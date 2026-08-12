import { toast } from "../components/ui/toast";
import { HttpError } from "./postJson";

export type FaucetReceipt = {
  status?: string;
  txHash?: string;
  message?: string;
};

function normalize(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isAlreadyClaimed(status?: string, message?: string) {
  const statusNorm = normalize(status);
  const messageNorm = normalize(message);
  return statusNorm.includes("already") || messageNorm.includes("already");
}

export function toastFaucetSuccess(receipt: FaucetReceipt) {
  if (isAlreadyClaimed(receipt.status, receipt.message)) {
    toast.add({
      type: "info",
      title: "Already claimed",
      description: receipt.message || "BLEND faucet was already claimed for this account.",
    });
    return;
  }

  toast.add({
    type: "success",
    title: "Faucet claimed",
    description:
      receipt.message ||
      (receipt.txHash ? `Transaction ${receipt.txHash}` : "BLEND was sent to your wallet."),
  });
}

export function toastFaucetError(error: unknown) {
  if (error instanceof HttpError) {
    if (isAlreadyClaimed(error.body?.status, error.message) || error.status === 409) {
      toast.add({
        type: "info",
        title: "Already claimed",
        description: error.message || "BLEND faucet was already claimed for this account.",
      });
      return;
    }

    if (error.status === 429) {
      toast.add({
        type: "warning",
        title: "Too many requests",
        description: error.message || "Please wait a moment and try again.",
      });
      return;
    }

    toast.add({
      type: "error",
      title: "Faucet request failed",
      description: error.message || `Request failed with ${error.status}`,
    });
    return;
  }

  toast.add({
    type: "error",
    title: "Faucet request failed",
    description: error instanceof Error ? error.message : "Something went wrong.",
  });
}
