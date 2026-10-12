import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Customize from "./Customize";
import DesignSystem from "./design-system/DesignSystem";
import { installPreviewFamiliesFetch } from "./previewScenarios";
import "./tailwind.css";

// Must run before the wallet menu mounts and fires its families request.
installPreviewFamiliesFetch();

// No router: three pages, so a pathname check keeps it simple.
const pages: Record<string, JSX.Element> = {
  "/customize": <Customize />,
  "/design-system": <DesignSystem />,
};
const page = pages[window.location.pathname] ?? <App />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{page}</StrictMode>,
);
