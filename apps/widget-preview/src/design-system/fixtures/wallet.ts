import type { FluentExternalWalletState, FluentWalletChoice } from "@fluent.xyz/connect";

import { SAMPLE_CUSTOM_LOGO } from "../../previewAvatars";
import { noop } from "./config";

const never = () => Promise.resolve();

/** Two injected wallets and a hand-off to the WalletConnect QR. */
export const walletChoices: FluentWalletChoice[] = [
  { id: "metamask", name: "MetaMask", icon: SAMPLE_CUSTOM_LOGO },
  { id: "rabby", name: "Rabby" },
  { id: "walletconnect", name: "WalletConnect", handoff: true },
];

/** A configured, disconnected wallet bridge with inline choices. */
export const walletState: FluentExternalWalletState = {
  configured: true,
  connected: false,
  choices: walletChoices,
  connectChoice: never,
  open: noop,
  disconnect: noop,
  switchChain: never,
};

/** Configured, but the host offers nothing to pick. */
export const emptyWalletState: FluentExternalWalletState = {
  ...walletState,
  choices: [],
};

/** No WalletConnect project: the link is disabled and the warning shows. */
export const unconfiguredWalletState: FluentExternalWalletState = {
  ...walletState,
  configured: false,
  choices: undefined,
  connectChoice: undefined,
};

/** A connected External wallet, as the debug panel prints it. */
export const connectedWalletState: FluentExternalWalletState = {
  ...walletState,
  connected: true,
  address: "0xdC9BF18a1c307ce1A84e2775C7645e57eB373CD4",
  chainId: 20994,
};
