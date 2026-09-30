/**
 * Wallet-menu screens reached from the account dropdown rather than the tab
 * strip. They take over the whole card and replace the account header with a
 * Back button and the title below, so the drawer and the card have to agree on
 * which tab values are one of these — hence one list, not a condition in each.
 */
export const FLUENT_WALLET_MENU_DETAIL_TITLES = {
  settings: "Settings",
  history: "Transaction history",
} as const;

export type FluentWalletMenuDetailTab = keyof typeof FLUENT_WALLET_MENU_DETAIL_TITLES;

/** The screen's title, or null when `tab` is an ordinary tab-strip tab. */
export function fluentWalletMenuDetailTitle(tab: string): string | null {
  return FLUENT_WALLET_MENU_DETAIL_TITLES[tab as FluentWalletMenuDetailTab] ?? null;
}
