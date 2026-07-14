import React from "react";
import { createRoot } from "react-dom/client";
import {
  FLUENT_ZERODEV_ERC20_PAYMASTER_TOKENS,
  FluentWidget,
  createFluentWidgetConfigFromEnv,
  type FluentBatchApi,
  type FluentWidgetRenderContext,
  type FluentWidgetSession,
} from "@fluent/react";
import { fluentTestnetTokenDefaults } from "@fluent/wallet-sdk";
import { encodeFunctionData, type Address, type Hash } from "viem";
import "./styles.css";

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

const blendToken = FLUENT_ZERODEV_ERC20_PAYMASTER_TOKENS.BLEND;
const blendDefinition = fluentTestnetTokenDefaults.BLEND;
const oneBlend = 10n ** BigInt(blendToken.decimals);
const widgetConfig = createFluentWidgetConfigFromEnv(import.meta.env);

function App() {
  return (
    <FluentWidget
      config={widgetConfig}
      mode="page"
      tokens={[blendDefinition]}
      showDebugPayload={false}
      renderPage={(context) => <TransferPanel {...context} />}
    />
  );
}

function TransferPanel({
  session,
  widget,
}: FluentWidgetRenderContext) {
  const [status, setStatus] = React.useState("Connect Fluent ID to prepare the transfer.");
  const [busy, setBusy] = React.useState(false);
  const [txHash, setTxHash] = React.useState<Hash | null>(null);
  const account = getSmartAccountAddress(widget, session);
  const canSend = Boolean(account && !busy);

  async function sendSelfTransfer() {
    if (!account) {
      setStatus("Use the wallet button in the top-right corner to connect Fluent ID.");
      return;
    }

    setBusy(true);
    setTxHash(null);
    setStatus("Submitting 1 BLEND self-transfer with BLEND gas.");

    try {
      const op = widget.createBatchOp({
        id: "blend-self-transfer",
        button: {
          label: "Send 1 BLEND",
          pendingLabel: "Sending BLEND",
          successLabel: "Transfer submitted",
        },
        calls: [
          {
            id: "transfer-blend-to-self",
            label: "Transfer 1 BLEND to self",
            to: blendToken.address,
            data: encodeFunctionData({
              abi: blendAbi,
              functionName: "transfer",
              args: [account, oneBlend],
            }),
          },
        ],
      });

      const hash = await op.execute({
        gasPayment: {
          token: blendToken.address,
          symbol: blendToken.symbol,
          includeApproval: true,
        },
      });

      setTxHash(hash);
      setStatus("Transfer submitted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="transfer-panel">
        <div className="panel-heading">
          <span>Fluent ERC20 Paymaster</span>
          <h1>Send 1 BLEND to yourself</h1>
        </div>

        <dl className="transfer-details">
          <div>
            <dt>Sender</dt>
            <dd>{account ? formatAddress(account) : "Not connected"}</dd>
          </div>
          <div>
            <dt>Receiver</dt>
            <dd>{account ? formatAddress(account) : "Not connected"}</dd>
          </div>
          <div>
            <dt>Gas token</dt>
            <dd>{blendToken.symbol}</dd>
          </div>
        </dl>

        <button className="primary-action" type="button" disabled={!canSend} onClick={sendSelfTransfer}>
          {busy ? "Sending..." : account ? "Send 1 BLEND" : "Connect first"}
        </button>

        <p className="status-text">{status}</p>

        {txHash ? (
          <a
            className="tx-link"
            href={`https://testnet.fluentscan.xyz/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
        ) : null}
      </section>
    </main>
  );
}

function getSmartAccountAddress(widget: FluentBatchApi, session: FluentWidgetSession | null) {
  return (widget.account.address ?? session?.wallet.smartAccountAddress) as Address | undefined;
}

function formatAddress(address: Address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
