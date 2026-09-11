import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { IpcChannel } from "../shared/ipc";
import {
  GLOBAL_TOGGLE_ACCELERATOR,
  defaultAppState,
  defaultPhysicsSettings,
  type AppState,
  type InteractionMode,
  type MotionMode,
  type PhysicsSettings,
} from "../shared/types";
import { clampPhysics, loadSettings, saveSettings } from "./store";
import { createAppTray } from "./tray";
import { createOverlayWindow, fitSizeToArea, primaryWorkArea } from "./window-manager";

let state: AppState = {
  ...defaultAppState,
  physics: { ...defaultPhysicsSettings },
};

app.commandLine.appendSwitch("disable-background-timer-throttling");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.kineticdesk.app");
    }
    if (process.platform === "darwin") {
      app.dock?.hide();
    }

    const saved = loadSettings();
    state = {
      ...state,
      physics: saved.physics,
      pivotInertia: saved.pivotInertia,
      displayFps: saved.displayFps,
      motionMode: saved.motionMode,
    };
    // A window larger than the screen would park the object off the desktop.
    const startSize = fitSizeToArea(state.physics.windowSize, primaryWorkArea());
    if (startSize !== state.physics.windowSize) {
      console.log(`[kinetic] window size ${state.physics.windowSize} does not fit this display; using ${startSize}`);
      state = { ...state, physics: { ...state.physics, windowSize: startSize } };
    }
    if (process.env.KINETIC_BENCH) {
      state = {
        ...state,
        interactionMode: "passthrough",
        motionMode: "driven",
        paused: process.env.KINETIC_BENCH_PAUSED === "1",
        trails: process.env.KINETIC_BENCH_TRAILS === "1",
        displayFps: process.env.KINETIC_BENCH_FPS === "60" ? 60 : 30,
        physics: clampPhysics({
          ...defaultPhysicsSettings,
          windowSize: 700,
          style: process.env.KINETIC_BENCH_STYLE === "sticks" ? "sticks" : "bobs",
          bobCount: 2,
        }),
      };
    }
    if (!process.env.KINETIC_BENCH) {
      saveSettings({
        physics: state.physics,
        pivotInertia: state.pivotInertia,
        displayFps: state.displayFps,
        motionMode: state.motionMode,
      });
    }

    const overlay = createOverlayWindow(state.physics.windowSize);
    const { browserWindow } = overlay;
    let rebuildTray = () => {};

    const broadcast = () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannel.appState, state);
        }
      }
      rebuildTray();
    };

    const setInteractionMode = (mode: InteractionMode) => {
      state = { ...state, interactionMode: mode };
      overlay.setInteractionMode(mode);
      if (mode === "control") {
        browserWindow.showInactive();
      }
      broadcast();
      console.log(`[kinetic] interaction mode: ${mode}`);
    };

    const setMotionMode = (mode: MotionMode) => {
      state = { ...state, motionMode: mode };
      persist();
      broadcast();
    };

    const togglePause = () => {
      state = { ...state, paused: !state.paused };
      broadcast();
    };

    const reset = () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IpcChannel.resetObject);
      }
    };

    const persist = () => {
      saveSettings({
        physics: state.physics,
        pivotInertia: state.pivotInertia,
        displayFps: state.displayFps,
        motionMode: state.motionMode,
      });
    };

    const setTrails = (enabled: boolean) => {
      state = { ...state, trails: enabled };
      broadcast();
    };

    const setPivotInertia = (enabled: boolean) => {
      state = { ...state, pivotInertia: enabled };
      persist();
      broadcast();
    };

    const setDisplayFps = (fps: 30 | 60) => {
      state = { ...state, displayFps: fps };
      persist();
      broadcast();
    };

    const setPhysics = (requested: PhysicsSettings) => {
      const physics = { ...requested, windowSize: overlay.fitSize(requested.windowSize) };
      const sizeChanged = physics.windowSize !== state.physics.windowSize;
      state = { ...state, physics };
      persist();
      if (sizeChanged) overlay.setSize(physics.windowSize);
      broadcast();
    };

    const patchPhysics = (patch: Partial<PhysicsSettings>) => {
      setPhysics(clampPhysics({ ...state.physics, ...patch }));
    };

    const tray = createAppTray(browserWindow, () => state, {
      setInteractionMode,
      setMotionMode,
      togglePause,
      setFrameDebug: (enabled) => {
        if (!__KINETIC_DEV_TOOLS__) return;
        state = { ...state, frameDebug: enabled };
        broadcast();
      },
      reset,
      setTrails,
      setPivotInertia,
      setDisplayFps,
      patchPhysics,
      resetPhysics: () => setPhysics({ ...defaultPhysicsSettings }),
      quit: () => app.quit(),
    });
    rebuildTray = tray.rebuild;

    ipcMain.removeHandler(IpcChannel.getState);
    ipcMain.handle(IpcChannel.getState, () => state);
    ipcMain.on(IpcChannel.rendererReady, () => {
      broadcast();
      console.log("[kinetic] renderer ready");
      console.log("[capability] transparent window: yes (frameless, no chrome)");
      console.log(`[capability] always on top: ${overlay.capabilities.alwaysOnTop ? "yes" : "no"}`);
      console.log(`[capability] click-through: ${overlay.capabilities.clickThrough ? "yes" : "no"}`);
      console.log("[capability] return from click-through: tray extra + CommandOrControl+Alt+P");
    });
    ipcMain.on(IpcChannel.setMotionMode, (_event, mode: MotionMode) => setMotionMode(mode));
    ipcMain.on(IpcChannel.setTrails, (_event, enabled: boolean) => setTrails(enabled));
    ipcMain.on(IpcChannel.setPivotInertia, (_event, enabled: boolean) => setPivotInertia(enabled));
    ipcMain.on(IpcChannel.updatePhysics, (_event, patch: Partial<PhysicsSettings>) => {
      setPhysics(clampPhysics({ ...state.physics, ...patch }));
    });
    ipcMain.on(IpcChannel.resetPhysics, () => setPhysics({ ...defaultPhysicsSettings }));
    ipcMain.on(IpcChannel.resetObject, () => reset());

    const bench = process.env.KINETIC_BENCH;
    if (bench) {
      const samples: Array<{ cpu: number; memory: number; type: string }> = [];
      const collect = () => {
        for (const metric of app.getAppMetrics()) {
          samples.push({
            cpu: metric.cpu.percentCPUUsage,
            memory: metric.memory.workingSetSize,
            type: metric.type,
          });
        }
      };
      browserWindow.webContents.once("did-finish-load", () => {
        setTimeout(() => {
          browserWindow.webContents.send(IpcChannel.benchControl, "start");
          const tick = setInterval(collect, 1000);
          setTimeout(() => {
            clearInterval(tick);
            ipcMain.once(IpcChannel.benchResult, (_event, renderer) => {
              const byType: Record<string, { cpu: number[]; memory: number[] }> = {};
              for (const sample of samples) {
                const bucket = byType[sample.type] ?? { cpu: [], memory: [] };
                bucket.cpu.push(sample.cpu);
                bucket.memory.push(sample.memory);
                byType[sample.type] = bucket;
              }
              const summarize = (values: number[]) => {
                if (!values.length) return { avg: 0, max: 0 };
                return {
                  avg: values.reduce((sum, value) => sum + value, 0) / values.length,
                  max: Math.max(...values),
                };
              };
              const report = {
                label: bench,
                dpr: undefined,
                renderer,
                processes: Object.fromEntries(
                  Object.entries(byType).map(([type, bucket]) => [
                    type,
                    {
                      cpuPercent: summarize(bucket.cpu),
                      memoryMB: {
                        avg: summarize(bucket.memory).avg / 1024,
                        max: summarize(bucket.memory).max / 1024,
                      },
                    },
                  ]),
                ),
              };
              console.log(`[kinetic-bench] ${JSON.stringify(report)}`);
              if (process.env.KINETIC_BENCH_QUIT === "1") app.quit();
            });
            browserWindow.webContents.send(IpcChannel.benchControl, "stop");
          }, Number(process.env.KINETIC_BENCH_MS ?? 30000));
        }, Number(process.env.KINETIC_BENCH_WARMUP_MS ?? 5000));
      });
    }

    const shortcutOk = globalShortcut.register(GLOBAL_TOGGLE_ACCELERATOR, () => {
      setInteractionMode(state.interactionMode === "control" ? "passthrough" : "control");
    });
    console.log(`[capability] global shortcut ${GLOBAL_TOGGLE_ACCELERATOR}: ${shortcutOk ? "yes" : "no"}`);

    app.on("second-instance", () => {
      setInteractionMode("control");
    });

    app.on("activate", () => {
      setInteractionMode("control");
    });
  });
}

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
