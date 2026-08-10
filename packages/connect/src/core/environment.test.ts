import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizeFluentWidgetNetwork,
  resolveFluentWidgetNetworkFromEnv,
} from "./environment";

describe("Fluent widget environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes common aliases to Fluent networks", () => {
    expect(normalizeFluentWidgetNetwork("testnet")).toBe("testnet");
    expect(normalizeFluentWidgetNetwork("mainnet")).toBe("mainnet");
    expect(normalizeFluentWidgetNetwork("development")).toBe("testnet");
    expect(normalizeFluentWidgetNetwork("dev")).toBe("testnet");
    expect(normalizeFluentWidgetNetwork("production")).toBe("mainnet");
    expect(normalizeFluentWidgetNetwork("prod")).toBe("mainnet");
  });

  it("reads VITE_FLUENT_WIDGET_NETWORK from the environment", () => {
    vi.stubEnv("VITE_FLUENT_WIDGET_NETWORK", "mainnet");
    expect(resolveFluentWidgetNetworkFromEnv()).toBe("mainnet");
  });

  it("reads FLUENT_NETWORK as a fallback", () => {
    vi.stubEnv("FLUENT_NETWORK", "prod");
    expect(resolveFluentWidgetNetworkFromEnv()).toBe("mainnet");
  });
});
