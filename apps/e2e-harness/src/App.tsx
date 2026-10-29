import { FluentWidget, type FluentWidgetConfig } from "@fluent.xyz/connect";
import { useState } from "react";
import { createFakePrivyAdapter } from "./fakePrivy";

/**
 * The page's query string is the scenario: `?signedInAs=<email>` starts with that
 * person already signed in, and no query starts signed out.
 */
const params = new URLSearchParams(location.search);

const config: FluentWidgetConfig = {
  // Never reaches a service: every request this page makes is answered by the test.
  appId: "app_e2e00000000000000000000000000000",
  privyClientId: "client-e2e",
  network: "testnet",
  appName: "E2E Harness",
  disableAnalytics: true,
};

export default function App() {
  const [adapter] = useState(() =>
    createFakePrivyAdapter({
      signedInAs: params.get("signedInAs") ?? undefined,
      chainId: 20994,
    }),
  );

  return (
    <main>
      <h1>Fluent widget E2E harness</h1>
      <FluentWidget config={config} privyAdapter={adapter} />
    </main>
  );
}
