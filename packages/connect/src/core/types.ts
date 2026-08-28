import type { WalletClient } from "viem";

export type FluentExternalWalletState = {
  configured: boolean;
  connected: boolean;
  address?: string;
  chainId?: number;
  walletClient?: WalletClient;
  /**
   * True while the wallet is being restored from a previous visit and neither
   * `connected` nor "no wallet" is known yet. Optional so hosts supplying their
   * own wallet state keep working; omitting it just means the widget reports
   * `"disconnected"` slightly earlier during a reload.
   */
  reconnecting?: boolean;
  open: () => void;
  disconnect: () => void;
  switchChain: (chainId: number) => Promise<void>;
};

/**
 * Top-level connection state of the widget, safe to read on any render.
 *
 * The distinction that matters is `"restoring"` vs `"disconnected"`: a session
 * restored from a previous visit is not known synchronously, so a host that
 * treats "not connected yet" as "no account" will render a Connect button at
 * users who do have a live session. Wait out `"restoring"` instead.
 *
 * - `"restoring"` — a previous session may exist; nothing is decided yet.
 * - `"connecting"` — a sign-in the user started is in flight.
 * - `"connected"` — an account is available. Whether it can send transactions
 *   *right now* is a separate question — see `widget.account.executionStatus`.
 * - `"disconnected"` — no account, and none is being restored or negotiated.
 */
export type FluentWidgetStatus = "restoring" | "connecting" | "connected" | "disconnected";
