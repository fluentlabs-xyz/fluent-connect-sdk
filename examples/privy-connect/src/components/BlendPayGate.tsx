import { useState, useMemo, useCallback, useEffect } from "react";
import { FluentWidgetSession, BLEND_PAYMENT_AMOUNT, blendPublicClient, BLEND_TOKEN_ADDRESS, BLEND_PAYMENT_RECIPIENT } from "../const";
import { ReownWalletState } from "../reown-appkit";
import { explorerAddress } from "../utils/explorerAddress";
import { explorerTx } from "../utils/explorerTx";
import { formatAddress } from "../utils/formatAddress";
import { parseUnits, erc20Abi, formatUnits } from "viem";
import { fluentTestnet } from "viem/chains";

export function BlendPayGate({
  session,
  wallet,
  onConnect,
}: {
  session: FluentWidgetSession | null;
  wallet: ReownWalletState | null;
  onConnect: () => void;
}) {
  const accountAddress = (wallet?.address ?? session?.wallet.signerAddress) as `0x${string}` | undefined;
  const [tokenSymbol, setTokenSymbol] = useState("BLEND");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [status, setStatus] = useState("Connect to check BLEND access");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requiredAmount = useMemo(
    () => parseUnits(BLEND_PAYMENT_AMOUNT, tokenDecimals),
    [tokenDecimals],
  );
  const hasEnoughBlend = balance !== null && balance >= requiredAmount;
  const canSendPayment = Boolean(wallet?.connected && wallet.address && wallet.walletClient);

  const refreshBalance = useCallback(async () => {
    if (!accountAddress) {
      setBalance(null);
      setStatus("Connect to check BLEND access");
      return;
    }

    setStatus("Checking BLEND balance");
    try {
      const [nextDecimals, nextSymbol, nextBalance] = await Promise.all([
        blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        blendPublicClient.readContract({
          address: BLEND_TOKEN_ADDRESS,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [accountAddress],
        }),
      ]);
      setTokenDecimals(nextDecimals);
      setTokenSymbol(nextSymbol);
      setBalance(nextBalance);
      setStatus(nextBalance >= parseUnits(BLEND_PAYMENT_AMOUNT, nextDecimals) ? "Ready to pay" : "BLEND required");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not read BLEND balance");
    }
  }, [accountAddress]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  const payWithWallet = useCallback(async () => {
    if (!wallet?.walletClient || !wallet.address) return;
    setBusy(true);
    setTxHash(null);
    setStatus("Preparing BLEND payment");
    try {
      if (wallet.chainId !== fluentTestnet.id) {
        setStatus("Switching to Fluent Testnet");
        await wallet.switchChain(fluentTestnet.id);
      }

      setStatus("Waiting for wallet signature");
      const hash = await wallet.walletClient.writeContract({
        account: wallet.address as `0x${string}`,
        chain: fluentTestnet,
        address: BLEND_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [BLEND_PAYMENT_RECIPIENT, requiredAmount],
      });
      setTxHash(hash);
      setStatus("Payment submitted");
      await blendPublicClient.waitForTransactionReceipt({ hash });
      setStatus("Payment confirmed. Premium BLEND section unlocked.");
      await refreshBalance();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }, [refreshBalance, requiredAmount, wallet]);

  return (
    <section className="blend-app">
      <div className="blend-app-main">
        <p className="eyebrow">BLEND pay-in demo</p>
        <h2>Fluent Yield Terminal</h2>
        <p>
          This third-party app requires a small BLEND payment on Fluent Testnet before
          unlocking the strategy dashboard.
        </p>

        <div className="blend-requirement">
          <span>Required payment</span>
          <strong>
            {BLEND_PAYMENT_AMOUNT} {tokenSymbol}
          </strong>
        </div>

        <div className="blend-actions">
          {accountAddress ? (
            <button type="button" onClick={refreshBalance} disabled={busy}>
              Refresh balance
            </button>
          ) : (
            <button type="button" onClick={onConnect}>
              Connect to pay
            </button>
          )}
          <button type="button" onClick={payWithWallet} disabled={!canSendPayment || !hasEnoughBlend || busy}>
            {busy ? "Paying" : hasEnoughBlend ? "Ready to PAY" : "Pay with BLEND"}
          </button>
        </div>

        <p className="blend-status">{status}</p>
        {txHash ? (
          <a className="blend-link" href={explorerTx(txHash)} target="_blank" rel="noreferrer">
            View payment transaction
          </a>
        ) : null}
      </div>

      <aside className="blend-app-side">
        <div>
          <span>Connected account</span>
          <strong>{accountAddress ? formatAddress(accountAddress) : "Not connected"}</strong>
        </div>
        <div>
          <span>BLEND balance</span>
          <strong>
            {balance === null ? "Unknown" : `${formatUnits(balance, tokenDecimals)} ${tokenSymbol}`}
          </strong>
        </div>
        <div>
          <span>Payment recipient</span>
          <a href={explorerAddress(BLEND_PAYMENT_RECIPIENT)} target="_blank" rel="noreferrer">
            {formatAddress(BLEND_PAYMENT_RECIPIENT)}
          </a>
        </div>
        <div>
          <span>BLEND token</span>
          <a href={explorerAddress(BLEND_TOKEN_ADDRESS)} target="_blank" rel="noreferrer">
            {formatAddress(BLEND_TOKEN_ADDRESS)}
          </a>
        </div>
        <div>
          <span>Payment execution</span>
          <strong>{canSendPayment ? "Wallet signer ready" : "Connect external wallet to sign"}</strong>
        </div>
      </aside>
    </section>
  );
}
