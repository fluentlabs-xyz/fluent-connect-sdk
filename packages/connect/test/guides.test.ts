// @vitest-environment node
/**
 * What the shipped guides and the glossary say about the 0.6.0 API.
 *
 * The guides are `README.md`, `INTEGRATION.md` (a stub that maps the old sections) and
 * `docs/**`, the files the package ships: a builder reads nothing else. Each case reads them as
 * text; where a case needs the API
 * itself (a type's members, a union's literals, an `@experimental` tag) it reads the census
 * `test/apiCensus.ts` builds with the TypeScript checker. `docs/api.md` (`apiDoc.test.ts`), the
 * error tables (`errorsDoc.test.ts`) and the examples (`docExamples.test.ts`) have cases of
 * their own. Whether a recipe gives the old name's result, and whether prose names its
 * conditions, is for review. Nothing is faked.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { apiCensus, type CensusRow } from "./apiCensus";
import {
  anchorsOf,
  docsFiles,
  fencedBlocks,
  INTERNAL_DOC,
  PACKAGE_ROOT,
  proseOf,
  readDoc,
  REPO_ROOT,
  sectionOf,
  shippedDocs,
  spanHolds,
  UPGRADE_DOC,
} from "./docsText";

const readRepo = (relative: string) => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const README = readDoc("README.md");
const UPGRADE = readDoc(UPGRADE_DOC);
const GLOSSARY = readRepo("GLOSSARY.md");

/** The 188 names 0.5.3 exported and 0.6.0 does not, values first. */
const REMOVED = [
  "Button", "CallType", "Dialog", "DialogClose", "DialogContent", "DialogDescription",
  "DialogFooter", "DialogHeader", "DialogOverlay", "DialogPortal", "DialogTitle", "DialogTrigger",
  "FLUENT_CONNECT_DEFAULT_ASSETS", "FLUENT_GAS_PAYMENT_DEFAULT_ETH_RATES",
  "FLUENT_USER_TOKEN_LIMIT", "FLUENT_WIDGET_DEFAULT_GAS_TOKEN", "FLUENT_WIDGET_SESSION_STORAGE_KEY",
  "FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY", "FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY",
  "FLUENT_ZERODEV_ERC20_PAYMASTER_QUERY", "FLUENT_ZERODEV_PAYMASTER_DEMO_RECIPIENT",
  "FluentAccountDrawer", "FluentIframeRpcError", "FluentPortalContainerProvider",
  "FluentSettingsError", "FluentWidgetConnectButton", "FluentWidgetNetworkProvider", "Icon",
  "Label", "ParamCondition", "Separator", "Switch", "WIDGET_STYLE_SCOPE", "WalletMenuActionCard",
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
  "sortFluentGasTokens", "useFluentUserTokens", "useFluentWidgetNetwork", "useFluentZeroDevAccount",
  "useWidget",
  "AppDefinition", "BackendUserTokenStore", "BridgeAddresses", "FluentBatchConfirmationMode",
  "FluentBatchOperationExecutor", "FluentBatchOperationReview", "FluentCallPermission",
  "FluentClient", "FluentClientConfig", "FluentFamilies", "FluentFamiliesClient",
  "FluentFamiliesClientConfig", "FluentFamily", "FluentFamilyTier", "FluentFamilyType",
  "FluentGasPaymentSelection", "FluentGasPaymentValueTier", "FluentIframeBridge",
  "FluentIframeBridgeOptions", "FluentIframeRpcExecutor", "FluentIframeRpcHandler",
  "FluentIframeRpcRequest", "FluentPermissionApi", "FluentPermissionArgConstraint",
  "FluentPermissionArgs", "FluentPermissionBatchPolicy", "FluentPermissionBatchPolicyInput",
  "FluentPermissionCallInput", "FluentPermissionCallPolicy", "FluentPermissionClient",
  "FluentPermissionClientConfig", "FluentPermissionGrant", "FluentPermissionGrantRequest",
  "FluentPermissionPolicy", "FluentPermissionPolicyBuilders", "FluentPermissionPreview",
  "FluentPermissionSession", "FluentPermissionSessionExecutor", "FluentPermissionSessionInput",
  "FluentPermissionStatus", "FluentProfile", "FluentSession", "FluentSettingsClient",
  "FluentSettingsErrorCode", "FluentSignatureReview", "FluentSpendPeriod", "FluentSpendPermission",
  "FluentTokenBalance", "FluentTokenTransferOutcome", "FluentTokenTransferRequest",
  "FluentTokenTransferSender", "FluentTransferAmount", "FluentTransferFee",
  "FluentTransferRecipient", "FluentTypedDataRequest", "FluentUserSettings",
  "FluentUserSettingsPatch", "FluentUserTokenAddResult", "FluentWidgetConnectButtonProps",
  "FluentZeroDevErc20PaymasterToken", "FluentZeroDevErc20PaymasterTokenInfo", "FluentZeroDevKernel",
  "FluentZeroDevPaymasterDemoResult", "FluentZeroDevPaymasterKernel", "FluentZeroDevPermissionCall",
  "FluentZeroDevPermissionSession", "FluentZeroDevSignerMode",
  "FluentZeroDevSponsorshipTokenSource", "IconName", "L1ChainDefinition",
  "ResolvedFluentWidgetConfig", "ResolvedFluentWidgetExecution", "UserTokenStore",
  "ZerodevIntegration",
];

