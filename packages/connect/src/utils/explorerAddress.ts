import { getFluentExplorerBaseUrl } from "../core/network";
import { useFluentWidgetNetwork } from "../widget/widgetNetworkContext";

export function explorerAddress(address: string, network?: Parameters<typeof getFluentExplorerBaseUrl>[0]) {
  const baseUrl = getFluentExplorerBaseUrl(network ?? "testnet");
  return `${baseUrl}/address/${address}`;
}

export function useExplorerAddress(address: string) {
  const { network } = useFluentWidgetNetwork();
  return explorerAddress(address, network);
}
