import { describe, expect, it } from "vitest";
import { fluentTokenIdentity, type FluentDisplayToken } from "@fluent.xyz/connect-sdk";
import { decodeFunctionData, getAddress } from "viem";

import type { FluentTransactionOperationEntry } from "../core/transactionHistory";
import { createFluentBatchOp } from "./batchOperation";
import {
  attachFluentPendingTransfers,
  buildFluentTransferCall,
  checkFluentTransferFee,
  fluentTransferAbi,
  parseFluentTransferAmount,
  parseFluentTransferRecipient,
  resolveFluentTransferGasContext,
  type FluentPendingTransfer,
} from "./tokenTransfer";

/** A 32-byte hash from a short seed, for rows that only need to be told apart. */
const hash = (seed: string) => `0x${seed.repeat(64 / seed.length)}` as `0x${string}`;

const RECIPIENT = "0x1c92dffbce76670f69007f22a54e31ff3ab45d5e";
const BLEND = {
  chainId: 20994,
  symbol: "BLEND",
  name: "Mock Blend",
  decimals: 18,
  address: "0x83Fed707A8dDDC2535aE591CF19fB6C91D542D8E",
} as const;
const ETH = {
  chainId: 20994,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
  native: true,
} as const;

describe("parseFluentTransferRecipient", () => {
  it("accepts an address and reports an empty field separately from a wrong one", () => {
    expect(parseFluentTransferRecipient({ input: `  ${RECIPIENT}  ` })).toEqual({
      status: "ok",
      address: RECIPIENT,
    });
    expect(parseFluentTransferRecipient({ input: "   " })).toEqual({ status: "empty" });
  });

  it("rejects anything that is not address-shaped", () => {
    for (const input of ["not an address", "0x123", RECIPIENT.slice(0, -1), `${RECIPIENT}ff`]) {
      expect(parseFluentTransferRecipient({ input }).status).toBe("rejected");
    }
  });

  it("rejects a mixed-case address whose checksum does not match", () => {
    // One character of a correctly checksummed address changed case: the shape
    // still passes, and only the checksum catches it.
    const tampered = `0x83fed707A8dDDC2535aE591CF19fB6C91D542D8E`;
    const result = parseFluentTransferRecipient({ input: tampered });
    expect(result.status).toBe("rejected");
    expect(result).toMatchObject({ message: expect.stringContaining("checksum") });
    // The same address in full lowercase carries no checksum to fail.
    expect(parseFluentTransferRecipient({ input: tampered.toLowerCase() }).status).toBe("ok");
  });

  it("rejects the sending account, whatever case it is written in", () => {
    expect(
      parseFluentTransferRecipient({ input: RECIPIENT, self: RECIPIENT.toUpperCase() }).status,
    ).toBe("rejected");
  });

  it("rejects a listed token's own contract", () => {
    const result = parseFluentTransferRecipient({
      input: BLEND.address,
      contracts: new Set([BLEND.address.toLowerCase()]),
    });
    expect(result).toMatchObject({ status: "rejected" });
  });
});

describe("parseFluentTransferAmount", () => {
  const balance = 10n * 10n ** 18n;
  const parse = (input: string, decimals = 18) =>
    parseFluentTransferAmount({ input, symbol: "BLEND", decimals, balance });

  it("parses a decimal amount into the token's base units", () => {
    expect(parse("1.5")).toEqual({ status: "ok", raw: 1_500_000_000_000_000_000n });
    expect(parse(" 10 ")).toEqual({ status: "ok", raw: balance });
  });

  it("reports an empty field separately, so a fresh form shows no error", () => {
    expect(parse("")).toEqual({ status: "empty" });
    expect(parse("   ")).toEqual({ status: "empty" });
  });

  it("rejects input that is not a plain number", () => {
    for (const input of ["abc", "1.2.3", "-1", "1e18", "0x10", ".", "1 000"]) {
      expect(parse(input).status, input).toBe("rejected");
    }
  });

  it("points a comma at the separator the widget actually parses", () => {
    expect(parse("1,5")).toMatchObject({
      status: "rejected",
      message: "Use a dot for the decimal point.",
    });
  });

  it("rejects zero however it is written", () => {
    for (const input of ["0", "0.0", "0.000", ".0"]) {
      expect(parse(input).status, input).toBe("rejected");
    }
  });

  it("rejects more decimals than the token has, rather than rounding them away", () => {
    expect(parse("1.5", 0).status).toBe("rejected");
    expect(parse("1.1234567", 6).status).toBe("rejected");
    expect(parse("1.123456", 6)).toEqual({ status: "ok", raw: 1_123_456n });
  });

  it("rejects more than the balance and accepts exactly the balance", () => {
    expect(parse("10.000000000000000001").status).toBe("rejected");
    expect(parse("11")).toMatchObject({
      status: "rejected",
      message: "That is more than your BLEND balance.",
    });
    expect(parse("10").status).toBe("ok");
  });

  it("refuses to spend a zero balance", () => {
    expect(
      parseFluentTransferAmount({ input: "1", symbol: "BLEND", decimals: 18, balance: 0n }).status,
    ).toBe("rejected");
  });
});

