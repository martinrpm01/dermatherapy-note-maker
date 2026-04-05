/// <reference types="vite/client" />

import type { ElectronApi } from "../../shared/types";

declare global {
  interface Window {
    rtNoteApi?: ElectronApi;
  }
}

export {};
