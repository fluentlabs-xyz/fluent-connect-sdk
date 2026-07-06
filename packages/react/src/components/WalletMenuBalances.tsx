import {
  fluentTestnet,
  fluentTestnetTokenDefaults,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent/connect-sdk";
import { useState, useCallback, useEffect } from "react";
import { createPublicClient, http } from "viem";
import { formatAddress } from "../utils/formatAddress";

const fluentPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(),
});

const defaultTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.ETH,
  fluentTestnetTokenDefaults.USDnr,
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.USDC,
  fluentTestnetTokenDefaults.USDT,
];

export function WalletMenuBalances({
  accountAddress,
  tokens = defaultTokens,
}: {
  accountAddress?: `0x${string}`;
  tokens?: readonly FluentTokenDefinition[];
}) {
  const [balances, setBalances] = useState<FluentTokenBalance[]>([]);
  const [status, setStatus] = useState("Connect a wallet to load balances");
  const [busy, setBusy] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accountAddress) {
      setBalances([]);
      setStatus("Connect a wallet to load balances");
      return;
    }

    setBusy(true);
    setStatus("Reading Fluent Testnet balances");
    const next = await readFluentTokenBalances({
      client: fluentPublicClient,
      account: accountAddress,
      tokens,
    });
    setBalances(next);
    setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    setBusy(false);
  }, [accountAddress, tokens]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const copyAddress = useCallback(async (address: `0x${string}`) => {
    await navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => {
      setCopiedAddress((current) => (current === address ? null : current));
    }, 1400);
  }, []);

  return (
    <div className="wallet-menu-balances">
      <button className="wallet-menu-balances-trigger" type="button">
        <div>
          <strong>Balances</strong>
          <span>Portfolio on Fluent Testnet</span>
        </div>
        <span className="wallet-menu-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <section className="wallet-menu-balances-panel" aria-label="Token balances on Fluent Testnet">
        <div className="wallet-menu-balances-header">
          <div>
            <strong>Token balances</strong>
            <span>Network: Fluent Testnet</span>
          </div>
          <button type="button" onClick={refresh} disabled={!accountAddress || busy}>
            {busy ? "..." : "Refresh"}
          </button>
        </div>

        <div className="wallet-token-list">
          {tokens.map((token) => {
            const balance = balances.find((item) => item.symbol === token.symbol);
            const unavailable = balance?.status === "not-configured";
            const failed = balance?.status === "error";
            return (
              <div className="wallet-token-row" key={token.symbol}>
                <span className={`token-mark token-mark-${token.symbol.toLowerCase()}`}>
                  {token.symbol.slice(0, 1)}
                </span>
                <span className="wallet-token-name">
                  <strong>{token.symbol}</strong>
                  <small>
                    {balance?.status === "ready"
                      ? balance.formatted
                      : unavailable
                        ? "Not configured"
                        : failed
                          ? "Unavailable"
                          : accountAddress
                            ? "Loading"
                            : "Connect"}
                  </small>
                </span>
                {token.address ? (
                  <button
                    className="wallet-token-copy"
                    type="button"
                    title={`Copy ${token.symbol} address`}
                    onClick={() => copyAddress(token.address!)}
                  >
                    <span>{copiedAddress === token.address ? "Copied" : formatAddress(token.address)}</span>
                    <span aria-hidden="true">⧉</span>
                  </button>
                ) : (
                  <span className="wallet-token-native">
                    {token.symbol === "ETH" ? "Native" : "No address"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p>{status}</p>
      </section>
    </div>
  );
}
