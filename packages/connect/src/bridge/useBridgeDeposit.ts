import { useQuery } from "@tanstack/react-query";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  formatUnits,
  padHex,
  parseEther,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import {
  useAccount,
  useBalance,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { debugError, debugLog } from "../core/debugLogger";
import type { FluentWidgetNetwork } from "../core/network";
import { createFluentRpcTransport } from "../core/rpc";
import {
  erc20GatewayAbi,
  fastPathPortalAbi,
  fluentBridgeFeeAbi,
  nativeGatewayAbi,
  swapFacilityAbi,
} from "./abi";
import { sanitizeBridgeAmountInput, validateBridgeAmount } from "./amount";
import { readFastPathFeeWei } from "./fastPathFee";
import type { FluentBridgeRoute } from "./route";
import { getDeliveredToken, type BridgeToken } from "./tokens";
import { findBridgeTxBySentHash, getBridgeTransactions, type BridgeTxItem } from "./txHistory";
import { describeSwitchError, switchWalletChain, type Eip1193Provider } from "./walletChain";

/** ETH left unspent on the source chain so the deposit itself can pay for gas. */
const GAS_HEADROOM_WEI = parseEther("0.0005");
/** After this the transfer is late, not broken — the copy changes, nothing else. */
const RELAY_SLOW_AFTER_MS = 120_000;
/**
 * How long a stored connection gets to come back before the page offers a fresh
 * connect instead. wagmi's `reconnect()` awaits every connector's `getProvider()`
 * and `isAuthorized()` in turn, and a single connector that never answers keeps
 * the status on "reconnecting" forever — a button must not wait on that.
 */
const RESTORE_TIMEOUT_MS = 8_000;

export type BridgeDepositPhase =
  | "idle"
  | "approving"
  | "swapping"
  | "confirming"
  | "submitted"
  | "relaying"
  | "settled"
  | "error";

export type BridgeDepositState = {
  phase: BridgeDepositPhase;
  /** What the wallet is being asked to do right now — the status view's heading. */
  stepLabel?: string;
  /** The deposit transaction on the source chain. */
  hash?: Hash;
  /** The transaction that credited the funds on Fluent — the one worth showing once landed. */
  receivedHash?: Hash;
  /** For a swap route: how much of the delivered token the swap actually produced. */
  swappedAmount?: bigint;
  /** Relay is taking longer than usual — the funds are not lost. */
  slow: boolean;
  message?: string;
};

export type BridgeDepositForm = {
  amount: string;
  /** Filters the keystroke before it lands — see `sanitizeBridgeAmountInput`. */
  setAmount: (value: string) => void;
  /** Everything the wallet can part with: ETH minus fee and gas, an ERC-20 whole. */
  setMax: () => void;
  /** Empty while the amount is blank or unparseable — not an error yet. */
  validationError?: string;
  canSubmit: boolean;
};

export type UseBridgeDeposit = {
  /** What the user is paying with. */
  token: BridgeToken;
  /** What arrives on Fluent — differs from `token` on a swap route. */
  deliveredToken: BridgeToken;
  connected: boolean;
  address?: Address;
  /** Opens RainbowKit's wallet picker. */
  connect: () => void;
  connecting: boolean;
  /**
   * wagmi is still restoring a stored connection. Distinct from disconnected:
   * showing "Connect a wallet" here flashes that button at someone who is
   * already connected. Only ever true while there *is* a stored connection to
   * restore, and never for longer than `RESTORE_TIMEOUT_MS`.
   */
  restoring: boolean;
  /** Waiting on the fee read — the deposit's value is not known yet. */
  feeLoading: boolean;
  /** The wallet is connected but pointed at some other chain. */
  wrongChain: boolean;
  switchToSource: () => void;
  switchingChain: boolean;
  /** Why the last chain switch failed — the button alone cannot say. */
  switchError?: string;
  /**
   * Drops the wallet. It is the app's wallet, not a bridge-only one, so this
   * disconnects it everywhere — the escape hatch when a wallet is on a chain it
   * will not leave.
   */
  disconnect: () => void;
  /** Balance of the selected token on the source chain, in its smallest unit. */
  sourceBalance?: bigint;
  balanceLoading: boolean;
  /** Paid in ETH alongside the deposit: the message fee, or the fast-path quote. */
  fee?: bigint;
  /** The first signature will be an approval rather than the transfer itself. */
  needsApproval: boolean;
  receiveAmount?: bigint;
  form: BridgeDepositForm;
  state: BridgeDepositState;
  submit: () => void;
  reset: () => void;
};

function isUserRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /user rejected|denied/i.test(message);
}

