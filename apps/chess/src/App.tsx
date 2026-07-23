import {
  FluentWidget,
  createChessFluentWidgetConfig,
} from "./fluentSdk";
import { ChessDemo } from "./components/ChessDemo";

const fluentWidgetConfig = createChessFluentWidgetConfig();
const fluentLogo = fluentWidgetConfig.assets?.fluentLogo ?? "/fluent-assets/fluent-logo.svg";

function ChessAppShell() {
  return (
    <main className="main-chess">
      <header>
        <img className="brand-logo" src={fluentLogo} alt="Fluent" />
        <p className="eyebrow">On-chain bot demo</p>
        <h1>Fluent Chess Blitz</h1>
        <p className="lead">
          Watch two permissioned bots play chess on Fluent Testnet with every move
          submitted as a fast BLEND-paid transaction.
        </p>
      </header>

      <FluentWidget
        config={fluentWidgetConfig}
        mode="page"
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
  return <ChessAppShell />;
}
