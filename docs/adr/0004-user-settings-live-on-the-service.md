# User settings live on the service, keyed per person

Supersedes [ADR 0002](0002-user-tokens-are-stored-locally-behind-an-interface.md), which deferred exactly this and kept the `UserTokenStore` interface so that the move would replace one implementation. It is now made: the user's Quick sign preference, their gas token and their hand-added tokens live on fluent-connect-service, keyed by the person the Fluent token names, and follow them between Apps, browsers and devices.

The routes are `GET`/`PATCH /me/settings` and `PUT`/`DELETE /me/tokens/{chain_id}/{address}`, all under the widget's `publicApiUrl`. Every request carries `Authorization: Bearer <Fluent token>` from `getAuthToken()` and nothing else.

## The token is the only identifier

No route the widget calls carries a Privy DID, a subject or a uuid. The service resolves the token's `(aud, sub)` to one person itself. Handing it an id would mean the widget deciding whose settings to read, in a page the App controls; the token is a credential the service minted, and it is the only thing here that can name a user safely.

The consequence is that the widget's storage key and the service's are different in kind. Ours is `(publicApiUrl, appId, subject)` — the same tuple `useAuthToken` caches a token under, because an App change or a service change must invalidate both. Theirs is the person, one row across every App. A person who signs in to two Apps sees one list.

## localStorage stays exactly where no token can exist

Two states cannot mint a Fluent token today:

- **Hosted mode with a Fluent ID.** Its Privy session lives on the Fluent authorize page, not in the App's page, so there is nothing to exchange; `getAuthToken()` rejects with `hosted_not_supported`. FLU-1438's hosted channel will change that, and when it does these users switch over with no further change here — the switch is "does `getAuthToken()` resolve", not a flag.
- **Nobody connected.** There is no person to key anything to.

In both, the widget keeps `createFluentUserTokenStore` over `fluent:widget:tokens:v1` and the in-memory preference defaults, behaving exactly as it did before. A read that fails for a reason waiting cannot fix — a 500, a rejected wallet challenge — falls back to the same place rather than showing an error the user can do nothing about.

## Considered options for the two preferences

**Per person, one value.** What we chose. Quick sign and the gas token are properties of how someone likes to transact, not of one App's page.

**Per person and App.** Rejected. It would mean a user turning Quick sign off in one place and being surprised by a popup-free signature in another, which is the failure mode the setting exists to prevent.

**Per chain, for the gas token.** Rejected for now. The symbol is validated against the active network's closed gas-token set on read (`resolveGasTokenSymbol`), so a symbol that means nothing on this network falls back to the widget's default instead of reaching transaction execution. Storing one per chain is a strictly larger shape we can move to without a migration.

## The one-time import

The local key is per browser origin with no user attached, so a server-side migration is impossible: the data is in users' browsers. Instead, after the first successful read for a person, when the service holds no tokens and the local key does, each valid entry is pushed through the backend store and the key is then removed.

It is resumable and it is bounded. A marker key, `fluent:widget:tokens-import:v1`, is written before the first write and removed with the token key once every entry has answered. Without the marker, a non-empty list on the service stops the import outright — that list is the person's own, and this browser's leftovers are not ours to merge into it. With it, a partial attempt resumes, because the only reason the service's list is non-empty is that we put it there. The marker's value is the subject that wrote it, not a flag: the token key belongs to a browser and the next person to sign in on it is not the one whose import stopped halfway, so only that subject may resume past a non-empty list. Entries that answer `invalid` are dropped rather than retried; `at-capacity` and network failures stop the run and leave the remainder under the key.

The cost is known and accepted: on a shared browser the first person to sign in inherits the other person's additions. That is what localStorage already does, and it happens once.

## Consequences

`UserTokenStore` is asynchronous — `list`, `add` and `remove` return promises. This is a breaking change for integrators who inject their own `userTokenStore`, released as 0.4.0. `add` gains a `{ status: "failed"; message }` result for the failures a network store has and a browser one does not; nothing is thrown out of `add` or `remove`, because a failed write in a wallet menu must not reach the host App as a rejection.

Writes are not queued offline. A failed write keeps the local value the user chose and shows a message; the next sign-in reads the service's value, which may differ. A token removed while the `DELETE` fails stays removed for the current widget session and comes back on the next sign-in. Both are deliberate: a retry queue would need its own persistence, its own ordering and its own conflict rules, for a corner of a wallet menu.

The trust ordering of ADR 0002 is untouched. Default > Integrator > User still decides what a duplicate identity renders as, and a token the service returns is validated with the same rule as a stored one before it is shown — those rows started life as somebody's `PUT` body.

Two tabs of one browser writing the same preference is last-write-wins on the service. Within one tab, writes to a preference are serialized and coalesced, so the value that lands last is the one the user picked last.
