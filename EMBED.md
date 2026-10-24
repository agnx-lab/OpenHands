## 上游嵌入

- 上游：`OpenHands/OpenHands`（npm 包 `@openhands/agent-canvas@1.27.1`），许可证 **MIT**
  - 版本依据：`package.json` `version: 1.27.1` + `config/defaults.json` `versions.agentCanvas: 1.27.1`
  - 源码为用户提供的整仓快照 `/Users/apple/Downloads/OpenHands-main`（**无 `.git`**，故无 commit 号）；副本在 `$AGNX_HOME/apps/openhands/`，原件未改动
- 上游原生平台：桌面 ✅（`electron/` + `electron-builder.config.mjs` + `npm run build:desktop`）| 网页 ✅（React Router 7 SPA，`ssr:false`，`build/` + `scripts/static-server.mjs`）| 移动 ❌（仓库无 iOS/Android 工程）
- 工作方式：**原样嵌入（首选路线，未退回 mock）** —— 使用上游自己的全栈入口 `bin/agent-canvas.mjs`，Agnx 只做 `host.guest.mount` 的 iframe 承载
- 上游改动清单：**无**（未改任何 `.ts`/`.tsx`/`package.json`/脚本；`build/` 是上游自己 `npm run build:app` 的产物）

### 挂载

- 挂载：`guest.auth=none` / 策略 `auto`（direct-iframe 优先，同源 8100）
  - API key 不走 Agnx：上游 `ingress` → `static-server --session-api-key` 在 HTML 里注入 `window.__AGENT_CANVAS_SESSION_API_KEY__` 并写 `localStorage['openhands-agent-server-config']`
- 启动：`ensureTool=.agnx/tools/ensure-openhands.mjs`，端口 **8100**，上游命令
  `<node24> bin/agent-canvas.mjs --port 8100`
- 上游自带的四层（ensure 全部用环境变量指定端口，不改代码）：

  | 层 | 角色 | 端口 | 指定方式 |
  | --- | --- | --- | --- |
  | ingress | 静态前端 + 反向代理（对 Agnx 暴露的唯一入口） | **8100** | `--port` / `PORT` |
  | static-server | serve `build/` | 18111 | `OH_CANVAS_SAFE_VITE_PORT` |
  | agent-server | `uvx --from openhands-agent-server==1.55.1`（Python） | 18100 | `OH_CANVAS_SAFE_BACKEND_PORT` |
  | automation | `uvx --from openhands-automation==1.21.0`（Python） | 18101 | `OH_CANVAS_SAFE_AUTOMATION_PORT` |
  | vscode | 内置编辑器，经 ingress `/vscode` 暴露 | 19100 | `OH_CANVAS_SAFE_VSCODE_PORT` |

- 面板与 Tab：`openhands.main`（走 `ensureTool`），命令 `openhands.open`，侧栏 label `OpenHands`（order 59）
- 数据落盘：`$AGNX_HOME/apps/data/openhands/`
  - `openhands.json`：sidecar 状态（pid / fingerprint / 内部端口），供复用与 `--force-restart` 停旧
  - `.openhands/agent-canvas/`：上游全部运行时状态（`api-key.txt`、`secret-key.txt`、`logs/`、会话）；由 `HOME=$workDir` 决定，**不写用户真实 `~/.openhands`**

### 构建与验收实测（2026-10-19）

```text
# 依赖（Node 24，1376 包，约 1 分钟）
npm install --ignore-scripts --no-audit --no-fund

# 上游真实模式构建 → build/（11 MB）
npm run build:app            → exit 0，build/index.html 有 <title>OpenHands</title>

# 胶水
node .agnx/scripts/build.mjs → .agnx/dist/index.js（4.6 kb，含 openhands.main / openhands.open）

# ensure：首启（ok:true, reused:false）
$ node .agnx/tools/ensure-openhands.mjs --port 8100 --work-dir /tmp/openhands-probe
{"ok":true,"reused":false,"port":8100,"origin":"http://127.0.0.1:8100","pid":9907,...}

# ensure：再次调用 → 复用
{"ok":true,"reused":true,"port":8100,"pid":9907,...}

# HTTP
GET http://127.0.0.1:8100/           → 200，<title>OpenHands</title>
GET http://127.0.0.1:8100/server_info → 200（agent-server 就绪后；未就绪时 502，属上游对「后端未起」的正常应答）
GET http://127.0.0.1:8100/api/automation/health → 200（automation 就绪后）

# manifest
python3 -m json.tool .agnx/manifest.json → 通过
另用宿主真实解析器（packages/server/dist/server/workspace-apps/manifest*.js）校验：
  parseWorkspaceAppManifestJson → ok；icon 解析到 build/favicon.svg；
  guest / sidecar / platforms 三段全部通过；isSupervisedLoopbackEnsureTool → true
```

