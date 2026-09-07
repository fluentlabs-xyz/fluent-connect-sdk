import { createFluentZeroDevErc20PaymasterApprovalCall } from "@fluent.xyz/connect";
import { decodeFunctionData, erc20Abi, type Address } from "viem";

import { BLEND_ADDRESS, CHAIN } from "../consts";

/**
 * The ERC-20 paymaster's address, resolved from the SDK rather than written down.
 *
 * Token-paid gas goes to a different ZeroDev project from the sponsorship path, so every
 * ERC-20 paymaster address recorded in this repository belongs to the wrong project. The
 * SDK asks that project which account it will charge and encodes an approve against the
 * answer; reading the spender back out of that call is how this page learns the address
 * without ever naming one. This page never pays in tokens — the address exists so a send
 * that settled against the ERC-20 paymaster is named as the surprise it is.
 *
 * The answer depends on the chain and the EntryPoint, not on the token, so it is fetched
 * once and the promise is shared; a failure is not cached, so it stays retryable.
 */
let spenderPromise: Promise<Address> | null = null;

/**
 * What this page knows about the ERC-20 paymaster, including the two states an address
 * alone cannot express.
 *
 * `unreachable` carries the error rather than collapsing to an absent address: a token
 * button that is off has to say why it is off, and "we asked and this came back" is the only
 * honest answer available. The resolver above does not cache a failure, so the state is not
 * terminal.
 */
export type Erc20PaymasterState =
  | { status: "resolving"; address?: undefined; error?: undefined }
  | { status: "ready"; address: Address; error?: undefined }
  | { status: "unreachable"; address?: undefined; error: string };

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
