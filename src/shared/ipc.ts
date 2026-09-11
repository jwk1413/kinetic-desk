import type { AppState } from "./types";

export const IpcChannel = {
  rendererReady: "renderer-ready",
  setClickThrough: "set-click-through",
  dragObjectTo: "drag-object-to",
  setObjectAnchor: "set-object-anchor",
  appState: "app-state",
  getState: "get-state",
  resetObject: "reset-object",
  windowBounds: "window-bounds",
  getWindowBounds: "get-window-bounds",
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
  /** True while the user is dragging the object, when the pivot moving *is* the point. */
  dragging: boolean;
}

export interface WindowOrigin {
  x: number;
  y: number;
}

export interface DeskApi {
  ready: () => void;
  getState: () => Promise<AppState>;
  setClickThrough: (ignore: boolean) => void;
  /** Where the object hangs inside the window, so the main process can keep it reachable. */
  setObjectAnchor: (anchor: ObjectAnchor) => void;
  /**
   * Puts the object at this screen position. Dragging sends where the object
   * should be, not how far to nudge it, so that stopping at the edge of a
   * display cannot leave it trailing behind the cursor for the rest of the drag.
   */
  dragObjectTo: (x: number, y: number) => void;
  getWindowBounds: () => Promise<WindowOrigin>;
  onWindowBounds: (callback: (origin: WindowOrigin) => void) => () => void;
  onState: (callback: (state: AppState) => void) => () => void;
  onBenchControl?: (callback: (command: "start" | "stop") => void) => () => void;
  sendBenchResult?: (payload: unknown) => void;
}
