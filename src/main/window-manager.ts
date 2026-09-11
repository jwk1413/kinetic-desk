import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { IpcChannel, type ObjectAnchor } from "../shared/ipc";
import { WINDOW_WIDTH, physicsLimits, type InteractionMode } from "../shared/types";

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

const WIDTH_RATIO = 0.93;
const HEIGHT_RATIO = 0.93;
// The overlay is transparent, so an oversized window is invisible but still
// pushes the object off screen. Keep a margin so the swing stays reachable.
const SCREEN_MARGIN = 16;
// The object may always come this close to the outer edge of the desktop, even
// when it is small.
const MIN_EDGE_MARGIN = 24;

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
function areaAt(x: number, y: number) {
  return workAreaList().find((a) => x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height) ?? null;
}

/**
 * Keeps the object reachable without walling it into one display.
 *
 * Only the outer rim of the desktop is a wall. Where another display sits just
 * past an edge, that edge is left open so the object can be dragged across the
 * seam; once the pivot lands on the neighbour, that display's own edges take
 * over. Clamping the object's whole swing inside a single display instead made
 * it impossible to move between monitors at all.
 */
function clampWindow(x: number, y: number, width: number, height: number, anchor: ObjectAnchor) {
  const pivotX = x + anchor.pivotX;
  const pivotY = y + anchor.pivotY;
  const area = areaAt(pivotX, pivotY) ?? nearestArea(pivotX, pivotY);
  const margin = Math.max(MIN_EDGE_MARGIN, Math.min(anchor.reach, area.width / 3, area.height / 3));
  const open = (px: number, py: number) => areaAt(px, py) !== null;
  const probe = 2;
  const minX = open(area.x - probe, pivotY) ? -Infinity : area.x + margin;
  const maxX = open(area.x + area.width + probe, pivotY) ? Infinity : area.x + area.width - margin;
  const minY = open(pivotX, area.y - probe) ? -Infinity : area.y + margin;
  const maxY = open(pivotX, area.y + area.height + probe) ? Infinity : area.y + area.height - margin;
  const targetX = clamp(pivotX, Math.min(minX, maxX), maxX);
  const targetY = clamp(pivotY, Math.min(minY, maxY), maxY);
  return {
    x: Math.round(x + (targetX - pivotX)),
    y: Math.round(y + (targetY - pivotY)),
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

  // What the renderer draws inside the window. Until it reports, assume the
  // middle so the clamp behaves like a plain "keep the window on screen".
  let objectAnchor: ObjectAnchor = { pivotX: width / 2, pivotY: height / 2, reach: 0, dragging: false };
  // Where the pivot should sit on screen, kept in full precision. Window bounds
  // are whole pixels, so re-deriving this from them on every resize rounded the
  // anchor a little each time and the object slowly walked across the desktop.
  // Where the pivot belongs on screen, in full precision. This is the one place
  // the object's position lives: the renderer says where it sits inside the
  // window, and the window is then placed so it lands here. Only the user
  // dragging it changes the anchor, so nothing else can nudge the object about.
  let anchor: { x: number; y: number } | null = null;

  const applyBounds = (next: { x: number; y: number; width: number; height: number }) => {
    browserWindow.setBounds(next, false);
    // Tell the renderer where the window actually landed. Drag inertia is
    // measured from the object's real movement, and a clamped move means the
    // object did not move at all however far the cursor went.
    if (!browserWindow.webContents.isDestroyed()) {
      browserWindow.webContents.send(IpcChannel.windowBounds, { x: next.x, y: next.y });
    }
  };

  const placeToAnchor = () => {
    if (anchor === null || browserWindow.isDestroyed()) return;
    const bounds = browserWindow.getBounds();
    const x = Math.round(anchor.x - objectAnchor.pivotX);
    const y = Math.round(anchor.y - objectAnchor.pivotY);
    if (x === bounds.x && y === bounds.y) return;
    applyBounds({ x, y, width: bounds.width, height: bounds.height });
  };

  const keepOnDesktop = () => {
    if (browserWindow.isDestroyed()) return;
    const bounds = browserWindow.getBounds();
    if (intersectsDesktop(bounds)) return;
    const next = placeOnPrimary(bounds.width, bounds.height);
    applyBounds(clampWindow(next.x, next.y, next.width, next.height, objectAnchor));
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
  ipcMain.removeAllListeners(IpcChannel.dragObjectTo);
  ipcMain.removeAllListeners(IpcChannel.setObjectAnchor);
  ipcMain.removeHandler(IpcChannel.getWindowBounds);
  ipcMain.removeHandler(IpcChannel.getDisplayLayout);

  ipcMain.on(IpcChannel.setClickThrough, (_event, ignore: boolean) => {
    hoverClickThrough = ignore || interactionMode === "passthrough";
    applyClickThrough();
  });
  ipcMain.on(IpcChannel.moveWindowBy, (_event, dx: number, dy: number, keepInReach = true) => {
    if (browserWindow.isDestroyed()) return;
    // Layout corrections are already handled: the window follows the anchor on
    // every report, so a correction would only move the object twice.
    if (!keepInReach) return;
    const bounds = browserWindow.getBounds();
    if (anchor === null) anchor = { x: bounds.x + objectAnchor.pivotX, y: bounds.y + objectAnchor.pivotY };
    const moved = clampWindow(
      anchor.x + dx - objectAnchor.pivotX,
      anchor.y + dy - objectAnchor.pivotY,
      bounds.width,
      bounds.height,
      objectAnchor,
    );
    anchor = { x: moved.x + objectAnchor.pivotX, y: moved.y + objectAnchor.pivotY };
    placeToAnchor();
    if (!browserWindow.isDestroyed()) {
      const landed = browserWindow.getBounds();
      browserWindow.webContents.send(IpcChannel.windowBounds, { x: landed.x, y: landed.y });
    }
  });
  ipcMain.on(IpcChannel.dragObjectTo, (_event, x: number, y: number) => {
    if (browserWindow.isDestroyed()) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const bounds = browserWindow.getBounds();
    const placed = clampWindow(
      x - objectAnchor.pivotX,
      y - objectAnchor.pivotY,
      bounds.width,
      bounds.height,
      objectAnchor,
    );
    anchor = { x: placed.x + objectAnchor.pivotX, y: placed.y + objectAnchor.pivotY };
    placeToAnchor();
    browserWindow.webContents.send(IpcChannel.windowBounds, { x: placed.x, y: placed.y });
  });
  ipcMain.on(IpcChannel.setObjectAnchor, (_event, next: ObjectAnchor) => {
    if (!next) return;
    if (![next.pivotX, next.pivotY, next.reach].every(Number.isFinite)) return;
    objectAnchor = next;
    // While the user drags, the pivot moving inside the window *is* the object
    // moving: the anchor follows it. Pulling the window back to the old anchor
    // instead fought the drag and left the object far behind the cursor.
    if (next.dragging || anchor === null) {
      const bounds = browserWindow.getBounds();
      anchor = { x: bounds.x + next.pivotX, y: bounds.y + next.pivotY };
      return;
    }
    placeToAnchor();
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
      const ratioX = size.width / current.width;
      const ratioY = size.height / current.height;
      // The renderer holds the pivot at a fixed fraction of the canvas, so this
      // is where it will end up. Using it now means the window resizes and lands
      // in its final place in one step, instead of the object jumping and being
      // dragged back a frame later. The report that follows corrects any drift.
      const pivotX = objectAnchor.pivotX * ratioX;
      const pivotY = objectAnchor.pivotY * ratioY;
      const held = anchor ?? { x: current.x + objectAnchor.pivotX, y: current.y + objectAnchor.pivotY };
      anchor = held;
      objectAnchor = { ...objectAnchor, pivotX, pivotY };
      applyBounds({ x: Math.round(held.x - pivotX), y: Math.round(held.y - pivotY), ...size });
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
    ipcMain.removeAllListeners(IpcChannel.dragObjectTo);
    ipcMain.removeAllListeners(IpcChannel.setObjectAnchor);
    ipcMain.removeHandler(IpcChannel.getWindowBounds);
    ipcMain.removeHandler(IpcChannel.getDisplayLayout);
  });

  return overlay;
}
