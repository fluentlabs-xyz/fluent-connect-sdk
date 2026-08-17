import { toast } from "../components/ui/toast";
import { formatAddress } from "./formatAddress";
import { debugWarn } from "../core/debugLogger";

export async function copyAddressToClipboard(address: string) {
  try {
    await navigator.clipboard.writeText(address);
    toast.add({
      type: "success",
      title: "Address copied",
      description: formatAddress(address),
    });
  } catch (error) {
    debugWarn("[fluent connect] Failed to copy address", error);
    toast.add({
      type: "error",
      title: "Copy failed",
      description: "Could not copy address to clipboard.",
    });
  }
}
