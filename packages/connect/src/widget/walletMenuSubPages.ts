/**
 * A Two-step deposit as a Transfer page, opened at its signature and again when its swap's
 * Review is confirmed: drawn from the deposit the widget holds rather than from a row of the
 * history, which does not list it yet.
 */
export const DEPOSIT_SWAP_TAB = "deposit-swap";

/**
 * A Send as a Transfer page, opened when its Review is confirmed: drawn from the transfer the
 * widget holds, Pending until it is mined, rather than from a row of the history.
 */
export const SENT_TRANSFER_TAB = "sent-transfer";

/**
 * The wallet menu values that render a full page instead of a tab, keyed by the `tab` value that
 * opens each: the drawer swaps its account header for a back button and the title, and renders
 * the page in place of the wallet menu. `parent` makes Back walk one level up instead of out to
 * the tab the person came in from; `dismiss: "close"` swaps the Back chevron for an X.
 */
export const WALLET_MENU_SUB_PAGES: Record<
  string,
  { title: string; parent?: string; dismiss?: "back" | "close" }
> = {
  settings: { title: "Settings" },
  send: { title: "Send" },
  bridge: { title: "Swap" },
  activity: { title: "Transfer" },
  [DEPOSIT_SWAP_TAB]: { title: "Transfer" },
  [SENT_TRANSFER_TAB]: { title: "Transfer" },
  // Closed with an X, not walked back from: leaving it is the rejection.
  review: { title: "Confirm transaction", dismiss: "close" },
};

/**
 * The Review of a Batch operation: a page the widget opens on its own when an execution needs
 * confirming, rendered in place of the wallet menu. Closing it rejects the operation.
 */
export const REVIEW_TAB = "review";

export function isReviewTab(tab: string): boolean {
  return tab === REVIEW_TAB;
}

/** The `tab` values the bridge screen owns. */
export const BRIDGE_TABS = ["bridge"] as const;
export type BridgeTab = (typeof BRIDGE_TABS)[number];

export function isBridgeTab(tab: string): tab is BridgeTab {
  return (BRIDGE_TABS as readonly string[]).includes(tab);
}

/** Pages the wallet menu card renders itself; anything else needs its own screen. */
export function isWalletMenuCardTab(tab: string): boolean {
  return !isBridgeTab(tab) && !isReviewTab(tab);
}
