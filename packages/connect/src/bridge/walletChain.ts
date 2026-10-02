import { numberToHex, type Chain } from "viem";

/** The slice of EIP-1193 this module needs; connectors hand back the real thing. */
export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: never[]) => void) => void;
  removeListener?: (event: string, listener: (...args: never[]) => void) => void;
};

type ConnectorLike = { getProvider: () => Promise<unknown> } | undefined;

/** MetaMask's code for "I don't know this chain" — answered with an add request. */
const CHAIN_NOT_ADDED = 4902;

function errorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

/**
 * Moves the wallet to `chain` by talking to the wallet, not through wagmi.
 *
 * wagmi's `switchChain` routes through AppKit's adapter, which refuses to act
 * while its active network is one the widget does not list — the state a wallet
 * sitting on Ethereum mainnet puts it in. Going straight to the provider works
 * from any starting chain, and wagmi picks the result up from `chainChanged`
 * like it would for a switch the user made in the wallet UI.
 */
export async function switchWalletChain(connector: ConnectorLike, chain: Chain) {
  if (!connector) throw new Error("No wallet is connected");

  const provider = (await connector.getProvider()) as Eip1193Provider;
  const chainId = numberToHex(chain.id);

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
    return;
  } catch (error) {
    if (errorCode(error) !== CHAIN_NOT_ADDED) throw error;
  }

  // The wallet has never seen this chain: describe it, then it switches itself.
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
        blockExplorerUrls: chain.blockExplorers?.default.url
          ? [chain.blockExplorers.default.url]
          : undefined,
      },
    ],
  });
}

export function describeSwitchError(error: unknown, chainName: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (errorCode(error) === 4001 || /user rejected|denied/i.test(message)) {
    return `You declined the switch to ${chainName}`;
  }
  return message;
}
