import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import type { KernelAccountClient } from "@zerodev/sdk";
import type { Chain, EIP1193Provider, PublicClient, Transport } from "viem";
import { createPublicClient, http } from "viem";

import { assertFluentZeroDevChain, getZeroDevRpcUrl } from "./zerodev.js";

export type CreateFluentKernelAccountClientParams = {
  chain: Chain;
  zeroDevProjectId: string;
  /** Privy embedded wallet EIP-1193 provider */
  signer: EIP1193Provider;
  /** Optional Fluent RPC; defaults to chain default HTTP RPC */
  fluentRpcUrl?: string;
};

export type FluentKernelAccount = Awaited<
  ReturnType<typeof createKernelAccount>
>;

export type FluentKernelAccountClient = {
  publicClient: PublicClient;
  kernelClient: KernelAccountClient;
  account: FluentKernelAccount;
  smartAccountAddress: `0x${string}`;
  zeroDevRpcUrl: string;
};

/**
 * Build a gas-sponsored Kernel smart account on Fluent using a Privy embedded wallet as signer.
 * Requires a ZeroDev project with Fluent testnet (20994) or mainnet (25363) enabled.
 */
export async function createFluentKernelAccountClient(
  params: CreateFluentKernelAccountClientParams,
): Promise<FluentKernelAccountClient> {
  const { chain, zeroDevProjectId, signer } = params;
  assertFluentZeroDevChain(chain.id);

  const fluentRpc =
    params.fluentRpcUrl ?? chain.rpcUrls.default.http[0];
  if (!fluentRpc) {
    throw new Error(`No default RPC URL on chain ${chain.name}`);
  }

  const zeroDevRpcUrl = getZeroDevRpcUrl({
    projectId: zeroDevProjectId,
    chainId: chain.id,
  });
  const entryPoint = getEntryPoint("0.7");

  const publicClient = createPublicClient({
    chain,
    transport: http(fluentRpc),
  });

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });

  const account = await createKernelAccount(publicClient, {
    entryPoint,
    plugins: { sudo: ecdsaValidator },
    kernelVersion: KERNEL_V3_3,
  });

  const zerodevPaymaster = createZeroDevPaymasterClient({
    chain,
    transport: http(zeroDevRpcUrl),
  });

  const kernelClient = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(zeroDevRpcUrl),
    client: publicClient,
    paymaster: {
      getPaymasterData: (userOperation) =>
        zerodevPaymaster.sponsorUserOperation({ userOperation }),
    },
  });

  return {
    publicClient,
    kernelClient,
    account,
    smartAccountAddress: account.address,
    zeroDevRpcUrl,
  };
}

/** Factory for Privy wagmi `useEmbeddedSmartAccountConnector` */
export function createFluentSignerToZeroDevSmartAccount(params: {
  chain: Chain;
  zeroDevProjectId: string;
  fluentRpcUrl?: string;
}) {
  const { chain, zeroDevProjectId, fluentRpcUrl } = params;

  return async function signerToFluentZeroDevSmartAccount({
    signer,
  }: {
    signer: EIP1193Provider;
  }): Promise<EIP1193Provider> {
    const { kernelClient } = await createFluentKernelAccountClient({
      chain,
      zeroDevProjectId,
      signer,
      fluentRpcUrl,
    });
    return kernelClient as unknown as EIP1193Provider;
  };
}

export type { Chain, EIP1193Provider, PublicClient, Transport };
