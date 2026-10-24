// 场景：OpenHands Host 绑定单例 — 面板与入口共用。
import type { WorkspaceAppHostApi } from "@agnx-lab/app-sdk";

let boundHost: WorkspaceAppHostApi | null = null;

export function bindOpenHandsHost(host: WorkspaceAppHostApi): void {
  boundHost = host;
}

export function getBoundHost(): WorkspaceAppHostApi | null {
  return boundHost;
}

export function requireBoundHost(): WorkspaceAppHostApi {
  if (!boundHost) {
    throw new Error("OpenHands Host 尚未绑定");
  }
  return boundHost;
}
