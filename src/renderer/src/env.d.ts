/// <reference types="vite/client" />

import type { DeskApi } from "../../shared/ipc";

declare global {
  interface Window {
    // Shape comes from DeskApi so this cannot drift from the preload bridge.
    desk?: DeskApi;
  }
}

export {};
