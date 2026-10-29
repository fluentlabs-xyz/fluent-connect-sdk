/**
 * @vitest-environment jsdom
 *
 * Every refusal of config resolution (FLU-1622, criterion 4.6): a `FluentWidgetConfigError`
 * whose `code` says what is wrong with the option (`missing_option`, `invalid_option` or
 * `removed_option`) and whose message names the option (standard A4).
 *
 * Each case renders `<FluentWidget>` with one bad option, as a host does, and reads what its
 * first render throws to the nearest error boundary: config resolution runs on that render,
 * before anything below the widget mounts, so nothing is faked. The cases are one per
 * `throw new Error(` config resolution had at `a733e95` (13, in source order), then the two
 * refusals of a `network` that is missing or unknown, which 0.6.0 adds, then the values that
 * made config resolution throw a plain `Error` or a `TypeError` instead: a default Gas token
 * the network lacks (thrown in `core/gasPayment.ts`), rejected values whose formatting threw,
 * and options read as a string or a list that hold neither. The refusals that already carried
 * a code (`invalid_fee_source`, `invalid_receipt_source`, `invalid_chain_check_before_sign`)
 * are `core/config.test.ts`'s.
 *
 * The last case is a guard the table cannot be: it hands every option a set of values a
 * JavaScript host can pass and the type forbids, and asserts that config resolution either
 * accepts each one or refuses it with a `FluentWidgetConfigError`. A `TypeError` raised for a
 * value no case names, in `core/config.ts` or in any module it calls, fails it.
 */
import { render } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FluentWidgetConfigError,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
} from "../core/config";
import { FluentWidget } from "./FluentWidget";

/** The host's error boundary: keeps what the widget's render threw. */
class Boundary extends Component<{ children: ReactNode; onError: (error: unknown) => void }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** What rendering the widget with `config` threw, or `undefined`. */
function renderError(config: FluentWidgetConfig): unknown {
  let caught: unknown;
  // React reports an error a boundary caught on the console; it is asserted on below instead.
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <Boundary onError={(error) => (caught = error)}>
      <FluentWidget config={config} />
    </Boundary>,
  );
  return caught;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID: FluentWidgetConfig = {
  appId: "app_00000000000000000000000000000000",
  privyClientId: "client-test",
  network: "testnet",
};

/** A config as a JavaScript host may pass it, read past the type on purpose. */
function config(overrides: Record<string, unknown>): FluentWidgetConfig {
  return { ...VALID, ...overrides } as unknown as FluentWidgetConfig;
}

/** An object that refers to itself, which `JSON.stringify` refuses. */
function cyclic(): Record<string, unknown> {
  const value: Record<string, unknown> = { mode: "hosted" };
  value.self = value;
  return value;
}

/** Valid as JSON, yet `String` cannot convert it: it finds no `toString` to call. */
const NO_TO_STRING = { toString: null };

