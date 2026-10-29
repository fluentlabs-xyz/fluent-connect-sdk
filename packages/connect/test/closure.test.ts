// @vitest-environment node
/**
 * The public API of `@fluent.xyz/connect` is closed (FLU-1622, criteria 1.3, 1.4, 2.4, 2.4b
 * and 2.5).
 *
 * A failure here means the change broke the public API: fix the change, never this file; the
 * file changes only by the maintainer's own edit.
 *
 * A name a builder can import promises every type its signature reaches, so each of those is
 * either exported itself — and pinned by `exports.test.ts` — or it is a promise nobody can read.
 * A package outside `packages/*` is reached only when it is listed here as part of the
 * platform, or through the one `@experimental` provider seam, and what may still change is
 * tagged `@experimental` where a builder's editor shows it, together with the names of the
 * types it reaches. All of it is read by the TypeScript checker
 * (`test/apiCensus.ts`). Nothing is faked.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { apiCensus, type CensusMember, type CensusRow } from "./apiCensus";

/** The one vendor seam (D41): the exported adapter type, and the prop that names it. */
const VENDOR_SEAM_TYPE = "FluentPrivyAdapter";
const VENDOR_SEAM_MEMBER = "FluentWidgetProps.privyAdapter";

/**
 * Criterion 1.4: the packages outside `packages/*` any kept name may reach, with the reason. A
 * package missing here is a vendor until someone lists it on purpose.
 */
const PLATFORM_PACKAGES: Record<string, string> = {
  viem: "the chain library a host already uses for addresses, calls, chains and receipts",
  abitype: "the ABI and address types viem's own types are made of",
  "@types/react": "React, the host's framework and a peer dependency",
};

/** The packages the seam type alone may reach besides the platform ones. */
const SEAM_PACKAGES = ["@privy-io/react-auth"];

/** Criterion 2.4: members that may change in a minor release. */
const EXPERIMENTAL_MEMBERS = [
  "FluentWidgetConfig.privyClientId",
  "FluentWidgetConfig.customOAuthRedirectUrl",
  "FluentWidgetConfig.execution",
  "FluentWidgetConfig.swapper",
  "FluentWidgetConfig.sponsorshipUrl",
  "FluentWidgetConfig.gasPayment.ethValueByToken",
  "FluentWidgetProps.privyAdapter",
  "FluentWidgetProps.wallet",
  "FluentWidgetRenderContext.wallet",
  "FluentBatchOperationExecuteOptions.userOperationGas",
  "FluentExecuteResult.paymaster",
  "FluentExecuteResult.timing",
];

/** Criterion 2.4b: the names the Outcome lists as `@experimental`. */
const EXPERIMENTAL_NAMES = [
  "FluentPrivyAdapter",
  "FluentExternalWalletState",
  "FluentWalletChoice",
  "FluentWidgetExecution",
  "FluentWidgetExecutionSource",
  "FluentUserOperationGas",
  "FluentUserOperationGasError",
  "FluentUserOperationGasErrorCode",
  "FluentFixedAccountGas",
  "FluentFixedPaymasterGas",
  "FluentExecuteTiming",
  "FluentExecuteTimingInstants",
  "FluentGasPaymentEthRates",
];

/** The sentence `FluentWidgetConfig.execution` has carried since 0.5.0. */
const EXPERIMENTAL_SENTENCE = "@experimental May change or be removed in a minor release";

let rows: CensusRow[] = [];
let seamless: CensusRow[] = [];

// Building the program over the package takes several seconds, more under load.
beforeAll(() => {
  rows = apiCensus();
  seamless = apiCensus({ opaque: [VENDOR_SEAM_MEMBER] });
}, 180_000);

