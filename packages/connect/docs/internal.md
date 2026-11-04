# Internal entry

> **Nothing on this page is promised.** `@fluent.xyz/connect/internal` is the Internal entry:
> the helpers the widget is built from, importable by name. Any of them may change or go in any
> release, a patch included, and none is in [api.md](api.md). The root entry,
> `@fluent.xyz/connect`, is what is kept after 0.6.0; [experimental.md](experimental.md) says
> which of its names may still change. Import from here only where you can read this page at
> every upgrade.

The entry exists so that an App which needs the widget's own helpers, such as a wallet
dashboard that reads balances or builds a transfer without the widget's Send form, imports them
instead of copying their source, which drifts from the SDK silently. A name an App comes to rely
on is moved to the root entry, where it becomes a promise; ask for it.

| Name | What it is |
|---|---|
| `fluentTestnetTokenDefaults`, `fluentMainnetTokenDefaults`, `getFluentTokenDefaultsForNetwork` | The Default tokens of a Network, by symbol. |
| `getFluentDefaultWidgetDisplayTokens` | The Default tokens in the order the widget shows them. |
| `isFluentNativeToken`, `fluentTokenIdentity` | Whether a token is the chain's own currency; a token's Token identity. |
| `readFluentTokenBalances`, `FluentTokenBalance` | One account's balance of each token, read through a viem public client. |
| `FluentTokenDefinition` | The widget's own token shape, with `native` and `gasPriority`; see below. |
| `parseFluentTransferRecipient`, `parseFluentTransferAmount`, `FluentTransferRecipient`, `FluentTransferAmount` | The validation of the widget's Send form: a recipient, an amount. |
| `buildFluentTransferCall`, `fluentTransferAbi` | The one call of a Batch operation that moves a token, and the ERC-20 ABI it encodes with. |
| `isFaucetNetwork`, `getFluentExplorerBaseUrl` | Whether a Network has a faucet; its block explorer URL. |
| `normalizeFluentWidgetNetwork` | The Network an App's own setting names (`"prod"`, `"Development"`, …), or `undefined`; the widget reads no environment variable, so the App passes the result as `network`. |
| `createFluentFamiliesClient`, `FluentFamilies`, `FluentFamily`, `FluentFamilyTier`, `FluentFamilyType`, `FluentFamiliesClient`, `FluentFamiliesClientConfig` | A client of the service's families endpoint, read by the person's Privy DID. |
| `buildFluentBridgeUrl` | The portal bridge URL with a recipient, for an App that links out to the bridge. |

## Two `FluentTokenDefinition`s

The root entry's `FluentTokenDefinition` is an Integrator token: what an App passes in `tokens`,
with no `native` and no `gasPriority`, because the widget grants neither to a token it did not
declare itself. The Internal entry's `FluentTokenDefinition` is a Default token as the widget
declares it, and carries both; the helpers above take and return that one. An App that imports
both renames one:

```ts
import type { FluentTokenDefinition } from "@fluent.xyz/connect";
import type { FluentTokenDefinition as FluentDefaultToken } from "@fluent.xyz/connect/internal";

export function isNative(token: FluentDefaultToken): boolean {
  return token.native === true;
}

export function integratorToken(token: FluentDefaultToken): FluentTokenDefinition {
  const { native: _native, gasPriority: _gasPriority, ...rest } = token;
  return rest;
}
```

## Reading balances

```ts
import { createPublicClient, http, type Address } from "viem";
import { fluentTestnet } from "@fluent.xyz/connect";
import {
  getFluentDefaultWidgetDisplayTokens,
  readFluentTokenBalances,
} from "@fluent.xyz/connect/internal";

const client = createPublicClient({ chain: fluentTestnet, transport: http() });

export async function balancesOf(account: Address) {
  const balances = await readFluentTokenBalances({
    client,
    account,
    tokens: getFluentDefaultWidgetDisplayTokens("testnet"),
  });
  return balances.filter((balance) => balance.status === "ready");
}
```

## Building a transfer

The call goes to the Widget API's `execute()` like any other; the widget's Send form does the
same.

```ts
import type { FluentBatchCallInput } from "@fluent.xyz/connect";
import {
  buildFluentTransferCall,
  fluentMainnetTokenDefaults,
  parseFluentTransferAmount,
  parseFluentTransferRecipient,
} from "@fluent.xyz/connect/internal";

export function transferCall(params: {
  from: `0x${string}`;
  to: string;
  amount: string;
  balance: bigint;
}): FluentBatchCallInput | string {
  const token = fluentMainnetTokenDefaults.BLEND;
  const recipient = parseFluentTransferRecipient({
    input: params.to,
    self: params.from,
    contracts: new Set([token.address.toLowerCase()]),
  });
  if (recipient.status !== "ok") return recipient.status === "empty" ? "" : recipient.message;
  const amount = parseFluentTransferAmount({
    input: params.amount,
    symbol: token.symbol,
    decimals: token.decimals,
    balance: params.balance,
  });
  if (amount.status !== "ok") return amount.status === "empty" ? "" : amount.message;
  return buildFluentTransferCall({ token, to: recipient.address, amount: amount.raw });
}
```
