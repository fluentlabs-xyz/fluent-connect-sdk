import { FluentWidget } from "@fluent.xyz/connect";

import { AuthPanel } from "./components/AuthPanel";
import { SignPanel } from "./components/SignPanel";
import { FLUENT_WIDGET_CONFIG } from "./consts";

export default function App() {
  return (
    <main className="page-shell">
      <FluentWidget
        config={FLUENT_WIDGET_CONFIG}
        mode="page"
        renderPage={(ctx) => (
          <>
            <AuthPanel ctx={ctx} />
            <SignPanel ctx={ctx} />
          </>
        )}
      />
    </main>
  );
}
