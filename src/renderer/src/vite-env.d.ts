/// <reference types="vite/client" />

import type { ElectronApi } from "../../shared/types";

declare global {
  interface Window {
    rtNoteApi?: ElectronApi;
  }
}

declare module "*.pdf" {
  const src: string;
  export default src;
}

export {};
