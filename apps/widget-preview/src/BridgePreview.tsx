import { ApprovalSteps } from "@fluent.xyz/connect/internal/bridge/BridgeForm";
import { DepositSteps, type DepositStep } from "@fluent.xyz/connect/internal/bridge/DepositSteps";
import { getFluentSwapContracts, FLUENT_SWAP_SLIPPAGE_BPS } from "@fluent.xyz/connect/internal/swap/contracts";
import { getFluentSwapQuote, type FluentSwapQuote } from "@fluent.xyz/connect/internal/swap/quote";
import { applyFluentSwapSlippage } from "@fluent.xyz/connect/internal/swap/slippage";
import { getFluentSwapTokens, type FluentSwapToken } from "@fluent.xyz/connect/internal/swap/tokens";
import { Button } from "@fluent.xyz/connect/internal/ui/button";
import { fluentMainnet } from "@fluent.xyz/connect-sdk";
import { useEffect, useState } from "react";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import type { PublicClient } from "viem";

import { PreviewCard } from "./ActivityPreview";

/**
 * The two-step approval flow's stepper, in both states, with the button each
 * state shows beneath it. The live stepper needs a connected wallet holding an
 * ERC-20, so this is the only place to see it without one.
 */
function ApprovalStepsPreview() {
  return (
    <>
      <PreviewCard title="Step 1 — approving" note="The allowance is short; the approval is out with the wallet.">
        <ApprovalSteps currentStep={1} actionLabel="Deposit" busy />
        <Button className="w-full" disabled>
          Approving…
        </Button>
      </PreviewCard>

      <PreviewCard title="Step 2 — ready to deposit" note="The allowance covers the amount; the deposit is next.">
        <ApprovalSteps currentStep={2} actionLabel="Deposit" busy={false} />
        <Button className="w-full">Deposit to Fluent</Button>
      </PreviewCard>
    </>
  );
}

function steps(bridge: DepositStep["status"], swap: DepositStep["status"]): readonly [DepositStep, DepositStep] {
  return [
    {
      title: "Bridge to Fluent",
      caption: "ETH lands on your Fluent account.",
      status: bridge,
    },
    {
      title: "Swap to USDnr",
      caption: "Your Fluent account swaps the ETH it received for USDnr.",
      status: swap,
    },
  ];
}

/**
 * Every state the Two-step deposit's stepper reaches. The live one needs a
 * mainnet deposit to actually land before its second half moves, so the states
 * are laid out here instead.
 */
function DepositStepsPreview() {
  return (
    <>
      <PreviewCard title="Chosen, nothing signed" note="Shown as soon as a second token is picked — before the bridge is signed.">
        <DepositSteps
          headline="Deposit ETH, receive USDnr"
          description="The bridge runs first; the swap is a second confirmation once it lands."
          steps={steps("active", "waiting")}
        />
      </PreviewCard>

      <PreviewCard title="Bridging" note="The deposit is out with the wallet or relaying; step 1 pulses.">
        <DepositSteps
          headline="Bridging to Fluent"
          description="The swap to USDnr runs once the deposit has landed."
          steps={steps("active", "waiting")}
          busy
        />
      </PreviewCard>

      <PreviewCard title="Bridge done — swap is next" note="The deposit landed. The swap waits for one more confirmation.">
        <DepositSteps
          headline="Bridge done — the swap is left"
          description="What landed is ETH; the swap turns it into USDnr."
          steps={steps("done", "active")}
        />
        <Button className="w-full">Swap to USDnr</Button>
        <Button variant="ghost" className="w-full">
          Keep the ETH instead
        </Button>
      </PreviewCard>

      <PreviewCard title="Swapping" note="The swap is out as a user operation from the Fluent ID.">
        <DepositSteps
          headline="Bridge done — the swap is left"
          description="The ETH the bridge delivered becomes USDnr."
          steps={steps("done", "active")}
          busy
        />
      </PreviewCard>

      <PreviewCard title="Done" note="Both legs landed.">
        <DepositSteps
          headline="Deposit complete"
          description="You deposited ETH and ended up with USDnr on Fluent."
          steps={steps("done", "done")}
        />
      </PreviewCard>

      <PreviewCard title="Swap failed" note="The deposit is safe on the Fluent ID; only the swap did not go through.">
        <DepositSteps
          headline="Bridge done — the swap is left"
          description="The ETH the bridge delivered becomes USDnr."
          steps={steps("done", "failed")}
        />
        <Button className="w-full">Try the swap again</Button>
        <Button variant="ghost" className="w-full">
          Keep the ETH instead
        </Button>
      </PreviewCard>
    </>
  );
}

