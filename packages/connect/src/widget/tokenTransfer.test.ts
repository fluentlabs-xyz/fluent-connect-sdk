import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress } from "viem";

import { createFluentBatchOp } from "./batchOperation";
import {
  buildFluentTransferCall,
  fluentTransferAbi,
  parseFluentTransferAmount,
  parseFluentTransferRecipient,
} from "./tokenTransfer";

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