/** Read past the type: the three codes are what this criterion adds. */
function codeOf(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

const CASES: Array<[string, Record<string, unknown>, string, string]> = [
  [
    "a custom OAuth redirect that is not a string",
    { customOAuthRedirectUrl: 42 },
    "invalid_option",
    "customOAuthRedirectUrl",
  ],
  [
    "a custom OAuth redirect that is not a URL",
    { customOAuthRedirectUrl: "not a url" },
    "invalid_option",
    "customOAuthRedirectUrl",
  ],
  [
    "a custom OAuth redirect over plain HTTP",
    { customOAuthRedirectUrl: "http://app.example/cb" },
    "invalid_option",
    "customOAuthRedirectUrl",
  ],
  [
    "a Quick sign allowlist entry that is not an address",
    { quickSign: { whitelistAddresses: ["nope"] } },
    "invalid_option",
    "quickSign.whitelistAddresses",
  ],
  ["the removed hosted authMode", { authMode: "hosted" }, "removed_option", "authMode"],
  ["the removed clientId", { clientId: "client-test" }, "removed_option", "clientId"],
  ["the renamed partnerId", { partnerId: "partner_1" }, "removed_option", "partnerId"],
  ["an empty appId", { appId: "" }, "missing_option", "appId"],
  ["a client id passed as appId", { appId: "client-test" }, "invalid_option", "appId"],
  ["an appId of another shape", { appId: "partner_123" }, "invalid_option", "appId"],
  ["an empty privyClientId", { privyClientId: "" }, "missing_option", "privyClientId"],
  [
    "an app id passed as privyClientId",
    { privyClientId: "app_00000000000000000000000000000000" },
    "invalid_option",
    "privyClientId",
  ],
  [
    "a privyClientId of another shape",
    { privyClientId: "something-else" },
    "invalid_option",
    "privyClientId",
  ],
  ["a missing network", { network: undefined }, "missing_option", "network"],
  ["a network the widget does not know", { network: "devnet" }, "invalid_option", "network"],
  [
    "a default Gas token the network lacks",
    { gasPayment: { defaultToken: "DAI" } },
    "invalid_option",
    "gasPayment.defaultToken",
  ],
  [
    "a default Gas token that is not a string",
    { gasPayment: { defaultToken: null } },
    "invalid_option",
    "gasPayment.defaultToken",
  ],
  ["a bigint authMode", { authMode: 1n }, "removed_option", "authMode"],
  ["an authMode object that refers to itself", { authMode: cyclic() }, "removed_option", "authMode"],
  [
    "a Quick sign allowlist entry String cannot convert",
    { quickSign: { whitelistAddresses: [NO_TO_STRING] } },
    "invalid_option",
    "quickSign.whitelistAddresses",
  ],
  [
    "a Quick sign allowlist that is not a list",
    { quickSign: { whitelistAddresses: {} } },
    "invalid_option",
    "quickSign.whitelistAddresses",
  ],
  [
    "login methods that are not a list",
    { enabledAuthMethods: 5 },
    "invalid_option",
    "enabledAuthMethods",
  ],
  ["an appId that is not a string", { appId: 42 }, "invalid_option", "appId"],
  ["a privyClientId that is not a string", { privyClientId: 42 }, "invalid_option", "privyClientId"],
  [
    "a default logo URL that is not a string",
    { avatar: { defaultLogoUrl: 42 } },
    "invalid_option",
    "avatar.defaultLogoUrl",
  ],
];

/** Every option of `FluentWidgetConfig`, as a path; a nested one is written `parent.child`. */
const OPTIONS = [
  "appId",
  "privyClientId",
  "network",
  "appName",
  "customOAuthRedirectUrl",
  "enabledAuthMethods",
  "swapper",
  "swapper.enabled",
  "swapper.integratorId",
  "swapper.dstChainId",
  "swapper.dstTokenAddress",
  "gasPayment",
  "gasPayment.defaultToken",
  "gasPayment.sponsorship",
  "gasPayment.ethValueByToken",
  "execution",
  "execution.feeSource",
  "execution.receiptSource",
  "execution.chainCheckBeforeSign",
  "quickSign",
  "quickSign.whitelistAddresses",
  "reputationEnabled",
  "source",
  "campaign",
  "disableAnalytics",
  "reconnectOnMount",
  "sponsorshipUrl",
  "authTokenRenewalOffsetSeconds",
  "assets",
  "avatar",
  "avatar.defaultLogoUrl",
  "avatar.forceDefault",
  "authMode",
  "clientId",
  "partnerId",
];

/** Values a JavaScript host can pass that the type forbids, chosen for what breaks conversion. */
const HOSTILE_VALUES: Array<[string, () => unknown]> = [
  ["null", () => null],
  ["a number", () => 42],
  ["a bigint", () => 1n],
  ["a symbol", () => Symbol("option")],
  ["an object String cannot convert", () => ({ ...NO_TO_STRING })],
  ["an object that refers to itself", cyclic],
  ["a list holding an object String cannot convert", () => [{ ...NO_TO_STRING }]],
];

/** `VALID` with `value` at `path`, a nested option inside its parent. */
function configWith(path: string, value: unknown): FluentWidgetConfig {
  const dot = path.indexOf(".");
  if (dot === -1) return config({ [path]: value });
  return config({ [path.slice(0, dot)]: { [path.slice(dot + 1)]: value } });
}

/** What resolving `config` threw, or `undefined`. */
function resolveError(config: FluentWidgetConfig): unknown {
  try {
    resolveFluentWidgetConfig(config);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("criterion 4.6: config resolution refuses", () => {
  it.each(CASES)("%s with FluentWidgetConfigError", (_, overrides, code, option) => {
    const caught = renderError(config(overrides));

    expect(caught).toBeInstanceOf(FluentWidgetConfigError);
    expect((caught as Error).name).toBe("FluentWidgetConfigError");
    expect(codeOf(caught)).toBe(code);
    expect((caught as Error).message).toContain(`FluentWidgetConfig.${option}`);
  });
});

describe("criterion 4.6: config resolution", () => {
  it("accepts or refuses with FluentWidgetConfigError any value a JavaScript host passes", () => {
    const escaped: string[] = [];
    for (const option of OPTIONS) {
      for (const [label, value] of HOSTILE_VALUES) {
        const error = resolveError(configWith(option, value()));
        if (error !== undefined && !(error instanceof FluentWidgetConfigError)) {
          escaped.push(`${option} = ${label}: ${String(error)}`);
        }
      }
    }
    expect(escaped).toEqual([]);
  });
});
