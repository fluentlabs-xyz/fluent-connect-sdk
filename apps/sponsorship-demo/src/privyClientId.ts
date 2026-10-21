/**
 * The Privy app client of the demo's App — login only, no longer the App's identity. The
 * default is the dev App's client, issued from the dev Privy app, and a mainnet run needs a
 * client of the production Privy app: set VITE_PRIVY_CLIENT_ID. The empty string counts as
 * unset, like the paymaster addresses in `consts.ts`: a `.env` line left blank falls back rather
 * than making the widget throw on a blank client.
 *
 * A leaf module with no SDK import, so a test of the env read loads in milliseconds instead of
 * pulling the widget and its dependencies in with `consts.ts`.
 */
export const PRIVY_CLIENT_ID: string =
  import.meta.env.VITE_PRIVY_CLIENT_ID || "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";
