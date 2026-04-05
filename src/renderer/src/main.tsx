import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import type { AppClient } from "../../shared/types";
import { getAppClient } from "./runtime/get-app-client";
import "./styles.css";

let appClient: AppClient | null = null;
let appClientError = "";

try {
  appClient = getAppClient();
} catch (error) {
  appClientError = error instanceof Error ? error.message : "The application client could not be created.";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App appClient={appClient} initialClientError={appClientError} />
  </React.StrictMode>
);
