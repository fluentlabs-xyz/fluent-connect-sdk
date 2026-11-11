import coinbaseIcon from "./brand/coinbase.svg";
import fluentLogo from "./brand/fluent-logo.svg";
import metamaskIcon from "./brand/metamask.png";
import walletConnectIcon from "./brand/walletconnect.svg";

/**
 * The brand images built into the package: the default `FluentWidgetAssets`, so an App serves
 * none of them itself.
 */
export const FLUENT_CONNECT_BUNDLED_ASSETS = {
  fluentLogo,
  walletConnectIcon,
  metamaskIcon,
  coinbaseIcon,
} as const;
