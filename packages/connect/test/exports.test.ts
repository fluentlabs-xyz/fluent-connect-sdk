// @vitest-environment node
/**
 * The export list of `@fluent.xyz/connect` 0.6.0, held literally (FLU-1622, criteria 1.1, 1.2
 * and 2.1).
 *
 * A failure here means the change broke the public API: fix the change, never this file; the
 * file changes only by the maintainer's own edit.
 *
 * 0.6.0 is the last release allowed to break the API: every name this file holds is a promise
 * kept after mainnet, apart from what its TSDoc tags `@experimental`, which a minor release may
 * still change or remove. So the list changes only by an edit a person makes on purpose. The
 * names are read by the TypeScript checker (`test/apiCensus.ts`), which resolves the `export *`
 * lines of `src/index.ts` the way a builder's compiler does, and the built `dist/index.d.ts` a
 * builder's compiler reads is held to the same list. Nothing is faked.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

import { apiCensus, type CensusRow } from "./apiCensus";

/** The kept values of the Issue's Outcome, sorted. */
const KEPT_VALUES = [
  "AccountAvatar",
  "FluentAuthError",
  "FluentReviewRejectedError",
  "FluentSponsorshipFallbackError",
  "FluentUserOperationGasError",
  "FluentWidget",
  "FluentWidgetConfigError",
  "fluentMainnet",
  "fluentTestnet",
  "getFluentChainByChainId",
  "getFluentChainForNetwork",
  "useFluentIframeBridge",
  "useFluentWidget",
  "useLinkX",
];

/** The kept types of the Issue's Outcome, sorted. */
const KEPT_TYPES = [
  "AccountAvatarProps",
  "FluentAccountCapabilities",
  "FluentAccountType",
  "FluentAuthErrorCode",
  "FluentBatchApi",
  "FluentBatchCallInput",
  "FluentBatchOperation",
  "FluentBatchOperationExecuteOptions",
  "FluentBatchOperationInput",
  "FluentChainDefinition",
  "FluentEncodedBatchCall",
  "FluentExecuteResult",
  "FluentExecuteTiming",
  "FluentExecuteTimingInstants",
  "FluentExternalWalletState",
  "FluentFixedAccountGas",
  "FluentFixedPaymasterGas",
  "FluentGasPayment",
  "FluentGasPaymentEthRates",
  "FluentGasTokenSymbol",
  "FluentIframeElement",
  "FluentLinkXResult",
  "FluentLinkXStatus",
  "FluentPrivyAdapter",
  "FluentReviewRejectedErrorCode",
  "FluentSignApi",
  "FluentSigningMode",
  "FluentSponsorshipReason",
  "FluentTokenDefinition",
  "FluentUserOperationGas",
  "FluentUserOperationGasErrorCode",
  "FluentWalletChoice",
  "FluentWidgetAccount",
  "FluentWidgetAssets",
  "FluentWidgetAuthMethod",
  "FluentWidgetConfig",
  "FluentWidgetConfigErrorCode",
  "FluentWidgetConnectButtonRenderContext",
  "FluentWidgetExecution",
  "FluentWidgetExecutionSource",
  "FluentWidgetExecutionStatus",
  "FluentWidgetGasPayment",
  "FluentWidgetNetwork",
  "FluentWidgetProps",
  "FluentWidgetRenderContext",
  "FluentWidgetSession",
  "FluentWidgetStatus",
  "FluentXAccount",
  "UseFluentIframeBridgeOptions",
];

