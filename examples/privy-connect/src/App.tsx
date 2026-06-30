import { PrivyProvider } from "@privy-io/react-auth";
import {
  ReownProvider,
  reownConfigured,
  useReownWallet,
} from "./reown-appkit";
import { HostedAuthorizeContent } from "./components/HostedAuthorizeContent";
import { SetupNotice } from "./components/SetupNotice";
import { ThirdPartyDemo } from "./components/ThirdPartyDemo";
import { PRIVY_APP_ID, hostedAuthorizePrivyConfig, FLUENT_LOGO } from "./const";

function ReownConnectedDemo({ view }: { view?: "home" | "chess" }) {
  const wallet = useReownWallet();

  return <ThirdPartyDemo wallet={wallet} view={view} />;
}

export default function App() {
  const hasAuthConfig = Boolean(PRIVY_APP_ID);
  const isAuthorize = location.pathname === "/authorize";
  const isChess = location.pathname === "/chess";

  if (isAuthorize) {
    return (
      <PrivyProvider appId={PRIVY_APP_ID} config={hostedAuthorizePrivyConfig}>
        <HostedAuthorizeContent />
      </PrivyProvider>
    );
  }

  return (
    <main className={isChess ? "main-chess" : undefined}>
      <header>
        <img className="brand-logo" src={FLUENT_LOGO} alt="Fluent" />
        {isChess ? (
          <>
            <p className="eyebrow">On-chain bot demo</p>
            <h1>Fluent Chess Blitz</h1>
            <p className="lead">
              Watch two permissioned bots play chess on Fluent Testnet with every move
              submitted as a fast BLEND-paid transaction.
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">Third-party BLEND app</p>
            <h1>Pay into Fluent with BLEND</h1>
            <p className="lead">
              A demo app that asks users to connect through Fluent, checks their BLEND
              balance on Fluent Testnet, and gates access behind a token payment.
            </p>
          </>
        )}
      </header>

      {!hasAuthConfig ? <SetupNotice /> : null}

      {hasAuthConfig ? (
        reownConfigured ? (
          <ReownProvider>
            <ReownConnectedDemo view={isChess ? "chess" : "home"} />
          </ReownProvider>
        ) : (
          <ThirdPartyDemo
            view={isChess ? "chess" : "home"}
            wallet={{
              configured: false,
              connected: false,
              open: () => undefined,
              disconnect: () => undefined,
              switchChain: async () => undefined,
            }}
          />
        )
      ) : (
        <section className="mock-card">
          <div className="mock-widget">
            <div className="mock-mark">F</div>
            <div>
              <strong>Log in with Fluent</strong>
              <span>Fluent ID, wallet, faucet</span>
            </div>
            <button type="button">Continue</button>
          </div>
        </section>
      )}
    </main>
  );
}
