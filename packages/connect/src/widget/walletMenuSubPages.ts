/**
 * Wallet-menu values that render a full page instead of a tab: the drawer swaps
 * its account header for a back button and the title below, and renders that
 * page in place of the wallet menu. Keyed by the `tab` value that opens it.
 *
 * `parent` makes Back walk one level up the stack instead of all the way out to
 * the tab the user came in from; a page without one returns to that tab.
 *
 * Deliberately its own module: this is drawer chrome, and the pages behind these
 * keys live in different places — Settings and Deposit inside the wallet menu
 * card, Bridge in its own self-contained screen with its own web3 provider.
 */
export const WALLET_MENU_SUB_PAGES: Record<string, { title: string; parent?: string }> = {
  settings: { title: "Settings" },
  deposit: { title: "Deposit" },
  bridge: { title: "Bridge", parent: "deposit" },
  "bridge-history": { title: "Bridge history", parent: "bridge" },
};

/** The `tab` values the bridge screen owns — everything under `bridge`. */
export const BRIDGE_TABS = ["bridge", "bridge-history"] as const;
export type BridgeTab = (typeof BRIDGE_TABS)[number];

export function isBridgeTab(tab: string): tab is BridgeTab {
  return (BRIDGE_TABS as readonly string[]).includes(tab);
}

/** Pages the wallet menu card renders itself; anything else needs its own screen. */
export function isWalletMenuCardTab(tab: string): boolean {
  return !isBridgeTab(tab);
}
