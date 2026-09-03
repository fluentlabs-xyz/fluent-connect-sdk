import { fluentTokenIdentity, type FluentTokenDefinition } from "./balances.js";

/**
 * Where a display token came from, ordered by how much we trust it. See
 * docs/adr/0002-user-tokens-are-stored-locally-behind-an-interface.md.
 */
export type FluentTokenSource = "default" | "integrator" | "user";

export type FluentDisplayToken = FluentTokenDefinition & {
  source: FluentTokenSource;
  /** `fluentTokenIdentity` for this token, computed once here. */
  identity: string;
};

/**
 * Fields that grant a token a capability rather than describe it. They are
 * meaningful only on tokens Fluent ships, so they are dropped from every other
 * source instead of being filtered out downstream: an untrusted token should be
 * structurally unable to pay gas, not merely excluded by whoever remembers to
 * check.
 */
function withoutCapabilities(token: FluentTokenDefinition): FluentTokenDefinition {
  const { gasPriority: _gasPriority, native: _native, ...rest } = token;
  return rest;
}

/**
 * Combine the three token sources into the list the widget renders.
 *
 * Duplicates are resolved by identity, never by symbol, and the more trusted
 * source wins: a token a user added by hand is superseded once we ship it as
 * one of ours, taking our name and logo with it. The user's stored record is only
 * shadowed here — callers must not delete it, so that dropping a token from the
 * default set brings their entry back rather than destroying it.
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
