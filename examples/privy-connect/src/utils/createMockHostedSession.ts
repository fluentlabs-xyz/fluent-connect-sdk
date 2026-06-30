import { FluentWidgetSession } from "../const";

export function createMockHostedSession(params: {
  clientId: string;
  scopes: string[];
  userId: string;
  signerAddress?: `0x${string}`;
}): FluentWidgetSession {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: location.origin,
    aud: params.clientId,
    sub: params.userId,
    scopes: params.scopes,
    iat: issuedAt,
  };

  return {
    clientId: params.clientId,
    idToken: `mock.${btoa(JSON.stringify(payload))}.signature`,
    user: { id: params.userId },
    wallet: {
      signerAddress: params.signerAddress,
    },
    scopes: params.scopes,
    issuedAt,
    metadata: {
      hosted: "true",
      origin: location.origin,
    },
  };
}