/** Appendix A of the Issue: the 188 names 0.5.x exported and 0.6.0 does not. */
const REMOVED = [
  "AppDefinition", "BackendUserTokenStore", "BridgeAddresses", "Button", "CallType", "Dialog",
  "DialogClose", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader",
  "DialogOverlay", "DialogPortal", "DialogTitle", "DialogTrigger", "FLUENT_CONNECT_DEFAULT_ASSETS",
  "FLUENT_GAS_PAYMENT_DEFAULT_ETH_RATES", "FLUENT_USER_TOKEN_LIMIT",
  "FLUENT_WIDGET_DEFAULT_GAS_TOKEN", "FLUENT_WIDGET_SESSION_STORAGE_KEY",
  "FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY", "FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY",
  "FLUENT_ZERODEV_ERC20_PAYMASTER_QUERY", "FLUENT_ZERODEV_PAYMASTER_DEMO_RECIPIENT",
  "FluentAccountDrawer", "FluentBatchConfirmationMode", "FluentBatchOperationExecutor",
  "FluentBatchOperationReview", "FluentCallPermission", "FluentClient", "FluentClientConfig",
  "FluentFamilies", "FluentFamiliesClient", "FluentFamiliesClientConfig", "FluentFamily",
  "FluentFamilyTier", "FluentFamilyType", "FluentGasPaymentSelection", "FluentGasPaymentValueTier",
  "FluentIframeBridge", "FluentIframeBridgeOptions", "FluentIframeRpcError",
  "FluentIframeRpcExecutor", "FluentIframeRpcHandler", "FluentIframeRpcRequest",
  "FluentPermissionApi", "FluentPermissionArgConstraint", "FluentPermissionArgs",
  "FluentPermissionBatchPolicy", "FluentPermissionBatchPolicyInput", "FluentPermissionCallInput",
  "FluentPermissionCallPolicy", "FluentPermissionClient", "FluentPermissionClientConfig",
  "FluentPermissionGrant", "FluentPermissionGrantRequest", "FluentPermissionPolicy",
  "FluentPermissionPolicyBuilders", "FluentPermissionPreview", "FluentPermissionSession",
  "FluentPermissionSessionExecutor", "FluentPermissionSessionInput", "FluentPermissionStatus",
  "FluentPortalContainerProvider", "FluentProfile", "FluentSession", "FluentSettingsClient",
  "FluentSettingsError", "FluentSettingsErrorCode", "FluentSignatureReview", "FluentSpendPeriod",
  "FluentSpendPermission", "FluentTokenBalance", "FluentTokenTransferOutcome",
  "FluentTokenTransferRequest", "FluentTokenTransferSender", "FluentTransferAmount",
  "FluentTransferFee", "FluentTransferRecipient", "FluentTypedDataRequest", "FluentUserSettings",
  "FluentUserSettingsPatch", "FluentUserTokenAddResult", "FluentWidgetConnectButton",
  "FluentWidgetConnectButtonProps", "FluentWidgetNetworkProvider",
  "FluentZeroDevErc20PaymasterToken", "FluentZeroDevErc20PaymasterTokenInfo",
  "FluentZeroDevKernel", "FluentZeroDevPaymasterDemoResult", "FluentZeroDevPaymasterKernel",
  "FluentZeroDevPermissionCall", "FluentZeroDevPermissionSession", "FluentZeroDevSignerMode",
  "FluentZeroDevSponsorshipTokenSource", "Icon", "IconName", "L1ChainDefinition", "Label",
  "ParamCondition", "ResolvedFluentWidgetConfig", "ResolvedFluentWidgetExecution", "Separator",
  "Switch", "UserTokenStore", "WIDGET_STYLE_SCOPE", "WalletMenuActionCard", "ZerodevIntegration",
  "buildFluentTransferCall", "buttonVariants", "checkFluentTransferFee",
  "clearPrivyRecentLoginMethod", "createFluentBackendUserTokenStore", "createFluentBatchOp",
  "createFluentClient", "createFluentFamiliesClient", "createFluentIframeBridge",
  "createFluentIframeRpcHandler", "createFluentPermissionApi", "createFluentPermissionClient",
  "createFluentPermissionPolicyBuilders", "createFluentPermissionSession",
  "createFluentSettingsClient", "createFluentSponsorshipRpcUrl", "createFluentUserTokenStore",
  "createFluentZeroDevErc20Paymaster", "createFluentZeroDevErc20PaymasterApprovalCall",
  "createFluentZeroDevErc20PaymasterClient", "createFluentZeroDevErc20PaymasterRpcUrl",
  "createFluentZeroDevPermissionSession", "createFluentZeroDevRpcUrl",
  "createFluentZeroDevSponsoredPaymaster", "deriveFluentGasEthRates", "findFluentSymbolCollisions",
  "fluent", "fluentApps", "fluentBridgeAbi", "fluentChain", "fluentChains",
  "fluentDefinitionToViemChain", "fluentIntegrations", "fluentL1Chains",
  "fluentMainnetTokenDefaults", "fluentTestnetTokenDefaults", "fluentTokenIdentity",
  "fluentTransferAbi", "fluentZeroDevChainIds", "getApp", "getContractAddressFromChain",
  "getFluentChain", "getFluentDefaultWidgetDisplayTokens", "getFluentDefaultWidgetGasTokens",
  "getFluentExplorerBaseUrl", "getFluentGasPaymentEthValue", "getFluentGasPaymentTokens",
  "getFluentGasPaymentValueTier", "getFluentGasTokenAddress", "getFluentTokenDefaults",
  "getFluentTokenDefaultsForNetwork", "getFluentZeroDevErc20PaymasterTokens", "getL1Chain",
  "getL1ForFluentChain", "getZeroDevRpcUrl", "getZerodevIntegration", "isFaucetNetwork",
  "isFluentDefaultToken", "isFluentNativeToken", "isFluentZeroDevChain", "l1DefinitionToViemChain",
  "mergeFluentDisplayTokens", "normalizeFluentWidgetNetwork", "parseFluentTransferAmount",
  "parseFluentTransferRecipient", "readFluentTokenBalances", "readFluentTokenMetadata",
  "registryVersion", "resolveBridgeAddresses", "resolveDefaultGasToken",
  "resolveFluentWidgetNetworkFromEnv", "resolveFluentZeroDevErc20PaymasterToken",
  "resolveL1Definition", "selectFluentGasPaymentToken", "sendFluentZeroDevErc20PaymasterDemo",
  "sortFluentGasTokens", "useFluentUserTokens", "useFluentWidgetNetwork",
  "useFluentZeroDevAccount", "useWidget",
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** The TSDoc tags the census reads. */
const TAGS = ["experimental", "deprecated", "internal", "beta", "alpha"];

let rows: CensusRow[] = [];

// Building the program over the package takes several seconds, more under load.
beforeAll(() => {
  rows = apiCensus();
}, 180_000);

/** A module specifier naming one of the two private packages bundled into the package. */
const PRIVATE_PACKAGE = /["'](@fluent\.xyz\/(?:registry|connect-sdk))(?:["'/])/g;

/**
 * The names the built `dist/index.d.ts` exports, read by the checker as a builder's compiler
 * reads them, and every declaration file that program loads.
 */
function builtDeclarations(entry: string): { exports: string[]; files: string[] } {
  const program = ts.createProgram([entry], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const symbol = source ? checker.getSymbolAtLocation(source) : undefined;
  return {
    exports: symbol ? checker.getExportsOfModule(symbol).map((exported) => exported.name) : [],
    files: program.getSourceFiles().map((file) => path.resolve(file.fileName)),
  };
}

/** The names `src/index.ts` lists one by one, read with the parser rather than the checker. */
function namesListedInEntry(): string[] {
  const file = path.join(ROOT, "packages/connect/src/index.ts");
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  return sf.statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) &&
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map((element) => element.name.text)
      : [],
  );
}

describe("criterion 1.1: the census the lock tests read", () => {
  it("returns one row per export, each with its name, kind, closure, externals and tags", () => {
    const names = rows.map((row) => row.name);
    expect(new Set(names).size).toBe(rows.length);
    // Every name the entry lists one by one is a row; the rest come from its `export *` lines.
    expect(namesListedInEntry().filter((name) => !names.includes(name))).toEqual([]);
    for (const row of rows) {
      expect(["value", "type"]).toContain(row.kind);
      expect(row.externals.every((pkg) => !pkg.startsWith("."))).toBe(true);
      expect(row.tags.every((tag) => TAGS.includes(tag))).toBe(true);
      for (const ref of row.closure) {
        expect(ref.at).toMatch(/^packages\/[^:]+:\d+$/);
        expect(existsSync(path.join(ROOT, ref.at.split(":")[0] ?? ""))).toBe(true);
        if (ref.exportedAs !== null) expect(names).toContain(ref.exportedAs);
      }
    }
  });

  it("reads kinds, closures, externals and tags the way the checker sees them", () => {
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("FluentWidget")?.kind).toBe("value");
    expect(byName.get("FluentWidgetProps")?.kind).toBe("type");
    // A declaration a signature reaches, with the name the entry exports it under.
    expect(byName.get("FluentWidgetProps")?.closure).toContainEqual({
      name: "FluentWidgetConfig",
      at: expect.stringMatching(/^packages\/connect\/src\/core\/config\.ts:\d+$/),
      exportedAs: "FluentWidgetConfig",
    });
    // A package outside `packages/*` the walk stopped at.
    expect(byName.get("FluentExternalWalletState")?.externals).toContain("viem");
    expect(byName.get("FluentWidgetProps")?.externals).toContain("@types/react");
    // A tag from the declaration's TSDoc.
    expect(byName.get("FluentWidgetExecution")?.tags).toContain("experimental");
  });
});