/**
 * The amount the facility handed out, read from its own event. Extensions swap
 * at par today, but the bridge leg must carry what actually arrived — a
 * predicted number that ran ahead of reality would try to bridge USDnr the
 * wallet does not hold.
 */
function readSwappedAmount(receipt: TransactionReceipt, facility: Address): bigint | undefined {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== facility.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: swapFacilityAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Swapped" || decoded.eventName === "SwappedInJMI") {
        return decoded.args.amount;
      }
    } catch {
      // another event from the same facility — expected
    }
  }
  return undefined;
}

export function useBridgeDeposit({
  route,
  network,
  recipient,
  token,
}: {
  route: FluentBridgeRoute;
  network: FluentWidgetNetwork;
  recipient?: Address;
  token: BridgeToken;
}): UseBridgeDeposit {
  const { address, isConnected, connector, status: accountStatus } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: route.source.id });
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<BridgeDepositState>({ phase: "idle", slow: false });
  const [switchError, setSwitchError] = useState<string | undefined>(undefined);
  const [switchingChain, setSwitchingChain] = useState(false);
  const { disconnect } = useDisconnect();

  const isErc20 = token.route !== "native";
  const isSwap = token.route === "swap";
  // On a swap route the bridge leg is the *delivered* token's route.
  const deliveredToken = getDeliveredToken(network, token);
  const bridgeSpender: Address | undefined =
    deliveredToken.route === "canonical"
      ? route.erc20Gateway
      : deliveredToken.route === "fast-path"
        ? route.fastPathPortal
        : undefined;
  // Who the *first* approval goes to: the facility for a swap, the bridge otherwise.
  const firstSpender = isSwap ? route.swapFacility : bridgeSpender;

  // Switching tokens invalidates the typed amount: the decimals differ, and so
  // does what "max" means.
  useEffect(() => {
    setAmount("");
  }, [token.symbol]);

  // The wallet's own chain, read from the provider rather than from
  // `useAccount().chainId`.
  //
  // The bridge shares the app's wagmi config, and AppKit owns that config's
  // chain bookkeeping: a wallet sitting on a chain the widget does not list
  // (Ethereum mainnet, say — the MetaMask default) parks AppKit on "Unknown
  // Network" and leaves the cached `chainId` stale, so `useSwitchChain` reported
  // nothing and the button looked dead. Asking the wallet directly is the only
  // reading that is true from any starting chain.
  const [walletChainId, setWalletChainId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!connector) {
      setWalletChainId(undefined);
      return;
    }

    let active = true;
    let detach: (() => void) | undefined;

    void (async () => {
      try {
        const provider = (await connector.getProvider()) as Eip1193Provider;
        const current = await provider.request({ method: "eth_chainId" });
        if (!active) return;
        setWalletChainId(Number(current));

        const onChainChanged = (next: string) => {
          if (active) setWalletChainId(Number(next));
        };
        provider.on?.("chainChanged", onChainChanged);
        detach = () => provider.removeListener?.("chainChanged", onChainChanged);
      } catch (error) {
        debugError("[FluentBridge] could not read the wallet chain", error);
      }
    })();

    return () => {
      active = false;
      detach?.();
    };
  }, [connector]);

  const busy =
    state.phase === "approving" ||
    state.phase === "swapping" ||
    state.phase === "confirming" ||
    state.phase === "submitted";

  // `"connecting"` is deliberately not counted: wagmi reports it during its
  // blanket start-up `reconnect()` even when nothing was ever connected, so a
  // first-time visitor would sit behind a "Reconnecting…" button.
  const reconnecting = accountStatus === "reconnecting";
  const [restoreTimedOut, setRestoreTimedOut] = useState(false);
  useEffect(() => {
    if (!reconnecting) {
      setRestoreTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setRestoreTimedOut(true), RESTORE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [reconnecting]);

  const wrongChain =
    isConnected && walletChainId !== undefined && walletChainId !== route.source.id;

  // ETH is always read: it pays the fee and the gas whatever is being bridged.
  const { data: ethBalance, isLoading: ethBalanceLoading } = useBalance({
    address,
    chainId: route.source.id,
    query: { enabled: Boolean(address) },
  });

  const { data: tokenBalance, isLoading: tokenBalanceLoading } = useReadContract({
    address: token.l1Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: route.source.id,
    query: { enabled: isErc20 && Boolean(address && token.l1Address) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token.l1Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && firstSpender ? [address, firstSpender] : undefined,
    chainId: route.source.id,
    query: { enabled: isErc20 && Boolean(address && firstSpender && token.l1Address) },
  });

  // The facility's own gate: whether this wallet may put this stablecoin in.
  // Asked up front, so an opaque revert becomes a sentence before any signing.
  const { data: canSwap } = useReadContract({
    address: route.swapFacility,
    abi: swapFacilityAbi,
    functionName: "canSwapViaPath",
    args:
      address && token.l1Address && deliveredToken.l1Address
        ? [address, token.l1Address, deliveredToken.l1Address]
        : undefined,
    chainId: route.source.id,
    query: {
      enabled:
        isSwap && Boolean(address && route.swapFacility && token.l1Address && deliveredToken.l1Address),
    },
  });

  // The message fee prices the canonical bridge — ETH and pegged ERC-20s alike.
  const { data: messageFee, isPending: messageFeeLoading } = useReadContract({
    address: route.bridge,
    abi: fluentBridgeFeeAbi,
    functionName: "getSentMessageFee",
    chainId: route.source.id,
    query: { enabled: deliveredToken.route !== "fast-path" },
  });

  const fastPathFee = useQuery({
    queryKey: ["fluent-bridge-fast-path-fee", route.fastPathPortal, route.destination.id],
    queryFn: () => readFastPathFeeWei(publicClient!, route.fastPathPortal!, route.destination.id),
    enabled: deliveredToken.route === "fast-path" && Boolean(publicClient && route.fastPathPortal),
    staleTime: 30_000,
  });

  const fee = deliveredToken.route === "fast-path" ? fastPathFee.data : messageFee;
  const feeLoading =
    deliveredToken.route === "fast-path" ? fastPathFee.isPending : messageFeeLoading;

  const { writeContractAsync, isPending: signing } = useWriteContract();
  const { data: receipt, isError: receiptFailed } = useWaitForTransactionReceipt({
    hash: state.hash,
    chainId: route.source.id,
    query: { enabled: state.phase === "submitted" },
  });

  // Arrival is read with a plain viem client rather than `useBalance`, so
  // watching the destination does not depend on which chain the shared wallet
  // happens to sit on.
  const relayBaseline = useRef<bigint | undefined>(undefined);
  const destinationClient = useMemo(
    () =>
      createPublicClient({
        chain: route.destination,
        transport: createFluentRpcTransport(route.destination),
      }),
    [route.destination],
  );

  const feeWei = fee ?? 0n;
  const ethReserve = feeWei + GAS_HEADROOM_WEI;
  const sourceBalance = isErc20 ? tokenBalance : ethBalance?.value;
  const balanceLoading = isErc20 ? tokenBalanceLoading || ethBalanceLoading : ethBalanceLoading;

  // What the wallet can actually part with. ETH pays its own fee and gas, so
  // both come off the top; an ERC-20 can go out whole, but the wallet still
  // needs ETH on the side — that is checked separately below.
  const spendable = isErc20
    ? tokenBalance
    : ethBalance === undefined
      ? undefined
      : ethBalance.value > ethReserve
        ? ethBalance.value - ethReserve
        : 0n;

  const validated = validateBridgeAmount({
    input: amount,
    // Only judge the ceiling once a balance is in hand, and only for a wallet
    // that is actually on the source chain — otherwise the reading is someone
    // else's chain and the error would be nonsense.
    spendable: isConnected && !wrongChain ? spendable : undefined,
    symbol: token.symbol,
    decimals: token.decimals,
    native: !isErc20,
  });
  const ethShortForFee =
    isErc20 &&
    isConnected &&
    !wrongChain &&
    ethBalance !== undefined &&
    !feeLoading &&
    ethBalance.value < ethReserve;
  const validationError =
    validated.error ??
    (ethShortForFee && validated.wei !== undefined
      ? `Not enough ETH for the bridge fee and gas (about ${formatUnits(ethReserve, 18)} ETH)`
      : isSwap && canSwap === false
        ? `${token.symbol} cannot be converted to ${deliveredToken.symbol} on this network right now`
        : undefined);
  const amountWei = validationError ? undefined : validated.wei;

  const needsApproval =
    isErc20 && amountWei !== undefined && allowance !== undefined && allowance < amountWei;

  const setMax = useCallback(() => {
    if (spendable === undefined || spendable === 0n) return;
    setAmount(formatUnits(spendable, token.decimals));
  }, [spendable, token.decimals]);

  const reset = useCallback(() => {
    relayBaseline.current = undefined;
    setState({ phase: "idle", slow: false });
    setAmount("");
  }, []);

  const fail = useCallback((error: unknown, fallback: string) => {
    debugError("[FluentBridge] deposit failed", error);
    setState({
      phase: "error",
      slow: false,
      // A rejected signature is a decision, not a failure worth shouting about.
      message: isUserRejection(error)
        ? "You cancelled the transaction"
        : error instanceof Error
          ? error.message
          : fallback,
    });
  }, []);

  const submit = useCallback(() => {
    if (!recipient || !address || amountWei === undefined || fee === undefined) return;
    if (!publicClient) return;

    relayBaseline.current = undefined;

    // Approve exactly the amount a spender is about to pull — a blanket max
    // approval is a habit this widget does not want to teach.
    const ensureAllowance = async (
      erc20: Address,
      spender: Address,
      needed: bigint,
      symbol: string,
    ) => {
      const current = await publicClient.readContract({
        address: erc20,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spender],
      });
      if (current >= needed) return;
      setState((s) => ({ ...s, phase: "approving", stepLabel: `Approve ${symbol} in your wallet` }));
      const approveHash = await writeContractAsync({
        address: erc20,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, needed],
        chainId: route.source.id,
      });
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
      if (approveReceipt.status === "reverted") {
        throw new Error(`The ${symbol} approval transaction reverted`);
      }
    };

    void (async () => {
      try {
        // What the bridge leg carries: the typed amount, or whatever the swap produced.
        let bridgeAmount = amountWei;
        const bridgeToken = deliveredToken;

        if (isSwap) {
          if (!route.swapFacility || !token.l1Address || !bridgeToken.l1Address) {
            throw new Error(`${token.symbol} is not configured on this network`);
          }
          await ensureAllowance(token.l1Address, route.swapFacility, amountWei, token.symbol);

          setState((s) => ({
            ...s,
            phase: "swapping",
            stepLabel: `Swapping ${token.symbol} to ${bridgeToken.symbol}`,
          }));
          const swapHash = await writeContractAsync({
            address: route.swapFacility,
            abi: swapFacilityAbi,
            functionName: "swap",
            args: [token.l1Address, bridgeToken.l1Address, amountWei, address],
            chainId: route.source.id,
          });
          const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
          if (swapReceipt.status === "reverted") throw new Error("The swap transaction reverted");
          bridgeAmount = readSwappedAmount(swapReceipt, route.swapFacility) ?? amountWei;
          setState((s) => ({ ...s, swappedAmount: bridgeAmount }));
          debugLog("[FluentBridge] swapped", { in: amountWei, out: bridgeAmount, swapHash });
        }

        if (bridgeToken.route !== "native") {
          if (!bridgeToken.l1Address || !bridgeSpender) {
            throw new Error(`${bridgeToken.symbol} is not configured on this network`);
          }
          await ensureAllowance(bridgeToken.l1Address, bridgeSpender, bridgeAmount, bridgeToken.symbol);
        }

        setState((s) => ({ ...s, phase: "confirming", stepLabel: "Confirm the deposit in your wallet" }));

        let hash: Hash;
        if (bridgeToken.route === "native") {
          hash = await writeContractAsync({
            address: route.nativeGateway,
            abi: nativeGatewayAbi,
            functionName: "sendNativeTokens",
            args: [recipient],
            value: bridgeAmount + fee,
            chainId: route.source.id,
          });
        } else if (bridgeToken.route === "canonical") {
          hash = await writeContractAsync({
            address: bridgeSpender!,
            abi: erc20GatewayAbi,
            functionName: "sendTokens",
            args: [bridgeToken.l1Address!, recipient, bridgeAmount],
            value: fee,
            chainId: route.source.id,
          });
        } else {
          // Fast path addresses everything as bytes32 so one portal can serve
          // non-EVM destinations too; the refund address is the sender.
          hash = await writeContractAsync({
            address: bridgeSpender!,
            abi: fastPathPortalAbi,
            functionName: "sendToken",
            args: [
              bridgeAmount,
              bridgeToken.l1Address!,
              route.destination.id,
              padHex(bridgeToken.l2Address!, { size: 32 }),
              padHex(recipient, { size: 32 }),
              padHex(address, { size: 32 }),
              "0x",
            ],
            value: fee,
            chainId: route.source.id,
          });
        }

        setState((s) => ({ ...s, phase: "submitted", hash, stepLabel: undefined }));
      } catch (error) {
        fail(error, "The deposit could not be sent");
      }
    })();
  }, [
    address,
    amountWei,
    bridgeSpender,
    deliveredToken,
    fail,
    fee,
    isSwap,
    publicClient,
    recipient,
    route,
    token,
    writeContractAsync,
  ]);

  // After a swap the facility's allowance is spent; keep the form's reading honest.
  useEffect(() => {
    if (state.phase === "idle" || state.phase === "settled" || state.phase === "error") {
      void refetchAllowance();
    }
  }, [refetchAllowance, state.phase]);

  // Receipt settles the source leg; the destination leg is watched separately.
  useEffect(() => {
    if (state.phase !== "submitted") return;
    if (receiptFailed) {
      setState((current) => ({
        ...current,
        phase: "error",
        message: `The deposit transaction failed on ${route.source.name}`,
      }));
      return;
    }
    if (!receipt) return;
    if (receipt.status === "reverted") {
      setState((current) => ({
        ...current,
        phase: "error",
        message: "The deposit transaction reverted",
      }));
      return;
    }
    setState((current) => ({ ...current, phase: "relaying" }));
  }, [receipt, receiptFailed, route.source.name, state.phase]);

  // Two independent readings of the same question, because neither alone is
  // enough: the indexer knows *which* transfer landed and whether the relay
  // succeeded, but it can be behind or unreachable; the destination balance is
  // always readable but cannot tell one deposit from another.
  //
  // Keeps running briefly after `settled` too: the balance poll can declare
  // arrival before the indexer has the delivering transaction, and that hash is
  // what the success screen links to.
  const awaitingReceivedHash = state.phase === "settled" && !state.receivedHash;
  useEffect(() => {
    if ((state.phase !== "relaying" && !awaitingReceivedHash) || !recipient || !address) return;

    let active = true;
    let attemptsLeft = awaitingReceivedHash ? 24 : Number.POSITIVE_INFINITY; // ~2 min after landing
    const controller = new AbortController();

    const pollIndexer = async () => {
      if (!state.hash) return false;
      try {
        // Filtered by sender: the indexer answers for the wallet that signed the
        // deposit, not for the Fluent ID it was credited to.
        const history = await getBridgeTransactions({
          baseUrl: route.indexerUrl,
          address,
          signal: controller.signal,
        });
        const item: BridgeTxItem | undefined = findBridgeTxBySentHash(history, state.hash);
        debugLog("[FluentBridge] indexer transactions", {
          sentTxHash: state.hash,
          matched: item,
          items: history.items.length,
          l1RequiredConfirmations: history.l1_required_confirmations,
        });

        if (!item || !active) return false;
        if (item.received_tx_hash) {
          const receivedHash = item.received_tx_hash;
          setState((current) =>
            current.receivedHash === receivedHash ? current : { ...current, receivedHash },
          );
        }
        if (item.status === "failed" || item.successful_call === false) {
          setState((current) => ({
            ...current,
            phase: "error",
            message: "The bridge could not deliver this deposit on Fluent",
          }));
          return true;
        }
        return item.status === "relayed";
      } catch (error) {
        if (!controller.signal.aborted) {
          debugError("[FluentBridge] indexer read failed", error);
        }
        return false;
      }
    };

    const readDestinationBalance = () =>
      deliveredToken.route === "native" || !deliveredToken.l2Address
        ? destinationClient.getBalance({ address: recipient })
        : destinationClient.readContract({
            address: deliveredToken.l2Address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [recipient],
          });

    const pollBalance = async () => {
      try {
        const balance = await readDestinationBalance();
        if (relayBaseline.current === undefined) {
          relayBaseline.current = balance;
          return false;
        }
        return balance > relayBaseline.current;
      } catch {
        // A missed poll is not a failed bridge — the next tick tries again.
        return false;
      }
    };

    const poll = async () => {
      if (awaitingReceivedHash) {
        if (attemptsLeft-- <= 0) {
          clearInterval(timer);
          return;
        }
        await pollIndexer();
        return;
      }
      const [relayed, credited] = await Promise.all([pollIndexer(), pollBalance()]);
      if (active && (relayed || credited)) {
        setState((current) =>
          current.phase === "relaying" ? { ...current, phase: "settled" } : current,
        );
      }
    };

    const timer = setInterval(poll, 5_000);
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [
    address,
    awaitingReceivedHash,
    deliveredToken,
    destinationClient,
    recipient,
    route.indexerUrl,
    state.hash,
    state.phase,
  ]);

  useEffect(() => {
    if (state.phase !== "relaying") return;
    const timer = setTimeout(
      () => setState((current) => ({ ...current, slow: true })),
      RELAY_SLOW_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [state.phase]);

  return {
    token,
    deliveredToken,
    connected: isConnected,
    address,
    connect: () => openConnectModal?.(),
    connecting: signing,
    restoring: reconnecting && !restoreTimedOut,
    feeLoading,
    wrongChain,
    switchToSource: () => {
      setSwitchError(undefined);
      setSwitchingChain(true);
      void switchWalletChain(connector, route.source)
        .catch((error: unknown) => {
          debugError("[FluentBridge] switch to source chain failed", error);
          setSwitchError(describeSwitchError(error, route.source.name));
        })
        .finally(() => setSwitchingChain(false));
    },
    switchingChain,
    switchError,
    disconnect: () => {
      setSwitchError(undefined);
      disconnect();
    },
    sourceBalance,
    balanceLoading,
    fee,
    needsApproval,
    // Mirrors what was typed even when it overshoots the balance: blanking the
    // receive side while the user is being told the maximum reads as a glitch.
    // A swap is at par and both sides are 6-decimal, so the typed amount is the
    // honest estimate until the facility says otherwise.
    receiveAmount: state.swappedAmount ?? validated.wei,
    form: {
      amount,
      setAmount: (value: string) =>
        setAmount((current) => sanitizeBridgeAmountInput(value, current, token.decimals)),
      setMax,
      validationError,
      canSubmit:
        Boolean(recipient) &&
        isConnected &&
        !wrongChain &&
        !busy &&
        // The fee is added to `value`; submitting before it lands would send a
        // deposit short of what the bridge charges.
        !feeLoading &&
        fee !== undefined &&
        amountWei !== undefined &&
        !validationError &&
        // For a swap the facility has to have said yes before anything is signed.
        (!isSwap || canSwap === true),
    },
    state,
    submit,
    reset,
  };
}
