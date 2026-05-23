import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { initializeAnalytics } from "./observability/analytics";
import { initializeSentry, SentryErrorBoundary } from "./observability/sentry";
import "./ui/styles.css";

initializeSentry();
initializeAnalytics();

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SentryErrorBoundary fallback={<main className="app-shell error-screen">DeepBlue dropped a tile. Reload and try again.</main>}>
      <App />
    </SentryErrorBoundary>
  </React.StrictMode>
);
