/**
 * The App this demo signs in as. Defaults are the dev "ERC4626 vault" App from
 * `config.json`, which is registered on the testnet service and on the testnet
 * Privy app.
 *
 * A mainnet run needs both of these replaced, and replacing only one does not
 * work: the widget picks the Privy app id from its network (testnet and mainnet
 * are two different Privy apps), so a testnet client paired with the mainnet
 * Privy app leaves Privy unable to initialise — `usePrivy().ready` never turns
 * true and every sign-in button stays disabled.
 *
 * Set them in `apps/erc4626-vault/.env.local`, which git ignores, rather than in
 * `config.json`:
 *
 * ```
 * VITE_FLUENT_APP_ID=app_<32 hex>
 * VITE_PRIVY_CLIENT_ID=client-<...>
 * ```
 *
 * An empty string counts as unset, so a blank line in `.env.local` falls back to
 * the dev App instead of making the widget throw on an empty value.
 *
 * A leaf module with no SDK import, mirroring `apps/sponsorship-demo`: the env
 * read stays testable without pulling the widget in.
 */
import appConfig from "../config.json";

export const APP_ID: string = import.meta.env.VITE_FLUENT_APP_ID || appConfig.fluent.appId;

export const PRIVY_CLIENT_ID: string =
  import.meta.env.VITE_PRIVY_CLIENT_ID || appConfig.fluent.privyClientId;
