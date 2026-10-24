#!/usr/bin/env node
/**
 * 场景：短跑 sidecar — 确保 OpenHands Agent Canvas 栈（ingress + agent-server + automation）已在 127.0.0.1:<port> 上；
 *       端口已健康则复用，指纹不一致或 --force-restart 则停旧再起。
 * 用法：node .agnx/tools/ensure-openhands.mjs [--port <n>] [--work-dir <dataRoot>] [--force-restart] [--supervised]
 * stdout：最后一行单行 JSON { ok, port, origin, reused, pid, upstreamRoot, warnings? }；失败 { ok:false, error } 且 exitCode=1
 *
 * 上游启动方式（不改造上游，只传启动参数/端口/HOME）：
 *   <repoRoot>/bin/agent-canvas.mjs --port <port>
 *     ├─ ingress（静态前端 + 反向代理） : <port>
 *     ├─ static-server (build/)        : OH_CANVAS_SAFE_VITE_PORT
 *     ├─ agent-server (uvx Python)     : OH_CANVAS_SAFE_BACKEND_PORT
 *     └─ automation  (uvx Python)      : OH_CANVAS_SAFE_AUTOMATION_PORT
 * 上游引擎要求 node>=24：优先使用本机 nvm 的 Node 24 解释器。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, constants as fsConstants, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 上游整仓根 = openhands/（.agnx 的上一级） */
const upstreamRoot = path.resolve(__dirname, "../..");
const entryScript = path.join(upstreamRoot, "bin", "agent-canvas.mjs");
const buildIndex = path.join(upstreamRoot, "build", "index.html");
const defaultPort = 8100;

/** 内部服务端口基址（避开 3001 / 18000 等常被占用的默认值）。 */
const INTERNAL_BASE = 18100;

const NODE24_CANDIDATES = [
  process.env.AGNX_OPENHANDS_NODE,
  path.join(homedir(), ".nvm/versions/node/v24.21.0/bin/node"),
].filter(Boolean);

function traceEnsure(phase, fields) {
  process.stderr.write(`[ensure-openhands] ${JSON.stringify({ phase, ...fields })}\n`);
}

function parseArgs(argv) {
  let workDir = process.env.AGNX_APP_DATA_ROOT || "";
  let port = defaultPort;
  let forceRestart = false;
  let supervised = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--work-dir" || arg === "--workDir") && next) {
      workDir = String(next).trim();
      i += 1;
    } else if (arg === "--port" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) {
        port = n;
      }
      i += 1;
    } else if (arg === "--force-restart" || arg === "--forceRestart") {
      forceRestart = true;
    } else if (arg === "--supervised") {
      supervised = true;
    }
  }
  return {
    workDir: workDir || path.join(upstreamRoot, ".agnx-openhands-runtime"),
    port,
    forceRestart,
    supervised,
  };
}

function fingerprint(cfg) {
  return JSON.stringify({ upstreamRoot, port: cfg.port, entry: "bin/agent-canvas.mjs" });
}

async function readState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeState(statePath, payload) {
  await writeFile(statePath, JSON.stringify(payload, null, 2), "utf8");
}

function httpGet(url, timeout = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(0));
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
  });
}

/** ingress 存活即可视作健康：静态前端 200 就算通（后端未就绪时 /api 会 502，上游 UI 自己会提示）。 */
async function isIngressHealthy(port) {
  const code = await httpGet(`http://127.0.0.1:${port}/`);
  return code >= 200 && code < 500;
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 1) {
    return false;
  }
  try {
    process.kill(n, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function stopPid(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) {
    return;
  }
  // 上游用 process-tree 方式起子进程；先整组 TERM 再兜底 KILL。
  try {
    process.kill(-n, "SIGTERM");
  } catch {
    try {
      process.kill(n, "SIGTERM");
    } catch {
      // ignore
    }
  }
}

async function pathExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isNode24(bin) {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(bin, ["-v"], { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout?.on("data", (c) => {
      out += c.toString();
    });
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(Number(out.trim().replace(/^v/, "").split(".")[0]) >= 24));
  });
}

async function resolveNode() {
  for (const candidate of NODE24_CANDIDATES) {
    if (candidate && existsSync(candidate) && (await isNode24(candidate))) {
      return { node: candidate, via: candidate };
    }
  }
  if (await isNode24(process.execPath)) {
    return { node: process.execPath, via: process.execPath };
  }
  return null;
}

