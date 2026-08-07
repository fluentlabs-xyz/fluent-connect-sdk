export {
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  FLUENT_CONNECT_DEFAULT_ASSETS,
} from "./config";
export type { FluentWidgetConfig, FluentWidgetSession, FluentWidgetAuthMode, ResolvedFluentWidgetConfig } from "./config";
export {
  normalizeFluentWidgetNetwork,
  resolveFluentWidgetNetworkFromEnv,
} from "./environment";
export {
  getFluentChainForNetwork,
  getFluentDefaultGasTokens,
  getFluentExplorerBaseUrl,
  getFluentTokenDefaults,
  isFaucetNetwork,
  type FluentWidgetNetwork,
} from "./network";
export {
  FluentWidgetNetworkProvider,
  useFluentWidgetNetwork,
} from "./widgetNetworkContext";
export * from "./types";
export * from "./batchOperation";
export * from "./gasPayment";
export * from "./permissionSession";
export * from "./FluentWidget";
export { FluentWidgetConnectButton } from "./components/FluentWidgetConnectButton";
export type { FluentWidgetConnectButtonProps } from "./components/FluentWidgetConnectButton";
export * from "./zerodevPaymaster";
export * from "./zerodevSession";
export { CallType, ParamCondition } from "@zerodev/permissions/policies";

/** Re-export headless helpers so apps only need `@fluent.xyz/connect`. */
export {
  fluent,
  fluentTestnet,
  fluentDevnet,
  fluentMainnet,
  fluentTestnetTokenDefaults,
  fluentTestnetWidgetTokens,
  fluentMainnetTokenDefaults,
  fluentMainnetWidgetTokens,
  fluentDevnetTokenDefaults,
  fluentDevnetWidgetTokens,
  getFluentTokenDefaultsForNetwork,
  getFluentDefaultWidgetGasTokens,
  readFluentTokenBalances,
  createFluentClient,
  createFluentFamiliesClient,
  createFluentPermissionClient,
  type FluentSession,
  type FluentTokenBalance,
  type FluentTokenDefinition,
  type FluentFamilies,
} from "@fluent.xyz/connect-sdk";

export { Button, buttonVariants } from "./components/ui/button";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
export { Separator } from "./components/ui/separator";
export { Icon } from "./components/Icon";
export type { IconName } from "./components/Icon";
