import { getFluentExplorerBaseUrl } from "../core/network";

export function explorerTransaction(
  hash: string,
  network?: Parameters<typeof getFluentExplorerBaseUrl>[0],
) {
  const baseUrl = getFluentExplorerBaseUrl(network ?? "testnet");
  return `${baseUrl}/tx/${hash}`;
}

/**
 * Returns the explorer page of a user operation, keyed by its user-operation hash rather than
 * the hash of the transaction that carried it.
 */
export function explorerUserOperation(
  hash: string,
  network?: Parameters<typeof getFluentExplorerBaseUrl>[0],
) {
  const baseUrl = getFluentExplorerBaseUrl(network ?? "testnet");
  return `${baseUrl}/op/${hash}`;
}
