// 场景：OpenHands 薄壳面板 — host.guest.mount 嵌入受管 Agent Canvas 栈（L8 Guest Surface）。
// 首帧即品牌扫光（消灭空 host 黑屏）；mount 时 bootOverlay:false，由面板独自持有遮罩。
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  WorkspaceAppBrandLogoLoaderPanelProps,
  WorkspaceAppHostApi,
} from "@agnx-lab/app-sdk";
import {
  DEFAULT_OPENHANDS_PORT,
  OPENHANDS_APP_ID,
  OPENHANDS_ENSURE_TOOL_REL,
} from "./constants";
import { bindOpenHandsHost, requireBoundHost } from "./host-bind";

const WEB_ROOT_STYLE: CSSProperties = {
  flex: "1 1 0%",
  alignSelf: "stretch",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  backgroundColor: "transparent",
};

const GUEST_HOST_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const BOOT_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  background: "rgb(9, 9, 11)",
};

const ERROR_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 3,
  display: "flex",
  flexDirection: "column",
  background: "rgba(9,9,11,0.88)",
};

const ERROR_FALLBACK_STYLE: CSSProperties = {
  ...ERROR_LAYER_STYLE,
  alignItems: "center",
  justifyContent: "center",
  color: "#a1a1aa",
  padding: 24,
  textAlign: "center",
};

const RETAIN_REASON = "openhands-open";

const styles = StyleSheet.create((theme) => ({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
    backgroundColor: "transparent",
  },
  fallbackText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

export function bindOpenHandsPanelHost(host: WorkspaceAppHostApi): void {
  bindOpenHandsHost(host);
}

function getHost(): WorkspaceAppHostApi {
  return requireBoundHost();
}

function canUseGuestSurface(): boolean {
  return typeof document !== "undefined" && getHost().platform.isWeb;
}

export function OpenHandsPanel(_props: {
  appId: string;
  panelId: string;
  entityId: string;
}): ReactElement {
  const guestHostRef = useRef<HTMLDivElement | null>(null);
  /** 首帧即 true：在 ensure / mount 之前盖住空 host，避免黑屏。 */
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = getHost();
    host.background?.requestRetain?.({
      appId: OPENHANDS_APP_ID,
      active: true,
      reason: RETAIN_REASON,
    });
    return () => {
      host.background?.requestRetain?.({
        appId: OPENHANDS_APP_ID,
        active: false,
        reason: RETAIN_REASON,
      });
    };
  }, []);

  useEffect(() => {
    if (!canUseGuestSurface()) {
      setBooting(false);
      setError("当前平台暂不支持嵌入 OpenHands，请使用 Agnx 桌面端或网页端。");
      return;
    }

    let cancelled = false;
    let unmountGuest: (() => void) | null = null;

    const mountGuest = () => {
      const host = getHost();
      const container = guestHostRef.current;
      if (!container) {
        return;
      }
      if (!host.guest?.mount) {
        setBooting(false);
        setError("宿主未提供 host.guest（需升级 Agnx 并重新扫描子应用）");
        return;
      }

      unmountGuest?.();
      unmountGuest = null;
      setBooting(true);
      setError(null);

      try {
        // 面板首帧已盖品牌遮罩；关闭宿主再挂，避免卸节点闪黑。
        unmountGuest = host.guest.mount({
          container,
          ensureTool: OPENHANDS_ENSURE_TOOL_REL,
          ensureArgs: ["--port", String(DEFAULT_OPENHANDS_PORT)],
          // 上游首启可能要 uvx 装 Python 依赖（首次 5~10 分钟），给足超时。
          timeoutMs: 600_000,
          surfaceReadyTimeoutMs: 60_000,
          bootOverlay: false,
          onReady: () => {
            if (!cancelled) {
              setError(null);
              window.setTimeout(() => {
                if (!cancelled) {
                  setBooting(false);
                }
              }, 280);
            }
          },
          onError: (detail) => {
            if (!cancelled) {
              setBooting(false);
              setError(`${detail.code}: ${detail.message}`);
            }
          },
        });
      } catch (err) {
        setBooting(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    mountGuest();

    return () => {
      cancelled = true;
      unmountGuest?.();
    };
  }, []);

  if (!canUseGuestSurface()) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{error ?? "加载中…"}</Text>
      </View>
    );
  }

  const BrandPanel = getHost().ui?.BrandLogoLoaderPanel as
    | ComponentType<WorkspaceAppBrandLogoLoaderPanelProps>
    | undefined;

  return (
    <div style={WEB_ROOT_STYLE} data-testid="workspace-mini-app-openhands-root">
      <div ref={guestHostRef} data-agnx-guest-surface-host="true" style={GUEST_HOST_STYLE} />
      {booting && !error && BrandPanel ? (
        <div data-agnx-guest-boot-overlay="true" style={BOOT_LAYER_STYLE} role="status">
          <BrandPanel
            title="正在启动 OpenHands…"
            description="正在准备 Agent Canvas"
            testID="openhands-boot-overlay"
          />
        </div>
      ) : null}
      {booting && !error && !BrandPanel ? (
        <div
          data-agnx-guest-boot-overlay="true"
          style={{ ...BOOT_LAYER_STYLE, ...ERROR_FALLBACK_STYLE }}
          role="status"
        >
          正在启动 OpenHands…
        </div>
      ) : null}
      {error && BrandPanel ? (
        <div style={ERROR_LAYER_STYLE} role="alert">
          <BrandPanel
            title={error}
            description="首次启动需要 uvx 拉取 Python agent-server，请检查网络后重开 Tab。"
            testID="openhands-mount-error"
          />
        </div>
      ) : null}
      {error && !BrandPanel ? (
        <div style={ERROR_FALLBACK_STYLE} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export { OpenHandsPanel as OpenHandsEmbedPanel };
