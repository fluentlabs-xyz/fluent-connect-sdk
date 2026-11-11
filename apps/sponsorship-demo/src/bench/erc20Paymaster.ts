import {
  createFluentZeroDevErc20PaymasterApprovalCall,
} from "@fluent.xyz/connect/internal/zerodevPaymaster";
import { decodeFunctionData, erc20Abi, type Address } from "viem";

import { BLEND_ADDRESS, CHAIN } from "../consts";

/**
 * The shared lookup of the ERC-20 paymaster's address. The address depends on the chain and the
 * EntryPoint, not on the token, so one promise serves every caller; a failure clears it, so the
 * lookup stays retryable.
 */
let spenderPromise: Promise<Address> | null = null;

/**
 * What this page knows about the ERC-20 paymaster: still resolving, resolved, or unreachable.
 * `unreachable` carries the error, so a disabled token button can say why; the lookup caches no
 * failure, so the state is not final.
 */
export type Erc20PaymasterState =
  | { status: "resolving"; address?: undefined; error?: undefined }
  | { status: "ready"; address: Address; error?: undefined }
  | { status: "unreachable"; address?: undefined; error: string };

/**
 * Returns the ERC-20 paymaster's address: the spender of the approval call the SDK builds.
 * Token-paid gas goes through a different ZeroDev project from Sponsorship, so the SDK asks that
 * project which account it charges, and this app names no ERC-20 paymaster address of its own.
 */
export function resolveErc20PaymasterAddress(): Promise<Address> {
  spenderPromise ??= (async () => {
    const call = await createFluentZeroDevErc20PaymasterApprovalCall({
      chain: CHAIN,
      gasToken: BLEND_ADDRESS,
      approveAmount: 0n,
    });
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
    if (decoded.functionName !== "approve") {
      throw new Error(`expected an approve call, got ${decoded.functionName}`);
    }
    return decoded.args[0];
  })().catch((error: unknown) => {
    spenderPromise = null;
    throw error;
  });
  return spenderPromise;
}
