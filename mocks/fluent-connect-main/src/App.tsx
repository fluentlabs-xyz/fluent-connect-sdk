import { PrivyProvider } from "@privy-io/react-auth";
import { clearPrivyRecentLoginMethod } from "@fluent.xyz/connect";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { HostedAuthorizeContent } from "./components/HostedAuthorizeContent";
import { FLUENT_LOGO, PRIVY_APP_ID, hostedAuthorizePrivyConfig } from "./const";

function MainAppLanding() {
  return (
    <main className="authorize-page">
      <section className="authorize-panel">
        <img className="brand-logo" src={FLUENT_LOGO} alt="Fluent" />
        <p className="eyebrow">Fluent Connect Main App</p>
        <h1>Hosted authorization</h1>
        <p className="lead">
          This mock only represents the primary Fluent Connect redirect app. Builder demos live in
          dedicated apps under <code>apps/</code>.
        </p>
      </section>
    </main>
  );
}

export default function App() {
  const [privyEpoch, setPrivyEpoch] = useState(0);
  const pendingPrivyLoginRef = useRef(false);

  // Drop last-used promotion before Privy's mount effect reads storage.
  useLayoutEffect(() => {
    clearPrivyRecentLoginMethod(PRIVY_APP_ID);
  }, [privyEpoch]);

  const requestPrivyLogin = useCallback(() => {
    clearPrivyRecentLoginMethod(PRIVY_APP_ID);
    pendingPrivyLoginRef.current = true;
    setPrivyEpoch((value) => value + 1);
  }, []);

  if (location.pathname !== "/authorize") {
    return <MainAppLanding />;
  }

  return (
    <PrivyProvider
      key={privyEpoch}
      appId={PRIVY_APP_ID}
      config={hostedAuthorizePrivyConfig}
    >
      <HostedAuthorizeContent
        requestPrivyLogin={requestPrivyLogin}
        pendingPrivyLoginRef={pendingPrivyLoginRef}
      />
    </PrivyProvider>
  );
}
