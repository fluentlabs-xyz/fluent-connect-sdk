# No `wallet_watchAsset`

`wallet_watchAsset` (EIP-747) looks like the obvious way to let users add tokens, and it will keep being proposed. It is a one-way call from dapp to wallet: it asks a connected wallet to show a token in *its own* UI, returns a boolean, and gives us nothing back — there is no way to read what tokens a user holds in their wallet. It is an export button, not a storage mechanism, so it cannot answer "where do the widget's tokens live".

It also does not work for our primary identity. A **Fluent ID** is a smart account with no EIP-1193 provider at all, so there is nothing to send the request to. The method is only callable when a user has connected an **External wallet**, which means the feature would be absent in exactly the default, email-login case the product is built around.

We may still add it later as a convenience for connected External wallets. It is not part of how the widget stores or lists tokens.
