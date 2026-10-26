/**
 * Invariant (4) of FLU-1639, for generated configs: `resolveFluentWidgetConfig` either resolves
 * or throws `FluentWidgetConfigError`, never a `TypeError` or a plain `Error`. A JavaScript host
 * is not held to `FluentWidgetConfig`, so the generator passes any value as the whole config and
 * any value in each option, nested ones included, around valid ids and network often enough to
 * reach the options checked after them. Nothing is faked; `console.warn` is silenced for the
 * 0.4.x `authMode: "direct"` notice.
 */
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FluentWidgetConfigError,
  resolveFluentWidgetConfig,
  type FluentWidgetConfig,
} from "./config";

const APP_ID = "app_8908941315934a06b738c6804ce26132";
const PRIVY_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";

/** Any value a JavaScript host can write, beyond what JSON can hold. */
const anyValue = fc.anything({
  withBoxedValues: true,
  withNullPrototype: true,
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withTypedArray: true,
  withSparseArray: true,
  withObjectString: true,
});

/** A valid value most of the time, so the options checked after it are reached. */
const mostlyValid = <T>(valid: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary: valid, weight: 4 }, { arbitrary: anyValue, weight: 1 });

/** An object option whose own fields are each generated, any of them absent. */
const nested = (keys: readonly string[]) =>
  fc.oneof(
    fc.record(Object.fromEntries(keys.map((key) => [key, anyValue])), { requiredKeys: [] }),
    fc.record(
      Object.fromEntries(keys.map((key) => [key, fc.array(anyValue)])),
      { requiredKeys: [] },
    ),
    anyValue,
  );

const configObject = fc.record(
  {
    appId: mostlyValid(fc.constantFrom(APP_ID, ` ${APP_ID} `)),
    privyClientId: mostlyValid(fc.constant(PRIVY_CLIENT_ID)),
    network: mostlyValid(fc.constantFrom("testnet", "mainnet")),
    clientId: anyValue,
    partnerId: anyValue,
    authMode: anyValue,
    appName: anyValue,
    customOAuthRedirectUrl: anyValue,
    enabledAuthMethods: fc.oneof(anyValue, fc.array(anyValue)),
    swapper: nested(["enabled", "integratorId", "dstChainId", "dstTokenAddress"]),
    gasPayment: nested(["defaultToken", "sponsorship", "ethValueByToken"]),
    execution: nested(["feeSource", "receiptSource", "chainCheckBeforeSign"]),
    quickSign: nested(["whitelistAddresses"]),
    reputationEnabled: anyValue,
    source: anyValue,
    campaign: anyValue,
    disableAnalytics: anyValue,
    reconnectOnMount: anyValue,
    sponsorshipUrl: anyValue,
    authTokenRenewalOffsetSeconds: anyValue,
    assets: anyValue,
    avatar: nested(["defaultLogoUrl", "forceDefault"]),
    scopes: anyValue,
  },
  { requiredKeys: ["appId", "privyClientId", "network"] },
);

/** Mostly a config object; otherwise a value in its place, the primitives a slip produces first. */
const anyConfig = fc.oneof(
  { arbitrary: configObject, weight: 6 },
  { arbitrary: fc.constantFrom<unknown>(null, undefined, 0, "", "config", true, []), weight: 1 },
  { arbitrary: anyValue, weight: 3 },
);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("invariant (4): a config resolves or is refused with FluentWidgetConfigError", () => {
  it("resolves or throws FluentWidgetConfigError for any config a JavaScript host can pass", () => {
    fc.assert(
      fc.property(anyConfig, (config) => {
        try {
          resolveFluentWidgetConfig(config as FluentWidgetConfig);
        } catch (error) {
          expect(error).toBeInstanceOf(FluentWidgetConfigError);
        }
      }),
      // Each run is a synchronous call, so a wider sample costs milliseconds. A missing config
      // is tried on every run, not left to the generator: it is the slip a host makes first.
      { numRuns: 1000, examples: [[null], [undefined]] },
    );
  });
});
