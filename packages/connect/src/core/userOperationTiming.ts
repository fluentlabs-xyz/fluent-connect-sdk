import type { Address, Hex } from "viem";
import type { FluentZeroDevKernel } from "../widget/zerodevSession";
import { debugLog, isDebugLoggingEnabled } from "./debugLogger";

/** Observe the SDK's signing boundary without repeating preparation or logging payloads. */
export async function sendUserOperationWithTiming(
  client: FluentZeroDevKernel["client"],
  args: {
    account: FluentZeroDevKernel["account"];
    calls: { to: Address; data: Hex; value: bigint }[];
  },
) {
  if (!isDebugLoggingEnabled()) return client.sendUserOperation(args);
  const startedAt = performance.now();
  let signingAt: number | undefined;
  let signedAt: number | undefined;
  let success = false;
  const account = args.account;
  const observedAccount: typeof account = {
    ...account,
    async signUserOperation(operation) {
      signingAt = performance.now();
      debugLog("[fluent execution stage]", {
        stage: "signing",
        preparationMs: signingAt - startedAt,
      });
      const signature = await account.signUserOperation(operation);
      signedAt = performance.now();
      debugLog("[fluent execution stage]", {
        stage: "broadcasting",
        signingMs: signedAt - signingAt,
      });
      return signature;
    },
  };
  debugLog("[fluent execution stage]", { stage: "preparing" });
  try {
    const hash = await client.sendUserOperation({ ...args, account: observedAccount });
    success = true;
    return hash;
  } finally {
    const finishedAt = performance.now();
    debugLog("[fluent submission timing]", {
      success,
      preparationMs: (signingAt ?? finishedAt) - startedAt,
      signingMs: signingAt === undefined ? undefined : (signedAt ?? finishedAt) - signingAt,
      broadcastMs: signedAt === undefined ? undefined : finishedAt - signedAt,
      totalMs: finishedAt - startedAt,
    });
  }
}
