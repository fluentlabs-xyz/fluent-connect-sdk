import { FluentWidget, type FluentWidgetConfig } from "@fluent.xyz/connect";
import { VaultDashboard } from "./components/VaultDashboard";
import { FLUENT_WIDGET_APP_CONFIG } from "./consts";

const fluentWidgetConfig: FluentWidgetConfig = {
  ...FLUENT_WIDGET_APP_CONFIG,
  // The Network `config/*.env` names (scripts/with-config.mjs loads it); anything else is testnet.
  network: import.meta.env.VITE_FLUENT_WIDGET_NETWORK === "mainnet" ? "mainnet" : "testnet",
};

export default function App() {
  /// 1. Init FluentWidget: owns Fluent Connect login, session storage,
  /// and the widget API passed into the builder app.
  return (
    <>
      <div className="testnet-stripe" aria-label="Fluent Connect Demo App">
        <span>Fluent Connect Demo App</span>
      </div>

      <main>
        <FluentWidget
          config={fluentWidgetConfig}
          mode="page"
          connectButton={false}
          renderPage={() => <VaultDashboard />}
        />
      </main>
    </>
  );
}