- 浏览器首屏（Playwright + 本机 Chrome，1440×900）：完整渲染上游中文 onboarding「检查后端 / 选择智能体 / 设置你的 LLM / 打个招呼」，**未白屏**；后端未就绪时上游自行显示「未连接」提示条。

### 已知限制

1. **Node ≥ 24**：上游 `engines.node >= 24`，本机默认 v22.22.1。ensure 会自动探测 `~/.nvm/versions/node/v24.21.0/bin/node`（可用 `AGNX_OPENHANDS_NODE` 覆盖），并把该目录前置进 `PATH`，保证上游自己 spawn 的 `node` 也是 24；找不到 Node 24 时明确报 `ok:false` 而不是硬跑。
2. **首次启动慢且必须联网**：agent-server / automation 由 `uvx` 从 PyPI 安装（含 litellm 34 MB 等），冷启可达 5～10 分钟；且上游**要等 agent-server 就绪才起 ingress**，这期间 8100 不可达。命中 uv 缓存后约 1～2 分钟。ensure 健康等待 600 s，面板 `timeoutMs` 600 s。
3. **uv 网络超时**：uv 默认 30 s 超时，本机实测会让 `litellm==1.106.0` 解包失败（`Failed to download ... network timeout`），automation 直接退出。ensure 默认注入 `UV_HTTP_TIMEOUT=600`。
4. **端口冲突**：上游默认前端端口 `3001` 常被别的 vite 占用，且上游 `assertPortsFree` 命中即 Fatal。ensure 把内部端口整体挪到 `18100/18101/18111/19100`，与宿主和其他子应用隔离。
5. **`npm_execpath`**：若父进程带了 npm 的 `npm_execpath`，上游会用 `npm run dev:static` 起前端（重新载入宿主默认的 Node 22 npm）。ensure 主动清空该变量，走直连 node。
6. **模型凭据**：真实对话需用户在上游设置页自行填模型 API Key，本子应用不注入任何模型凭据（属上游既有 onboarding）。
7. **`build/` 是构建产物**：删除后需重跑 `npm run build:app`；ensure 检测不到 `build/index.html` 会直接给出可读错误。
8. **单实例单端口**：key 持久化在数据根，多 Tab 共用同一栈；不支持同时起两个 8100 实例。
9. **已禁用遥测**：ensure 注入 `AGENT_CANVAS_DISABLE_TELEMETRY=1`（上游原生开关），不外发 PostHog 安装事件。

## 嵌页宿主能力缺口

| 上游能力 | 信号位置 | 嵌后风险 | 处置 | 主路径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| WebSocket（`/sockets`，Agent 事件流） | `scripts/ingress.mjs` 代理 `/sockets` → agent-server | iframe 内 WS 被宿主策略截断则流式对话不更新 | manifest 声明 `capabilities:["websocket"]` | direct-iframe（同源 8100） | ingress 已做 WS 升级 |
| localStorage / cookies 存 API key | `build/index.html` 注入脚本写 `openhands-agent-server-config` | 跨重启 key 漂移 → 界面「未连接」 | 声明 `capabilities:["cookies"]`；上游每次启动都覆盖写运行时 key | direct-iframe | 前提是 iframe 未被 storage 分区隔离 |
| 内置编辑器（openvscode-server） | ingress `/vscode` → `:19100` | 编辑器是再套一层 iframe，宿主快捷键捕获层可能吃掉按键 | 未改上游；面板开 `iframeShortcutCapture:true` | direct-iframe | 随 agent-server 拉起，首次较慢 |
| PostHog 遥测 | `config/defaults.json` → `telemetry` | 向外发安装事件 | ensure 注入 `AGENT_CANVAS_DISABLE_TELEMETRY=1` | — | 上游原生开关，不改代码 |
| 桌面原生壳 | `electron/` + `--desktop` | 未使用上游 Electron 壳 | 有意跳过：Agnx 桌面已是窗口宿主 | Web iframe | 原生菜单等能力不在本次范围 |
| 文件/目录选择器 | agent-server 侧路径 | 选的是 agent-server 视角的路径，不是 Agnx 工作区目录 | 未处理 | — | 已知差异，不影响首屏与对话 |
