import { createFluentClient, fluentTestnet } from "@fluent/wallet-sdk";
import { http } from "viem";

const client = createFluentClient({
  chain: fluentTestnet,
  transport: http(),
});

const chainId = await client.public.getChainId();
const otherSide = await client.readOtherSideChainId();

console.log("Fluent chain:", client.definition.name, `(${chainId})`);
console.log("L2 FluentBridge:", client.addresses.bridge.l2?.proxy);
console.log("L1 FluentBridge (Sepolia):", client.addresses.bridge.l1?.proxy);
console.log("Bridge otherSideChainId:", otherSide?.toString() ?? "(unavailable)");
