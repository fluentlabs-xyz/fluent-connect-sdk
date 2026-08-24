import { FluentWidget } from "@fluent.xyz/connect";

import { BenchPanel } from "./components/BenchPanel";
import { FLUENT_WIDGET_CONFIG } from "./consts";

export default function App() {
  return (
    <main className="page-shell">
      <FluentWidget
        config={FLUENT_WIDGET_CONFIG}
        mode="page"
        showDebugPayload={false}
        renderPage={({ session, widget }) => (
          <BenchPanel session={session} widget={widget} />
        )}
      />
    </main>
  );
}