/**
 * Every member 0.6.0 removes or renames, read from 0.5.3's and 0.6.0's
 * declarations: `Type.member` for a member, `Union "literal"` for a literal of a code or mode
 * union, and `FluentBatchOperation.execute` for its executor argument.
 */
const MEMBER_CHANGES = [
  "AccountAvatarProps.userLogoUrl",
  "FluentBatchApi.confirmationMode",
  "FluentBatchApi.createPermissionSession",
  "FluentBatchApi.policies",
  "FluentBatchCallInput.functionName",
  "FluentBatchOperation.execute",
  "FluentBatchOperationExecuteOptions.confirmation",
  "FluentTokenDefinition.gasPriority",
  "FluentTokenDefinition.native",
  "FluentWidgetAccount.signerAddress",
  "FluentWidgetConfig.scopes",
  "FluentWidgetProps.showDebugPayload",
  "FluentWidgetRenderContext.connectedAddress",
  "FluentWidgetRenderContext.connecting",
  "FluentWidgetSession.app",
  "FluentWidgetSession.appId",
  "FluentWidgetSession.expiresAt",
  "FluentWidgetSession.idToken",
  "FluentWidgetSession.metadata",
  "FluentWidgetSession.scopes",
  "FluentWidgetSession.user",
  "FluentWidgetSession.wallet",
  'FluentAuthErrorCode "invalid_privy_token"',
  'FluentAuthErrorCode "privy_token_missing"',
  'FluentAuthErrorCode "no_embedded_wallet"',
  'FluentAuthErrorCode "nonce_unknown"',
  'FluentAuthErrorCode "nonce_used"',
  'FluentAuthErrorCode "nonce_expired"',
  'FluentSigningMode "always"',
  'FluentSigningMode "session"',
];

/** Every shipped document but the upgrade guide. */
const guides = () => shippedDocs().filter((file) => file !== UPGRADE_DOC);

const KINDS = ["rename", "recipe", "none"] as const;
type UpgradeRow = { subjects: string[]; kind: string; target: string; line: string };

let rows: CensusRow[] = [];

beforeAll(() => {
  // Building the census program takes several seconds; build it once, before the first case.
  rows = apiCensus();
}, 180_000);

/** The table rows of a part of the upgrade guide: the names it covers, its kind, its target. */
function upgradeRows(part: string): UpgradeRow[] {
  return part
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const [, subjectCell = "", kindCell = "", target = ""] = line.split("|").map((c) => c.trim());
      const spans = [...subjectCell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
      // `Union` `"literal"` is one subject: a literal of a code or mode union.
      const subjects =
        spans.length === 2 && /^".*"$/.test(spans[1] ?? "") ? [`${spans[0]} ${spans[1]}`] : spans;
      return { subjects, kind: kindCell, target, line };
    });
}

