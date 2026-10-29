// First statement on purpose: the Buffer global must exist before any Privy or ZeroDev
// module runs. See ./polyfills/buffer.
import "./polyfills/buffer";

// The public API of `@fluent.xyz/connect`, name by name. Every name here is a promise kept
// after 0.6.0 (docs/standards/public-api.md A1), except what its TSDoc tags `@experimental`,
// which may change or be removed in a minor release; `test/exports.test.ts` holds the list.

export { FluentWidget } from "./widget/FluentWidget";
export type {
  FluentWidgetConnectButtonRenderContext,
  FluentWidgetProps,
  FluentWidgetRenderContext,
} from "./widget/FluentWidget";
export { useFluentWidget } from "./widget/widgetContext";

export { FluentWidgetConfigError } from "./core/config";
export type {
  FluentWidgetAssets,
  FluentWidgetAuthMethod,
  FluentWidgetConfig,
  FluentWidgetConfigErrorCode,
  FluentWidgetExecution,
  FluentWidgetExecutionSource,
  FluentWidgetSession,
} from "./core/config";
export { getFluentChainForNetwork, type FluentWidgetNetwork } from "./core/network";
export type {
  FluentExternalWalletState,
  FluentWalletChoice,
  FluentWidgetStatus,
} from "./core/types";

export type {
  FluentAccountCapabilities,
  FluentAccountType,
  FluentBatchApi,
  FluentBatchCallInput,
  FluentBatchOperation,
  FluentBatchOperationExecuteOptions,
  FluentBatchOperationInput,
  FluentEncodedBatchCall,
  FluentExecuteResult,
  FluentExecuteTiming,
  FluentExecuteTimingInstants,
  FluentGasPayment,
  FluentSigningMode,
  FluentWidgetAccount,
  FluentWidgetExecutionStatus,
  FluentWidgetGasPayment,
} from "./widget/batchOperation";
export type { FluentSignApi } from "./widget/signRequest";
export type { FluentGasPaymentEthRates, FluentGasTokenSymbol } from "./core/gasPayment";
export {
  FluentUserOperationGasError,
  type FluentFixedAccountGas,
  type FluentFixedPaymasterGas,
  type FluentUserOperationGas,
  type FluentUserOperationGasErrorCode,
} from "./core/userOperationGas";

export { FluentAuthError, type FluentAuthErrorCode } from "./core/authToken";
export {
  FluentReviewRejectedError,
  type FluentReviewRejectedErrorCode,
} from "./widget/reviewRejected";
export {
  FluentSponsorshipFallbackError,
  type FluentSponsorshipReason,
} from "./core/sponsorshipFailure";

export type { FluentLinkXResult, FluentXAccount } from "./core/linkX";
export { useLinkX, type FluentLinkXStatus } from "./widget/hooks/useLinkX";

export {
  useFluentIframeBridge,
  type UseFluentIframeBridgeOptions,
} from "./widget/hooks/useFluentIframeBridge";
export type { FluentIframeElement } from "./widget/iframeBridge";

export { AccountAvatar, type AccountAvatarProps } from "./components/AccountAvatar";

export type { FluentTokenDefinition } from "./core/tokenDefinition";
export {
  fluentMainnet,
  fluentTestnet,
  getFluentChainByChainId,
  type FluentChainDefinition,
} from "@fluent.xyz/connect-sdk";

export type { FluentPrivyAdapter } from "./widget/privyAdapter";
