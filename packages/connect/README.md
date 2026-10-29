# `@fluent.xyz/connect`

A React widget and hooks that give an App a Fluent ID smart account on Fluent: Direct login to a
Fluent ID or a connected External wallet, the account's balances, and Batch operations with
gas-sponsored execution. It is for React Apps (React 18 or later) only.

## Install

```bash
pnpm add @fluent.xyz/connect @tanstack/react-query react react-dom viem wagmi
```

The five peers are peers so that your App and the widget share one copy of each. You also need
an `appId` and a `privyClientId` from Fluent, your page origins allow-listed for Direct login,
and, for sponsored operations, the App enabled for Sponsorship and Auth tokens: see
[docs/getting-started.md](docs/getting-started.md).

## Quickstart

```tsx
import "@fluent.xyz/connect/styles.css";
import {
  FluentReviewRejectedError,
  FluentWidget,
  useFluentWidget,
  type FluentWidgetConfig,
} from "@fluent.xyz/connect";
import { useState } from "react";
import { erc20Abi, parseUnits } from "viem";

const config: FluentWidgetConfig = {
  appId: "app_0123456789abcdef0123456789abcdef",
  privyClientId: "client-0123456789abcdef",
  network: "testnet",
};

// Placeholders: your token's address and the recipient's.
const TOKEN = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";

function App() {
  const { status, widget } = useFluentWidget();
  const [message, setMessage] = useState("");
  if (status !== "connected") return <p>Connect to continue.</p>;

  async function send() {
    const amount = parseUnits("1", 18);
    try {
      const result = await widget
        .createBatchOp({
          calls: [{ to: TOKEN, abi: erc20Abi, method: "transfer", args: [RECIPIENT, amount] }],
        })
        .execute();
      setMessage("Sent: " + result.hash);
    } catch (error) {
      const dismissed =
        error instanceof FluentReviewRejectedError &&
        error.code === "transaction_review_rejected";
      setMessage(dismissed ? "You dismissed the Review." : "The operation failed.");
    }
  }

  return (
    <main>
      <p>Your account: {widget.account.address}</p>
      <button type="button" onClick={send}>
        Send 1 token
      </button>
      <p>{message}</p>
    </main>
  );
}

export function Root() {
  return <FluentWidget config={config} mode="page" renderPage={() => <App />} />;
}
```

`network` is required and has no default: pass `"testnet"` or `"mainnet"` as a literal for each
deployment. `execute()` resolves once the Batch operation is included. Whether a Fluent ID's
operation shows the widget's Review depends on Quick sign, `confirmation` and
`quickSign.whitelistAddresses` ([docs/concepts.md](docs/concepts.md#prompt-mode-and-silent-mode)).
When the person dismisses the widget's Review (shown for a Fluent ID in Prompt mode), it rejects
with `FluentReviewRejectedError`, whose `code` is `"transaction_review_rejected"`; an External
wallet's own prompt rejects with the wallet's error. Branch on the class and the `code`, not on
the message. Keep a `default` branch in any `switch` over a code or status union: a later
release may add a value. Every code is listed in [docs/errors.md](docs/errors.md).

## Documentation

- [docs/getting-started.md](docs/getting-started.md): what to ask Fluent for, install, Network,
  mounting the widget, the connect button, reading the account.
- [docs/concepts.md](docs/concepts.md): Fluent ID, External wallet, Widget account, Widget
  session, Review, Quick sign, Sponsorship and the other terms.
- [docs/configuration.md](docs/configuration.md): the options of `config` and the props of
  `<FluentWidget>`.
- [docs/guides/transactions.md](docs/guides/transactions.md): Batch operations, Gas payment and
  Sponsorship.
- [docs/guides/sponsorship.md](docs/guides/sponsorship.md): Sponsorship flow by flow, reading
  `sponsored`, and why an operation was not sponsored.
- [docs/guides/signing.md](docs/guides/signing.md): message and typed-data signatures.
- [docs/guides/backend-auth.md](docs/guides/backend-auth.md): Auth tokens and verifying them on
  your backend.
- [docs/guides/link-x.md](docs/guides/link-x.md): linking an X account.
- [docs/guides/iframe.md](docs/guides/iframe.md): the Iframe bridge for a page your App embeds.
- [docs/errors.md](docs/errors.md): every error class and `code`, and how to branch on them.
- [docs/experimental.md](docs/experimental.md): what may change or be removed in a minor
  release.
- [docs/api.md](docs/api.md): the reference of every export.

Upgrading from 0.5: [docs/upgrading-0.5.md](docs/upgrading-0.5.md)

## License

Apache-2.0