describe("resolveFluentTransferGasContext", () => {
  const FLUENT_ID = "0x1C92DffBCe76670F69007F22A54e31ff3Ab45d5E";

  it("offers a fee token to a Fluent ID whose kernel is not ready yet", () => {
    // The regression this exists for. In hosted mode the ZeroDev initializer
    // never runs — it needs a local Privy signer and only direct mode has one —
    // so `capabilities.erc20Gas` is false for the whole session. Reading that
    // hid the fee selector from every hosted App.
    expect(
      resolveFluentTransferGasContext({
        fluentAccountAddress: FLUENT_ID,
        walletConnected: false,
      }),
    ).toMatchObject({ erc20Gas: true });
  });

  it("offers none to an external wallet, which has no paymaster", () => {
    expect(
      resolveFluentTransferGasContext({ walletConnected: true }),
    ).toMatchObject({ erc20Gas: false });
    // Both connected: the widget shows the wallet's balances and routes to it,
    // so a fee token chosen here would be ignored.
    expect(
      resolveFluentTransferGasContext({
        fluentAccountAddress: FLUENT_ID,
        walletConnected: true,
      }),
    ).toMatchObject({ erc20Gas: false });
  });

  it("reports sponsorship only when the App configured both halves of it", () => {
    const sponsoring = { fluentAccountAddress: FLUENT_ID, walletConnected: false };
    expect(
      resolveFluentTransferGasContext({ ...sponsoring, sponsorshipUrl: "https://p", appId: "a" }),
    ).toMatchObject({ sponsorshipAvailable: true });
    expect(
      resolveFluentTransferGasContext({ ...sponsoring, sponsorshipUrl: "https://p" }),
    ).toMatchObject({ sponsorshipAvailable: false });
    expect(resolveFluentTransferGasContext(sponsoring)).toMatchObject({
      sponsorshipAvailable: false,
    });
  });
});

describe("checkFluentTransferFee", () => {
  const blend: FluentDisplayToken = {
    ...BLEND,
    source: "default",
    identity: fluentTokenIdentity(BLEND),
  };
  const eth: FluentDisplayToken = {
    ...ETH,
    source: "default",
    identity: fluentTokenIdentity(ETH),
  };
  const ONE = 10n ** 18n;

  it("says nothing while the fee balance is still unread", () => {
    expect(
      checkFluentTransferFee({ feeToken: blend, feeBalance: null, sponsorshipAvailable: false }),
    ).toEqual({ status: "ok" });
  });

  it("blocks an empty ERC-20 fee balance even where the App sponsors", () => {
    // An ERC-20 fee is charged by that token's own paymaster, which sponsorship
    // never stands in for — so this is certain failure, not a risk.
    for (const sponsorshipAvailable of [true, false]) {
      expect(
        checkFluentTransferFee({ feeToken: blend, feeBalance: 0n, sponsorshipAvailable }),
      ).toMatchObject({ status: "blocked", message: expect.stringContaining("enough BLEND") });
    }
  });

  it("only warns about an empty native balance where the App may cover it", () => {
    expect(
      checkFluentTransferFee({ feeToken: eth, feeBalance: 0n, sponsorshipAvailable: true }),
    ).toMatchObject({ status: "warning" });
    expect(
      checkFluentTransferFee({ feeToken: eth, feeBalance: 0n, sponsorshipAvailable: false }),
    ).toMatchObject({ status: "blocked" });
  });

  it("warns about a balance the widget's own tier calls dust", () => {
    // Below 0.000001 ETH by `getFluentGasPaymentValueTier`. Only reachable where
    // the App configured rates, so it stays a warning on every path.
    expect(
      checkFluentTransferFee({
        feeToken: blend,
        feeBalance: ONE,
        feeBalanceEthValue: 1_000n,
        sponsorshipAvailable: false,
      }),
    ).toMatchObject({ status: "warning", message: expect.stringContaining("too small") });
    expect(
      checkFluentTransferFee({
        feeToken: blend,
        feeBalance: ONE,
        feeBalanceEthValue: ONE / 100n,
        sponsorshipAvailable: false,
      }),
    ).toEqual({ status: "ok" });
  });
});

