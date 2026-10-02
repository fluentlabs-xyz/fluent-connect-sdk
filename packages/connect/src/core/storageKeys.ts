export const FLUENT_WIDGET_SESSION_STORAGE_KEY = "fluent:widget:session:v1";

/**
 * Tokens the user added by hand, in the states where no Fluent token can exist:
 * hosted mode with a Fluent ID, and the not-connected state. Everywhere
 * `getAuthToken()` resolves, the service holds the list per person and this key
 * is not read (ADR 0004).
 *
 * Keyed per chain inside the payload, not per account: one person holds both a
 * Fluent ID and possibly an external wallet and switches between them, and
 * their list should not appear to vanish when they disconnect one.
 */
export const FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY = "fluent:widget:tokens:v1";

/**
 * Set while the one-time import of the local token list is in flight, and
 * removed with the list itself once every entry is on the service. It is what
 * tells a resumed import from a person who simply already had a list there.
 *
 * Its value is the subject whose import stopped halfway, not a flag: this key is
 * per browser, and the next person to sign in here must not have another's
 * leftovers pushed into their list (ADR 0004).
 */
export const FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY = "fluent:widget:tokens-import:v1";

/**
 * Prefix of the key one person's Refresh credential is kept under, at one App, at one service.
 * The rest of the key is `authTokenCacheKey` — `(publicApiUrl, appId, subject)` — so a token
 * minted for one audience can never be presented for another, and two people sharing a browser
 * never read each other's session (ADR 0013, §Origin binding).
 *
 * This is the one long-lived secret the widget writes to `localStorage`, and `localStorage` is
 * readable by any script the page runs: an XSS on the host page can take it, and neither
 * rotation nor the service's origin binding removes that. It is the tradeoff the parent Issue's
 * DECISION comment takes explicitly, in exchange for a session that survives a reload without a
 * second wallet signature.
 */
export const FLUENT_WIDGET_REFRESH_CREDENTIAL_STORAGE_PREFIX = "fluent:widget:refresh:v1";