async function waitForHealth(port, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isIngressHealthy(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function spawnDetached(command, args, { cwd, env }) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logBuf = "";
  const collect = (chunk) => {
    logBuf += chunk.toString();
    if (logBuf.length > 12_000) {
      logBuf = logBuf.slice(-12_000);
    }
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.unref();
  return { child, getLog: () => logBuf };
}

function buildEnv(cfg, nodeInfo) {
  const nodeDir = path.dirname(nodeInfo.node);
  // 上游默认前端端口 3001 常被别的 dev server 占用，这里统一挪到独立区间。
  const vitePort = INTERNAL_BASE + 11;
  const backendPort = INTERNAL_BASE;
  const automationPort = INTERNAL_BASE + 1;
  return {
    vitePort,
    backendPort,
    automationPort,
    env: {
      ...process.env,
      // 引擎要求 v24；PATH 前置 Node 24，保证上游自己 spawn 的 `node` 也是 24。
      PATH: `${nodeDir}:${process.env.PATH || ""}`,
      // 数据根：上游的 ~/.openhands/agent-canvas（api-key / secret-key / 会话）落到子应用数据目录。
      HOME: cfg.workDir,
      // 关键：npm_execpath 存在时上游会用 `npm run …` 起前端（会重新加载 Node 22 的 npm），
      // 这里清掉，走直连 node。
      npm_execpath: undefined,
      npm_node_execpath: undefined,
      PORT: String(cfg.port),
      OH_BIND_HOST: "127.0.0.1",
      OH_CANVAS_SAFE_VITE_PORT: String(vitePort),
      OH_CANVAS_SAFE_BACKEND_PORT: String(backendPort),
      OH_CANVAS_SAFE_AUTOMATION_PORT: String(automationPort),
      OH_CANVAS_SAFE_VSCODE_PORT: String(backendPort + 1000),
      // 首次 uvx 安装 Python 依赖较慢（litellm 30MB+），放宽 uv 超时。
      UV_HTTP_TIMEOUT: process.env.UV_HTTP_TIMEOUT || "600",
      AGENT_CANVAS_DISABLE_TELEMETRY: "1",
    },
  };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const warnings = [];
  await mkdir(cfg.workDir, { recursive: true });
  const statePath = path.join(cfg.workDir, "openhands.json");
  const wantedFp = fingerprint(cfg);

  if (!(await pathExists(entryScript))) {
    console.log(
      JSON.stringify({ ok: false, error: `上游入口缺失：${entryScript}`, upstreamRoot }),
    );
    process.exitCode = 1;
    return;
  }
  if (!(await pathExists(buildIndex))) {
    console.log(
      JSON.stringify({
        ok: false,
        error: `上游前端未构建：${buildIndex} 不存在。请在上游根执行 npm install && npm run build:app`,
        upstreamRoot,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const existing = await readState(statePath);
  const healthy = await isIngressHealthy(cfg.port);

  // 复用：端口已健康且指纹一致。
  if (!cfg.forceRestart && healthy && existing && existing.fingerprint === wantedFp) {
    traceEnsure("reuse", { port: cfg.port, pid: existing.pid ?? null });
    console.log(
      JSON.stringify({
        ok: true,
        reused: true,
        port: cfg.port,
        origin: `http://127.0.0.1:${cfg.port}`,
        pid: existing.pid ?? null,
        upstreamRoot,
        warnings: existing.warnings || [],
      }),
    );
    return;
  }
  // 端口健康但我们没有状态文件（别处已起）→ 也复用，不抢。
  if (!cfg.forceRestart && healthy && !existing) {
    traceEnsure("reuse-foreign", { port: cfg.port });
    console.log(
      JSON.stringify({
        ok: true,
        reused: true,
        port: cfg.port,
        origin: `http://127.0.0.1:${cfg.port}`,
        pid: null,
        upstreamRoot,
        warnings: ["端口已被非本子应用托管的进程占用，已复用"],
      }),
    );
    return;
  }

  if (existing) {
    stopPid(existing.pid);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  const nodeInfo = await resolveNode();
  if (!nodeInfo) {
    console.log(
      JSON.stringify({
        ok: false,
        error:
          "未找到 Node >= 24（上游 engines.node >= 24）。请安装 Node 24 或设置 AGNX_OPENHANDS_NODE 指向 node24 可执行文件。",
        node: process.version,
      }),
    );
    process.exitCode = 1;
    return;
  }
  warnings.push(`Node: ${nodeInfo.node} (${process.version} → v24 要求已满足)`);

  const { env, vitePort, backendPort, automationPort } = buildEnv(cfg, nodeInfo);
  const args = [entryScript, "--port", String(cfg.port)];

  // --supervised：daemon 自己托管进程，要的是「启动计划」而不是本脚本先起进程。
  // 契约（packages/server/src/workspace-apps/loopback-supervised-protocol.ts）：
  //   { ok:true, reused:false, plan:{ command, args, cwd, env, fingerprint, healthUrl, port } }
  if (cfg.supervised) {
    traceEnsure("supervised.plan", { port: cfg.port, command: nodeInfo.node });
    console.log(
      JSON.stringify({
        ok: true,
        reused: false,
        // env 必须是字符串字典：把 undefined 去掉。
        plan: {
          command: nodeInfo.node,
          args,
          cwd: upstreamRoot,
          env: Object.fromEntries(
            Object.entries(env).filter(([, v]) => typeof v === "string"),
          ),
          fingerprint: wantedFp,
          healthUrl: `http://127.0.0.1:${cfg.port}/`,
          port: cfg.port,
          launchMode: "packaged",
        },
        port: cfg.port,
        origin: `http://127.0.0.1:${cfg.port}`,
        upstreamRoot,
        warnings,
      }),
    );
    return;
  }

  traceEnsure("spawn", { command: nodeInfo.node, port: cfg.port, vitePort, backendPort, automationPort });

  const { child, getLog } = spawnDetached(nodeInfo.node, args, { cwd: upstreamRoot, env });

  const ready = await waitForHealth(cfg.port, 600_000);
  if (!ready) {
    stopPid(child.pid);
    const log = getLog().trim();
    console.log(
      JSON.stringify({
        ok: false,
        error: log
          ? `OpenHands 启动超时：${log.slice(-600)}`
          : "OpenHands 启动超时（检查 build/ 与 uvx 是否可用）",
        upstreamRoot,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const state = {
    fingerprint: wantedFp,
    port: cfg.port,
    pid: child.pid ?? null,
    origin: `http://127.0.0.1:${cfg.port}`,
    internalPorts: { static: vitePort, agentServer: backendPort, automation: automationPort },
    upstreamRoot,
    node: nodeInfo.node,
    warnings,
    updatedAt: Date.now(),
  };
  await writeState(statePath, state);

  console.log(
    JSON.stringify({
      ok: true,
      reused: false,
      port: cfg.port,
      origin: `http://127.0.0.1:${cfg.port}`,
      pid: child.pid ?? null,
      upstreamRoot,
      warnings,
    }),
  );
}

main().catch((error) => {
  console.log(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
