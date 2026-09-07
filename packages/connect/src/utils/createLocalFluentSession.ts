import type { FluentAppIdentity } from "@fluent.xyz/connect-sdk";
import type { FluentWidgetSession } from "../core/config";

export function createLocalFluentSession(params: {
  app: FluentAppIdentity;
  /** The token audience — `app.clientId` is the Privy client and must never land in `aud`. */
  partnerId: string;
  scopes: string[];
  userId: string;
  email?: string;
  signerAddress?: `0x${string}`;
  smartAccountAddress: `0x${string}`;
}): FluentWidgetSession {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: typeof location !== "undefined" ? location.origin : "fluent-local",
    aud: params.partnerId,
    sub: params.userId,
    app: params.app,
    scopes: params.scopes,
    iat: issuedAt,
  };

  return {
    app: params.app,
    partnerId: params.partnerId,
    idToken: `mock.${btoa(JSON.stringify(payload))}.signature`,
    user: {
      id: params.userId,
      email: params.email,
    },
    wallet: {
      signerAddress: params.signerAddress,
      smartAccountAddress: params.smartAccountAddress,
    },
    scopes: params.scopes,
    issuedAt,
    metadata: {
      authMode: "direct",
      origin: params.app.origin,
    },
  };
}
