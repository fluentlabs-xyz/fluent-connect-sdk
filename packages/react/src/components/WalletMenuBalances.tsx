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
        <div className="flex flex-col gap-0.5">
          <strong className="text-sm font-medium leading-none">Balances</strong>
          <span className="text-[10px] text-muted-foreground">Portfolio on Fluent Testnet</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={!accountAddress || busy}
        >
          {busy ? "..." : "Refresh"}
        </Button>
      </div>

      <section
        className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-2.5"
        aria-label="Token balances on Fluent Testnet"
      >
        <div className="flex flex-col gap-2">
          {tokens.map((token) => {
            const balance = balances.find((item) => item.symbol === token.symbol);
            const unavailable = balance?.status === "not-configured";
            const failed = balance?.status === "error";
            return (
              <div
                className="flex items-center gap-2"
                key={token.symbol}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-xs font-medium">
                  {token.symbol.slice(0, 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong className="text-sm font-medium leading-none">{token.symbol}</strong>
                  <small className="text-[10px] text-muted-foreground">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto shrink-0 gap-1 px-2 py-1 text-[10px] text-muted-foreground"
                    title={`Copy ${token.symbol} address`}
                    onClick={() => copyAddress(token.address!)}
                  >
                    <span>
                      {copiedAddress === token.address ? "Copied" : formatAddress(token.address)}
                    </span>
                    <span aria-hidden="true">⧉</span>
                  </Button>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {token.symbol === "ETH" ? "Native" : "No address"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground">{status}</p>
      </section>
    </div>
  );
}
