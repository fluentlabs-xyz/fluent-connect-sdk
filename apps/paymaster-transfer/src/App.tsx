import { FluentWidget } from "@fluent.xyz/connect";
import { TransferPanel } from "./components/TransferPanel";
import { FLUENT_WIDGET_CONFIG } from "./consts";

export default function App() {
  return (
    <>
      <div className="testnet-stripe" aria-label="Fluent Connect Demo App">
        <span>Fluent Connect Demo App</span>
      </div>

      <main className="page-shell">
        <FluentWidget
          config={FLUENT_WIDGET_CONFIG}
          mode="page"
          showDebugPayload={false}
          renderPage={({ session, widget }) => (
            <TransferPanel session={session} widget={widget} />
          )}
        />
      </main>
    </>
  );
}
