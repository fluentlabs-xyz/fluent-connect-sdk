# Errors

Every error the widget hands an App on purpose is an instance of one of five classes, each with
a string `code`. This page lists every code of each class, the call that throws it today, what it
means and what to do. The [API reference](api.md#auth-and-errors) holds the declarations.

## How to branch

Check the class with `instanceof`, then `switch` on `code`. Keep a `default` branch in every
`switch` over a code or status union: a later release may add a code, and a `switch` without a
`default` branch would then fall through in silence.

```ts
import {
  FluentAuthError,
  FluentReviewRejectedError,
  FluentSponsorshipFallbackError,
} from "@fluent.xyz/connect";

export function describeError(error: unknown): string {
  if (error instanceof FluentReviewRejectedError) return "You dismissed the request.";
  if (error instanceof FluentSponsorshipFallbackError) {
    switch (error.code) {
      case "unreachable":
        return "The sponsorship service did not answer, and paying your own gas failed too.";
      default:
        return "The operation could not be sent.";
    }
  }
  if (error instanceof FluentAuthError) {
    switch (error.code) {
      case "not_connected":
        return "Connect first.";
      case "rate_limited":
        return "Too many requests; try again in a minute.";
      default:
        return `Sign-in failed (${error.code}).`;
    }
  }
  return "Something went wrong.";
}
```

An error a call does not list here (a wallet's own refusal, a reverted call, a network failure)
reaches the App as it was thrown: keep a fallback for it too. The exception is
[`FluentSponsorshipFallbackError`](#fluentsponsorshipfallbackerror), which wraps such errors.

The calls named in "Thrown by":

| Call | Where it is |
|---|---|
| `<FluentWidget>` | rendering the widget with its `config` |
| `execute()` | `widget.createBatchOp({ calls }).execute()` |
| `signMessage()`, `signTypedData()` | `widget.signMessage(…)`, `widget.signTypedData(…)` |
| `getAuthToken()`, `linkX()` | the render context, or `useFluentWidget()` |
| `useLinkX()` | its `linkX()`, which also keeps the error in `error` |

## `FluentWidgetConfigError`

Thrown during the render of `<FluentWidget>` when its `config` cannot be used, so the nearest
error boundary catches it. The config is resolved again on every render that passes a new
`config` object: keep `config` stable (a module constant or a memo). The message names the
option to fix. See [configuration.md](configuration.md).

| `code` | Thrown by | What it means | What to do |
|---|---|---|---|
| `missing_option` | `<FluentWidget>` | A required option is absent: `appId` or `privyClientId` absent or empty, or `network` `undefined` or `null` (an empty `network` is `invalid_option`). | Pass the option; `network` has no default. |
| `invalid_option` | `<FluentWidget>` | An option holds a value the widget cannot use: an `appId` or `privyClientId` of the wrong shape, a `network` other than `"testnet"` and `"mainnet"`, a `customOAuthRedirectUrl` that is not an absolute HTTPS URL, a `gasPayment.defaultToken` that names no Gas token of the Network, an `enabledAuthMethods` or `quickSign.whitelistAddresses` that is not a list, a `quickSign.whitelistAddresses` entry that is not an address, an `avatar.defaultLogoUrl` that is not a string. | Fix the value the message names. |
| `removed_option` | `<FluentWidget>` | An option an earlier release removed is still passed: `clientId`, `partnerId`, or an `authMode` other than `"direct"` (`"direct"` only logs a warning). | Remove the option. |
| `invalid_fee_source` | `<FluentWidget>` | The experimental `execution.feeSource` is neither `"chain"` nor `"bundler"`. | Fix it, or leave `execution` out. |
| `invalid_receipt_source` | `<FluentWidget>` | The experimental `execution.receiptSource` is neither `"chain"` nor `"bundler"`. | Fix it, or leave `execution` out. |
| `invalid_chain_check_before_sign` | `<FluentWidget>` | The experimental `execution.chainCheckBeforeSign` is not a boolean. | Fix it, or leave `execution` out. |

## `FluentAuthError`

A refused Auth token, signature or X link. `code` is a `FluentAuthErrorCode`; `status` is the
service's HTTP status when the service refused. Where the service answers with a code of its
own, this package names it here. A service code this package does not name arrives as
`service_refused` from `getAuthToken()`, and as `link_failed` from `linkX()`. Not every rejection
of `getAuthToken()` is a `FluentAuthError`: a failure to read a Fluent ID's Direct-login
credential arrives as it was thrown.

| `code` | Thrown by | What it means | What to do |
|---|---|---|---|
| `not_connected` | `getAuthToken()`, `signMessage()`, `signTypedData()` | No Widget account is connected, or an External wallet is connected but its client is not ready yet (for `getAuthToken()`, only when the call has to sign the Sign-in challenge). | Wait for `widget.account.executionReady` to be `true`, then call again. |
| `root_signer_required` | `signMessage()`, `signTypedData()` | Neither of a Fluent ID's signing paths signs with its root Signer. A guard: no configuration of the widget reaches it today. | Report it to Fluent. |
| `login_credential_missing` | `getAuthToken()` | A Fluent ID's Direct login left no credential in the page. | Ask the person to connect again. |
| `origin_mismatch` | `getAuthToken()` | The Sign-in challenge names an origin other than the page's, so the External wallet was not asked to sign. | Report it to Fluent with the page's origin. |
| `request_failed` | `getAuthToken()` | The request did not reach the service, its answer carried no code or no token, or the External wallet refused to sign the Sign-in challenge. | Retry once the network is back; when the person refused to sign, retrying prompts the wallet again. |
| `service_refused` | `getAuthToken()` | The service refused with a code this package does not name; the message carries that code. | Log the message and report it. |
| `unknown_app` | `getAuthToken()` | The service does not know the App's `appId`. | Check `appId`. |
| `app_not_auth_enabled` | `getAuthToken()` | Auth tokens are not enabled for the App. | Ask Fluent to enable them. |
| `origin_not_allowed` | `getAuthToken()` | The page's origin is not registered on the App. | Ask Fluent to add the origin. |
| `origin_missing` | `getAuthToken()` | The request carried no origin. | Call from a page, not from a worker or a server. |
| `bad_request` | `getAuthToken()`, `linkX()`, `useLinkX()` | The service refused the request body. | Report it to Fluent: the request is this package's. |
| `challenge_unknown` | `getAuthToken()` | The service does not know the Sign-in challenge the External wallet signed. | Call again. |
| `challenge_used` | `getAuthToken()` | The Sign-in challenge was already used. The call retries once with a fresh one, which prompts the External wallet again, and rejects with whatever the retry fails with. | Call again. |
| `challenge_expired` | `getAuthToken()` | The Sign-in challenge expired before it was signed. Retried once, as above. | Call again. |
| `app_mismatch` | `getAuthToken()` | The credential or challenge belongs to another App. | Check `appId`. |
| `invalid_signature` | `getAuthToken()` | The External wallet's signature over the Sign-in challenge does not verify. | Call again; a smart-contract wallet must be deployed to sign the Sign-in challenge. |
| `signature_prefix_rejected` | `getAuthToken()` | The External wallet signed with a prefix the service refuses. Retried once, as above. | Call again. |
| `address_already_linked` | `getAuthToken()` | The External wallet is already bound to another person. | Tell the person to use the account it is bound to. |
| `invalid_login_credential` | `getAuthToken()` | The service did not accept a Fluent ID's Direct-login credential. | Ask the person to connect again. |
| `no_signer` | `getAuthToken()` | The service finds no Signer for the Fluent ID. | Ask the person to connect again; report it if it persists. |
| `invalid_refresh_token` | none | Not delivered: when the service refuses the stored refresh credential, `getAuthToken()` forgets it and opens a new Service session within the same call, which can prompt an External wallet. | Nothing. |
| `refresh_token_reused` | none | Not delivered, for the same reason as `invalid_refresh_token`. | Nothing. |
| `rate_limited` | `getAuthToken()` | Too many requests. | Retry later. |
| `internal` | `getAuthToken()` | The service failed. | Retry later. |
| `not_authenticated` | `linkX()`, `useLinkX()` | No Fluent ID or External wallet is connected, or the External wallet's client is not ready yet. | Connect first, or wait and call again. |
| `user_rejected` | `linkX()`, `useLinkX()` | The person said no at X, closed the flow, or declined a signature the link needed. | Nothing; offer the button again. |
| `linked_to_another_user` | `linkX()`, `useLinkX()` | That X account is already linked to another person. | Tell the person. |
| `link_failed` | `linkX()`, `useLinkX()` | Anything else under the link, including a refusal from the Auth token it mints (its message is kept) and a link record left in the tab for another account, which is discarded. | Call again. |

`getAuthToken()` throws the codes of its rows today, and `linkX()` throws its five. A code a later
release adds arrives in the `default` branch. Keep a fallback outside the `instanceof` check too:
not every rejection is a `FluentAuthError`.

## `FluentReviewRejectedError`

The person dismissed a Review instead of confirming it. `review` is `"transaction"` or
`"signature"`, and `code` says the same as a `FluentReviewRejectedErrorCode`. When a Fluent ID
shows a Review is in [concepts.md](concepts.md#prompt-mode-and-silent-mode). A Review that a
newer one replaces, or that closes because the widget unmounts, rejects with a plain `Error`.

| `code` | Thrown by | What it means | What to do |
|---|---|---|---|
| `transaction_review_rejected` | `execute()` | The person dismissed the Review of a Batch operation. An External wallet shows its own prompt instead, and its refusal arrives as the wallet's error. | Nothing: the person said no. |
| `signature_review_rejected` | `signMessage()`, `signTypedData()` | The person dismissed the Review of a signature, which an External wallet always shows. | Nothing: the person said no. |

## `FluentSponsorshipFallbackError`

A Fluent ID's sponsored submission failed, and the own-gas submission after it failed too
([which failures become this error](guides/sponsorship.md#both-failed-fluentsponsorshipfallbackerror)).
`code` (equal to `sponsorshipReason`) says why the sponsored submission failed; `fallbackError`
is the own-gas submission's error, and `cause` the sponsored submission's.

| `code` | Thrown by | What it means | What to do |
|---|---|---|---|
| `denied` | `execute()` | Any failure of the sponsored submission the other codes do not name: the sponsorship service refused the operation, or the operation itself failed, for example a call that reverts. | Check the fallback's error in `fallbackError`: the account may lack the ETH to pay itself. |
| `unauthorized` | `execute()` | The sponsorship service refused the App (HTTP 403) or its Auth token (HTTP 401, also after one fresh token). | Ask Fluent whether Sponsorship is enabled for the App. |
| `unreachable` | `execute()` | The request to the sponsorship service failed with an HTTP status other than 401 and 403, or with none. | Retry later. |
| `no_token` | `execute()` | The service refused the Auth token, and minting a fresh one failed. | Retry; check that `getAuthToken()` works for this person. |
| `not_requested` | none | Never this error's code: it is the reason for an operation that did not ask for Sponsorship, which has no sponsored submission to fail. | Nothing. |

## `FluentUserOperationGasError`

*Experimental*: may change or be removed in a minor release, with the `userOperationGas` option
it belongs to ([experimental.md](experimental.md#useroperationgas)).

| `code` | Thrown by | What it means | What to do |
|---|---|---|---|
| `invalid_policy` | `execute()` | A `skipEstimation` policy cannot be used: `skipEstimation` is not a boolean, is combined with `callGasBuffer`, comes with fixed gas limits that are missing or out of range, or, for a Gas token payment, gives only one of the two paymaster gas limits. A bad `callGasLimit` or `callGasBuffer` without `skipEstimation` throws a plain `Error` instead. | Fix the option, or leave it out to let the widget estimate. |
| `paymaster_gas_mismatch` | `execute()` | With estimation skipped, the paymaster's authorization of a Gas token payment does not match the fixed gas limits. | Leave `userOperationGas` out for Gas token payments. |
