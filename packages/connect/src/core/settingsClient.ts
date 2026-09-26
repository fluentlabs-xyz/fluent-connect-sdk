import type { FluentTokenDefinition } from "@fluent.xyz/connect-sdk";

import { HttpError, requestJson } from "../utils/postJson";
import { FluentAuthError } from "./authToken";
import { validateUserToken } from "./userTokens";

/**
 * Codes fluent-connect-service returns on the `/me` routes (FLU-1481), plus the
 * one the client mints when the failure never reached the service.
 */
export type FluentSettingsErrorCode =
  | "invalid_request"
  | "invalid_token"
  | "at_capacity"
  | "internal"
  | "request_failed";

export class FluentSettingsError extends Error {
  constructor(
    readonly code: FluentSettingsErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FluentSettingsError";
  }
}

/** The three values the service keeps per person. */
export type FluentUserSettings = {
  quickSign: boolean;
  /** `null` means "no choice stored"; the widget's own default applies. */
  gasTokenSymbol: string | null;
  /** Every chain the person has tokens on; callers filter by chain themselves. */
  tokens: FluentTokenDefinition[];
};

export type FluentUserSettingsPatch = {
  quickSign?: boolean;
  gasTokenSymbol?: string | null;
};

export type FluentSettingsClient = {
  read(): Promise<FluentUserSettings>;
  /** At least one field; the service refuses an empty or unknown-field body. */
  patch(patch: FluentUserSettingsPatch): Promise<FluentUserSettings>;
  putToken(token: FluentTokenDefinition): Promise<void>;
  deleteToken(token: Pick<FluentTokenDefinition, "chainId" | "address">): Promise<void>;
};

type WireSettings = {
  quick_sign?: unknown;
  gas_token_symbol?: unknown;
  tokens?: unknown;
};

type WireToken = {
  chain_id?: unknown;
  address?: unknown;
  symbol?: unknown;
  name?: unknown;
  decimals?: unknown;
};

/**
 * Built the same way as `toAuthError` in `authToken.ts`: the service's own code
 * survives, anything else becomes `request_failed`. A `FluentAuthError` passes
 * straight through, so a caller can tell "the widget holds no Fluent token"
 * from "the service refused the one it holds".
 */
function toSettingsError(err: unknown): FluentAuthError | FluentSettingsError {
  if (err instanceof FluentAuthError) return err;
  if (err instanceof FluentSettingsError) return err;
  if (err instanceof HttpError) {
    const code = (err.body?.code ?? "request_failed") as FluentSettingsErrorCode;
    return new FluentSettingsError(code, err.message, err.status);
  }
  return new FluentSettingsError("request_failed", err instanceof Error ? err.message : String(err));
}

function toUserSettings(wire: WireSettings | undefined): FluentUserSettings {
  const tokens: FluentTokenDefinition[] = [];
  const wireTokens = Array.isArray(wire?.tokens) ? (wire.tokens as WireToken[]) : [];
  for (const entry of wireTokens) {
    // Validated with the same rule as a stored entry: the service's rows are
    // somebody's `PUT` bodies, and this list is rendered next to Fluent's own.
    const token = validateUserToken({
      chainId: entry?.chain_id,
      address: entry?.address,
      symbol: entry?.symbol,
      name: entry?.name,
      decimals: entry?.decimals,
    });
    if (token) tokens.push(token);
  }

  return {
    // A person with nothing stored gets `{ true, null, [] }`, which is also
    // what a malformed answer should degrade to rather than throwing.
    quickSign: typeof wire?.quick_sign === "boolean" ? wire.quick_sign : true,
    gasTokenSymbol:
      typeof wire?.gas_token_symbol === "string" && wire.gas_token_symbol.length > 0
        ? wire.gas_token_symbol
        : null,
    tokens,
  };
}

/**
 * The widget's own client for `GET/PATCH /me/settings` and
 * `PUT/DELETE /me/tokens/{chain_id}/{address}`.
 *
 * Every request carries the Fluent token from `getAuthToken()` and nothing
 * else: the token names the person, so no route here carries a Privy DID, a
 * subject or a uuid.
 */
export function createFluentSettingsClient(params: {
  /** Already ends in `/api/v1`. */
  publicApiUrl: string;
  getAuthToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
}): FluentSettingsClient {
  const base = params.publicApiUrl.replace(/\/+$/, "");

  const call = async <T>(path: string, options: { method: string; body?: unknown }): Promise<T> => {
    try {
      const token = await params.getAuthToken();
      return await requestJson<T>(`${base}${path}`, {
        method: options.method,
        headers: { Authorization: `Bearer ${token}` },
        body: options.body,
        fetch: params.fetch,
      });
    } catch (err) {
      throw toSettingsError(err);
    }
  };

  const tokenPath = (token: Pick<FluentTokenDefinition, "chainId" | "address">) =>
    `/me/tokens/${token.chainId}/${token.address ?? ""}`;

  return {
    async read() {
      return toUserSettings(await call<WireSettings>("/me/settings", { method: "GET" }));
    },

    async patch(patch) {
      const body: Record<string, unknown> = {};
      if (patch.quickSign !== undefined) body.quick_sign = patch.quickSign;
      if (patch.gasTokenSymbol !== undefined) body.gas_token_symbol = patch.gasTokenSymbol;
      if (Object.keys(body).length === 0) {
        throw new FluentSettingsError("invalid_request", "A settings patch needs at least one field.");
      }
      return toUserSettings(await call<WireSettings>("/me/settings", { method: "PATCH", body }));
    },

    async putToken(token) {
      await call<unknown>(tokenPath(token), {
        method: "PUT",
        body: { symbol: token.symbol, name: token.name, decimals: token.decimals },
      });
    },

    async deleteToken(token) {
      await call<unknown>(tokenPath(token), { method: "DELETE" });
    },
  };
}
