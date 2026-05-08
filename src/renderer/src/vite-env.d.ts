/// <reference types="vite/client" />

import type { ElectronApi } from "../../shared/types";

type ClearSkinRefreshPulse = {
  id: string;
  version: string;
  commit: string;
  generatedAt: string;
};

declare global {
  const __CLEARSKIN_REFRESH_PULSE__: ClearSkinRefreshPulse | undefined;

  interface Window {
    rtNoteApi?: ElectronApi;
  }
}

declare module "*.pdf" {
  const src: string;
  export default src;
}

export {};
