// The Internal entry of `@fluent.xyz/connect`, imported as `@fluent.xyz/connect/internal`: the
// helpers the widget is built from, importable by name and promised nothing (ADR 0008). A name
// here may change or go in any release; no lock test holds this list, and `docs/internal.md` is
// the host's guide. What is promised is `./index.ts`.
//
// This entry imports no polyfill: nothing it reaches needs the Buffer global.

export {
  fluentMainnetTokenDefaults,
  fluentTestnetTokenDefaults,
  fluentTokenIdentity,
  getFluentDefaultWidgetDisplayTokens,
  getFluentTokenDefaultsForNetwork,
  isFluentNativeToken,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent.xyz/connect-sdk";
export {
  createFluentFamiliesClient,
  type FluentFamilies,
  type FluentFamiliesClient,
  type FluentFamiliesClientConfig,
  type FluentFamily,
  type FluentFamilyTier,
  type FluentFamilyType,
} from "@fluent.xyz/connect-sdk";
export {
  buildFluentTransferCall,
  fluentTransferAbi,
  parseFluentTransferAmount,
  parseFluentTransferRecipient,
  type FluentTransferAmount,
  type FluentTransferRecipient,
} from "./widget/tokenTransfer";
export {
  getFluentExplorerBaseUrl,
  isFaucetNetwork,
  normalizeFluentWidgetNetwork,
} from "./core/network";
export { buildFluentBridgeUrl } from "./utils/buildFluentBridgeUrl";