describe("criterion 1.2: the names @fluent.xyz/connect exports", () => {
  it("are exactly the 63 names of the kept list, 14 values and 49 types", () => {
    expect(KEPT_VALUES).toHaveLength(14);
    expect(KEPT_TYPES).toHaveLength(49);
    expect(rows.map((row) => row.name).sort()).toEqual([...KEPT_VALUES, ...KEPT_TYPES].sort());
    expect(
      rows
        .filter((row) => row.kind === "value")
        .map((row) => row.name)
        .sort(),
    ).toEqual([...KEPT_VALUES].sort());
  });

  it(
    "are the names the built dist/index.d.ts exports, and it reaches no private package",
    { timeout: 60_000 },
    () => {
      const dist = path.join(ROOT, "packages/connect/dist");
      const entry = path.join(dist, "index.d.ts");
      expect(existsSync(entry), "the package is built (turbo run build)").toBe(true);
      const built = builtDeclarations(entry);
      expect([...built.exports].sort()).toEqual([...KEPT_VALUES, ...KEPT_TYPES].sort());
      // The private packages are bundled into the JavaScript; a declaration file that still names
      // one leaves a builder's compiler with a module it cannot resolve.
      const files = built.files.filter((file) => file.startsWith(`${dist}${path.sep}`));
      expect(files).toContain(entry);
      const privateReferences = files.flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(PRIVATE_PACKAGE)].map(
          (match) => `${path.relative(ROOT, file)} names ${match[1] ?? ""}`,
        ),
      );
      expect(privateReferences).toEqual([]);
    },
  );
});

