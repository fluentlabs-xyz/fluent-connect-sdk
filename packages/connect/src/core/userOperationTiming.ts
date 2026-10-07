import type { FluentZeroDevKernel } from "../widget/zerodevSession";
import { debugLog, isDebugLoggingEnabled } from "./debugLogger";
import { withUserOperationGas, type FluentUserOperationGas, type FluentUserOperationCallArgs } from "./userOperationGas";

/** Observe the SDK's signing boundary without repeating preparation or logging payloads. */
export async function sendUserOperationWithTiming(
  client: FluentZeroDevKernel["client"],
  args: FluentUserOperationCallArgs,
  gas?: FluentUserOperationGas,
) {
  const preparedArgs = withUserOperationGas(client, args, gas);
  if (!isDebugLoggingEnabled()) return client.sendUserOperation(preparedArgs);
  const startedAt = performance.now();
  let signingAt: number | undefined;
  let signedAt: number | undefined;
  let success = false;
  const account = preparedArgs.account;
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
    const hash = await client.sendUserOperation({ ...preparedArgs, account: observedAccount });
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
