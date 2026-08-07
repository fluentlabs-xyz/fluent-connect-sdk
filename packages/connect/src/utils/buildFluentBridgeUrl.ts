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
