import { describe, expect, it } from "vitest";

import {
  deriveWidgetAccount,
  type DeriveWidgetAccountInput,
  type WidgetSmartAccountState,
} from "./useWidgetAccount";

const SMART = "0x1111111111111111111111111111111111111111" as const;
const EOA = "0x2222222222222222222222222222222222222222" as const;

const emptySmart: WidgetSmartAccountState = {
  smartAccountReady: false,
  privyReady: false,
  privyAuthenticated: false,
  embeddedWalletCount: 0,
};

function derive(overrides: Partial<DeriveWidgetAccountInput> = {}) {
  return deriveWidgetAccount({
    smartAccount: emptySmart,
    wallet: null,
    directAuth: false,
    ...overrides,
  });
}

describe("deriveWidgetAccount", () => {
  it("reports disconnected when nothing is connected", () => {
    const r = derive();
    expect(r.hasConnectedAccount).toBe(false);
    expect(r.connecting).toBe(false);
    expect(r.widgetAccount.type).toBeUndefined();
    expect(r.widgetAccount.executionReady).toBe(false);
    expect(r.widgetAccount.executionStatus).toBe("disconnected");
  });

  it("marks a ready direct-auth smart account as smart with AA capabilities", () => {
    const r = derive({
      directAuth: true,
      smartAccount: {
        ...emptySmart,
        smartAccountReady: true,
        smartAccountAddress: SMART,
        privyReady: true,
        privyAuthenticated: true,
        embeddedWalletCount: 1,
      },
    });
    expect(r.fluentAccountReady).toBe(true);
    expect(r.hasConnectedAccount).toBe(true);
    expect(r.widgetAccount.type).toBe("smart");
    expect(r.widgetAccount.capabilities).toEqual({ atomicBatch: true, erc20Gas: true });
    expect(r.widgetAccount.executionStatus).toBe("ready");
    expect(r.widgetAccount.address).toBe(SMART);
  });

  it("surfaces the connecting window while a direct-auth smart account spins up", () => {
    const r = derive({
      directAuth: true,
      smartAccount: { ...emptySmart, privyAuthenticated: true },
    });
    expect(r.hasConnectedAccount).toBe(false);
    expect(r.connecting).toBe(true);
  });

  it("does not report connecting once an error is set", () => {
    const r = derive({
      directAuth: true,
      smartAccount: { ...emptySmart, privyAuthenticated: true, error: new Error("boom") },
    });
    expect(r.connecting).toBe(false);
    expect(r.widgetAccount.executionStatus).toBe("disconnected");
  });

  describe("status", () => {
    it("is restoring while direct auth waits for Privy to settle", () => {
      const r = derive({ directAuth: true, smartAccount: { ...emptySmart, privyReady: false } });
      // The whole point: not yet distinguishable from a signed-in user.
      expect(r.hasConnectedAccount).toBe(false);
      expect(r.status).toBe("restoring");
    });

    it("becomes disconnected once Privy settles unauthenticated", () => {
      const r = derive({ directAuth: true, smartAccount: { ...emptySmart, privyReady: true } });
      expect(r.status).toBe("disconnected");
    });

    // A stale stored session must not pin the status to "restoring" forever.
    it("is disconnected with a stored session Privy has settled against", () => {
      const r = derive({
        directAuth: true,
        smartAccount: { ...emptySmart, privyReady: true, privyAuthenticated: false },
        sessionUserId: "user-1",
        sessionSmartAccountAddress: SMART,
      });
      expect(r.status).toBe("disconnected");
    });

    it("is restoring while an external wallet reconnects", () => {
      const r = derive({ wallet: { connected: false, hasWalletClient: false, reconnecting: true } });
      expect(r.status).toBe("restoring");
    });

    it("prefers connecting over restoring once sign-in is in flight", () => {
      const r = derive({
        directAuth: true,
        smartAccount: { ...emptySmart, privyAuthenticated: true },
      });
      expect(r.connecting).toBe(true);
      expect(r.status).toBe("connecting");
    });

    it("does not hang on restoring after an error", () => {
      const r = derive({
        directAuth: true,
        smartAccount: { ...emptySmart, privyReady: false, error: new Error("boom") },
      });
      expect(r.status).toBe("disconnected");
    });

    it("hosted auth needs no restoring window — the session is hydrated synchronously", () => {
      expect(derive({ directAuth: false }).status).toBe("disconnected");
      expect(derive({ directAuth: false, sessionUserId: "user-1" }).status).toBe("connected");
    });

    it("is connected for a ready smart account and for a connected EOA alike", () => {
      const smart = derive({
        directAuth: true,
        smartAccount: {
          ...emptySmart,
          smartAccountReady: true,
          smartAccountAddress: SMART,
          privyReady: true,
          privyAuthenticated: true,
          embeddedWalletCount: 1,
        },
      });
      expect(smart.status).toBe("connected");

      const eoa = derive({ wallet: { connected: true, address: EOA, hasWalletClient: true } });
      expect(eoa.status).toBe("connected");
    });
  });

  it("treats a connected external EOA as executable but without AA perks", () => {
    const r = derive({
      wallet: { connected: true, address: EOA, hasWalletClient: true },
    });
    expect(r.widgetAccount.type).toBe("eoa");
    expect(r.widgetAccount.executionReady).toBe(true);
    expect(r.widgetAccount.capabilities).toEqual({ atomicBatch: false, erc20Gas: false });
    expect(r.connectedAddress).toBe(EOA);
  });

  it("an EOA connected without a wallet client is unavailable, not ready", () => {
    const r = derive({
      wallet: { connected: true, address: EOA, hasWalletClient: false },
    });
    expect(r.widgetAccount.type).toBe("eoa");
    expect(r.widgetAccount.executionReady).toBe(false);
    expect(r.widgetAccount.executionStatus).toBe("unavailable");
  });

  it("hosted flow: a stored session counts as connected without smartAccountReady", () => {
    const r = derive({
      directAuth: false,
      sessionUserId: "user-1",
      sessionSmartAccountAddress: SMART,
    });
    expect(r.hasConnectedAccount).toBe(true);
    // Not execution-ready until the smart account initializes.
    expect(r.fluentAccountReady).toBe(false);
    expect(r.fluentAccountAddress).toBe(SMART);
  });

  it("smart account takes precedence over a connected EOA", () => {
    const r = derive({
      directAuth: true,
      smartAccount: {
        ...emptySmart,
        smartAccountReady: true,
        smartAccountAddress: SMART,
        privyReady: true,
        privyAuthenticated: true,
        embeddedWalletCount: 1,
      },
      wallet: { connected: true, address: EOA, hasWalletClient: true },
    });
    expect(r.widgetAccount.type).toBe("smart");
    // Account-menu address prefers the connected wallet's address.
    expect(r.accountMenuAddress).toBe(EOA);
  });
});
