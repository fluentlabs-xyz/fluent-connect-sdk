import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fluent.xyz/connect/styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
