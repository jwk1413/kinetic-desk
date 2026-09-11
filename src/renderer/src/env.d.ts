/// <reference types="vite/client" />

import type { AppState } from "../../shared/types";

declare global {
  interface Window {
    desk?: {
      ready: () => void;
      getState: () => Promise<AppState>;
      setClickThrough: (ignore: boolean) => void;
      moveWindowBy: (dx: number, dy: number) => void;
      updatePhysics: (physics: Partial<AppState["physics"]>) => void;
      setMotionMode: (mode: AppState["motionMode"]) => void;
      setTrails: (enabled: boolean) => void;
      setPivotInertia: (enabled: boolean) => void;
      resetPhysics: () => void;
      resetObject: () => void;
      getWindowBounds: () => Promise<{ x: number; y: number }>;
      onWindowBounds: (callback: (origin: { x: number; y: number }) => void) => () => void;
      getDisplayLayout: () => Promise<{
        width: number;
        height: number;
        primary: { x: number; y: number; width: number; height: number };
      }>;
      onDisplayLayout: (
        callback: (layout: {
          width: number;
          height: number;
          primary: { x: number; y: number; width: number; height: number };
        }) => void,
      ) => () => void;
      onState: (callback: (state: AppState) => void) => () => void;
      onBenchControl?: (callback: (command: "start" | "stop") => void) => () => void;
      sendBenchResult?: (payload: unknown) => void;
    };
  }
}

export {};
