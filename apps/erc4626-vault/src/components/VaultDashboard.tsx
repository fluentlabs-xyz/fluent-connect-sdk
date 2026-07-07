import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Hash } from "viem";
import {
  STBLEND_VAULT_ADDRESS,
  vaultPublicClient,
} from "../consts";
import { explorerAddress, explorerTx, formatAddress, formatAmount, formatTimestamp } from "../utils/format";
import {
  demoThirdPartyAddress,
  erc20Abi,
  getVaultFill,
  parseVaultAmount,
  previewVaultAction,
  readVaultSnapshot,
  type VaultMode,
  type VaultSnapshot,
  vaultAbi,
} from "../contracts/vault";
import {
  type FluentBatchApi,
  type FluentWidgetSession,
} from "@fluent/react";

export function VaultDashboard({
  onConnect,
  session,
  widget,
}: {
  onConnect: () => void;
  session: FluentWidgetSession | null;
  widget: FluentBatchApi;
}) {
  /// 2. Init FluentAccount: use the Fluent Connect widget session address for
  /// reads, then require an execution-capable ZeroDev account for writes.
  const account = widget.account.address ?? session?.wallet.smartAccountAddress;
  const fluentConnected = Boolean(session?.user?.id || session?.wallet.smartAccountAddress);
  const [mode, setMode] = useState<VaultMode | null>(null);
  const [amount, setAmount] = useState("");
  const [snapshot, setSnapshot] = useState<VaultSnapshot | null>(null);
  const [preview, setPreview] = useState<bigint | null>(null);
  const [status, setStatus] = useState("Connect with Fluent or refresh vault data");
  const [permissionStatus, setPermissionStatus] = useState("No delegated vault session created");
  const [permissionSigner, setPermissionSigner] = useState<string | null>(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<Hash | null>(null);

  const inputDecimals = snapshot?.assetDecimals ?? 18;
  const parsedAmount = useMemo(() => parseVaultAmount(amount, inputDecimals), [amount, inputDecimals]);
  const executionReady = Boolean(account && widget.account.executionReady);
  const executionUnavailable = Boolean(fluentConnected && !executionReady);
  const canCreateDelegatedPermission = Boolean(account && parsedAmount && executionReady && !permissionBusy);
  const canWithdraw = Boolean(account && snapshot && snapshot.shareBalance > 0n);

  useEffect(() => {
    console.log("[vault] account state", {
      hasSession: Boolean(session),
      sessionUserId: session?.user?.id,
      sessionSignerAddress: session?.wallet?.signerAddress,
      sessionSmartAccountAddress: session?.wallet?.smartAccountAddress,
      widgetAccountAddress: widget.account.address,
      widgetSignerAddress: widget.account.signerAddress,
      widgetConnected: widget.account.connected,
      widgetExecutionReady: widget.account.executionReady,
      widgetExecutionStatus: widget.account.executionStatus,
      widgetExecutionError: widget.account.executionError,
      resolvedAccount: account,
      executionReady,
      fluentConnected,
    });
  }, [
    account,
    executionReady,
    fluentConnected,
    session,
    widget.account.address,
    widget.account.connected,
    widget.account.executionError,
    widget.account.executionReady,
    widget.account.executionStatus,
    widget.account.signerAddress,
  ]);

  /// 3. Read Vault State: public reads do not require login, but account
  /// balances, allowance, and maxWithdraw use the FluentAccount address.
  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus("Reading vault state");
    try {
      const nextSnapshot = await readVaultSnapshot(account);
      setSnapshot(nextSnapshot);
      setStatus(
        account
          ? "Vault data loaded"
          : fluentConnected
            ? "Fluent Connect session loaded, waiting for account address"
            : "Connect with Fluent to load account balances",
      );
    } catch (err) {
      setSnapshot(null);
      setStatus(err instanceof Error ? err.message : "Failed to read vault state");
    } finally {
      setLoading(false);
    }
  }, [account, fluentConnected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /// 4. Preview ERC-4626 Math: previewDeposit/previewWithdraw lets builders
  /// show expected shares before the user signs a transaction.
  useEffect(() => {
    if (!parsedAmount || !mode) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    previewVaultAction(mode, parsedAmount)
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, parsedAmount]);

  useEffect(() => {
    if (session && !account) {
      setStatus("Fluent Connect session loaded, waiting for account address");
      return;
    }
    if (session && account && !executionReady) {
      setStatus(
        widget.account.executionError ??
          "Fluent Connect account is connected, but transaction execution is not available in this session",
      );
    }
  }, [account, executionReady, session, widget.account.executionError]);

  useEffect(() => {
    if (mode === "withdraw" && !canWithdraw) {
      setMode(null);
      setAmount("");
      setPreview(null);
    }
  }, [canWithdraw, mode]);

  /// 5. Submit Vault Action: deposits use CreateBatchOp() for approve + deposit;
  /// withdrawals are a single ERC-4626 call from the same FluentAccount.
  const submit = useCallback(async () => {
    if (!mode || !parsedAmount || !account || !session || !snapshot) return;
    if (!executionReady) {
      setStatus(widget.account.executionError ?? "Fluent smart account execution is not available");
      return;
    }

    setBusy(true);
    setStatus(mode === "deposit" ? "Submitting approve + deposit batch" : "Submitting withdrawal");
    try {
      /// 6. CreateBatchOp(): encode one or more contract calls as a
      /// smart-account user operation owned by the Fluent widget.
      const hash = await (mode === "deposit"
        ? widget
            .createBatchOp({
              id: "stblend-approve-deposit",
              button: {
                label: "Approve + deposit",
                pendingLabel: "Submitting batch",
                successLabel: "Deposit submitted",
              },
              calls: [
                {
                  id: "approve-asset",
                  label: `Approve ${snapshot.assetSymbol}`,
                  to: snapshot.assetAddress,
                  abi: erc20Abi,
                  method: "approve",
                  args: [STBLEND_VAULT_ADDRESS, parsedAmount],
                },
                {
                  id: "deposit-vault",
                  label: "Deposit into vault",
                  to: STBLEND_VAULT_ADDRESS,
                  abi: vaultAbi,
                  method: "deposit",
                  args: [parsedAmount, account],
                },
              ],
            })
            .execute()
        : widget
            .createBatchOp({
              id: "stblend-withdraw",
              button: {
                label: "Withdraw",
                pendingLabel: "Submitting withdrawal",
                successLabel: "Withdrawal submitted",
              },
              calls: [
                {
                  id: "withdraw-vault",
                  label: "Withdraw from vault",
                  to: STBLEND_VAULT_ADDRESS,
                  abi: vaultAbi,
                  method: "withdraw",
                  args: [parsedAmount, account, account],
                },
              ],
            })
            .execute());

      /// 7. Confirm And Refresh: wait for the transaction hash, then reload
      /// vault totals, balances, allowance, and max withdrawal.
      setTxHash(hash);
      await vaultPublicClient.waitForTransactionReceipt({ hash });
      setStatus(mode === "deposit" ? "Approve + deposit confirmed" : "Withdrawal confirmed");
      setAmount("");
      setPreview(null);
      setMode(null);
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Vault action failed");
    } finally {
      setBusy(false);
    }
  }, [account, executionReady, mode, parsedAmount, refresh, session, widget, snapshot]);

  /// 8. CreatePermissionSession(): grant a narrowly scoped ZeroDev session for
  /// a third-party executor. The policy can only approve this vault, deposit
  /// back to the user's FluentAccount, or withdraw to the configured receiver.
  const createDelegatedPermission = useCallback(async () => {
    if (!account || !snapshot || !parsedAmount) {
      setPermissionStatus("Enter an asset amount before creating the delegated session");
      return;
    }
    if (!executionReady) {
      setPermissionStatus(widget.account.executionError ?? "Fluent smart account execution is not available");
      return;
    }

    setPermissionBusy(true);
    setPermissionStatus("Creating scoped ZeroDev permission session");
    try {
      const permission = await widget.createPermissionSession({
        label: "Manage stBlend vault position",
        delegate: demoThirdPartyAddress,
        expiresAt: Date.now() + 60 * 60 * 1000,
        policies: [
          widget.policies.batch({
            id: "approve-deposit",
            calls: [
              {
                to: snapshot.assetAddress,
                abi: erc20Abi,
                method: "approve",
                args: {
                  spender: { equals: STBLEND_VAULT_ADDRESS },
                  amount: { max: parsedAmount },
                },
              },
              {
                to: STBLEND_VAULT_ADDRESS,
                abi: vaultAbi,
                method: "deposit",
                args: {
                  assets: { max: parsedAmount },
                  receiver: { equals: account },
                },
              },
            ],
          }),
          widget.policies.call({
            id: "withdraw-to-third-party",
            to: STBLEND_VAULT_ADDRESS,
            abi: vaultAbi,
            method: "withdraw",
            args: {
              assets: { max: parsedAmount },
              receiver: { equals: demoThirdPartyAddress },
              owner: { equals: account },
            },
          }),
        ],
      });
      setPermissionSigner(permission.sessionSignerAddress);
      setPermissionStatus("Delegated session created for approve + deposit and withdraw");
    } catch (err) {
      setPermissionSigner(null);
      setPermissionStatus(err instanceof Error ? err.message : "Failed to create delegated session");
    } finally {
      setPermissionBusy(false);
    }
  }, [account, executionReady, parsedAmount, snapshot, widget]);

  const useMax = useCallback(() => {
    if (!snapshot || !mode) return;
    const value = mode === "withdraw" ? snapshot.maxWithdraw : snapshot.assetBalance;
    setAmount(formatUnits(value, snapshot.assetDecimals));
  }, [mode, snapshot]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setMode(null);
    setAmount("");
    setPreview(null);
  }, [busy]);

  const previewLabel = mode === "deposit" ? "Shares received" : "Shares burned";
  const previewDecimals = snapshot?.vaultDecimals ?? 18;
  const permissionButtonLabel = permissionBusy
    ? "Creating session"
    : !account
      ? "Connect Fluent account"
      : !parsedAmount
        ? "Enter amount first"
        : !executionReady
          ? "Delegation unavailable"
          : "Create delegated session";
  const visiblePermissionStatus =
    account && parsedAmount && !executionReady
      ? "Delegation requires transaction authority. This hosted Fluent Connect session exposes the account address, but not the ZeroDev signer/kernel needed to install a permission."
      : permissionStatus;
  const canSubmit = Boolean(
    mode &&
      snapshot &&
      account &&
      parsedAmount &&
      executionReady &&
      !busy
  );

  function openMode(nextMode: VaultMode) {
    setMode(nextMode);
    setAmount("");
    setPreview(null);
  }

  return (
    <section className="vault-shell">
      <div className="vault-overview">
        <div className="vault-overview-top">
          <div>
            <p className="eyebrow">ERC-4626 vault</p>
            <h1>{snapshot?.vaultName ?? "stBlend Vault"}</h1>
          </div>
          <span className={snapshot?.paused ? "vault-state vault-state-paused" : "vault-state"}>
            {snapshot?.paused ? "Paused" : "Live"}
          </span>
        </div>

        <div className="vault-capacity">
          <span style={{ width: getVaultFill(snapshot) }} />
        </div>
        <div className="vault-capacity-labels">
          <strong>
            {snapshot
              ? `${formatAmount(snapshot.totalAssets, snapshot.assetDecimals)} ${snapshot.assetSymbol}`
              : "0"}
          </strong>
          <span>
            Cap{" "}
            {snapshot && snapshot.maxTotalAssets > 0n
              ? `${formatAmount(snapshot.maxTotalAssets, snapshot.assetDecimals)} ${snapshot.assetSymbol}`
              : "Uncapped"}
          </span>
        </div>

        <div className="vault-metrics">
          <div>
            <span>Total supply</span>
            <strong>
              {snapshot
                ? `${formatAmount(snapshot.totalSupply, snapshot.vaultDecimals)} ${snapshot.vaultSymbol}`
                : "-"}
            </strong>
          </div>
          <div>
            <span>Undistributed rewards</span>
            <strong>
              {snapshot
                ? `${formatAmount(snapshot.undistributedRewards, snapshot.assetDecimals)} ${snapshot.assetSymbol}`
                : "-"}
            </strong>
          </div>
          <div>
            <span>Reward rate</span>
            <strong>
              {snapshot
                ? `${formatAmount(snapshot.rewardRate, snapshot.assetDecimals, 8)} ${snapshot.assetSymbol}/sec`
                : "-"}
            </strong>
          </div>
          <div>
            <span>Stream finish</span>
            <strong>{snapshot ? formatTimestamp(snapshot.periodFinish) : "-"}</strong>
          </div>
        </div>

        <div className="vault-links">
          <a href={explorerAddress(STBLEND_VAULT_ADDRESS)} target="_blank" rel="noreferrer">
            Vault {formatAddress(STBLEND_VAULT_ADDRESS)}
          </a>
          {snapshot ? (
            <a href={explorerAddress(snapshot.assetAddress)} target="_blank" rel="noreferrer">
              Asset {formatAddress(snapshot.assetAddress)}
            </a>
          ) : null}
        </div>
      </div>

      <div className="vault-trade">
        <div
          className={canWithdraw ? "vault-tabs" : "vault-tabs vault-tabs-deposit-only"}
          role="tablist"
          aria-label="Vault action"
        >
          <button type="button" aria-selected={mode === "deposit"} onClick={() => openMode("deposit")}>
            Deposit
          </button>
          {canWithdraw ? (
            <button type="button" aria-selected={mode === "withdraw"} onClick={() => openMode("withdraw")}>
              Withdraw
            </button>
          ) : null}
        </div>

        <div className="vault-actions vault-actions-refresh-only">
          <button type="button" onClick={refresh} disabled={loading || busy}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>

        <p className="vault-status">{status}</p>
        {txHash ? (
          <a className="vault-tx" href={explorerTx(txHash)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        ) : null}
      </div>

      {mode ? (
        <div
          className="vault-dialog-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section className="vault-dialog" role="dialog" aria-modal="true" aria-label={`${mode} vault assets`}>
            <div className="vault-dialog-header">
              <div>
                <p className="eyebrow">{mode === "deposit" ? "Deposit" : "Withdraw"}</p>
                <h2>{mode === "deposit" ? "Deposit assets" : "Withdraw assets"}</h2>
              </div>
              <button type="button" aria-label="Close" onClick={closeDialog} disabled={busy}>
                x
              </button>
            </div>

            <label className="vault-field">
              <span>{mode === "deposit" ? "Asset amount" : "Withdraw assets"}</span>
              <div>
                <input
                  autoFocus
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <button type="button" onClick={useMax} disabled={!snapshot || busy}>
                  Max
                </button>
              </div>
            </label>

            <div className="vault-preview">
              <span>{previewLabel}</span>
              <strong>
                {preview === null
                  ? "-"
                  : `${formatAmount(preview, previewDecimals)} ${snapshot?.vaultSymbol ?? "shares"}`}
              </strong>
            </div>

            <div className="vault-account-grid">
              <div>
                <span>Wallet asset</span>
                <strong>
                  {snapshot
                    ? `${formatAmount(snapshot.assetBalance, snapshot.assetDecimals)} ${snapshot.assetSymbol}`
                    : "-"}
                </strong>
              </div>
              <div>
                <span>Vault shares</span>
                <strong>
                  {snapshot
                    ? `${formatAmount(snapshot.shareBalance, snapshot.vaultDecimals)} ${snapshot.vaultSymbol}`
                    : "-"}
                </strong>
              </div>
              <div>
                <span>Approved</span>
                <strong>
                  {snapshot
                    ? `${formatAmount(snapshot.assetAllowance, snapshot.assetDecimals)} ${snapshot.assetSymbol}`
                    : "-"}
                </strong>
              </div>
              <div>
                <span>Max withdraw</span>
                <strong>
                  {snapshot
                    ? `${formatAmount(snapshot.maxWithdraw, snapshot.assetDecimals)} ${snapshot.assetSymbol}`
                    : "-"}
                </strong>
              </div>
            </div>

            <div className="permission-demo">
              <div>
                <span>Permission demo receiver</span>
                <strong>{formatAddress(demoThirdPartyAddress)}</strong>
              </div>
              <button
                type="button"
                onClick={createDelegatedPermission}
                disabled={!canCreateDelegatedPermission}
              >
                {permissionButtonLabel}
              </button>
              <p>{visiblePermissionStatus}</p>
              {permissionSigner ? <small>Session signer {formatAddress(permissionSigner)}</small> : null}
            </div>

            <div className={fluentConnected ? "vault-actions" : "vault-actions vault-actions-refresh-only"}>
              {fluentConnected ? (
                !executionReady ? (
                  <button type="button" disabled>
                    {executionUnavailable ? "Execution unavailable" : "Preparing executor"}
                  </button>
                ) : (
                  <button type="button" onClick={submit} disabled={!canSubmit || snapshot?.paused}>
                    {busy
                      ? "Submitting"
                      : mode === "deposit"
                        ? "Approve + deposit"
                        : "Withdraw"}
                  </button>
                )
              ) : (
                <button type="button" onClick={onConnect}>
                  Connect wallet
                </button>
              )}
              <button type="button" onClick={closeDialog} disabled={busy}>
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
