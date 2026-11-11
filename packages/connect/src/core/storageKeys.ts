export const FLUENT_WIDGET_SESSION_STORAGE_KEY = "fluent:widget:session:v1";

/**
 * Where the User tokens are kept in the browser while no Auth token can exist: the
 * not-connected state. Wherever `getAuthToken()` resolves, the service holds the list per person
 * and the widget imports this key's entries into it (ADR 0004).
 *
 * One list per browser, each entry carrying its chain, not one per account: a person who holds a
 * Fluent ID and an External wallet and switches between them keeps the list when they disconnect
 * either.
 */
export const FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY = "fluent:widget:tokens:v1";

/**
 * Set while the one-time import of the browser's User tokens is in flight, and removed with the
 * list itself once every entry is on the service. It tells a resumed import from a person who
 * already had a list there.
 *
 * Its value is the subject whose import is in flight, not a flag: this key is per browser, and
 * the next person to sign in here must not have another's leftovers pushed into their list
 * (ADR 0004).
 */
export const FLUENT_WIDGET_USER_TOKENS_IMPORT_MARKER_KEY = "fluent:widget:tokens-import:v1";

/**
 * Prefix of the key the refresh credential of one person's Service session is kept under, at one
 * App and one service. The rest of the key is `authTokenCacheKey` (`publicApiUrl`, `appId`,
 * `subject`), so a credential minted for one audience is never read for another, and two people
 * sharing a browser never read each other's.
 *
 * This is the one long-lived secret the widget writes to `localStorage`, which any script the
 * page runs can read: an XSS on the App's page can take it, and neither rotation nor the
 * service's origin binding prevents that. The widget accepts that risk in exchange for a Service
 * session that survives a reload without a new sign-in.
 */
export const FLUENT_WIDGET_REFRESH_CREDENTIAL_STORAGE_PREFIX = "fluent:widget:refresh:v1";
