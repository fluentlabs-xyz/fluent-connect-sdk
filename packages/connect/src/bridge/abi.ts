/**
 * The two calls an ETH deposit needs. Kept hand-written and minimal rather than
 * synced wholesale from solidity-contracts: a deposit touches exactly these,
 * and a trimmed ABI keeps the published bundle small.
 */
export const nativeGatewayAbi = [
  {
    type: "function",
    name: "sendNativeTokens",
    stateMutability: "payable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getBridgeContract",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const fluentBridgeFeeAbi = [
  {
    type: "function",
    name: "getSentMessageFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** `erc20Gateway` — the one call a canonical ERC-20 deposit makes. */
export const erc20GatewayAbi = [
  {
    type: "function",
    name: "sendTokens",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/**
 * Fast-path portal (Portal's `FastPathPortalABI`, trimmed). `quote` has two
 * overloads; the adapter-taking one is the fallback when the short one reverts.
 */
export const fastPathPortalAbi = [
  {
    type: "function",
    name: "sendToken",
    stateMutability: "payable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "sourceToken", type: "address" },
      { name: "destinationChainId", type: "uint32" },
      { name: "destinationToken", type: "bytes32" },
      { name: "recipient", type: "bytes32" },
      { name: "refundAddress", type: "bytes32" },
      { name: "bridgeAdapterArgs", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "destinationChainId", type: "uint32" },
      { name: "payloadType", type: "uint8" },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "destinationChainId", type: "uint32" },
      { name: "payloadType", type: "uint8" },
      { name: "bridgeAdapter", type: "address" },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
  {
    type: "function",
    name: "defaultBridgeAdapter",
    stateMutability: "view",
    inputs: [{ name: "destinationChainId", type: "uint32" }],
    outputs: [{ name: "bridgeAdapter", type: "address" }],
  },
] as const;

/**
 * M^0 swap facility (Portal's `SwapFacilityABI`, trimmed): converts a
 * stablecoin into USDnr on Ethereum at par. The amount that actually came out is
 * read from `Swapped` / `SwappedInJMI` in the receipt — the bridge leg carries
 * what landed, never what was predicted.
 */
export const swapFacilityAbi = [
  {
    type: "function",
    name: "canSwapViaPath",
    stateMutability: "view",
    inputs: [
      { name: "swapper", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Swapped",
    inputs: [
      { name: "extensionIn", type: "address", indexed: true },
      { name: "extensionOut", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "recipient", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SwappedInJMI",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "extensionOut", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "recipient", type: "address", indexed: true },
    ],
  },
] as const;
