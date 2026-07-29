import "./polyfills";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FluentWidget,
  type FluentBatchApi,
  type FluentWidgetConfig,
  type FluentWidgetSession,
} from "@fluent/react";
import { fluentTestnetTokenDefaults } from "@fluent/connect-sdk";
import { encodeFunctionData, formatUnits, parseUnits, type Address, type Hash } from "viem";
import "@fluent/react/styles.css";
import "./styles.css";

const BLEND_TOKEN = {
  address: fluentTestnetTokenDefaults.BLEND.address as Address,
  symbol: "BLEND",
  decimals: 18,
};

const blendAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const oneBlend = parseUnits("1", BLEND_TOKEN.decimals);
const explorerBaseUrl = "https://testnet.fluentscan.xyz";
const fluentWidgetConfig = {
  network: "testnet",
  appName: "Fluent Paymaster Transfer",
  authMode: "direct",
  source: "paymaster_transfer_example",
  campaign: "paymaster-transfer",
} satisfies FluentWidgetConfig;

function App() {
  return (
    <>
      <div className="testnet-stripe" aria-label="Fluent Connect Demo App">
        <span>Fluent Connect Demo App</span>
      </div>

      <main className="page-shell">
        <FluentWidget
          config={fluentWidgetConfig}
          mode="page"
          showDebugPayload={false}
          renderPage={({ session, widget }) => (
            <TransferPanel session={session} widget={widget} />
          )}
        />
      </main>
    </>
  );
}