/** A TSDoc block as prose: comment markers gone, whitespace collapsed. */
function prose(tsdoc: string): string {
  return tsdoc
    .replace(/^\/\*\*|\*\/$/g, "")
    .replace(/^\s*\*+ ?/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function member(path: string): CensusMember | undefined {
  for (const row of rows) {
    const found = row.members.find((candidate) => candidate.path === path);
    if (found) return found;
  }
  return undefined;
}

describe("criterion 1.3: every type an export's signature reaches", () => {
  it("is itself an export of the package", () => {
    const exported = new Set(rows.map((row) => row.name));
    const outside = rows.flatMap((row) =>
      row.closure
        .filter((ref) => ref.exportedAs === null || !exported.has(ref.exportedAs))
        .map((ref) => `${row.name} reaches ${ref.name} (${ref.at})`),
    );
    expect(outside).toEqual([]);
  });
});

describe("criterion 1.4: the packages an export reaches", () => {
  it("are the listed platform packages, and the seam's own package for the seam alone", () => {
    const reaching = seamless.flatMap((row) =>
      row.externals
        .filter((pkg) => !(pkg in PLATFORM_PACKAGES))
        .filter((pkg) => !(row.name === VENDOR_SEAM_TYPE && SEAM_PACKAGES.includes(pkg)))
        .map((pkg) => `${row.name} reaches ${pkg}`),
    );
    expect(reaching).toEqual([]);
  });

  it("tags both parts of the seam @experimental", () => {
    const seamType = rows.find((row) => row.name === VENDOR_SEAM_TYPE);
    expect(seamType?.tags).toContain("experimental");
    expect(member(VENDOR_SEAM_MEMBER)?.tags).toContain("experimental");
  });
});

describe("criterion 2.4: the members that may change in a minor release", () => {
  it("each carry @experimental with the sentence execution uses", () => {
    const untagged = EXPERIMENTAL_MEMBERS.filter((path) => {
      const found = member(path);
      return (
        !found ||
        !found.tags.includes("experimental") ||
        !prose(found.tsdoc).includes(EXPERIMENTAL_SENTENCE)
      );
    });
    expect(untagged).toEqual([]);
  });
});

describe("criterion 2.4b: the names the Outcome lists as experimental", () => {
  it("each carry @experimental at their declaration", () => {
    const untagged = EXPERIMENTAL_NAMES.filter((name) => {
      const row = rows.find((candidate) => candidate.name === name);
      return !row || !row.tags.includes("experimental");
    });
    expect(untagged).toEqual([]);
  });
});

describe("criterion 2.5: an @experimental member's TSDoc", () => {
  it("names every exported type the member reaches", () => {
    const experimental = new Map<string, CensusMember>();
    for (const row of rows) {
      for (const candidate of row.members) {
        if (candidate.tags.includes("experimental")) {
          experimental.set(candidate.declaredAs, candidate);
        }
      }
    }
    expect(experimental.size).toBeGreaterThan(0);
    const unnamed = [...experimental.values()].flatMap((candidate) =>
      candidate.closure
        .filter((ref) => ref.exportedAs !== null)
        .filter((ref) => !new RegExp(`\\b${ref.exportedAs}\\b`).test(candidate.tsdoc))
        .map((ref) => `${candidate.declaredAs} does not name ${ref.exportedAs}`),
    );
    expect(unnamed).toEqual([]);
  });
});

/**
 * The census itself (audit findings S7 and S8): a kept signature an editor infers reaches what
 * the checker infers, so the census has to follow inferred types as far as a builder's
 * compiler does, or 1.3 and 1.4 pass over a name they never saw. Each export of the fixture
 * entry reaches unexported declarations of `fixtures/census/internal.ts` through one shape the
 * census once missed; each must be in that row's `closure` as unexported, and a vendor package
 * reached the same way in its `externals`.
 */
const CENSUS_FIXTURE_ENTRY = "packages/connect/test/fixtures/census/index.ts";

/** Per fixture export: the unexported declarations it reaches, sorted, and the vendors. */
const CENSUS_FIXTURE_REACHES: Record<string, { closure: string[]; externals: string[] }> = {
  // S7: the argument of an external alias, `Dispatch<SetStateAction<AliasArgument>>`.
  externalAlias: { closure: ["AliasArgument"], externals: ["@types/react"] },
  // S7: a vendor type as the argument of a vendor alias, `UseQueryResult<Chain>`.
  vendorAlias: { closure: [], externals: ["@tanstack/react-query", "viem"] },
  // S7: the check, extends, true and false sides of a deferred conditional type.
  conditional: {
    closure: ["ConditionalExtends", "ConditionalFalse", "ConditionalTrue"],
    externals: [],
  },
  // S7: the object side of a deferred indexed access.
  indexedAccess: { closure: ["IndexedHost"], externals: [] },
  // S7: the operand of a deferred `keyof`.
  keyofType: { closure: ["KeyofHost"], externals: [] },
  // S7: a placeholder of a template literal type.
  templateLiteral: { closure: ["TemplateBrand"], externals: [] },
  // S7: the constraint of an instantiated type parameter.
  genericConstraint: { closure: ["ConstraintArgument"], externals: [] },
  // S7: the default of an instantiated type parameter.
  genericDefault: { closure: ["DefaultArgument"], externals: [] },
  // S8: an unexported value a signature names with `typeof`.
  typeofValue: { closure: ["internalValue"], externals: [] },
  // S8: a parameter annotation of the arrow an un-annotated const wraps.
  arrowParameter: { closure: ["ArrowMode"], externals: [] },
  // S8: an alias the un-annotated const's `as` names, flattened into a union by inference.
  flattenedAlias: { closure: ["FlatMode"], externals: [] },
  // An alias named only through an import type, `import("./internal").ImportMode`.
  importType: { closure: ["ImportMode"], externals: [] },
  // A vendor interface a module augmentation under `packages/` adds a member to: react-query's
  // `Register`, which `@tanstack/query-core` declares.
  augmentedVendor: { closure: ["AugmentArgument"], externals: ["@tanstack/query-core"] },
};

/**
 * The fixture's seam: `SeamHost.adapter` is the opaque member, its annotation widened past the
 * exported seam type to a vendor's, which the walk must still report.
 */
const CENSUS_FIXTURE_SEAM_MEMBER = "SeamHost.adapter";

describe("criteria 1.1 and 1.3: the census reaches what an inferred signature reaches", () => {
  let fixture: CensusRow[] = [];

  // A program over the fixture entry alone: a few seconds, more under load.
  beforeAll(() => {
    fixture = apiCensus({ entry: CENSUS_FIXTURE_ENTRY });
  }, 180_000);

  it.each(Object.entries(CENSUS_FIXTURE_REACHES))(
    "%s reports every unexported declaration and vendor package it reaches",
    (name, expected) => {
      const row = fixture.find((candidate) => candidate.name === name);
      expect(row, name).toBeDefined();
      expect(row?.closure.map((ref) => [ref.name, ref.exportedAs])).toEqual(
        expected.closure.map((declaration) => [declaration, null]),
      );
      expect(row?.externals).toEqual(expect.arrayContaining(expected.externals));
    },
  );

  it("reports the vendor an opaque member is widened to, and does not enter the seam type", () => {
    const opaque = apiCensus({ entry: CENSUS_FIXTURE_ENTRY, opaque: [CENSUS_FIXTURE_SEAM_MEMBER] });
    const host = opaque.find((candidate) => candidate.name === "SeamHost");
    expect(host?.externals).toContain("viem");
    // The seam type's own vendor is its row's to report, not the member's.
    expect(host?.externals).not.toContain("@tanstack/react-query");
    expect(host?.closure.map((ref) => [ref.name, ref.exportedAs])).toEqual([
      ["SeamAdapter", "SeamAdapter"],
    ]);
    const seam = opaque.find((candidate) => candidate.name === "SeamAdapter");
    expect(seam?.externals).toContain("@tanstack/react-query");
  });
});
