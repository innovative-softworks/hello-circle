import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installStaleBuildListener } from "./chunkRecovery";
import { installErrorReporting } from "./errorReporting";
// Phase 12 (privacy) — application fonts are self-hosted (OFL-1.1); no
// request to Google Fonts before (or after) cookie consent.
import "@fontsource-variable/bricolage-grotesque/opsz.css";
// Body font: Inter everywhere (owner, 2026-10-22); headings stay Bricolage Grotesque.
import "@fontsource-variable/inter";
import "./index.css";

installStaleBuildListener();
installErrorReporting();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
