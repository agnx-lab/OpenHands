// 场景：OpenHands Sub App 常量（AppId / 命令 / 面板 / ensure 相对路径 / 默认端口）。
export const OPENHANDS_APP_ID = "openhands";
export const OPENHANDS_PANEL_ID = "openhands.main";
export const OPENHANDS_OPEN_COMMAND_ID = "openhands.open";

/** 短跑 sidecar：复用或拉起上游 Agent Canvas 栈（ingress 8100）。 */
export const OPENHANDS_ENSURE_TOOL_REL = ".agnx/tools/ensure-openhands.mjs";

/** 上游默认 ingress 端口（config/defaults.json 里是 8000，本项目统一 8100）。 */
export const DEFAULT_OPENHANDS_PORT = 8100;
