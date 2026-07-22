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
import { Icon, type IconName } from "./Icon";
import { Button } from "./ui/button";

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

const tokenIcons: Record<string, IconName> = {
  ETH: "eth",
  USDnr: "usdnr",
  BLEND: "fluent",
  USDC: "usdc",
  USDT: "usdt",
};

const tokenIconClassName: Record<string, string> = {
  ETH: "size-6 text-white",
  USDnr: "size-6 text-white",
  BLEND: "size-4",
  USDC: "size-6",
  USDT: "size-6",
};

const tokenBgClassName: Record<string, string> = {
  ETH: "bg-[#627EEA]",
  USDnr: "bg-[#7f52d0]",
  BLEND: "bg-[#FFFFFF]/10",
  USDC: "bg-[#2775CA]",
  USDT: "bg-[#26A17B]",
};

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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        {/* <Button
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={!accountAddress || busy}
        >
          {busy ? "..." : "Refresh"}
        </Button> */}
        {/* <p className="text-[10px] text-muted-foreground">{status}</p> */}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-4">
          {tokens.map((token) => {
            const balance = balances.find((item) => item.symbol === token.symbol);
            const unavailable = balance?.status === "not-configured";
            const failed = balance?.status === "error";
            const iconName = tokenIcons[token.symbol];
            return (
              <div
                className="flex items-center gap-3"
                key={token.symbol}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tokenBgClassName[token.symbol] ?? "bg-white/10"}`}
                >
                  {iconName ? (
                    <Icon
                      name={iconName}
                      className={tokenIconClassName[token.symbol] ?? "size-6 text-foreground"}
                    />
                  ) : (
                    <span className="text-xs font-medium">{token.symbol.slice(0, 1)}</span>
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="text-sm font-medium leading-4">{token.symbol}</span>
                  {token.address ? (
                      <Button
                        variant="link"
                        size="xs"
                        className="opacity-50 px-0 h-4"
                        title={`Copy ${token.symbol} address`}
                        onClick={() => copyAddress(token.address!)}
                      >
                        {copiedAddress === token.address ? "Copied" : formatAddress(token.address)}
                      </Button>
                    ) : (
                      <span className="shrink-0 text-xs leading-4 text-muted-foreground">
                        {token.symbol === "ETH" ? "Native" : "No address"}
                      </span>
                  )}    
                </span>

                <span className="text-sm font-medium tabular-nums">
                  {balance?.status === "ready" ? (
                    balance.formatted
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
    </div>
  );
}