describe("criterion 2.1: the names 0.6.0 removes", () => {
  it("leaves none of Appendix A's 188 names on the package entry", () => {
    expect(new Set(REMOVED).size).toBe(188);
    const exported = new Set(rows.map((row) => row.name));
    expect(REMOVED.filter((name) => exported.has(name))).toEqual([]);
  });

  it("publishes no path into the source, so a removed name stays inside packages/", () => {
    const manifestPath = path.join(ROOT, "packages/connect/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      exports: Record<string, unknown>;
      files: string[];
    };
    expect(Object.keys(manifest.exports).sort()).toEqual([".", "./package.json", "./styles.css"]);
    expect(manifest.files.filter((entry) => entry.startsWith("src"))).toEqual([]);
  });

  it("has the built entry carry exactly the 14 kept values at runtime", { timeout: 60_000 }, () => {
    // In a child Node process, as `entryImport.node.test.ts` does: Vite would transform the import.
    const built = path.join(ROOT, "packages/connect/dist/index.js");
    expect(existsSync(built), "the package is built (turbo run build)").toBe(true);
    const entry = pathToFileURL(built).href;
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const entry = await import(${JSON.stringify(entry)});` +
          " console.log(JSON.stringify(Object.keys(entry)));",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
    );
    const keys = JSON.parse(output.trim().split("\n").at(-1) ?? "[]") as string[];
    expect(keys.filter((name) => REMOVED.includes(name))).toEqual([]);
    expect([...keys].sort()).toEqual([...KEPT_VALUES].sort());
  });
});
