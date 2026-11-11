import { fluentTokenIdentity, type FluentTokenDefinition } from "./balances.js";

/**
 * The Token source of a Display token, from most to least trusted: `default`, `integrator`,
 * `user` (ADR 0002).
 */
export type FluentTokenSource = "default" | "integrator" | "user";

export type FluentDisplayToken = FluentTokenDefinition & {
  source: FluentTokenSource;
  /** The Token identity, computed once by `mergeFluentDisplayTokens` so readers need not. */
  identity: string;
};

/**
 * Returns `token` without `gasPriority` and `native`, the fields that grant a capability rather
 * than describe it. Only a Default token may hold them; dropping them here leaves a token of
 * another Token source unable to pay gas, whoever reads it later.
 */
function withoutCapabilities(token: FluentTokenDefinition): FluentTokenDefinition {
  const { gasPriority: _gasPriority, native: _native, ...rest } = token;
  return rest;
}

/**
 * Merges the three Token sources into the list the widget shows: Default tokens, then
 * Integrator tokens, then User tokens. A duplicate is resolved by Token identity, never by
 * symbol, and the more trusted source wins, its name and logo with it. A User token's stored
 * entry is only shadowed here; a caller must not delete it, so that the entry is listed again
 * if its Default token is removed.
 */
export function mergeFluentDisplayTokens(params: {
  defaults: readonly FluentTokenDefinition[];
  integrator?: readonly FluentTokenDefinition[];
  user?: readonly FluentTokenDefinition[];
}): FluentDisplayToken[] {
  const merged: FluentDisplayToken[] = [];
  const seen = new Set<string>();

  const take = (tokens: readonly FluentTokenDefinition[], source: FluentTokenSource) => {
    const trusted = source === "default";
    for (const raw of tokens) {
      // Capabilities are stripped *before* the key is computed: `native` feeds
      // into the identity, so a token claiming it would otherwise collide with
      // the chain's own currency and be deduped away instead of listed.
      const token = trusted ? raw : withoutCapabilities(raw);
      const identity = fluentTokenIdentity(token);
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push({ ...token, source, identity });
    }
  };

  take(params.defaults, "default");
  take(params.integrator ?? [], "integrator");
  take(params.user ?? [], "user");

  return merged;
}

/**
 * Returns the symbols, lowercased, that more than one of `tokens` claims. A shared symbol is the
 * cheap way to pass a worthless token off as a valuable one.
 */
export function findFluentSymbolCollisions(tokens: readonly FluentTokenDefinition[]) {
  const countBySymbol = new Map<string, number>();
  for (const token of tokens) {
    const symbol = token.symbol.toLowerCase();
    countBySymbol.set(symbol, (countBySymbol.get(symbol) ?? 0) + 1);
  }
  return new Set(
    [...countBySymbol.entries()].filter(([, count]) => count > 1).map(([symbol]) => symbol),
  );
}
