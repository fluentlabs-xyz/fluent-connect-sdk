import {
  fluentTestnet,
  fluentTestnetTokenDefaults,
  readFluentTokenBalances,
  type FluentTokenBalance,
  type FluentTokenDefinition,
} from "@fluent/connect-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import {
  getFluentGasPaymentEthValue,
  type FluentGasPaymentEthRates,
  type FluentGasPaymentSymbol,
  getFluentGasPaymentTokens,
  selectFluentGasPaymentToken,
} from "../gasPayment";

const fluentPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(),
});

const defaultTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.USDnr,
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.ETH,
];

export function WalletMenuGasPayment({
  accountAddress,
  bridgeUrl,
  ethValueByToken,
  tokens = defaultTokens,
}: {
  accountAddress?: `0x${string}`;
  bridgeUrl: string;
  ethValueByToken?: FluentGasPaymentEthRates;
  tokens?: readonly FluentTokenDefinition[];
}) {
  const gasTokens = useMemo(() => getFluentGasPaymentTokens(tokens), [tokens]);
  const [balances, setBalances] = useState<FluentTokenBalance[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a Fluent account");

  const refresh = useCallback(async () => {
    if (!accountAddress) {
      setBalances([]);
      setStatus("Connect a Fluent account");
      return;
    }

    setBusy(true);
    setStatus("Checking gas token balances");
    const next = await readFluentTokenBalances({
      client: fluentPublicClient,
      account: accountAddress,
      tokens: gasTokens,
    });
    setBalances(next);
    setStatus("Gas route updated");
    setBusy(false);
  }, [accountAddress, gasTokens]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selection = selectFluentGasPaymentToken({ balances, loading: busy });
  const activeSymbol =
    selection.status === "ready"
      ? selection.symbol
      : selection.status === "loading"
        ? "Checking"
        : "Bridge";
  const sortedRows = useMemo(
    () => gasTokens
      .map((token, index) => ({
        token,
        balance: balances.find((item) => item.symbol === token.symbol),
        index,
      }))
      .sort((left, right) => {
        const leftRaw = getComparableBalance(left.balance);
        const rightRaw = getComparableBalance(right.balance);
        if (leftRaw === rightRaw) return left.index - right.index;
        return rightRaw > leftRaw ? 1 : -1;
      }),
    [balances, gasTokens],
  );

  return (
    <div className="wallet-menu-gas">
      <button className="wallet-menu-gas-trigger" type="button">
        <div>
          <strong>Gas payment</strong>
          <span>{activeSymbol}</span>
        </div>
        <span className="wallet-menu-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <section className="wallet-menu-gas-panel" aria-label="Gas payment priority">
        <div className="wallet-menu-gas-header">
          <div>
            <strong>Gas payment</strong>
          </div>
        </div>

        <div className="wallet-gas-list">
          {sortedRows.map(({ token, balance }) => {
            const symbol = token.symbol as FluentGasPaymentSymbol;
            const value = getFluentGasPaymentEthValue({ balance, ethValueByToken });
            return (
              <div
                className={[
                  "wallet-gas-row",
                  selection.status === "ready" && selection.symbol === symbol ? "wallet-gas-row-active" : "",
                  `wallet-gas-value-${value.tier}`,
                ].filter(Boolean).join(" ")}
                key={symbol}
              >
                <span className={`token-mark token-mark-${symbol.toLowerCase()}`}>
                  {symbol.slice(0, 1)}
                </span>
                <span>
                  <strong>{symbol}</strong>
                  <small>Balance</small>
                </span>
                <strong className="wallet-gas-balance">{formatGasBalance(balance, accountAddress)}</strong>
              </div>
            );
          })}
        </div>

        {selection.status === "bridge-required" ? (
          <a className="wallet-menu-gas-bridge" href={bridgeUrl} target="_blank" rel="noreferrer">
            Bridge assets to Fluent
          </a>
        ) : (
          <p>
            {selection.status === "ready"
              ? `Using ${selection.symbol} for gas when supported.`
              : status}
          </p>
        )}
      </section>
    </div>
  );
}

function getComparableBalance(balance: FluentTokenBalance | undefined) {
  if (!balance || balance.status !== "ready" || balance.raw === null) return 0n;
  const decimals = BigInt(balance.decimals);
  if (decimals === 18n) return balance.raw;
  if (decimals < 18n) return balance.raw * 10n ** (18n - decimals);
  return balance.raw / 10n ** (decimals - 18n);
}

function formatGasBalance(balance: FluentTokenBalance | undefined, accountAddress: `0x${string}` | undefined) {
  if (balance?.status === "ready") return balance.formatted;
  if (balance?.status === "not-configured") return "Not configured";
  if (balance?.status === "error") return "Unavailable";
  return accountAddress ? "Loading" : "Connect";
}
