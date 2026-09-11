import type { AppState, PhysicsSettings } from "./types";

export const IpcChannel = {
  rendererReady: "renderer-ready",
  setClickThrough: "set-click-through",
  moveWindowBy: "move-window-by",
  setPivotOffset: "set-pivot-offset",
  appState: "app-state",
  getState: "get-state",
  setInteractionMode: "set-interaction-mode",
  setMotionMode: "set-motion-mode",
  togglePause: "toggle-pause",
  resetObject: "reset-object",
  setTrails: "set-trails",
  setPivotInertia: "set-pivot-inertia",
  updatePhysics: "update-physics",
  resetPhysics: "reset-physics",
  windowBounds: "window-bounds",
  getWindowBounds: "get-window-bounds",
  displayLayout: "display-layout",
  getDisplayLayout: "get-display-layout",
  benchControl: "bench-control",
  benchResult: "bench-result",
} as const;

export interface WindowOrigin {
  x: number;
  y: number;
}

export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLayout {
  width: number;
  height: number;
  primary: DisplayRect;
}

export interface DeskApi {
  ready: () => void;
  getState: () => Promise<AppState>;
  setClickThrough: (ignore: boolean) => void;
  moveWindowBy: (dx: number, dy: number) => void;
  /** Where the grabbable pivot sits inside the window, so the main process can keep it reachable. */
  setPivotOffset: (x: number, y: number) => void;
  updatePhysics: (physics: Partial<PhysicsSettings>) => void;
  setMotionMode: (mode: AppState["motionMode"]) => void;
  setTrails: (enabled: boolean) => void;
  setPivotInertia: (enabled: boolean) => void;
  resetPhysics: () => void;
  resetObject: () => void;
  getWindowBounds: () => Promise<WindowOrigin>;
  onWindowBounds: (callback: (origin: WindowOrigin) => void) => () => void;
  getDisplayLayout: () => Promise<DisplayLayout>;
  onDisplayLayout: (callback: (layout: DisplayLayout) => void) => () => void;
  onState: (callback: (state: AppState) => void) => () => void;
  onBenchControl?: (callback: (command: "start" | "stop") => void) => () => void;
  sendBenchResult?: (payload: unknown) => void;
}
