import {
  connectorsForWallets,
  getWalletConnectConnector,
  type WalletList,
} from "@rainbow-me/rainbowkit";
import { metaMaskWallet, rainbowWallet, trustWallet } from "@rainbow-me/rainbowkit/wallets";
import type { Config, Connector, CreateConnectorFn } from "wagmi";

/**
 * The wallets `BridgeWalletPicker` lists on a phone, where a browser has no extension to find.
 * There RainbowKit 2.2.8 lists only the connectors its `connectorsForWallets` built, and the
 * widget's wagmi config, which Reown's adapter builds for AppKit, holds none of those by itself,
 * so this module adds them. A desktop gets none of these: there RainbowKit lists the extensions
 * EIP-6963 announces under "Installed".
 */

type CreateWallet = WalletList[number]["wallets"][number];
type DeepLink = (uri: string) => string;

/** The mark RainbowKit 2.2.8 leaves on every connector `connectorsForWallets` builds. */
type RainbowKitConnector = Connector & {
  rkDetails?: { isRainbowKitConnector?: boolean };
};

/** The identity a wallet shows for a pairing; AppKit's `metadata` has the same shape. */
export type BridgeWalletMetadata = {
  name: string;
  description: string;
  url: string;
  icons: string[];
};

export type BridgeWalletConnectorsParams = {
  projectId: string;
  metadata: BridgeWalletMetadata;
};

/**
 * Reports whether `connector` is one of the picker's own, by the mark RainbowKit leaves on it.
 */
export function isBridgeWalletConnector(connector: Connector): boolean {
  return Boolean((connector as RainbowKitConnector).rkDetails?.isRainbowKitConnector);
}

/**
 * The wallets the picker adds, each reached over WalletConnect only and on a phone only: a tap
 * opens the wallet app on its own URL scheme, carrying the pairing URI. A scheme rather than the
 * wallet's universal link: the URI arrives after a relay round trip, and RainbowKit then opens
 * an `http` link from an anchor it clicks itself, which Safari on an iPhone does not open that
 * long after the tap, while it assigns a scheme to `location.href`, which needs no tap.
 * RainbowKit's own entries would switch to an injected or SDK connector where the wallet is
 * present, and those carry ids AppKit would list and set up at start, so each entry is pinned
 * to WalletConnect. They stay off a desktop: RainbowKit would offer them there as QR codes, and
 * its QR view does not render with the `qr` this repository resolves (`cuer` 0.0.2 asks it for
 * a border of 0, which `qr` 0.7.0 refuses).
 */
const WALLETS: Array<[CreateWallet, DeepLink]> = [
  [metaMaskWallet, (uri) => `metamask://wc?uri=${encodeURIComponent(uri)}`],
  [trustWallet, (uri) => `trust://wc?uri=${encodeURIComponent(uri)}`],
  [rainbowWallet, (uri) => `rainbow://wc?uri=${encodeURIComponent(uri)}&connector=rainbowkit`],
];

/**
 * Reports whether the user agent is Android or iOS: the test behind RainbowKit's own mobile list.
 */
function isPhone(): boolean {
  return typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

function walletConnectOnly(createWallet: CreateWallet, link: DeepLink): CreateWallet {
  return (params) => {
    const wallet = createWallet(params);
    return {
      ...wallet,
      installed: undefined,
      hidden: () => !isPhone(),
      mobile: { getUri: link },
      createConnector: getWalletConnectConnector({
        projectId: params.projectId,
        walletConnectParameters: params.walletConnectParameters,
      }),
    };
  };
}

/** Returns the picker's connectors, built the way RainbowKit's modal expects them. */
export function getBridgeWalletConnectors({
  projectId,
  metadata,
}: BridgeWalletConnectorsParams): CreateConnectorFn[] {
  return connectorsForWallets(
    [
      {
        groupName: "Popular",
        wallets: WALLETS.map(([createWallet, link]) => walletConnectOnly(createWallet, link)),
      },
    ],
    {
      projectId,
      appName: metadata.name,
      appDescription: metadata.description,
      appUrl: metadata.url,
      appIcon: metadata.icons[0],
      walletConnectParameters: { metadata },
    },
  );
}

const registered = new WeakSet<Config>();

/**
 * Adds the picker's connectors to the widget's wagmi config, once per config and after the
 * connectors AppKit set up at start, never in the config's initial list:
 *
 * - AppKit takes the first connector with the id `walletConnect` as its own (`getWagmiConnector`
 *   in `@reown/appkit-adapter-wagmi` 1.8.20), and RainbowKit's carry that id too. AppKit
 *   registers its own while `createAppKit` initializes, and this page opens only in the account
 *   drawer of a connected person, well after that, so appended here they come after it.
 * - wagmi's `walletConnect` connector starts its WalletConnect client in `setup()`, which runs at
 *   registration, and the three entries share one client, built from one RainbowKit
 *   `walletConnect` factory. Registered here, that client starts when a person opens this page,
 *   not at widget start for everyone, and wagmi's startup `reconnect` never sees these. The
 *   cost: a Deposit begun through one of them does not survive a reload of the page, and the
 *   person connects again.
 */
export function registerBridgeWalletConnectors(
  config: Config,
  params: BridgeWalletConnectorsParams,
): void {
  if (registered.has(config)) return;
  registered.add(config);
  const connectors = getBridgeWalletConnectors(params).map((createConnector) =>
    config._internal.connectors.setup(createConnector),
  );
  config._internal.connectors.setState((current) => [...current, ...connectors]);
}
