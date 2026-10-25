// @vitest-environment node
/**
 * The shape of the kept types of `@fluent.xyz/connect` 0.6.0 (FLU-1622, criteria 2.2, 2.3, 2.6,
 * 2.8–2.16 and 2.20).
 *
 * Each case reads a type the way a builder's compiler sees it on `src/index.ts`, through the
 * census `test/apiCensus.ts` builds with the TypeScript checker: the members a type has, the
 * annotation each is written with, the literals of a union. Nothing is faked.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { apiCensus, type CensusMember, type CensusRow } from "../test/apiCensus";

let rows: CensusRow[] = [];

// Building the program over the package takes several seconds, more under load.
beforeAll(() => {
  rows = apiCensus();
}, 180_000);

function row(name: string): CensusRow {
  const found = rows.find((candidate) => candidate.name === name);
  expect(found, `${name} is exported`).toBeDefined();
  return found as CensusRow;
}

/** The direct members of an exported type, by name. */
function membersOf(name: string): Map<string, CensusMember> {
  const owner = row(name);
  return new Map(
    owner.members
      .filter((member) => member.path.split(".").length === 2)
      .map((member) => [member.name, member]),
  );
}

describe("criterion 2.2: FluentBatchApi", () => {
  it("is FluentSignApi & {…}, with no permission API in its declaration, members or reach", () => {
    const api = row("FluentBatchApi");
    expect(api.declaration.text).toMatch(/FluentBatchApi\s*=\s*FluentSignApi\s*&/);
    expect(api.declaration.text).not.toContain("FluentPermission");
    const members = membersOf("FluentBatchApi");
    expect(members.has("createPermissionSession")).toBe(false);
    expect(members.has("policies")).toBe(false);
    const permissionRefs = api.closure.filter((ref) => /Permission/.test(ref.name));
    expect(permissionRefs.map((ref) => ref.name)).toEqual([]);
  });
});

describe("criterion 2.3: FluentBatchOperation.execute", () => {
  it("takes one optional FluentBatchOperationExecuteOptions argument and no executor", () => {
    const execute = membersOf("FluentBatchOperation").get("execute");
    expect(execute?.parameters).toEqual([
      { name: expect.any(String), optional: true, typeText: "FluentBatchOperationExecuteOptions" },
    ]);
  });
});

describe("criterion 2.6: FluentWidgetProps", () => {
  it("has debugLogging and no showDebugPayload", () => {
    const props = membersOf("FluentWidgetProps");
    expect(props.has("debugLogging")).toBe(true);
    expect(props.has("showDebugPayload")).toBe(false);
  });
});

describe("criterion 2.8: FluentWidgetRenderContext", () => {
  it("has status and the widget API, and neither connecting nor connectedAddress", () => {
    const context = membersOf("FluentWidgetRenderContext");
    expect(context.get("status")?.typeText).toBe("FluentWidgetStatus");
    expect(context.get("widget")?.typeText).toBe("FluentBatchApi");
    expect(membersOf("FluentWidgetAccount").has("address")).toBe(true);
    expect(context.has("connecting")).toBe(false);
    expect(context.has("connectedAddress")).toBe(false);
  });
});

describe("criterion 2.9: FluentWidgetAccount", () => {
  it("has address and no signerAddress", () => {
    const account = membersOf("FluentWidgetAccount");
    expect(account.has("address")).toBe(true);
    expect(account.has("signerAddress")).toBe(false);
  });
});

describe("criterion 2.10: FluentBatchCallInput", () => {
  it("has method and no functionName", () => {
    const call = membersOf("FluentBatchCallInput");
    expect(call.has("method")).toBe(true);
    expect(call.has("functionName")).toBe(false);
  });
});

describe("criterion 2.11: AccountAvatarProps", () => {
  it("has userAvatarUrl in place of userLogoUrl, its TSDoc free of Privy", () => {
    const props = membersOf("AccountAvatarProps");
    expect(props.has("userAvatarUrl")).toBe(true);
    expect(props.has("userLogoUrl")).toBe(false);
    expect(row("AccountAvatarProps").declaration.text).not.toMatch(/privy/i);
  });
});

describe("criterion 2.12: FluentTokenDefinition", () => {
  it("describes a token without the two capabilities the widget strips from host tokens", () => {
    const token = membersOf("FluentTokenDefinition");
    for (const field of ["chainId", "address", "name", "symbol", "decimals"]) {
      expect(token.has(field), field).toBe(true);
    }
    expect(token.has("gasPriority")).toBe(false);
    expect(token.has("native")).toBe(false);
  });
});

describe("criterion 2.13: FluentChainDefinition", () => {
  it("is a declared object type, not inferred from a schema", () => {
    const chain = row("FluentChainDefinition");
    expect(chain.declaration.text).not.toContain("z.infer");
    expect(chain.declaration.text).not.toContain("typeof");
    expect(membersOf("FluentChainDefinition").has("chainId")).toBe(true);
  });
});

describe("criterion 2.14: FluentWidgetConfig.assets", () => {
  it("is Partial<FluentWidgetAssets>, a declared type", () => {
    expect(membersOf("FluentWidgetConfig").get("assets")?.typeText).toBe(
      "Partial<FluentWidgetAssets>",
    );
    expect(row("FluentWidgetConfig").declaration.text).not.toContain("typeof");
    expect(row("FluentWidgetAssets").declaration.text).not.toContain("typeof");
  });
});

describe("criterion 2.15: FluentSigningMode", () => {
  it("is \"prompt\" | \"silent\", and FluentBatchOperationExecuteOptions.confirmation " +
    "takes it", () => {
    expect(row("FluentSigningMode").literals).toEqual(["prompt", "silent"]);
    expect(membersOf("FluentBatchOperationExecuteOptions").get("confirmation")?.typeText).toBe(
      "FluentSigningMode",
    );
  });
});

describe("criterion 2.16: the widget object", () => {
  it("has signingMode of type FluentSigningMode in place of confirmationMode", () => {
    const widget = membersOf("FluentBatchApi");
    expect(widget.get("signingMode")?.typeText).toBe("FluentSigningMode");
    expect(widget.has("confirmationMode")).toBe(false);
  });
});

describe("criterion 2.20: FluentGasPayment.sponsorship's TSDoc", () => {
  it("names only fields FluentExecuteResult has", () => {
    const tsdoc = membersOf("FluentGasPayment").get("sponsorship")?.tsdoc ?? "";
    expect(tsdoc).not.toBe("");
    expect(tsdoc).not.toContain("sponsorshipReason");
    const resultFields = membersOf("FluentExecuteResult");
    // A field a result is said to report is written `field: value` or `result.field`.
    const claimed = [
      ...[...tsdoc.matchAll(/`(\w+):/g)].map((match) => match[1] ?? ""),
      ...[...tsdoc.matchAll(/\bresult\.(\w+)/g)].map((match) => match[1] ?? ""),
    ];
    expect(claimed.filter((field) => !resultFields.has(field))).toEqual([]);
  });
});
