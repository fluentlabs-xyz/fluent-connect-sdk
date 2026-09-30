// UI intent only: never store a token, credential, or authorization here.
export const inlineOAuthKey = "fluent:inline-oauth:v1";
export function hasPendingInlineOAuth(): boolean {
  try {
    const started = Number(window.sessionStorage.getItem(inlineOAuthKey));
    const age = Date.now() - started;
    return started > 0 && age >= 0 && age < 600_000;
  } catch {
    return false;
  }
}
export function clearInlineOAuth() {
  try {
    window.sessionStorage.removeItem(inlineOAuthKey);
  } catch {
    /* Storage may be disabled. */
  }
}