describe("buildFluentTransferCall", () => {
  it("encodes an ERC-20 transfer against the token contract", () => {
    const call = buildFluentTransferCall({ token: BLEND, to: RECIPIENT, amount: 25n });
    expect(call.to).toBe(BLEND.address);
    expect(call.value ?? 0n).toBe(0n);

    // Encoded the way the widget will encode it, then read back: this is the
    // call that moves the money, so "transfer(recipient, amount)" is worth
    // asserting through the real path rather than on the inputs.
    const [encoded] = createFluentBatchOp({ calls: [call] }).encodedCalls;
    expect(decodeFunctionData({ abi: fluentTransferAbi, data: encoded!.data })).toEqual({
      functionName: "transfer",
      // Decoding checksums the address back; the bytes on the wire are the same.
      args: [getAddress(RECIPIENT), 25n],
    });
  });

  it("sends the chain's own currency as value to the recipient, not to a contract", () => {
    const call = buildFluentTransferCall({ token: ETH, to: RECIPIENT, amount: 25n });
    expect(call).toMatchObject({ to: RECIPIENT, value: 25n, data: "0x" });
  });

  it("refuses a token with no contract address on this network", () => {
    expect(() =>
      buildFluentTransferCall({
        token: { symbol: "GHOST" },
        to: RECIPIENT,
        amount: 1n,
      }),
    ).toThrow("GHOST has no contract address on this network");
  });
});

describe("attachFluentPendingTransfers", () => {
  const op = (overrides: Partial<FluentTransactionOperationEntry> = {}): FluentTransactionOperationEntry => ({
    kind: "operation",
    id: "op-1",
    status: "confirmed",
    timestamp: 1_700_000_000_000,
    hash: hash("aa"),
    transactionHash: hash("bb"),
    movements: [],
    ...overrides,
  });
  const settled: FluentPendingTransfer = {
    id: "pending-1",
    tokenIdentity: "20994:0xtoken",
    symbol: "USDnr",
    amount: "15",
    to: getAddress("0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4"),
    startedAt: 1_700_000_000_000,
    hash: hash("bb"),
  };

  it("writes a bare operation's movement from the transfer that settled with its hash", () => {
    const [entry] = attachFluentPendingTransfers([op()], [settled]);
    expect(entry).toMatchObject({
      kind: "operation",
      movements: [
        {
          kind: "movement",
          direction: "sent",
          symbol: "USDnr",
          amount: "15",
          tokenIdentity: "20994:0xtoken",
          counterparty: settled.to,
          hash: hash("bb"),
          status: "confirmed",
        },
      ],
    });
  });

  it("matches the operation hash as well as the transaction hash", () => {
    const [entry] = attachFluentPendingTransfers([op()], [{ ...settled, hash: hash("aa") }]);
    expect(entry.kind === "operation" && entry.movements).toHaveLength(1);
  });

  it("leaves an operation alone once the history knows what it moved", () => {
    const movement = {
      kind: "movement" as const,
      id: "m-1",
      status: "confirmed" as const,
      timestamp: 1_700_000_000_000,
      hash: hash("bb"),
      direction: "sent" as const,
      tokenIdentity: "20994:0xtoken",
      symbol: "USDnr",
      amount: "15",
      counterparty: settled.to,
    };
    const listed = op({ movements: [movement] });
    const [entry] = attachFluentPendingTransfers([listed], [settled]);
    expect(entry).toBe(listed);
  });

  it("ignores transfers that have not settled, and operations nobody sent", () => {
    const entries = [op(), op({ id: "op-2", hash: hash("cc"), transactionHash: hash("dd") })];
    const result = attachFluentPendingTransfers(entries, [{ ...settled, hash: undefined }]);
    expect(result).toBe(entries);
    const [, other] = attachFluentPendingTransfers(entries, [settled]);
    expect(other).toBe(entries[1]);
  });
});
