import { useMemo, useState } from "react";
import { FluentWidget } from "@fluent.xyz/connect";

import {
  EXECUTION_MODES,
  executionFor,
  type ExecutionModeId,
} from "./bench/executionMode";
import { BenchPanel } from "./components/BenchPanel";
import { FLUENT_WIDGET_CONFIG } from "./consts";

export default function App() {
  const [executionMode, setExecutionMode] = useState<ExecutionModeId>("chain");
  /**
   * A new `config` object per switch, which the widget resolves on its next render. Nothing is
   * rebuilt by it: the widget reads these three settings when a send or a signature needs them,
   * so the Fluent ID, the connection and the kernel all survive the switch — and the next send
   * is the one that changes.
   */
  const config = useMemo(
    () => ({ ...FLUENT_WIDGET_CONFIG, execution: executionFor(executionMode) }),
    [executionMode],
  );

  return (
    <main className="page-shell">
      {/* The switch sits above the widget, because it decides how every send below it runs. */}
      <div className="controls">
        <span className="gas-label">execution</span>
        <div className="gas-modes" role="radiogroup" aria-label="Execution path">
          {EXECUTION_MODES.map((mode) => (
            <label
              key={mode.id}
              className={`gas-mode${mode.id === executionMode ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="execution"
                value={mode.id}
                checked={mode.id === executionMode}
                onChange={() => setExecutionMode(mode.id)}
              />
              {mode.label}
            </label>
          ))}
        </div>
      </div>
      <FluentWidget
        config={config}
        mode="page"
        renderPage={({ session, widget, getAuthToken }) => (
          <BenchPanel session={session} widget={widget} getAuthToken={getAuthToken} />
        )}
      />
    </main>
  );
}
