import {
  connectorsForWallets,
  getWalletConnectConnector,
  type WalletList,
} from "@rainbow-me/rainbowkit";
import { metaMaskWallet, rainbowWallet, trustWallet } from "@rainbow-me/rainbowkit/wallets";
import type { Config, Connector, CreateConnectorFn } from "wagmi";

/**
 * The wallets `BridgeWalletPicker` lists on a phone, where a browser has no
 * extension to find. RainbowKit 2.2.8 lists there only the connectors its
 * `connectorsForWallets` built, and the widget's wagmi config, which Reown's
 * adapter builds for AppKit, holds none of those by itself: the list was empty
 * and "Get a Wallet" the only way on. A desktop is not affected, and gets none
 * of these: there RainbowKit lists the extensions EIP-6963 announces under
 * "Installed".
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

/** True for a connector of the picker's own, which no other list of the widget shows. */
export function isBridgeWalletConnector(connector: Connector): boolean {
  return Boolean((connector as RainbowKitConnector).rkDetails?.isRainbowKitConnector);
}

/**
 * Each wallet reached over WalletConnect only, and on a phone only: a tap
 * opens the wallet app on its universal link carrying the pairing URI, the
 * link RainbowKit's own entry uses. RainbowKit's own entries would switch to
 * an injected or SDK connector where the wallet is present; those carry ids
 * AppKit would list and set up at start, so each entry is pinned to
 * WalletConnect here. A desktop keeps the picker it had: the extensions
 * EIP-6963 announces, under "Installed". RainbowKit would offer these entries
 * there as QR codes, and its QR view does not render with the `qr` this
 * repository resolves (`cuer` 0.0.2 asks it for a border of 0, which `qr`
 * 0.7.0 refuses), so they stay off a desktop.
 */
const WALLETS: Array<[CreateWallet, DeepLink]> = [
  [metaMaskWallet, (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`],
  [trustWallet, (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`],
  [
    rainbowWallet,
    (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}&connector=rainbowkit`,
  ],
];

/** The test behind RainbowKit's own choice of its mobile list: Android or iOS by user agent. */
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

/** The picker's connectors, built the way RainbowKit's modal expects them. */
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
 * Adds the picker's connectors to the widget's wagmi config, once per config
 * and after the connectors AppKit set up at start. They are kept out of the
 * config's initial list on purpose:
 *
 * - AppKit resolves its own WalletConnect connector as the first connector
 *   with the id `walletConnect` (`getWagmiConnector` in
 *   `@reown/appkit-adapter-wagmi` 1.8.20), and RainbowKit's carry that id too.
 *   Appended here they come after it: AppKit registers its own while
 *   `createAppKit` initializes (`syncConnectors`, then
 *   `createUniversalProviderForAdapter`), and this page opens only to a
 *   signed-in person, well after that.
 * - wagmi's `walletConnect` connector starts its WalletConnect client in
 *   `setup()`, which runs at registration, and the three entries share one
 *   client (RainbowKit builds them from one `walletConnect` factory, whose
 *   provider lives in the factory's closure). Registered here, that client
 *   starts when a signed-in person opens this page, not at widget start for
 *   everyone, and wagmi's startup `reconnect`, which calls `getProvider()` on
 *   every connector it is given, never sees these. The cost: a Deposit begun
 *   through one of them does not survive a reload of the page, and the person
 *   connects again.
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
