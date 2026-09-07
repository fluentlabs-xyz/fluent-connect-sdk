import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Customize from "./Customize";
import { installPreviewFamiliesFetch } from "./previewScenarios";
import "./tailwind.css";

// Must run before the wallet menu mounts and fires its families request.
installPreviewFamiliesFetch();

// No router: the app has exactly two pages, so a pathname check keeps it simple.
const page = window.location.pathname === "/customize" ? <Customize /> : <App />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{page}</StrictMode>,
);
