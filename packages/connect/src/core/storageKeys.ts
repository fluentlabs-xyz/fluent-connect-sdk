export const FLUENT_WIDGET_SESSION_STORAGE_KEY = "fluent:widget:session:v1";

/**
 * Tokens the user added by hand. Keyed per chain inside the payload, not per
 * account: one person holds both a Fluent ID and possibly an external wallet
 * and switches between them, and their list should not appear to vanish when
 * they disconnect one.
 */
export const FLUENT_WIDGET_USER_TOKENS_STORAGE_KEY = "fluent:widget:tokens:v1";
