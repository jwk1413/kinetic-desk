import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { IpcChannel, type ObjectBox } from "../shared/ipc";
import { WINDOW_HEIGHT, WINDOW_WIDTH, physicsLimits, type InteractionMode } from "../shared/types";

export interface OverlayWindow {
  browserWindow: BrowserWindow;
  setInteractionMode: (mode: InteractionMode) => void;
  setClickThrough: (ignore: boolean) => void;
  setSize: (size: number) => void;
  /** Clamps a requested size to what the overlay's current display can hold. */
  fitSize: (size: number) => number;
  capabilities: {
    transparent: boolean;
    alwaysOnTop: boolean;
    clickThrough: boolean;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function displayBoundsList() {
  return screen.getAllDisplays().map((display) => display.bounds);
}

function workAreaList() {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function overlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function nearestArea(x: number, y: number) {
  const displays = workAreaList();
  let best = displays[0] ?? screen.getPrimaryDisplay().bounds;
  let bestDist = Infinity;
  for (const display of displays) {
    if (x >= display.x && x < display.x + display.width && y >= display.y && y < display.y + display.height) {
      return display;
    }
    const cx = clamp(x, display.x, display.x + display.width);
    const cy = clamp(y, display.y, display.y + display.height);
    const dist = (x - cx) ** 2 + (y - cy) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = display;
    }
  }
  return best;
}

const WIDTH_RATIO = 1.55;
const HEIGHT_RATIO = (WINDOW_HEIGHT / WINDOW_WIDTH) * 1.22;
// The overlay is transparent, so an oversized window is invisible but still
// pushes the object off screen. Keep a margin so the swing stays reachable.
const SCREEN_MARGIN = 16;
// How close the object may get to the edge of its display before it stops.
// The reported box already carries the object's own padding.
const EDGE_MARGIN = 8;

export function overlayWindowSize(size: number): { width: number; height: number } {
  const width = Math.round(size * WIDTH_RATIO);
  const height = Math.round(size * HEIGHT_RATIO);
  return { width, height };
}

/** Largest requested size whose overlay window still fits inside `area`. */
export function fitSizeToArea(size: number, area: { width: number; height: number }): number {
  const usableWidth = Math.max(160, area.width - SCREEN_MARGIN * 2);
  const usableHeight = Math.max(160, area.height - SCREEN_MARGIN * 2);
  const limit = Math.min(usableWidth / WIDTH_RATIO, usableHeight / HEIGHT_RATIO);
  return Math.max(physicsLimits.windowSize.min, Math.min(size, Math.floor(limit)));
}

export function primaryWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function placeOnPrimary(width: number, height: number) {
  const area = screen.getPrimaryDisplay().workArea;
  const x = area.x + area.width - width - 28;
  const y = area.y + Math.max(24, area.height * 0.08);
  return {
    x: Math.round(clamp(x, area.x, Math.max(area.x, area.x + area.width - width))),
    y: Math.round(clamp(y, area.y, Math.max(area.y, area.y + area.height - height))),
    width,
    height,
  };
}

/**
 * Keeps the grabbable pivot on screen rather than the window.
 *
 * The overlay is much larger than the object and fully transparent, so a clamp
 * that only keeps a corner of the *window* on screen happily parks the pendulum
 * hundreds of pixels outside the desktop, where it can never be grabbed again.
 * `pivotOffset` is where the renderer currently draws the pivot inside the
 * window; we clamp that point into the work area of the display nearest to it,
 * which still lets the object be dragged from one display to another.
 */
/** Slides `start`..`start + span` inside `min`..`max`, centring it if it cannot fit. */
function fitSpan(start: number, span: number, min: number, max: number): number {
  if (span >= max - min) return min + (max - min - span) / 2;
  return clamp(start, min, max - span);
}

function clampWindow(x: number, y: number, width: number, height: number, box: ObjectBox) {
  const boxX = x + box.x;
  const boxY = y + box.y;
  const area = nearestArea(boxX + box.width / 2, boxY + box.height / 2);
  const targetX = fitSpan(boxX, box.width, area.x + EDGE_MARGIN, area.x + area.width - EDGE_MARGIN);
  const targetY = fitSpan(boxY, box.height, area.y + EDGE_MARGIN, area.y + area.height - EDGE_MARGIN);
  return {
    x: Math.round(x + (targetX - boxX)),
    y: Math.round(y + (targetY - boxY)),
    width,
    height,
  };
}

function intersectsDesktop(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return displayBoundsList().some((display) => overlapArea(bounds, display) > 16 * 16);
}

function benchQuery(): Record<string, string> {
  if (!process.env.KINETIC_BENCH) return {};
  const query: Record<string, string> = { bench: "1" };
  const objects = process.env.KINETIC_BENCH_OBJECTS;
  if (objects) query.objects = objects;
  if (process.env.KINETIC_BENCH_SHADOWS === "0") query.shadows = "0";
  return query;
}

function withBenchQuery(base: string): string {
  const query = benchQuery();
  if (!Object.keys(query).length) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

export function createOverlayWindow(size = WINDOW_WIDTH): OverlayWindow {
  const { width, height } = overlayWindowSize(fitSizeToArea(size, primaryWorkArea()));
  const initial = placeOnPrimary(width, height);

  const browserWindow = new BrowserWindow({
    ...initial,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: true,
    hiddenInMissionControl: true,
    enableLargerThanScreen: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Overlay must keep animating while other apps are focused.
      backgroundThrottling: false,
    },
  });

  let pendingDx = 0;
  let pendingDy = 0;
  // What the renderer draws inside the window. Until it reports, assume the
  // middle so the clamp behaves like a plain "keep the window on screen".
  let objectBox: ObjectBox = { x: width / 4, y: height / 4, width: width / 2, height: height / 2, pivotX: width / 2, pivotY: height / 2 };
  // Where the pivot should sit on screen, kept in full precision. Window bounds
  // are whole pixels, so re-deriving this from them on every resize rounded the
  // anchor a little each time and the object slowly walked across the desktop.
  let anchor: { x: number; y: number } | null = null;
  let expectedPivot: { x: number; y: number } | null = null;
  let expectedMisses = 0;

  const keepOnDesktop = () => {
    if (browserWindow.isDestroyed()) return;
    const bounds = browserWindow.getBounds();
    if (intersectsDesktop(bounds)) return;
    const next = placeOnPrimary(bounds.width, bounds.height);
    browserWindow.setBounds(clampWindow(next.x, next.y, next.width, next.height, objectBox), false);
  };

  browserWindow.setAlwaysOnTop(true, "screen-saver", 1);
  if (process.platform === "darwin") {
    browserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  if (process.platform === "darwin") browserWindow.setWindowButtonVisibility(false);
  browserWindow.setIgnoreMouseEvents(true, { forward: true });

  browserWindow.webContents.on("console-message", (event) => {
    if (event.message.startsWith("[kinetic]")) {
      console.log(event.message);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void browserWindow.loadURL(withBenchQuery(process.env.ELECTRON_RENDERER_URL));
  } else {
    void browserWindow.loadFile(join(__dirname, "../renderer/index.html"), {
      query: benchQuery(),
    });
  }

  browserWindow.once("ready-to-show", () => {
    browserWindow.setBounds(initial, false);
    browserWindow.showInactive();
    const displays = screen.getAllDisplays().map((display) => display.bounds);
    console.log(`[kinetic] overlay ${initial.width}x${initial.height} at ${initial.x},${initial.y}; displays=${JSON.stringify(displays)}`);
  });

  screen.on("display-metrics-changed", keepOnDesktop);
  screen.on("display-added", keepOnDesktop);
  screen.on("display-removed", keepOnDesktop);

  const capabilities = {
    transparent: true,
    alwaysOnTop: browserWindow.isAlwaysOnTop(),
    clickThrough: typeof browserWindow.setIgnoreMouseEvents === "function",
  };

  let interactionMode: InteractionMode = "control";
  let hoverClickThrough = true;

  const applyClickThrough = () => {
    const passthrough = interactionMode === "passthrough";
    const ignore = passthrough || hoverClickThrough;
    if (passthrough) {
      // Full OS hit-test skip. `{ forward: true }` is required in control
      // mode so empty-space hover can still reach Chromium, but it leaves
      // the overlay in the mouse path. On Windows (and a focused Mac
      // window) clicks then land on the pendulum instead of passing through.
      browserWindow.setFocusable(false);
      browserWindow.setIgnoreMouseEvents(false);
      browserWindow.setIgnoreMouseEvents(true);
      if (browserWindow.isFocused()) browserWindow.blur();
      return;
    }
    if (!browserWindow.isFocusable()) browserWindow.setFocusable(true);
    if (ignore) {
      browserWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      browserWindow.setIgnoreMouseEvents(false);
    }
  };

  ipcMain.removeAllListeners(IpcChannel.setClickThrough);
  ipcMain.removeAllListeners(IpcChannel.moveWindowBy);
  ipcMain.removeAllListeners(IpcChannel.setObjectBox);
  ipcMain.removeHandler(IpcChannel.getWindowBounds);
  ipcMain.removeHandler(IpcChannel.getDisplayLayout);

  ipcMain.on(IpcChannel.setClickThrough, (_event, ignore: boolean) => {
    hoverClickThrough = ignore || interactionMode === "passthrough";
    applyClickThrough();
  });
  ipcMain.on(IpcChannel.moveWindowBy, (_event, dx: number, dy: number) => {
    if (browserWindow.isDestroyed()) return;
    pendingDx += dx;
    pendingDy += dy;
    const moveX = Math.round(pendingDx);
    const moveY = Math.round(pendingDy);
    if (moveX === 0 && moveY === 0) return;
    pendingDx -= moveX;
    pendingDy -= moveY;
    const bounds = browserWindow.getBounds();
    const desiredX = bounds.x + moveX;
    const desiredY = bounds.y + moveY;
    const next = clampWindow(desiredX, desiredY, bounds.width, bounds.height, objectBox);
    anchor = { x: next.x + objectBox.pivotX, y: next.y + objectBox.pivotY };
    expectedPivot = null;
    expectedMisses = 0;
    browserWindow.setBounds(next, false);
  });
  ipcMain.on(IpcChannel.setObjectBox, (_event, box: ObjectBox) => {
    if (!box) return;
    if (![box.x, box.y, box.width, box.height, box.pivotX, box.pivotY].every(Number.isFinite)) return;
    if (box.width <= 0 || box.height <= 0) return;
    const previous = objectBox;
    objectBox = box;
    if (expectedPivot !== null) {
      // A resize lands in the window first and in the renderer a moment later, so
      // the report in between still carries the old position. Waiting for the one
      // we predicted keeps that half-finished state from resetting the anchor.
      if (Math.abs(box.pivotX - expectedPivot.x) < 1 && Math.abs(box.pivotY - expectedPivot.y) < 1) {
        expectedPivot = null;
        expectedMisses = 0;
        return;
      }
      expectedMisses += 1;
      if (expectedMisses < 3) return;
      expectedPivot = null;
      expectedMisses = 0;
    }
    if (anchor === null) {
      const bounds = browserWindow.getBounds();
      anchor = { x: bounds.x + box.pivotX, y: bounds.y + box.pivotY };
      return;
    }
    // Follow the pivot by how far it actually moved. Re-reading the window
    // position instead would round the anchor off every time, and those
    // fractions added up into a visible drift.
    anchor = {
      x: anchor.x + (box.pivotX - previous.pivotX),
      y: anchor.y + (box.pivotY - previous.pivotY),
    };
  });
  ipcMain.handle(IpcChannel.getWindowBounds, () => {
    const { x, y } = browserWindow.getBounds();
    return { x, y };
  });

  const overlay: OverlayWindow = {
    browserWindow,
    setInteractionMode(mode) {
      interactionMode = mode;
      if (mode === "passthrough") {
        hoverClickThrough = true;
      }
      applyClickThrough();
    },
    setClickThrough(ignore) {
      hoverClickThrough = ignore;
      applyClickThrough();
    },
    setSize(nextSize) {
      if (browserWindow.isDestroyed()) return;
      const size = overlayWindowSize(overlay.fitSize(nextSize));
      const current = browserWindow.getBounds();
      if (size.width === current.width && size.height === current.height) return;
      // Everything the renderer draws scales with the window, and it holds the
      // object at the same fraction of the canvas, so the new box is just the
      // old one scaled. Predicting it here lets us resize and reposition in a
      // single step; doing it in two is what made the object jump and snap back.
      const ratioX = size.width / current.width;
      const ratioY = size.height / current.height;
      // The renderer holds the pivot at a fixed fraction of the canvas, so its
      // new position is exactly this — which is what lets us resize and move in
      // one step instead of letting the object jump and be dragged back.
      const pivotX = objectBox.pivotX * ratioX;
      const pivotY = objectBox.pivotY * ratioY;
      const held = anchor ?? { x: current.x + objectBox.pivotX, y: current.y + objectBox.pivotY };
      const x = held.x - pivotX;
      const y = held.y - pivotY;
      // The footprint does not scale quite as cleanly (bob radii are fixed), so
      // this is only an estimate, used to clamp. The renderer reports the real
      // one a frame later and any leftover correction goes the usual way.
      const scaled: ObjectBox = {
        x: pivotX + (objectBox.x - objectBox.pivotX) * ratioX,
        y: pivotY + (objectBox.y - objectBox.pivotY) * ratioY,
        width: objectBox.width * ratioX,
        height: objectBox.height * ratioY,
        pivotX,
        pivotY,
      };
      objectBox = scaled;
      const next = clampWindow(x, y, size.width, size.height, scaled);
      // If the clamp had to step in, that is a real move and becomes the new anchor.
      if (next.x !== Math.round(x) || next.y !== Math.round(y)) {
        anchor = { x: next.x + pivotX, y: next.y + pivotY };
        expectedPivot = null;
        expectedMisses = 0;
      } else {
        anchor = held;
        expectedPivot = { x: pivotX, y: pivotY };
        expectedMisses = 0;
      }
      browserWindow.setBounds(next, false);
    },
    fitSize(size) {
      if (browserWindow.isDestroyed()) return fitSizeToArea(size, primaryWorkArea());
      const bounds = browserWindow.getBounds();
      const display = screen.getDisplayMatching(bounds) ?? screen.getPrimaryDisplay();
      return fitSizeToArea(size, display.workArea);
    },
    capabilities,
  };

  app.on("before-quit", () => {
    screen.removeListener("display-metrics-changed", keepOnDesktop);
    screen.removeListener("display-added", keepOnDesktop);
    screen.removeListener("display-removed", keepOnDesktop);
    ipcMain.removeAllListeners(IpcChannel.setClickThrough);
    ipcMain.removeAllListeners(IpcChannel.moveWindowBy);
    ipcMain.removeAllListeners(IpcChannel.setObjectBox);
    ipcMain.removeHandler(IpcChannel.getWindowBounds);
    ipcMain.removeHandler(IpcChannel.getDisplayLayout);
  });

  return overlay;
}
