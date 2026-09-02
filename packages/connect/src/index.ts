export {
  FLUENT_WIDGET_SESSION_STORAGE_KEY,
  FLUENT_CONNECT_DEFAULT_ASSETS,
} from "./core/config";
export type { FluentWidgetConfig, FluentWidgetSession, FluentWidgetAuthMode, ResolvedFluentWidgetConfig } from "./core/config";
export {
  normalizeFluentWidgetNetwork,
  resolveFluentWidgetNetworkFromEnv,
} from "./core/environment";
export {
  getFluentChainForNetwork,
  getFluentDefaultDisplayTokens,
  getFluentDefaultGasTokens,
  getFluentExplorerBaseUrl,
  getFluentTokenDefaults,
  isFaucetNetwork,
  type FluentWidgetNetwork,
} from "./core/network";
export {
  FluentWidgetNetworkProvider,
  useFluentWidgetNetwork,
} from "./widget/widgetNetworkContext";
export { useFluentWidget, useWidget } from "./widget/widgetContext";
export { useFluentUserTokens } from "./hooks/useFluentUserTokens";
export {
  createFluentUserTokenStore,
  FLUENT_USER_TOKEN_LIMIT,
  type FluentUserTokenAddResult,
  type UserTokenStore,
} from "./core/userTokens";
export { FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY } from "./core/storageKeys";
export * from "./core/types";
export * from "./widget/batchOperation";
export * from "./core/gasPayment";
export * from "./widget/permissionSession";
export * from "./widget/FluentWidget";
export { FluentWidgetConnectButton } from "./components/FluentWidgetConnectButton";
export type { FluentWidgetConnectButtonProps } from "./components/FluentWidgetConnectButton";
export * from "./core/zerodevPaymaster";
export * from "./widget/zerodevSession";
export { clearPrivyRecentLoginMethod } from "./utils/clearPrivyRecentLoginMethod";
export { CallType, ParamCondition } from "@zerodev/permissions/policies";

/** Re-export headless helpers so apps only need `@fluent.xyz/connect`. */
export {
  fluent,
  fluentTestnet,
  fluentMainnet,
  fluentChain,
  fluentDefinitionToViemChain,
  l1DefinitionToViemChain,
  fluentTestnetTokenDefaults,
  fluentTestnetWidgetTokens,
  fluentMainnetTokenDefaults,
  fluentMainnetWidgetTokens,
  fluentTokenKey,
  getFluentTokenDefaultsForNetwork,
  getFluentDefaultWidgetDisplayTokens,
  getFluentDefaultWidgetGasTokens,
  isFluentNativeToken,
  findFluentSymbolCollisions,
  mergeFluentDisplayTokens,
  readFluentTokenBalances,
  readFluentTokenMetadata,
  createFluentClient,
  createFluentFamiliesClient,
  createFluentPermissionClient,
  fluentBridgeAbi,
  getContractAddressFromChain,
  resolveBridgeAddresses,
  resolveL1Definition,
  // Registry data records are re-exported under a fluent* prefix: bare `apps`,
  // `integrations` and `l1Chains` say nothing about where they come from once
  // they are part of this package's public API.
  apps as fluentApps,
  integrations as fluentIntegrations,
  l1Chains as fluentL1Chains,
  fluentChains,
  fluentZeroDevChainIds,
  getApp,
  getFluentChain,
  getFluentChainByChainId,
  getL1Chain,
  getL1ForFluentChain,
  getZerodevIntegration,
  getZeroDevRpcUrl,
  isFluentZeroDevChain,
  registryVersion,
  type FluentSession,
  type BridgeAddresses,
  type FluentClient,
  type FluentClientConfig,
  type FluentCallPermission,
  type FluentPermissionClient,
  type FluentPermissionClientConfig,
  type FluentPermissionGrant,
  type FluentPermissionGrantRequest,
  type FluentPermissionPreview,
  type FluentPermissionStatus,
  type FluentSpendPeriod,
  type FluentSpendPermission,
  type FluentTokenBalance,
  type FluentTokenDefinition,
  type FluentFamilies,
  type FluentFamiliesClient,
  type FluentFamiliesClientConfig,
  type FluentFamily,
  type FluentFamilyTier,
  type FluentFamilyType,
  type AppDefinition,
  type FluentChainDefinition,
  type L1ChainDefinition,
  type ZerodevIntegration,
} from "@fluent.xyz/connect-sdk";
// FluentPermissionPolicy is intentionally not re-exported: `./permissionSession`
// already exports a different type under that name.

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
