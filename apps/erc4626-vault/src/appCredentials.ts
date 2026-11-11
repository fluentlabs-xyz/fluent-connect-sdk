/**
 * The App this demo signs in as. The defaults are the dev "ERC4626 vault" App from
 * `config.json`, registered on the testnet service and the testnet Privy app.
 *
 * A mainnet run replaces both, as `VITE_FLUENT_APP_ID` and `VITE_PRIVY_CLIENT_ID` in
 * `apps/erc4626-vault/.env.local`: the widget picks the Privy app from its Network, so a
 * testnet client with the mainnet Privy app never initialises and every sign-in button stays
 * disabled. An empty value counts as unset. A leaf module with no SDK import, so the env read
 * is testable without the widget.
 */
import appConfig from "../config.json";

export const APP_ID: string = import.meta.env.VITE_FLUENT_APP_ID || appConfig.fluent.appId;

export const PRIVY_CLIENT_ID: string =
  import.meta.env.VITE_PRIVY_CLIENT_ID || appConfig.fluent.privyClientId;
