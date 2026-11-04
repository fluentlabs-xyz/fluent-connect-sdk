/**
 * The portal bridge URL with `recipient` as a query parameter, so the Deposit is credited to that
 * account; `bridgeUrl` itself when there is no recipient. A `bridgeUrl` the `URL` parser refuses
 * gets the parameter appended as text.
 */
export function buildFluentBridgeUrl(bridgeUrl: string, recipient?: string | null) {
  if (!recipient) return bridgeUrl;

  try {
    const url = new URL(bridgeUrl);
    url.searchParams.set("recipient", recipient);
    return url.toString();
  } catch {
    const join = bridgeUrl.includes("?") ? "&" : "?";
    return `${bridgeUrl}${join}recipient=${encodeURIComponent(recipient)}`;
  }
}
