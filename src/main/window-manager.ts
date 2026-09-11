import { app, BrowserWindow, ipcMain, screen } from "electron";
import { join } from "node:path";
import { IpcChannel } from "../shared/ipc";
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

function overlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function nearestDisplay(x: number, y: number) {
  const displays = displayBoundsList();
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

function clampWindow(x: number, y: number, width: number, height: number) {
  const keep = 48;
  const rect = { x, y, width, height };
  const visible = displayBoundsList().reduce((sum, display) => sum + overlapArea(rect, display), 0);
  if (visible >= keep * keep) {
    return { x: Math.round(x), y: Math.round(y), width, height };
  }
  const anchor = nearestDisplay(x + width / 2, y + height / 2);
  return {
    x: Math.round(clamp(x, anchor.x - width + keep, anchor.x + anchor.width - keep)),
    y: Math.round(clamp(y, anchor.y - height + keep, anchor.y + anchor.height - keep)),
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

  const keepOnDesktop = () => {
    if (browserWindow.isDestroyed()) return;
    const bounds = browserWindow.getBounds();
    if (intersectsDesktop(bounds)) return;
    const next = placeOnPrimary(bounds.width, bounds.height);
    browserWindow.setBounds(clampWindow(next.x, next.y, next.width, next.height), false);
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
    const next = clampWindow(desiredX, desiredY, bounds.width, bounds.height);
    browserWindow.setBounds(next, false);
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
      const { width, height } = overlayWindowSize(overlay.fitSize(nextSize));
      const current = browserWindow.getBounds();
      const x = current.x - (width - current.width) / 2;
      const y = current.y - (height - current.height) / 2;
      const next = clampWindow(x, y, width, height);
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
    ipcMain.removeHandler(IpcChannel.getWindowBounds);
    ipcMain.removeHandler(IpcChannel.getDisplayLayout);
  });

  return overlay;
}
