// Shared by the page and the dev-server "App backend" — the values an App pins.

/** "Auth demo" — the dev App with auth enabled, `http://localhost:5173` registered, scope `addresses`. */
export const APP_ID = "app_8908941315934a06b738c6804ce26132";

/** The same App's Privy app client — login configuration, never the token audience. */
export const PRIVY_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";

/** Pinned, as an App backend would pin it — never read from the token. */
export const FLUENT_AUTH_ISSUER = "https://api.fluent-connect.dev.gblend.xyz";
