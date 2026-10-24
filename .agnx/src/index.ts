// 场景：OpenHands Sub App 入口 — 薄壳 + ensure 拉起上游 Agent Canvas 栈 + iframe。
import type { WorkspaceAppHostApi, WorkspaceAppModule } from "@agnx-lab/app-sdk";
import {
  OPENHANDS_APP_ID,
  OPENHANDS_ENSURE_TOOL_REL,
  OPENHANDS_OPEN_COMMAND_ID,
  OPENHANDS_PANEL_ID,
} from "./constants";
import { bindOpenHandsPanelHost, OpenHandsPanel } from "./panel";

export const appId = OPENHANDS_APP_ID;

function openOpenHandsTab(
  host: WorkspaceAppHostApi,
  context?: {
    serverId?: string;
    workspaceId?: string;
    currentPathname?: string | null;
  },
): void {
  host.openMiniAppTab({
    appId: OPENHANDS_APP_ID,
    panelId: OPENHANDS_PANEL_ID,
    serverId: context?.serverId,
    workspaceId: context?.workspaceId,
    currentPathname: context?.currentPathname,
  });
}

export function activate(host: WorkspaceAppHostApi): void {
  bindOpenHandsPanelHost(host);

  host.registerMiniApp({
    id: OPENHANDS_PANEL_ID,
    appId: OPENHANDS_APP_ID,
    title: "OpenHands",
    component: OpenHandsPanel,
    iframeShortcutCapture: true,
    isolation: {
      mode: "iframe",
      sidecarTools: [OPENHANDS_ENSURE_TOOL_REL],
      note: "Tab iframe 加载上游 Agent Canvas 栈（ingress 8100）；ensure 短跑 sidecar 负责复用/拉起",
    },
  });

  host.registerCommand({
    id: OPENHANDS_OPEN_COMMAND_ID,
    appId: OPENHANDS_APP_ID,
    title: "OpenHands",
    keywords: ["openhands", "agent", "canvas", "agent-canvas", "openhands"],
    sidebarAction: {
      defaultVisible: true,
      label: "OpenHands",
      order: 59,
    },
    run: (context) => {
      openOpenHandsTab(host, context);
    },
  });
}

const moduleExport: WorkspaceAppModule = {
  appId: OPENHANDS_APP_ID,
  activate,
};

export default moduleExport;

export { OPENHANDS_APP_ID, OPENHANDS_OPEN_COMMAND_ID, OPENHANDS_PANEL_ID } from "./constants";
export { OpenHandsPanel } from "./panel";
