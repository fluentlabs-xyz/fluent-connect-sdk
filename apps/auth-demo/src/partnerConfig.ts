// Shared by the page and the dev-server "partner backend" — the values a partner pins.

/** "Auth demo" — the dev partner with auth enabled, `http://localhost:5173` registered, scope `addresses`. */
export const PARTNER_ID = "partner_8908941315934a06b738c6804ce26132";

/** The same partner's Privy app client — login configuration, never the token audience. */
export const PRIVY_CLIENT_ID = "client-WY6TBjkNm49yhyWAPjW4cj7z8NyqpvFvdiDrgxAtC7ht1";

/** Pinned, as a partner backend would pin it — never read from the token. */
export const FLUENT_AUTH_ISSUER = "https://api.fluent-connect.dev.gblend.xyz";
