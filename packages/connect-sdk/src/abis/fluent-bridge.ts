/**
 * The FluentBridge ABI reduced to its `otherSideChainId` view, the one call
 * `readOtherSideChainId` of `createFluentClient` makes.
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
