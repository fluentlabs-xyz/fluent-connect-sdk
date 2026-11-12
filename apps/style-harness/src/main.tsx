import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Widget stylesheet first: the order an integrator uses, and the order in
// which a `:root` token collision would favour the host.
import "@fluent.xyz/connect/styles.css";
import "./harness.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
