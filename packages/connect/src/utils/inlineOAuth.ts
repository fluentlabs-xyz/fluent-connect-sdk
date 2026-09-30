// UI intent only: never store a token, credential, or authorization here.
export const inlineOAuthKey = "fluent:inline-oauth:v1";
export type InlineOAuthProvider = "twitter" | "google";

export function hasPendingInlineOAuth(): boolean {
  return getPendingInlineOAuth() !== null;
}

export function getPendingInlineOAuth(): {
  started: number;
  provider: InlineOAuthProvider;
} | null {
  try {
    const saved: unknown = JSON.parse(
      window.sessionStorage.getItem(inlineOAuthKey) ?? "null",
    );
    // Older X redirects stored only a timestamp. Preserve their return flow.
    const intent =
      typeof saved === "number"
        ? { started: saved, provider: "twitter" }
        : saved;
    if (!intent || typeof intent !== "object") return null;
    const { started, provider } = intent as Record<string, unknown>;
    if (
      typeof started !== "number" ||
      (provider !== "twitter" && provider !== "google")
    )
      return null;
    const age = Date.now() - started;
    return started > 0 && age >= 0 && age < 600_000
      ? { started, provider }
      : null;
  } catch {
    return null;
  }
}
export function clearInlineOAuth() {
  try {
    window.sessionStorage.removeItem(inlineOAuthKey);
  } catch {
    /* Storage may be disabled. */
  }
}
