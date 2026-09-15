/**
 * Pins the claim the public signing API rests on: a signature produced by the
 * ZeroDev Kernel account (KERNEL_V3_3, EntryPoint 0.7, ECDSA sudo validator)
 * verifies with viem's `verifyTypedData` / `verifyMessage` both before the account
 * is deployed (ERC-6492) and after (ERC-1271).
 *
 * Runs against an `anvil` fork of Fluent testnet, where the Kernel factory and
 * implementation live, so it needs foundry and network access to fetch fork
 * state, but no funded key. A local private key stands in for the Fluent ID's
 * Signer: both are plain ECDSA keys behind the same validator, and the Kernel
 * signature format is what this test is about.
 *
 * Opt in with `FLUENT_KERNEL_SIGNATURE_TEST=1` (`pnpm test:kernel-signature`).
 */
import { spawn, type ChildProcess } from "node:child_process";

import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { createKernelAccount } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { fluentTestnet } from "@fluent.xyz/connect-sdk";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type Hex,
  type HttpTransport,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FORK_URL = process.env.FLUENT_KERNEL_SIGNATURE_FORK_URL ?? "https://rpc.testnet.fluent.xyz/";
const ANVIL_PORT = 8545 + Math.floor(Math.random() * 1000);
const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`;
/** anvil's first default account, funded on every fork. */
const ANVIL_FUNDED_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
/** ERC-6492 signatures end with this 32-byte magic suffix. */
const ERC6492_SUFFIX = "6492649264926492649264926492649264926492649264926492649264926492";

const ORDER = {
  domain: { name: "Zenkai", version: "1", chainId: fluentTestnet.id },
  types: { Order: [{ name: "id", type: "uint256" }, { name: "maker", type: "address" }] },
  primaryType: "Order",
  message: { id: 7n, maker: "0x0000000000000000000000000000000000000001" },
} as const;

describe.skipIf(!process.env.FLUENT_KERNEL_SIGNATURE_TEST)(
  "Kernel account signatures verify through viem",
  () => {
    let anvil: ChildProcess;
    let chain: Chain;
    let publicClient: PublicClient<HttpTransport, Chain>;
    let account: Awaited<ReturnType<typeof createKernelAccount>>;

    beforeAll(async () => {
      anvil = spawn("anvil", ["--fork-url", FORK_URL, "--port", String(ANVIL_PORT), "--silent"], {
        stdio: "ignore",
      });
      chain = {
        ...fluentTestnet,
        rpcUrls: { default: { http: [ANVIL_URL] } },
      };
      publicClient = createPublicClient({ chain, transport: http(ANVIL_URL) });
      await waitForRpc(publicClient);

      const signer = privateKeyToAccount(generatePrivateKey());
      const entryPoint = getEntryPoint("0.7");
      const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
        signer,
        entryPoint,
        kernelVersion: KERNEL_V3_3,
      });
      account = await createKernelAccount(publicClient, {
        entryPoint,
        plugins: { sudo: ecdsaValidator },
        kernelVersion: KERNEL_V3_3,
      });
    }, 120_000);

    afterAll(() => {
      anvil?.kill();
    });

    it("before deployment: ERC-6492-wrapped signatures verify, and a tampered message does not", async () => {
      expect(await account.isDeployed()).toBe(false);

      const typedSignature = await account.signTypedData(ORDER);
      expect(typedSignature.endsWith(ERC6492_SUFFIX)).toBe(true);
      expect(
        await publicClient.verifyTypedData({ ...ORDER, address: account.address, signature: typedSignature }),
      ).toBe(true);
      expect(
        await publicClient.verifyTypedData({
          ...ORDER,
          message: { ...ORDER.message, id: 8n },
          address: account.address,
          signature: typedSignature,
        }),
      ).toBe(false);

      const messageSignature = await account.signMessage({ message: "hello fluent" });
      expect(messageSignature.endsWith(ERC6492_SUFFIX)).toBe(true);
      expect(
        await publicClient.verifyMessage({ address: account.address, message: "hello fluent", signature: messageSignature }),
      ).toBe(true);
      expect(
        await publicClient.verifyMessage({ address: account.address, message: "hello fluent!", signature: messageSignature }),
      ).toBe(false);
    }, 60_000);

    it("after deployment: plain ERC-1271 signatures verify against the deployed account", async () => {
      const { factory, factoryData } = await account.getFactoryArgs();
      if (!factory || !factoryData) throw new Error("Kernel account has no factory args");
      const deployer = createWalletClient({
        account: privateKeyToAccount(ANVIL_FUNDED_KEY),
        chain,
        transport: http(ANVIL_URL),
      });
      const hash = await deployer.sendTransaction({ to: factory, data: factoryData });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
      expect(await account.isDeployed()).toBe(true);

      const typedSignature = await account.signTypedData(ORDER);
      expect(typedSignature.endsWith(ERC6492_SUFFIX)).toBe(false);
      expect(
        await publicClient.verifyTypedData({ ...ORDER, address: account.address, signature: typedSignature }),
      ).toBe(true);
      expect(
        await publicClient.verifyTypedData({
          ...ORDER,
          message: { ...ORDER.message, id: 8n },
          address: account.address,
          signature: typedSignature,
        }),
      ).toBe(false);

      const messageSignature = await account.signMessage({ message: "hello fluent" });
      expect(messageSignature.endsWith(ERC6492_SUFFIX)).toBe(false);
      expect(
        await publicClient.verifyMessage({ address: account.address, message: "hello fluent", signature: messageSignature }),
      ).toBe(true);
    }, 60_000);
  },
);

async function waitForRpc(client: PublicClient<HttpTransport, Chain>) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await client.getChainId();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
