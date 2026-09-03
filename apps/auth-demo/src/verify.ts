import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { PARTNER_ID, FLUENT_AUTH_ISSUER } from "./consts";

// Everything a partner backend needs: the issuer it pinned and its own partner id. No Fluent code.
const jwks = createRemoteJWKSet(new URL(`${FLUENT_AUTH_ISSUER}/.well-known/jwks.json`));

export type FluentClaims = JWTPayload & {
  scopes: string[];
  auth_method: "wallet" | "privy";
  addresses?: { account: string; signer?: string };
};

export async function verifyFluentToken(token: string): Promise<FluentClaims> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: FLUENT_AUTH_ISSUER,
    audience: PARTNER_ID,
    algorithms: ["ES256"],
  });
  return payload as FluentClaims;
}
