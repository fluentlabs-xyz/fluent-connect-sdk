import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installPreviewFamiliesFetch } from "./previewScenarios";
import "./tailwind.css";

// Must run before the wallet menu mounts and fires its families request.
installPreviewFamiliesFetch();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
