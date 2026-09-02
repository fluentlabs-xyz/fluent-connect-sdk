import { fluentTokenKey, type FluentTokenDefinition } from "./balances.js";

/**
 * Where a display token came from, ordered by how much we trust it. See
 * docs/adr/0002-user-tokens-are-stored-locally-behind-an-interface.md.
 */
export type FluentTokenSource = "curated" | "integrator" | "user";

export type FluentDisplayToken = FluentTokenDefinition & {
  source: FluentTokenSource;
};

/**
 * Combine the three token sources into the list the widget renders.
 *
 * Duplicates are resolved by identity, never by symbol, and the more trusted
 * source wins: a token a user added by hand is superseded once we ship it as
 * curated, taking our name and logo with it. The user's stored record is only
 * shadowed here — callers must not delete it, so that dropping a token from the
 * curated set brings their entry back rather than destroying it.
 */
export function mergeFluentDisplayTokens(params: {
  curated: readonly FluentTokenDefinition[];
  integrator?: readonly FluentTokenDefinition[];
  user?: readonly FluentTokenDefinition[];
}): FluentDisplayToken[] {
  const merged: FluentDisplayToken[] = [];
  const seen = new Set<string>();

  const take = (tokens: readonly FluentTokenDefinition[], source: FluentTokenSource) => {
    for (const token of tokens) {
      const key = fluentTokenKey(token);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...token, source });
    }
  };

  take(params.curated, "curated");
  take(params.integrator ?? [], "integrator");
  take(params.user ?? [], "user");

  return merged;
}

/**
 * Symbols in `tokens` that more than one token claims. The widget shows the
 * address on every row regardless, but a collision is worth calling out loudly:
 * it is the cheap way to pass a worthless token off as a valuable one.
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
