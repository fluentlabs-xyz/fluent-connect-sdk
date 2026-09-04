import { describe, expect, it } from "vitest";

import { ABSENT, describeWallet, fluentIdFromToken, type WalletInfoInput } from "./walletInfo";

const KERNEL = "0x1111111111111111111111111111111111111111" as const;
const SIGNER = "0x2222222222222222222222222222222222222222" as const;

function tokenWith(payload: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

const base: WalletInfoInput = {
  accountType: "smart",
  address: KERNEL,
  signerAddress: SIGNER,
  fluentToken: tokenWith({ sub: "fcid_abc" }),
  fluentTokenStatus: "idle",
  fluentTokenError: undefined,
  privyDid: "did:privy:abc",
  xHandle: "d1r1_me",
  segments: ["Has a Fluent profile"],
  sponsorshipHost: "sponsorship.example",
};

function factFor(facts: ReturnType<typeof describeWallet>, label: string) {
  const fact = facts.find((candidate) => candidate.label === label);
  if (!fact) throw new Error(`no fact labelled ${label}`);
  return fact;
}

describe("fluentIdFromToken", () => {
  it("reads the Fluent ID out of the token's sub", () => {
    expect(fluentIdFromToken(tokenWith({ sub: "fcid_abc" }))).toBe("fcid_abc");
  });

  it("returns nothing for a token it cannot read, rather than throwing", () => {
    expect(fluentIdFromToken(undefined)).toBeUndefined();
    expect(fluentIdFromToken("not-a-token")).toBeUndefined();
    expect(fluentIdFromToken("header.!!!.signature")).toBeUndefined();
    expect(fluentIdFromToken(tokenWith({ aud: "partner" }))).toBeUndefined();
  });

  // The direct-auth session's `sub` is the Privy DID. Reporting it as a Fluent ID would
  // invent an identifier no service ever issued.
  it("rejects a sub that is not an fcid", () => {
    expect(fluentIdFromToken(tokenWith({ sub: "did:privy:abc" }))).toBeUndefined();
  });
});

describe("describeWallet", () => {
  it("separates the signing wallet from the account that executes", () => {
    const facts = describeWallet(base);

    expect(factFor(facts, "Signer").value).toBe(SIGNER);
    expect(factFor(facts, "Smart account").value).toBe(KERNEL);
    expect(factFor(facts, "Fluent ID").value).toBe("fcid_abc");
  });

  it("reports no smart account for an external wallet, and shows the EOA as the signer", () => {
    const facts = describeWallet({
      ...base,
      accountType: "eoa",
      address: SIGNER,
      signerAddress: undefined,
      privyDid: undefined,
      fluentToken: undefined,
    });

    expect(factFor(facts, "Signer").value).toBe(SIGNER);
    expect(factFor(facts, "Smart account").value).toBe(ABSENT);
    expect(factFor(facts, "Privy DID").value).toBe(ABSENT);
    expect(factFor(facts, "Fluent ID").value).toBe(ABSENT);
    expect(factFor(facts, "Fluent ID").note).toContain("EIP-712 challenge");
    expect(factFor(facts, "Fluent ID").obtainable).toBe(true);
  });

  it("keeps every row in the same order whatever the sign-in", () => {
    const labels = (input: WalletInfoInput) => describeWallet(input).map((fact) => fact.label);
    const connected = labels(base);

    expect(labels({ ...base, accountType: "eoa" })).toEqual(connected);
    expect(
      labels({
        ...base,
        accountType: undefined,
        address: undefined,
        signerAddress: undefined,
        fluentToken: undefined,
        privyDid: undefined,
        xHandle: null,
        segments: undefined,
      }),
    ).toEqual(connected);
  });

  it("never marks a non-address as linkable", () => {
    const facts = describeWallet({ ...base, accountType: "eoa", address: SIGNER });

    expect(factFor(facts, "Smart account").address).toBeFalsy();
    expect(factFor(facts, "Fluent ID").address).toBeFalsy();
    expect(factFor(facts, "Privy DID").address).toBeFalsy();
  });

  it("marks the row absent while the kernel is still being derived", () => {
    const facts = describeWallet({ ...base, address: undefined, signerAddress: undefined });

    expect(factFor(facts, "Smart account").value).toBe(ABSENT);
    expect(factFor(facts, "Smart account").address).toBe(false);
  });

  it("refuses a locally minted token, whose sub is the Privy DID", () => {
    const facts = describeWallet({ ...base, fluentToken: tokenWith({ sub: "did:privy:abc" }) });

    expect(factFor(facts, "Fluent ID").value).toBe(ABSENT);
    expect(factFor(facts, "Privy DID").value).toBe("did:privy:abc");
  });

  it("reports the exchange's own failure, and lets it be retried", () => {
    const failed = describeWallet({
      ...base,
      fluentToken: undefined,
      fluentTokenStatus: "error",
      fluentTokenError: "origin not allowed",
    });
    expect(factFor(failed, "Fluent ID").note).toBe("origin not allowed");
    expect(factFor(failed, "Fluent ID").obtainable).toBe(true);

    const loading = describeWallet({
      ...base,
      fluentToken: undefined,
      fluentTokenStatus: "loading",
    });
    expect(factFor(loading, "Fluent ID").note).toContain("Exchanging");
    expect(factFor(loading, "Fluent ID").obtainable).toBe(false);
  });

  it("distinguishes a profile with no segments from an unknown profile", () => {
    expect(factFor(describeWallet({ ...base, segments: [] }), "Segments").value).toBe("none");
    expect(factFor(describeWallet({ ...base, segments: undefined }), "Segments").value).toBe(ABSENT);
  });
});
