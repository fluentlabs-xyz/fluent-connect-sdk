import { afterEach, describe, expect, it, vi } from "vitest";

const DEV_PRIVY_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";

/** The module reads the environment at import, so each case loads it afresh. */
async function loadPrivyClientId() {
  vi.resetModules();
  const { PRIVY_CLIENT_ID } = await import("./privyClientId");
  return PRIVY_CLIENT_ID;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the Privy client the demo widget logs in with", () => {
  it("passes VITE_PRIVY_CLIENT_ID when it is set", async () => {
    vi.stubEnv("VITE_PRIVY_CLIENT_ID", "client-from-env");
    expect(await loadPrivyClientId()).toBe("client-from-env");
  });

  it("falls back to the dev App's client when VITE_PRIVY_CLIENT_ID is not set", async () => {
    vi.stubEnv("VITE_PRIVY_CLIENT_ID", undefined);
    expect(await loadPrivyClientId()).toBe(DEV_PRIVY_CLIENT_ID);
  });

  it("falls back to the dev App's client when VITE_PRIVY_CLIENT_ID is left blank", async () => {
    vi.stubEnv("VITE_PRIVY_CLIENT_ID", "");
    expect(await loadPrivyClientId()).toBe(DEV_PRIVY_CLIENT_ID);
  });
});
