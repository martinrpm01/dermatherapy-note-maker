import type { AppClient } from "../../../shared/types";
import { BrowserAppClient } from "./browser-app-client";
import { ElectronAppClient } from "./electron-app-client";

let cachedClient: AppClient | null = null;

export function getAppClient(): AppClient {
  if (cachedClient) {
    return cachedClient;
  }

  // Electron exposes the typed preload bridge; plain browser runtimes do not.
  // Fall back to the browser AppClient so the same renderer shell can boot later.
  if (window.rtNoteApi) {
    cachedClient = new ElectronAppClient(window.rtNoteApi);
    return cachedClient;
  }

  cachedClient = new BrowserAppClient();
  return cachedClient;
}
