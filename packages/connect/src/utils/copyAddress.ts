import { toast } from "../components/ui/toast";
import { formatAddress } from "./formatAddress";
import { debugWarn } from "../core/debugLogger";

/** Copies a hex string and says so; `label` is what the toast calls it. */
export async function copyHexToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.add({
      type: "success",
      title: `${label} copied`,
      description: formatAddress(value),
    });
  } catch (error) {
    debugWarn(`[fluent connect] Failed to copy ${label.toLowerCase()}`, error);
    toast.add({
      type: "error",
      title: "Copy failed",
      description: `Could not copy ${label.toLowerCase()} to clipboard.`,
    });
  }
}

export async function copyAddressToClipboard(address: string) {
  return copyHexToClipboard(address, "Address");
}
