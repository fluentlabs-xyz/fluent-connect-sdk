# Gas tokens are a property of a token, not a second list

The widget originally treated "token we show" and "token you can pay gas with" as one concept: every token list was filtered through the gas-payment whitelist, so any token outside it was silently dropped. That made an extensible token list impossible.

Splitting them naively produced the opposite problem — the same three tokens ended up declared in six places (definitions, display order, gas order, gas priority by symbol, icon map, paymaster addresses), and the two lists looked identical enough to invite someone to merge them back. So the split is expressed as data instead: a token definition carries an optional `gasPriority`, and both lists are derived from the single declaration in `balances.ts`.

## Consequences

Fee-token preference is **BLEND → USDnr → ETH**, which is what the `gasPriority`
numbers encode. The constant this replaced listed USDnr first while the widget
itself defaulted to BLEND, so the two disagreed; BLEND-first is the intended
order and settles it. Changing the preference means editing those numbers, not a
separate list.

Adding a token to the definitions shows it, gives it an icon and a USD price, and does **not** make it pay for gas. Payability needs `gasPriority`, and only after the ERC-20 paymaster has been configured for that token — which happens outside this repo. That asymmetry is the point: it is why the two lists are not one.

The lists hold the same three tokens today because everything Fluent ships happens to be payable. That is a coincidence of the current token set, not a reason to collapse the concepts.

The ZeroDev paymaster's own token map is derived from the same place. It used to be hand-written twice over (addresses in `network.ts`, addresses *and* decimals again in `zerodevPaymaster.ts`), which meant a token given a `gasPriority` would show up in the gas selector while the paymaster path stayed unaware of it — a broken UserOp rather than a missing row. Resolving an unknown symbol now throws instead of returning `undefined`, because the keys are no longer a literal union and every caller reaches straight for `.address`.

The one thing still declared per symbol is the icon map in `defaultTokens.ts`. That is presentation data with no place in the SDK, and getting it wrong degrades to a letter placeholder rather than breaking a transaction; a test asserts every shipped token has one.

`gasPriority` alone is not sufficient to make a token payable. `mergeFluentDisplayTokens` strips it — along with `native` — from every source but our own, so an untrusted token is structurally unable to pay gas rather than merely filtered out downstream; stripping happens *before* the identity key is computed, since `native` feeds into that key and a token claiming it would otherwise collide with the chain's own currency and vanish. `getFluentGasPaymentTokens` re-checks `isFluentDefaultToken` as a safety net for callers handed a raw list that never went through the merge.

The candidate list for resolving the selected fee token is always our own gas tokens, never the integrator prop. Matching against the prop let a builder passing `{ symbol: "BLEND", address: theirs }` redirect fees to their own contract; narrowing the prop instead produced an empty list whenever the prop held only the extra display tokens it is meant to hold, silently resolving every fee payment to `undefined`.

A Display token with no known USD price is still shown, with its balance, but contributes nothing to the portfolio total or PnL. Hiding priceless tokens would mean a user adds a token and cannot see it, which reads as a bug.

Tokens are identified by **Token identity** — chain plus contract address — not by symbol. Symbols are not unique, and the old symbol-keyed lookups (icons, prices, gas-token address resolution, and the native-token check) all had to move to identity-keyed ones. `FluentGasTokenSymbol` — named `FluentGasPaymentSymbol` when this was written — stopped being a union of three literals as a result; it is now `string`, because which tokens are payable is data.
