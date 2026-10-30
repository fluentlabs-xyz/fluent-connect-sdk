import { parseEther, parseUnits } from "viem";
import { describe, expect, it } from "vitest";

import {
  FLUENT_SWAP_NATIVE_GAS_RESERVE_WEI,
  getFluentSwapContracts,
} from "./contracts";
import {
  findFluentSwapToken,
  getFluentSwapInputAmount,
  getFluentSwapPathAddress,
  getFluentSwapTokens,
} from "./tokens";

const contracts = getFluentSwapContracts("mainnet")!;

describe("getFluentSwapTokens", () => {
  it("offers the Default tokens and nothing else", () => {
    expect(getFluentSwapTokens("mainnet").map((token) => token.symbol).sort()).toEqual([
      "BLEND",
      "ETH",
      "USDnr",
    ]);
  });

  it("marks the chain's own coin by having no contract address", () => {
    expect(findFluentSwapToken("mainnet", "ETH")?.address).toBeUndefined();
    expect(findFluentSwapToken("mainnet", "USDnr")?.address).toBeDefined();
  });
});

describe("getFluentSwapContracts", () => {
  it("has no deployment on testnet, where FluxFlow does not run", () => {
    expect(getFluentSwapContracts("testnet")).toBeUndefined();
  });
});

describe("getFluentSwapPathAddress", () => {
  it("names the chain's own coin by WETH9, which is how a pool holds it", () => {
    const eth = findFluentSwapToken("mainnet", "ETH")!;
    expect(getFluentSwapPathAddress(eth, contracts)).toBe(contracts.weth9);
  });
});

describe("getFluentSwapInputAmount", () => {
  const eth = findFluentSwapToken("mainnet", "ETH")!;
  const usdnr = findFluentSwapToken("mainnet", "USDnr")!;

  it("leaves a native deposit something to pay for its own swap with", () => {
    const delivered = parseEther("0.01");
    expect(getFluentSwapInputAmount(delivered, eth)).toBe(
      delivered - FLUENT_SWAP_NATIVE_GAS_RESERVE_WEI,
    );
  });

  it("sells an ERC-20 deposit whole", () => {
    const delivered = parseUnits("25", usdnr.decimals);
    expect(getFluentSwapInputAmount(delivered, usdnr)).toBe(delivered);
  });

  it("answers zero when the reserve leaves nothing to swap", () => {
    expect(getFluentSwapInputAmount(FLUENT_SWAP_NATIVE_GAS_RESERVE_WEI, eth)).toBe(0n);
  });

  it("answers nothing until the deposit amount is known", () => {
    expect(getFluentSwapInputAmount(undefined, eth)).toBeUndefined();
  });
});
