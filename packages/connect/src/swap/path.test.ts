import { getAddress, size } from "viem";
import { describe, expect, it } from "vitest";

import { encodeFluentSwapPath } from "./path";

const USDNR = getAddress("0xD48e565561416dE59DA1050ED70b8d75e8eF28f9");
const WETH9 = getAddress("0x927C469E58Daab257Ea60B2D8c37bEDD2a203A54");
const BLEND = getAddress("0x1385B8f55A84f2BdA13EeD4099d29Eae03d553b2");

describe("encodeFluentSwapPath", () => {
  it("packs a single pool as token, fee, token", () => {
    const path = encodeFluentSwapPath([{ tokenIn: WETH9, tokenOut: USDNR, fee: 3_000 }]);

    // 20 + 3 + 20 bytes, packed rather than ABI-encoded, which is what the
    // router's `exactInput` reads.
    expect(size(path)).toBe(43);
    expect(path.toLowerCase()).toBe(
      `0x${WETH9.slice(2)}000bb8${USDNR.slice(2)}`.toLowerCase(),
    );
  });

  it("chains a hop so each pool contributes one fee and one token", () => {
    const path = encodeFluentSwapPath([
      { tokenIn: BLEND, tokenOut: WETH9, fee: 10_000 },
      { tokenIn: WETH9, tokenOut: USDNR, fee: 500 },
    ]);

    expect(size(path)).toBe(66);
    expect(path.toLowerCase()).toBe(
      `0x${BLEND.slice(2)}002710${WETH9.slice(2)}0001f4${USDNR.slice(2)}`.toLowerCase(),
    );
  });

  it("refuses a route with no pool in it", () => {
    expect(() => encodeFluentSwapPath([])).toThrow("at least one pool");
  });
});
