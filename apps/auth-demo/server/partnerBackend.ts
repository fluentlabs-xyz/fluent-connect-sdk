import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Plugin } from "vite";

import { CLIENT_ID, FLUENT_AUTH_ISSUER } from "../src/partnerConfig";

/**
 * The partner's backend, as small as it can be while still being one: it verifies the Fluent
 * token exactly once, keys its own user row on `sub`, and from then on trusts only its own
 * cookie. Nothing here talks to Fluent after `/api/login` returns — that is the point of the
 * demo. In-memory, dev server only; `vite build` ships without it.
 */
const jwks = createRemoteJWKSet(new URL(`${FLUENT_AUTH_ISSUER}/.well-known/jwks.json`));

type User = { sub: string; address?: string; logins: number };
const users = new Map<string, User>();
const sessions = new Map<string, string>(); // session id → sub

const COOKIE = "partner_session";

function readCookie(req: IncomingMessage) {
  const match = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match?.[1];
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function login(req: IncomingMessage, res: ServerResponse) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return json(res, 401, { error: "missing bearer token" });

  let sub: string | undefined;
  let address: string | undefined;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: FLUENT_AUTH_ISSUER,
      audience: CLIENT_ID,
      algorithms: ["ES256"],
    });
    sub = payload.sub;
    address = (payload.addresses as { account?: string } | undefined)?.account;
  } catch (err) {
    return json(res, 401, { error: `token rejected: ${err instanceof Error ? err.message : err}` });
  }
  if (!sub) return json(res, 401, { error: "token has no sub" });

  const user = users.get(sub) ?? { sub, logins: 0 };
  user.logins += 1;
  if (address) user.address = address;
  users.set(sub, user);

  const sessionId = randomBytes(16).toString("hex");
  sessions.set(sessionId, sub);
  res.setHeader("Set-Cookie", `${COOKIE}=${sessionId}; HttpOnly; Path=/; SameSite=Lax`);
  json(res, 200, { ok: true, user });
}

function me(req: IncomingMessage, res: ServerResponse) {
  const sub = sessions.get(readCookie(req) ?? "");
  const user = sub ? users.get(sub) : undefined;
  if (!user) return json(res, 401, { error: "no partner session — sign in first" });
  json(res, 200, { user });
}

function logout(req: IncomingMessage, res: ServerResponse) {
  sessions.delete(readCookie(req) ?? "");
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  json(res, 200, { ok: true });
}

export function partnerBackend(): Plugin {
  return {
    name: "auth-demo-partner-backend",
    configureServer(server) {
      server.middlewares.use("/api/login", (req, res, next) =>
        req.method === "POST" ? void login(req, res) : next(),
      );
      server.middlewares.use("/api/me", (req, res, next) =>
        req.method === "GET" ? me(req, res) : next(),
      );
      server.middlewares.use("/api/logout", (req, res, next) =>
        req.method === "POST" ? logout(req, res) : next(),
      );
    },
  };
}