function TransferPanel({
  session,
  widget,
}: {
  session: FluentWidgetSession | null;
  widget: FluentBatchApi;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const gasPayment = widget.gasPayment;
  const paymasterApprovalAmount = parseUnits("100", gasPayment.decimals);
  const account = widget.account.address ?? session?.wallet.smartAccountAddress;
  const signer = (session?.wallet as { signerAddress?: Address } | undefined)?.signerAddress;
  const canSubmit = Boolean(account && widget.account.executionReady && !busy);

  const txUrl = useMemo(() => (txHash ? `${explorerBaseUrl}/tx/${txHash}` : null), [txHash]);

  function appendLog(message: string) {
    const timestamp = new Date().toISOString().slice(11, 19);
    setLogs((current) => [...current.slice(-19), `${timestamp}  ${message}`]);
  }

  useEffect(() => {
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    const shouldMirror = (args: unknown[]) =>
      args.some((arg) =>
        typeof arg === "string" &&
        /\[(fluent|hosted|privy|zerodev)/i.test(arg),
      );
    const mirror = (level: "log" | "warn" | "error", args: unknown[]) => {
      if (!shouldMirror(args)) return;
      appendLog(`${level}: ${args.map(formatLogArg).join(" ")}`);
    };

    console.log = (...args: unknown[]) => {
      originalConsole.log(...args);
      mirror("log", args);
    };
    console.warn = (...args: unknown[]) => {
      originalConsole.warn(...args);
      mirror("warn", args);
    };
    console.error = (...args: unknown[]) => {
      originalConsole.error(...args);
      mirror("error", args);
    };

    appendLog(`page loaded: ${location.href}`);
    return () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    };
  }, []);

  useEffect(() => {
    appendLog(
      [
        "session",
        `user=${session?.user?.id ?? "none"}`,
        `smart=${session?.wallet?.smartAccountAddress ?? "none"}`,
        `signer=${session?.wallet?.signerAddress ?? "none"}`,
        `scopes=${session?.scopes?.join(",") ?? "none"}`,
      ].join(" | "),
    );
  }, [session]);

  useEffect(() => {
    appendLog(
      [
        `account=${account ?? "none"}`,
        `connected=${widget.account.connected}`,
        `execution=${widget.account.executionStatus}`,
        `signer=${signer ?? "none"}`,
        widget.account.executionError ? `error=${widget.account.executionError}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }, [
    account,
    signer,
    widget.account.connected,
    widget.account.executionError,
    widget.account.executionStatus,
  ]);

  useEffect(() => {
    const onSignerLog = (event: Event) => {
      const detail = (event as CustomEvent<{
        message?: string;
        details?: Record<string, unknown>;
      }>).detail;
      if (!detail?.message) return;
      const details = detail.details
        ? ` ${JSON.stringify(detail.details)}`
        : "";
      appendLog(`signer: ${detail.message}${details}`);
    };

    window.addEventListener("fluent:signer:log", onSignerLog);
    return () => window.removeEventListener("fluent:signer:log", onSignerLog);
  }, []);

  async function sendOneBlendToSelf() {
    if (!account) {
      appendLog("Submission blocked: smart account is missing.");
      return;
    }

    const smartAccountAddress = account as Address;
    setBusy(true);
    setTxHash(null);
    setStatus(`Requesting signature for ${gasPayment.symbol}-paid UserOperation...`);
    appendLog(
      `Preparing 1 BLEND self-transfer with ${gasPayment.symbol} gas payment.`,
    );
    try {
      const op = widget.createBatchOp({
        id: `${gasPayment.symbol.toLowerCase()}-paymaster-self-transfer`,
        button: {
          label: "Send 1 BLEND",
          pendingLabel: "Sending BLEND",
          successLabel: "Transfer submitted",
        },
        calls: [
          {
            id: "transfer-blend-to-self",
            label: "Transfer 1 BLEND to self",
            to: BLEND_TOKEN.address,
            data: encodeFunctionData({
              abi: blendAbi,
              functionName: "transfer",
              args: [smartAccountAddress, oneBlend],
            }),
          },
        ],
      });

      const gasPaymentOptions =
        gasPayment.symbol === "ETH" || !gasPayment.token
          ? undefined
          : {
              token: gasPayment.token,
              symbol: gasPayment.symbol,
              includeApproval: true as const,
              approveAmount: paymasterApprovalAmount,
            };
      const hash = await op.execute({ gasPayment: gasPaymentOptions });
      setTxHash(hash);
      setStatus(`Transfer submitted with ${gasPayment.symbol} gas payment.`);
      appendLog(`Transfer confirmed: ${hash}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transfer failed";
      setStatus(message);
      appendLog(`Transfer failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="transfer-panel">
      <div className="eyebrow">Fluent Connect SDK</div>
      <h1>BLEND paymaster transfer</h1>
      <p>
        Sends {formatUnits(oneBlend, BLEND_TOKEN.decimals)} BLEND from the
        ZeroDev smart account back to itself. Gas is charged through the
        selected ERC20 paymaster route.
      </p>

      <dl className="account-grid">
          <div>
            <dt>Smart account</dt>
            <dd>{account ?? "Not connected"}</dd>
          </div>
          <div>
            <dt>Privy signer</dt>
            <dd>{signer ?? "Not connected"}</dd>
          </div>
          <div>
            <dt>Gas token</dt>
            <dd>{gasPayment.symbol} · selected in Fluent widget</dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd>{account ?? "Sender = receiver after login"}</dd>
          </div>
        </dl>

        {account ? (
          <div className="actions">
            <button type="button" onClick={sendOneBlendToSelf} disabled={!canSubmit}>
              {busy ? "Submitting..." : "Send 1 BLEND to self"}
            </button>
            <span className={widget.account.executionReady ? "pill ready" : "pill"}>
              {widget.account.executionReady
                ? "Smart account ready"
                : widget.account.executionError ?? widget.account.executionStatus}
            </span>
          </div>
        ) : null}

        {status ? <p className="status">{status}</p> : null}
        {txUrl ? (
          <a className="tx-link" href={txUrl} target="_blank" rel="noreferrer">
            View transaction
          </a>
        ) : null}
        {!canSubmit && account && !busy ? (
          <p className="hint">
            {widget.account.executionError ??
              "Wait until the widget finishes preparing the ZeroDev smart account."}
          </p>
        ) : null}
        <details className="runtime-logs" open>
          <summary>Runtime logs</summary>
          <pre>{logs.length > 0 ? logs.join("\n") : "Waiting for account state..."}</pre>
      </details>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

function formatLogArg(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, (_key, next) =>
      typeof next === "bigint" ? next.toString() : next,
    );
  } catch {
    return String(value);
  }
}
