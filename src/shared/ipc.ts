import type { AppState, PhysicsSettings } from "./types";

export const IpcChannel = {
  rendererReady: "renderer-ready",
  setClickThrough: "set-click-through",
  moveWindowBy: "move-window-by",
  setObjectAnchor: "set-object-anchor",
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

/** Where the object hangs inside the window, in canvas pixels. */
export interface ObjectAnchor {
  /** The pivot, which the renderer holds at a fixed fraction of the canvas. */
  pivotX: number;
  pivotY: number;
  /** How far past the pivot the object reaches before it stops being graspable. */
  reach: number;
}

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
  /**
   * Moves the overlay. `keepInReach` is for the user dragging the object, which
   * must not leave the desktop; layout corrections pass false, because they only
   * cancel out a move the renderer just made and must not shift the object.
   */
  moveWindowBy: (dx: number, dy: number, keepInReach?: boolean) => void;
  /** Where the object hangs inside the window, so the main process can keep it reachable. */
  setObjectAnchor: (anchor: ObjectAnchor) => void;
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
