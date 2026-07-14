/**
 * Minimal FluentBridge view ABI for connectivity checks.
 * Full ABI will be synced from solidity-contracts in a later release.
 */
export const fluentBridgeAbi = [
  {
    type: "function",
    name: "otherSideChainId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
