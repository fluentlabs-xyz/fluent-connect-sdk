import { type FluentAppIdentity } from "@fluent.xyz/connect-sdk";
import { FluentWidgetSession } from "../const";

export function createMockHostedSession(params: {
  app: FluentAppIdentity;
  scopes: string[];
  userId: string;
  signerAddress?: `0x${string}`;
  smartAccountAddress?: `0x${string}`;
}): FluentWidgetSession {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: location.origin,
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
    user: { id: params.userId },
    wallet: {
      signerAddress: params.signerAddress,
      smartAccountAddress: params.smartAccountAddress,
    },
    scopes: params.scopes,
    issuedAt,
    metadata: {
      hosted: "true",
      mode: params.app.mode,
      origin: location.origin,
    },
  };
}
