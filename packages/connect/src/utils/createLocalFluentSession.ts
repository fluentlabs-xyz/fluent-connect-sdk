import type { FluentAppIdentity } from "@fluent.xyz/connect-sdk";
import type { FluentWidgetSession } from "../config";

export function createLocalFluentSession(params: {
  app: FluentAppIdentity;
  scopes: string[];
  userId: string;
  email?: string;
  signerAddress?: `0x${string}`;
  smartAccountAddress: `0x${string}`;
}): FluentWidgetSession {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: typeof location !== "undefined" ? location.origin : "fluent-local",
    aud: params.app.clientId ?? params.app.origin,
    sub: params.userId,
    app: params.app,
    scopes: params.scopes,
    iat: issuedAt,
  };

  return {
    app: params.app,
    clientId: params.app.clientId,
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
