import { describe, expect, it } from "vitest";

import {
  deriveWidgetAccount,
  HOSTED_SIGNER_MISSING_MESSAGE,
  type DeriveWidgetAccountInput,
  type WidgetSmartAccountState,
} from "./useWidgetAccount";

const SMART = "0x1111111111111111111111111111111111111111" as const;
const EOA = "0x2222222222222222222222222222222222222222" as const;

const emptySmart: WidgetSmartAccountState = {
  smartAccountReady: false,
  hostedSignerAvailable: false,
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
    expect(r.widgetAccount.connected).toBe(true);
    // Not execution-ready until the smart account initializes.
    expect(r.fluentAccountReady).toBe(false);
    expect(r.fluentAccountAddress).toBe(SMART);
  });

  describe("hosted session with a Signer behind the Fluent popup", () => {
    const hosted = {
      directAuth: false,
      sessionUserId: "user-1",
      sessionSmartAccountAddress: SMART,
    };
    const popupSigner: WidgetSmartAccountState = {
      ...emptySmart,
      hostedSignerAvailable: true,
      privyReady: true,
    };

    it("can send before its kernel is built — the popup signs, the kernel needs only the address", () => {
      const r = derive({ ...hosted, smartAccount: popupSigner });
      expect(r.fluentAccountReady).toBe(false);
      expect(r.fluentExecutionReady).toBe(true);
      expect(r.hostedSignerMissing).toBe(false);
      expect(r.widgetAccount).toEqual({
        address: SMART,
        signerAddress: undefined,
        connected: true,
        executionReady: true,
        type: "smart",
        capabilities: { atomicBatch: true, erc20Gas: true },
        executionStatus: "ready",
        executionError: undefined,
      });
    });

    it("does not wait for Privy to settle — the popup holds the credentials, not this page", () => {
      const r = derive({ ...hosted, smartAccount: { ...popupSigner, privyReady: false } });
      expect(r.widgetAccount.executionStatus).toBe("ready");
    });

    it("stays ready once the initializer has built the kernel", () => {
      const r = derive({
        ...hosted,
        smartAccount: { ...popupSigner, smartAccountReady: true, smartAccountAddress: SMART },
      });
      expect(r.fluentAccountReady).toBe(true);
      expect(r.widgetAccount.executionStatus).toBe("ready");
      expect(r.widgetAccount.type).toBe("smart");
    });

    it("reports a failed kernel build as an error, not as ready", () => {
      const r = derive({ ...hosted, smartAccount: { ...popupSigner, error: new Error("boom") } });
      expect(r.fluentExecutionReady).toBe(false);
      expect(r.widgetAccount.executionStatus).toBe("error");
      expect(r.widgetAccount.executionError).toBe("boom");
    });

    it("prefers the Fluent ID over a connected External wallet", () => {
      const r = derive({
        ...hosted,
        smartAccount: popupSigner,
        wallet: { connected: true, address: EOA, hasWalletClient: true },
      });
      expect(r.widgetAccount.type).toBe("smart");
      expect(r.accountMenuAddress).toBe(EOA);
    });

    it("is nothing without a session naming the Fluent ID", () => {
      const r = derive({ directAuth: false, smartAccount: popupSigner });
      expect(r.status).toBe("disconnected");
      expect(r.widgetAccount.executionStatus).toBe("disconnected");
    });
  });

  describe("hosted session that names no Signer", () => {
    const hosted = {
      directAuth: false,
      sessionUserId: "user-1",
      sessionSmartAccountAddress: SMART,
    };

    it("is connected but cannot send, and the account says why", () => {
      const r = derive({ ...hosted, smartAccount: { ...emptySmart, privyReady: true } });
      expect(r.status).toBe("connected");
      expect(r.hostedSignerMissing).toBe(true);
      expect(r.widgetAccount).toEqual({
        address: SMART,
        signerAddress: undefined,
        connected: true,
        executionReady: false,
        type: undefined,
        capabilities: { atomicBatch: false, erc20Gas: false },
        executionStatus: "unavailable",
        executionError: HOSTED_SIGNER_MISSING_MESSAGE,
      });
    });

    it("withholds the reason while Privy is still settling", () => {
      const r = derive({ ...hosted, smartAccount: { ...emptySmart, privyReady: false } });
      expect(r.hostedSignerMissing).toBe(false);
      expect(r.widgetAccount.executionStatus).toBe("unavailable");
      expect(r.widgetAccount.executionError).toBeUndefined();
    });

    // Privy signed in on this page too: the App runs on the Fluent origin, and the
    // initializer is about to build the Fluent ID from that Signer.
    it("withholds the reason while a Signer on this page initializes the Fluent ID", () => {
      const r = derive({
        ...hosted,
        smartAccount: {
          ...emptySmart,
          privyReady: true,
          privyAuthenticated: true,
          embeddedWalletCount: 1,
        },
      });
      expect(r.hostedSignerMissing).toBe(false);
      expect(r.widgetAccount.executionStatus).toBe("unavailable");
      expect(r.widgetAccount.executionError).toBeUndefined();
    });

    it("is ready once that Fluent ID initializes", () => {
      const r = derive({
        ...hosted,
        smartAccount: {
          ...emptySmart,
          smartAccountReady: true,
          smartAccountAddress: SMART,
          privyReady: true,
          privyAuthenticated: true,
          embeddedWalletCount: 1,
        },
      });
      expect(r.hostedSignerMissing).toBe(false);
      expect(r.widgetAccount.executionStatus).toBe("ready");
      expect(r.widgetAccount.type).toBe("smart");
    });

    it("lets a connected External wallet send instead", () => {
      const r = derive({
        ...hosted,
        smartAccount: { ...emptySmart, privyReady: true },
        wallet: { connected: true, address: EOA, hasWalletClient: true },
      });
      expect(r.hostedSignerMissing).toBe(false);
      expect(r.widgetAccount.executionReady).toBe(true);
      expect(r.widgetAccount.type).toBe("eoa");
      expect(r.widgetAccount.executionError).toBeUndefined();
    });

    it("reports an initialization error over the missing-signer reason", () => {
      const r = derive({
        ...hosted,
        smartAccount: { ...emptySmart, privyReady: true, error: new Error("boom") },
      });
      expect(r.hostedSignerMissing).toBe(false);
      expect(r.widgetAccount.executionStatus).toBe("error");
      expect(r.widgetAccount.executionError).toBe("boom");
    });
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
    // And says so, because the avatar beside that address has to follow it: the
    // Fluent ID's X picture over an External wallet's address is one account's
    // face on another account's row.
    expect(r.accountMenuIsExternalWallet).toBe(true);
  });

  it("keeps the menu on the Fluent ID when no External wallet is connected", () => {
    const r = derive({
      directAuth: true,
      sessionSmartAccountAddress: SMART,
      smartAccount: {
        ...emptySmart,
        smartAccountReady: true,
        smartAccountAddress: SMART,
        privyReady: true,
        privyAuthenticated: true,
        embeddedWalletCount: 1,
      },
    });

    expect(r.accountMenuAddress).toBe(SMART);
    expect(r.accountMenuIsExternalWallet).toBe(false);
  });

  it("stays on the External wallet even while it cannot execute", () => {
    // `hasWalletClient: false` is the window right after connecting. The header
    // already shows that wallet, so the avatar must already have left the Fluent
    // ID — keying this off execution readiness would put the X picture back.
    const r = derive({
      directAuth: true,
      sessionSmartAccountAddress: SMART,
      smartAccount: { ...emptySmart, privyReady: true },
      wallet: { connected: true, address: EOA, hasWalletClient: false },
    });

    expect(r.accountMenuAddress).toBe(EOA);
    expect(r.accountMenuIsExternalWallet).toBe(true);
  });
});
