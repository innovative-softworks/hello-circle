import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installStaleBuildListener } from "./chunkRecovery";
// Phase 12 (privacy) — application fonts are self-hosted (OFL-1.1); no
// request to Google Fonts before (or after) cookie consent.
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/hanken-grotesk";
import "./index.css";

installStaleBuildListener();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