const exportsPart = () => sectionOf(UPGRADE, /^## Removed exports\s*$/);
const membersPart = () => sectionOf(UPGRADE, /^## Removed or renamed members\s*$/);

/** The text of a heading's section that a `#anchor` link in the upgrade guide points to. */
function sectionAtAnchor(anchor: string): string {
  const at = proseOf(UPGRADE)
    .split("\n")
    .findIndex((line) => anchorsOf(line).has(anchor));
  return at < 0 ? "" : sectionOf(UPGRADE.split("\n").slice(at).join("\n"), /^#/);
}

/** Whether a recipe cell links to a section of the guide that holds a checked `ts` block. */
function recipeHasBlock(target: string): boolean {
  const anchor = /\]\(#([^)]+)\)/.exec(target)?.[1];
  if (!anchor) return false;
  return fencedBlocks(sectionAtAnchor(anchor)).some(
    (block) => ["ts", "tsx"].includes(block.info[0] ?? "") && !block.info.includes("skip-check"),
  );
}

describe("docs/upgrading-0.5.md, the removed exports", () => {
  it("names each of the 188 removed exports in exactly one row", () => {
    expect(new Set(REMOVED).size).toBe(188);
    const named = upgradeRows(exportsPart()).flatMap((row) => row.subjects);
    const counts = new Map<string, number>();
    for (const name of named) counts.set(name, (counts.get(name) ?? 0) + 1);
    expect(REMOVED.filter((name) => counts.get(name) !== 1)).toEqual([]);
    expect(named.filter((name) => !REMOVED.includes(name))).toEqual([]);
  });

  it("gives each row one kind: rename, recipe or none", () => {
    const kinds: readonly string[] = KINDS;
    const bad = upgradeRows(UPGRADE).filter((row) => !kinds.includes(row.kind));
    expect(bad.map((row) => row.line)).toEqual([]);
  });

  // A look-alike name is a recipe or none, not a rename; a rename row would need a check that it
  // names one kept export of the same kind.
  it("renames no export: each row is a recipe or none", () => {
    const renames = upgradeRows(exportsPart()).filter((row) => row.kind === "rename");
    expect(renames.map((row) => row.line)).toEqual([]);
  });

  it("links each recipe row to a typechecked block", () => {
    const missing = upgradeRows(UPGRADE)
      .filter((row) => row.kind === "recipe" && !recipeHasBlock(row.target))
      .map((row) => row.line);
    expect(missing).toEqual([]);
  });

  it("is linked from README.md, which holds no upgrade table of its own", () => {
    expect(README).toContain("](docs/upgrading-0.5.md)");
    expect(README).not.toMatch(/^#+ Upgrading from/m);
  });
});

describe("docs/upgrading-0.5.md, the members and the behaviour changes", () => {
  it("names each removed or renamed member in exactly one row", () => {
    const named = upgradeRows(membersPart()).flatMap((row) => row.subjects);
    expect(MEMBER_CHANGES.filter((m) => named.filter((n) => n === m).length !== 1)).toEqual([]);
  });

  it("renames a member only to a 0.6.0 member of its type, a literal to one of its union", () => {
    const members = new Set(rows.flatMap((row) => row.members.map((member) => member.path)));
    const wrong = upgradeRows(membersPart())
      .filter((row) => row.kind === "rename")
      .flatMap((row) => {
        const target = /`([^`]+)`/.exec(row.target)?.[1] ?? "";
        const [subject = ""] = row.subjects;
        const literal = /^(\w+) "(.+)"$/.exec(subject);
        if (literal) {
          const union = rows.find((r) => r.name === literal[1]);
          const value = /^"(.+)"$/.exec(target)?.[1] ?? "";
          return union?.literals.includes(value) ? [] : [row.line];
        }
        const owner = subject.split(".")[0] ?? "";
        return members.has(target) && target.startsWith(`${owner}.`) ? [] : [row.line];
      });
    expect(wrong).toEqual([]);
  });

  it("has a Behaviour changes section", () => {
    const changes = sectionOf(UPGRADE, /^## Behaviour changes\s*$/);
    const subjects = ["network", "confirmation", "sponsored", "session", "FluentWidgetConfigError"];
    for (const subject of subjects) {
      expect(spanHolds(changes, subject), subject).toBe(true);
    }
  });
});

/** Whether a document names a removed export: in a span or a block, never as `@fluent.xyz`. */
function namesRemoved(text: string, name: string): boolean {
  const escaped = name.replace(/[$]/g, "\\$");
  return new RegExp(`(?<![\\w$@/.-])${escaped}(?![\\w$/-])(?!\\.xyz)`).test(
    // Prose outside backticks says words, not names: `fluent` the export, not Fluent the chain.
    [...text.matchAll(/`[^`\n]+`/g)].map((m) => m[0]).join("\n") +
      "\n" +
      fencedBlocks(text)
        .map((block) => block.code)
        .join("\n"),
  );
}

describe("outside docs/upgrading-0.5.md", () => {
  // The Internal entry publishes removed names again, promised nothing, and its guide is where
  // a host reads which; every other guide still speaks of kept exports only.
  const kept = guides().filter((file) => file !== INTERNAL_DOC);
  it.each(kept)("%s names only kept exports", (file) => {
    const text = readDoc(file);
    expect(REMOVED.filter((name) => namesRemoved(text, name))).toEqual([]);
  });
});

describe("README.md and docs/errors.md", () => {
  it.each(["README.md", "docs/errors.md"])("%s tells the host to keep a default branch", (file) => {
    expect(readDoc(file)).toContain("`default` branch");
  });
});

describe("docs/guides/link-x.md", () => {
  it("says the five linkX codes are the ones it throws today", () => {
    const linkX = readDoc("docs/guides/link-x.md");
    const codes = [
      "user_rejected",
      "linked_to_another_user",
      "not_authenticated",
      "bad_request",
      "link_failed",
    ];
    for (const code of codes) {
      expect(linkX, code).toContain(`\`${code}\``);
    }
    expect(linkX).toMatch(/throws today/);
  });

  it.each(shippedDocs())("%s never calls a switch complete", (file) => {
    expect(readDoc(file)).not.toContain("is complete");
  });
});

describe("docs/standards/public-api.md A3", () => {
  it("names FluentAuthError and FluentAuthErrorCode as its model, not FluentSettingsError", () => {
    const publicApi = readRepo("docs/standards/public-api.md");
    expect(publicApi).not.toContain("FluentSettingsError");
    const a3 = sectionOf(publicApi, /^### A3 /);
    expect(a3).toContain("FluentAuthError");
    expect(a3).toContain("FluentAuthErrorCode");
  });
});

describe("README.md's install steps", () => {
  it("install only @fluent.xyz/connect and its peers, every peer included", () => {
    const manifest = JSON.parse(readDoc("package.json")) as {
      peerDependencies: Record<string, string>;
    };
    const allowed = new Set(["@fluent.xyz/connect", ...Object.keys(manifest.peerDependencies)]);
    const installed = sectionOf(README, /^## Install\b/)
      .split("\n")
      .map((line) => /^\s*(?:pnpm add|npm install|npm i|yarn add|bun add)\s+(.+)$/.exec(line)?.[1])
      .filter((args): args is string => Boolean(args))
      .flatMap((args) => args.split(/\s+/))
      .filter((arg) => arg && !arg.startsWith("-"))
      // `react@^18` names `react`; a scope's own `@` is not a version.
      .map((arg) => arg.replace(/(.)@[^/]*$/, "$1"));
    expect(installed).toContain("@fluent.xyz/connect");
    expect(installed.filter((name) => !allowed.has(name))).toEqual([]);
    expect([...allowed].filter((name) => !installed.includes(name))).toEqual([]);
  });
});

describe("docs/guides/backend-auth.md", () => {
  it("calls getAuthToken() from useFluentWidget() or the render context, never from widget", () => {
    for (const file of shippedDocs()) {
      expect(readDoc(file), file).not.toContain("widget.getAuthToken");
    }
    const code = fencedBlocks(readDoc("docs/guides/backend-auth.md"))
      .map((block) => block.code)
      .join("\n");
    expect(code).toMatch(/useFluentWidget\(\)/);
    expect(code).toMatch(/getAuthToken\(\)/);
  });
});

describe("no 0.4 notes and no token store to inject", () => {
  it.each(shippedDocs())("%s has no 0.4 upgrade note and no userTokenStore", (file) => {
    const text = readDoc(file);
    expect(text).not.toContain("userTokenStore");
    expect(text).not.toContain("Upgrading from 0.4");
  });
});

describe("execute()'s rejections by class and code", () => {
  it.each(["README.md", "docs/guides/transactions.md"])("%s names the class and code", (file) => {
    const text = readDoc(file);
    expect(text).not.toContain("User rejected Fluent");
    expect(text).toContain("FluentReviewRejectedError");
    expect(text).toContain("transaction_review_rejected");
  });
});

describe("docs/guides/link-x.md", () => {
  it("tells the builder what to ask Fluent for, with no Privy Dashboard steps", () => {
    for (const file of docsFiles()) expect(readDoc(file), file).not.toContain("Privy Dashboard");
    expect(readDoc("docs/guides/link-x.md")).toMatch(/[Aa]sk Fluent/);
  });
});

describe("the examples reach the Widget API as useFluentWidget().widget", () => {
  it.each(guides())("%s never names useWidget", (file) => {
    expect(readDoc(file)).not.toMatch(/\buseWidget\b/);
  });
});

describe("GLOSSARY.md", () => {
  it.each([
    "Quick sign",
    "Batch operation",
    "Review",
    "Widget API",
    "Widget session",
    "Service session",
    "Network",
    "Iframe bridge",
    "Account avatar",
    "Linked X account",
    "Auth method",
    "Sponsorship",
    "Gas payment",
    "Connect",
  ])("holds exactly one entry for %s", (term) => {
    const entry = new RegExp(`^\\*\\*${term}\\*\\*:\\s*$`, "gm");
    expect(GLOSSARY.match(entry) ?? []).toHaveLength(1);
  });
});

describe("the guides ship in docs/ and link only to what ships", () => {
  it("are the listed files, shipped by package.json files", () => {
    expect(docsFiles()).toEqual([
      "docs/api.md",
      "docs/concepts.md",
      "docs/configuration.md",
      "docs/errors.md",
      "docs/experimental.md",
      "docs/getting-started.md",
      "docs/guides/backend-auth.md",
      "docs/guides/iframe.md",
      "docs/guides/link-x.md",
      "docs/guides/signing.md",
      "docs/guides/sponsorship.md",
      "docs/guides/transactions.md",
      "docs/internal.md",
      "docs/upgrading-0.5.md",
    ]);
    const manifest = JSON.parse(readDoc("package.json")) as { files: string[] };
    expect(manifest.files).toEqual(expect.arrayContaining(["docs", "README.md", "INTEGRATION.md"]));
  });

  it("keep INTEGRATION.md as a stub that maps its old sections into docs/", () => {
    const stub = readDoc("INTEGRATION.md");
    expect(stub.split("\n").length).toBeLessThan(80);
    expect(fencedBlocks(stub)).toEqual([]);
    expect(stub.match(/\]\(docs\/[^)]+\)/g)?.length ?? 0).toBeGreaterThan(10);
  });

  it.each(shippedDocs())("%s: every relative link and anchor resolves", (file) => {
    const broken: string[] = [];
    for (const link of proseOf(readDoc(file)).matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = link[1] ?? "";
      if (/^[a-z]+:/i.test(href)) continue;
      const [target = "", anchor] = href.split("#");
      const here = path.join(PACKAGE_ROOT, file);
      const resolved = target ? path.join(path.dirname(here), target) : here;
      const shipped = path.relative(PACKAGE_ROOT, resolved);
      if (!existsSync(resolved) || !shippedDocs().includes(shipped)) {
        broken.push(`${href}: not a shipped document`);
        continue;
      }
      if (anchor && !anchorsOf(readFileSync(resolved, "utf8")).has(anchor)) {
        broken.push(`${href}: no such heading`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("the contributor rules point to packages/connect/docs/", () => {
  it.each(["AGENTS.md", "docs/standards/docs-and-comments.md"])("%s points there", (file) => {
    const text = readRepo(file);
    expect(text).not.toContain("INTEGRATION.md");
    expect(text).toContain("packages/connect/docs/");
  });
});

describe("the wording of the guides", () => {
  it.each(guides())("%s calls no Network the default", (file) => {
    expect(readDoc(file)).not.toMatch(/`?testnet`?\s*\(default\)/i);
  });

  it("README.md names no experimental option, member or export but privyClientId", () => {
    const experimental = rows.flatMap((row) => [
      ...(row.tags.includes("experimental") ? [row.name] : []),
      ...row.members
        .filter((member) => member.tags.includes("experimental"))
        .map((member) => member.name)
        .filter((name) => name !== "privyClientId"),
    ]);
    expect(experimental.filter((name) => spanHolds(README, name))).toEqual([]);
  });

  // `docs/api.md` is the TSDoc as written in `src`, which standard D6 governs at the source.
  const written = shippedDocs().filter((file) => file !== "docs/api.md");
  it.each(written)("%s uses no multi-word Avoid term of GLOSSARY.md", (file) => {
    const avoid = [...GLOSSARY.matchAll(/^_Avoid_:\s*(.+)$/gm)]
      .flatMap((m) => (m[1] ?? "").split(","))
      .map((term) => term.trim())
      .filter((term) => term.includes(" ") && !term.includes("("));
    const prose = proseOf(readDoc(file)).toLowerCase();
    expect(avoid.filter((term) => prose.includes(term.toLowerCase()))).toEqual([]);
  });
});
