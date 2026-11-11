import type { WalletClient } from "viem";

/**
 * One wallet the connect dialog offers inline, as a host's `FluentExternalWalletState` lists it.
 *
 * @experimental May change or be removed in a minor release: a host that brings its own wallet
 * connection is not a 0.6.0 commitment.
 */
export type FluentWalletChoice = {
  /** What `connectChoice` is called with when the user picks this wallet. */
  id: string;
  /** The wallet's name, shown on its button. */
  name: string;
  /** The URL of the wallet's icon; without it the button shows a generic wallet icon. */
  icon?: string;
  /**
   * Whether this wallet opens a surface of its own, such as a WalletConnect QR code: the connect
   * dialog then closes before connecting it instead of showing its wait screen.
   */
  handoff?: boolean;
};

/**
 * An External wallet as the widget sees it: whether one is connected, its address, chain and
 * client, and how to open, connect, switch and disconnect it. Its inline choices are
 * `FluentWalletChoice`s.
 *
 * @experimental May change or be removed in a minor release: a host that brings its own wallet
 * connection is not a 0.6.0 commitment.
 */
export type FluentExternalWalletState = {
  /**
   * Whether an External wallet can be connected at all; `false` disables its row in the connect
   * dialog.
   */
  configured: boolean;
  /** Whether an External wallet is connected. */
  connected: boolean;
  /** The connected wallet's address. */
  address?: string;
  /** The chain the connected wallet reports. */
  chainId?: number;
  /**
   * The client the widget signs and sends through, once the client's account is `address`.
   */
  walletClient?: WalletClient;
  /**
   * True while the wallet is being restored from a previous visit and neither `connected` nor
   * "no wallet" is known yet. Without it the widget can report `"disconnected"` during a reload
   * before the wallet is back.
   */
  reconnecting?: boolean;
  /**
   * The wallets the connect dialog offers inline. Without them, or without `connectChoice`, the
   * dialog calls `open` instead.
   */
  choices?: readonly FluentWalletChoice[];
  /** Connects the wallet of the `FluentWalletChoice` with this `id`. */
  connectChoice?: (id: string) => Promise<void>;
  /** Opens the host's own wallet picker. */
  open: () => void;
  /** Disconnects the External wallet. */
  disconnect: () => void;
  /** Asks the wallet to switch to `chainId`; the widget calls it before using the wallet. */
  switchChain: (chainId: number) => Promise<void>;
};

/**
 * The widget's connection state, safe to read on any render.
 *
 * The distinction that matters is `"restoring"` against `"disconnected"`: a sign-in kept from a
 * previous visit is not known synchronously, so an App that treats "not connected yet" as "no
 * account" shows a Connect button to people who are still signed in. Wait out `"restoring"`.
 *
 * - `"restoring"`: a previous sign-in may exist; nothing is decided yet.
 * - `"connecting"`: a Connect the user started is in flight.
 * - `"connected"`: a Widget account is available. Whether it can send right now is
 *   `widget.account.executionStatus`.
 * - `"disconnected"`: no Widget account, and none is being restored or connected.
 */
export type FluentWidgetStatus = "restoring" | "connecting" | "connected" | "disconnected";