const SWAP_NETWORK = "mainnet" as const;
const swapContracts = getFluentSwapContracts(SWAP_NETWORK)!;
const swapTokens = getFluentSwapTokens(SWAP_NETWORK);

/**
 * A client of the preview's own rather than the widget's: the widget builds one
 * from its configured network, and this card is pinned to mainnet because that
 * is the only place FluxFlow is deployed. The chain comes from the SDK, so the
 * RPC is whatever the registry says it is.
 */
const swapClient: PublicClient = createPublicClient({
  chain: fluentMainnet,
  transport: http(),
});

function TokenPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FluentSwapToken;
  onChange: (token: FluentSwapToken) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs text-white/50">
      {label}
      <select
        className="h-9 rounded-lg bg-white/10 px-2 text-sm text-white outline-none"
        value={value.symbol}
        onChange={(event) => {
          const next = swapTokens.find((token) => token.symbol === event.target.value);
          if (next) onChange(next);
        }}
      >
        {swapTokens.map((token) => (
          <option key={token.symbol} value={token.symbol}>
            {token.symbol}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Prices a real Fluent swap against FluxFlow's pools on mainnet. A quote is a
 * read, so this needs no wallet, no Privy and no money — it is the only way to
 * check the routing and the numbers without making a deposit first.
 */
function SwapQuotePreview() {
  const [tokenIn, setTokenIn] = useState<FluentSwapToken>(swapTokens[0]!);
  const [tokenOut, setTokenOut] = useState<FluentSwapToken>(swapTokens[1]!);
  const [amount, setAmount] = useState("0.01");
  const [quote, setQuote] = useState<FluentSwapQuote | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    let amountIn: bigint;
    try {
      amountIn = parseUnits(amount as `${number}`, tokenIn.decimals);
    } catch {
      return;
    }
    if (amountIn <= 0n || tokenIn.symbol === tokenOut.symbol) {
      setQuote(undefined);
      setError(tokenIn.symbol === tokenOut.symbol ? "Pick two different tokens" : undefined);
      return;
    }

    setLoading(true);
    setError(undefined);
    const timer = setTimeout(() => {
      getFluentSwapQuote({
        client: swapClient,
        network: SWAP_NETWORK,
        contracts: swapContracts,
        tokenIn,
        tokenOut,
        amountIn,
      })
        .then((next) => {
          if (!active) return;
          setQuote(next);
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setQuote(undefined);
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [amount, tokenIn, tokenOut]);

  const minimumOut = quote ? applyFluentSwapSlippage(quote.amountOut, FLUENT_SWAP_SLIPPAGE_BPS) : undefined;

  return (
    <PreviewCard
      title="Live quote — FluxFlow on Fluent mainnet"
      note="A real read against the pools. No wallet, no sign-in, no money: this is the swap leg's pricing on its own."
    >
      <div className="flex gap-2">
        <TokenPicker label="Sell" value={tokenIn} onChange={setTokenIn} />
        <TokenPicker label="Buy" value={tokenOut} onChange={setTokenOut} />
      </div>

      <label className="flex flex-col gap-1 text-xs text-white/50">
        Amount
        <input
          className="h-9 rounded-lg bg-white/10 px-2 text-sm text-white outline-none"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>

      <div className="flex flex-col gap-1.5 text-xs">
        <Row label="Receive">
          {loading
            ? "Pricing…"
            : quote
              ? `≈ ${formatUnits(quote.amountOut, tokenOut.decimals)} ${tokenOut.symbol}`
              : "—"}
        </Row>
        <Row label={`Min. received (${Number(FLUENT_SWAP_SLIPPAGE_BPS) / 100}%)`}>
          {minimumOut === undefined ? "—" : `${formatUnits(minimumOut, tokenOut.decimals)} ${tokenOut.symbol}`}
        </Row>
        <Row label="Route">
          {quote
            ? quote.route.map((hop) => `${hop.fee / 10_000}%`).join(" → ") +
              ` (${quote.route.length} pool${quote.route.length > 1 ? "s" : ""})`
            : "—"}
        </Row>
      </div>

      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </PreviewCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-white/50">{label}</span>
      <span className="text-right break-all text-white">{children}</span>
    </div>
  );
}

export function BridgePreview() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(384px,100%),1fr))] items-start gap-5">
      <ApprovalStepsPreview />
      <DepositStepsPreview />
      <SwapQuotePreview />
    </div>
  );
}
