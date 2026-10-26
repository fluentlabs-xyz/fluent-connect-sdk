# Fluent Connect integration guide

The guide moved to [`docs/`](docs/getting-started.md), shipped with the package. This page maps
each section of the old single-file guide to its new place; a link to one of its sections lands
here. Sections the table does not list (what the widget stores, where a send reads fees and
receipts, where the session is kept, the 0.4 upgrade notes) described internals and were dropped.

| Old section | Now |
|---|---|
| 1. Prerequisites | [Getting started: What you need from Fluent](docs/getting-started.md#what-you-need-from-fluent) |
| 2. Install; `Buffer` is provided for you | [Getting started: Install](docs/getting-started.md#install) |
| 3. Minimal setup; Networks and chain ids | [Getting started: Network](docs/getting-started.md#network), [Mount the widget](docs/getting-started.md#mount-the-widget) |
| 4. Config reference (`FluentWidgetConfig`) | [Configuration](docs/configuration.md#fluentwidgetconfig) |
| 4. Config errors | [Errors: `FluentWidgetConfigError`](docs/errors.md#fluentwidgetconfigerror) |
| 4. Capacitor OAuth | [Configuration: Capacitor and other web views](docs/configuration.md#capacitor-and-other-web-views) |
| 4. The section on Auth methods | [Configuration: Auth methods](docs/configuration.md#auth-methods) |
| 4. Account avatar | [Configuration: Account avatar and images](docs/configuration.md#account-avatar-and-images) |
| 5. Placing the connect button | [Getting started: The connect button](docs/getting-started.md#the-connect-button) |
| 6. Reading account state | [Getting started: Reading the account](docs/getting-started.md#reading-the-account) |
| 6. The props, the render context and the session | [API reference: `FluentWidgetProps`](docs/api.md#fluentwidgetprops), [`FluentWidgetRenderContext`](docs/api.md#fluentwidgetrendercontext), [`FluentWidgetSession`](docs/api.md#fluentwidgetsession) |
| 6. What an External wallet user sees in Settings | [Concepts: What differs by account kind](docs/concepts.md#what-differs-by-account-kind) |
| 7. Sending a transaction; Example: approve + deposit | [Transactions](docs/guides/transactions.md#building-and-executing), [the example](docs/guides/transactions.md#example-approve-and-deposit-in-one-batch-operation) |
| 7. Gas payment | [Transactions: Gas payment](docs/guides/transactions.md#gas-payment); Sponsorship and its fallback in [Sponsorship](docs/guides/sponsorship.md) |
| 7. What `execute()` rejects with | [Transactions: Rejections](docs/guides/transactions.md#rejections), [Errors](docs/errors.md#how-to-branch) |
| 7. Skipping UserOperation gas estimation | [Experimental: `userOperationGas`](docs/experimental.md#useroperationgas) |
| 7. Execution timing | [Experimental: `paymaster` and `timing`](docs/experimental.md#paymaster-and-timing) |
| 7. Always guard on `executionReady` | [Transactions: Building and executing](docs/guides/transactions.md#building-and-executing) |
| 7b. Requesting a signature | [Signing](docs/guides/signing.md#the-two-calls) |
| 7b. Verify with ERC-1271 / ERC-6492; EIP-2612 `permit` | [Signing: Verifying a signature](docs/guides/signing.md#verifying-a-signature) |
| 7c. Embedding a marketplace iframe | [Iframe](docs/guides/iframe.md#set-it-up) |
| 8. Auth, and how the Auth token renews itself | [Backend auth: Get an Auth token](docs/guides/backend-auth.md#get-an-auth-token), [Renewal](docs/guides/backend-auth.md#renewal) |
| 8. How Sponsorship authenticates with the Auth token | [Sponsorship: Before you start](docs/guides/sponsorship.md#before-you-start), [Backend auth: Sponsorship uses the same token](docs/guides/backend-auth.md#sponsorship-uses-the-same-token) |
| 8. What `getAuthToken()` rejects with | [Errors: `FluentAuthError`](docs/errors.md#fluentautherror) |
| 8b. Verify the token on your backend | [Backend auth: Verify the token on a backend](docs/guides/backend-auth.md#verify-the-token-on-a-backend) |
| 8c. Linking X | [Link X](docs/guides/link-x.md#the-call) |
| 8c. What it rejects with | [Link X: Rejections](docs/guides/link-x.md#rejections) |
| 8c. The sequence your backend sees | [Link X: The sequence](docs/guides/link-x.md#the-sequence) |
| 9. Peer dependencies; Provider model; Your own TanStack Query client | [Getting started: Install](docs/getting-started.md#install) |
| 9b. Debugging an integration | [Getting started: Debugging](docs/getting-started.md#debugging) |
| 10. Checklist | [Getting started: Checklist](docs/getting-started.md#checklist) |
| 11. Export reference | [API reference](docs/api.md) |
| Upgrading from 0.5 | [Upgrading from 0.5](docs/upgrading-0.5.md) |
