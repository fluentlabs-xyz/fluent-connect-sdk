import {
  FluentWidget,
  resolveFluentWidgetNetworkFromEnv,
} from "@fluent.xyz/connect";
import { VaultDashboard } from "./components/VaultDashboard";
import { FLUENT_WIDGET_APP_CONFIG } from "./consts";

const fluentWidgetConfig = {
  ...FLUENT_WIDGET_APP_CONFIG,
  network: resolveFluentWidgetNetworkFromEnv() ?? "mainnet",
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
          showDebugPayload={false}
          connectButton={false}
          renderPage={({
            session,
            openConnect,
            openAccount,
            hasConnectedAccount,
            connectedAddress,
            widget,
          }) => (
            <VaultDashboard
              session={session}
              onConnect={openConnect}
              onOpenAccount={openAccount}
              hasConnectedAccount={hasConnectedAccount}
              connectedAddress={connectedAddress}
              widget={widget}
            />
          )}
        />
      </main>
    </>
  );
}
