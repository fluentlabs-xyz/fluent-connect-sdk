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
  formatFluentGasTokenBalance,
  type FluentGasPaymentEthRates,
  type FluentGasPaymentSymbol,
  getFluentGasPaymentTokens,
  selectFluentGasPaymentToken,
} from "../gasPayment";
import { formatAddress } from "../utils/formatAddress";
import { Icon, type IconName } from "./Icon";
import { Button } from "./ui/button";

const fluentPublicClient = createPublicClient({
  chain: fluentTestnet,
  transport: http(),
});

const defaultTokens: readonly FluentTokenDefinition[] = [
  fluentTestnetTokenDefaults.USDnr,
  fluentTestnetTokenDefaults.BLEND,
  fluentTestnetTokenDefaults.ETH,
];

const tokenIcons: Record<string, IconName> = {
  ETH: "eth",
  USDnr: "usdnr",
  BLEND: "fluent",
};

const tokenIconClassName: Record<string, string> = {
  ETH: "size-6 text-white",
  USDnr: "size-6 text-white",
  BLEND: "size-4",
};

const tokenBgClassName: Record<string, string> = {
  ETH: "bg-[#627EEA]",
  USDnr: "bg-[#7f52d0]",
  BLEND: "bg-[#FFFFFF]/10",
};

export function WalletMenuGasPayment({
  accountAddress,
  bridgeUrl,
  ethValueByToken: _ethValueByToken,
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
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

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
  const sortedRows = useMemo(
    () =>
      gasTokens
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

  const copyAddress = useCallback(async (address: `0x${string}`) => {
    await navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => {
      setCopiedAddress((current) => (current === address ? null : current));
    }, 1400);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4" aria-label="Gas payment tokens">
        {sortedRows.map(({ token, balance }) => {
          const symbol = token.symbol as FluentGasPaymentSymbol;
          const unavailable = balance?.status === "not-configured";
          const failed = balance?.status === "error";
          const iconName = tokenIcons[symbol];
          const active = selection.status === "ready" && selection.symbol === symbol;
          const formatted =
            balance?.status === "ready" ? formatFluentGasTokenBalance(balance) ?? balance.formatted : null;

          return (
            <div className="flex items-center gap-3" key={symbol}>
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tokenBgClassName[symbol] ?? "bg-white/10"}`}
              >
                {iconName ? (
                  <Icon
                    name={iconName}
                    className={tokenIconClassName[symbol] ?? "size-6 text-foreground"}
                  />
                ) : (
                  <span className="text-xs font-medium">{symbol.slice(0, 1)}</span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium leading-4">
                  {symbol}
                  {active ? (
                    <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      Gas
                    </span>
                  ) : null}
                </span>
                {token.address ? (
                  <Button
                    variant="link"
                    size="xs"
                    className="h-4 px-0 opacity-50"
                    title={`Copy ${symbol} address`}
                    onClick={() => copyAddress(token.address!)}
                  >
                    {copiedAddress === token.address ? "Copied" : formatAddress(token.address)}
                  </Button>
                ) : (
                  <span className="shrink-0 text-xs leading-4 text-muted-foreground">
                    {symbol === "ETH" ? "Native" : "No address"}
                  </span>
                )}
              </span>

              <span className="text-sm font-medium tabular-nums">
                {formatted ? (
                  formatted
                ) : unavailable ? (
                  "—"
                ) : failed ? (
                  "Unavailable"
                ) : accountAddress || busy ? (
                  <span
                    className="inline-block h-4 w-16 animate-pulse rounded-md bg-white/10"
                    aria-label="Loading balance"
                  />
                ) : (
                  "Connect"
                )}
              </span>
            </div>
          );
        })}
      </div>

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
