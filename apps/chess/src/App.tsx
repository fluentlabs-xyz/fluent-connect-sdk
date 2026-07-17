import {
  FluentWidget,
  createChessFluentWidgetConfig,
  type ChessFluentWidgetRenderContext,
} from "./fluentSdk";
import { ChessDemo } from "./components/ChessDemo";
import { formatAddress } from "./utils";

const fluentWidgetConfig = createChessFluentWidgetConfig(import.meta.env);
const fluentLogo = fluentWidgetConfig.assets?.fluentLogo ?? "/fluent-assets/fluent-logo.svg";

function ChessLaunchCard({ session, openConnect }: ChessFluentWidgetRenderContext) {
  const smartAccount = session?.wallet.smartAccountAddress;

  return (
    <section className="chess-launch-card">
      <div className="chess-launch-copy">
        <p className="eyebrow">Permissioned agent demo</p>
        <h2>Fluent Chess Blitz</h2>
        <p>
          Grant a scoped Fluent session, let a bot play on your behalf, and watch
          every BLEND-paid move settle on Fluent Testnet.
        </p>
      </div>
      <div className="chess-launch-board" aria-hidden="true">
        {Array.from({ length: 16 }, (_, index) => (
          <span key={index}>{index === 2 ? "♞" : index === 13 ? "♚" : ""}</span>
        ))}
      </div>
      <div className="chess-launch-meta">
        <div>
          <span>Fluent smart account</span>
          <strong>{smartAccount ? formatAddress(smartAccount) : "Not prepared yet"}</strong>
        </div>
      </div>
      <div className="chess-launch-actions">
        {session ? (
          <a className="chess-launch-cta" href="/chess">
            Open chess arena
          </a>
        ) : (
          <button className="chess-launch-cta" type="button" onClick={openConnect}>
            Connect Fluent ID
          </button>
        )}
        <span>Auto play, manual play, batch approve + move</span>
      </div>
    </section>
  );
}

function ChessAppShell({ isChess }: { isChess: boolean }) {
  return (
    <main className={isChess ? "main-chess" : undefined}>
      <header>
        <img className="brand-logo" src={fluentLogo} alt="Fluent" />
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
            <p className="eyebrow">Permissioned agent demo</p>
            <h1>Play chess with Fluent</h1>
            <p className="lead">
              Connect with Fluent ID, create a ZeroDev smart account session, and
              watch a chess bot submit BLEND-paid moves on your behalf.
            </p>
          </>
        )}
      </header>

      <FluentWidget
        config={fluentWidgetConfig}
        mode={isChess ? "page" : "home"}
        renderHome={(context) => (
          <div className="demo-grid">
            <ChessLaunchCard {...context} />
          </div>
        )}
        renderPage={({ session, wallet, widget, openConnect }) => (
          <div className="chess-page">
            <ChessDemo
              session={session}
              wallet={wallet}
              widget={widget}
              onConnect={openConnect}
            />
          </div>
        )}
      />
    </main>
  );
}

export default function App() {
  const isChess = location.pathname === "/chess";

  return <ChessAppShell isChess={isChess} />;
}
