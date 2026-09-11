import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel, type DeskApi, type DisplayLayout, type WindowOrigin } from "../shared/ipc";
import type { AppState, MotionMode, PhysicsSettings } from "../shared/types";

const api: DeskApi = {
  ready() {
    ipcRenderer.send(IpcChannel.rendererReady);
  },
  getState() {
    return ipcRenderer.invoke(IpcChannel.getState) as Promise<AppState>;
  },
  setClickThrough(ignore: boolean) {
    ipcRenderer.send(IpcChannel.setClickThrough, ignore);
  },
  moveWindowBy(dx: number, dy: number) {
    ipcRenderer.send(IpcChannel.moveWindowBy, dx, dy);
  },
  setPivotOffset(x: number, y: number) {
    ipcRenderer.send(IpcChannel.setPivotOffset, x, y);
  },
  updatePhysics(physics: Partial<PhysicsSettings>) {
    ipcRenderer.send(IpcChannel.updatePhysics, physics);
  },
  setMotionMode(mode: MotionMode) {
    ipcRenderer.send(IpcChannel.setMotionMode, mode);
  },
  setTrails(enabled: boolean) {
    ipcRenderer.send(IpcChannel.setTrails, enabled);
  },
  setPivotInertia(enabled: boolean) {
    ipcRenderer.send(IpcChannel.setPivotInertia, enabled);
  },
  resetPhysics() {
    ipcRenderer.send(IpcChannel.resetPhysics);
  },
  resetObject() {
    ipcRenderer.send(IpcChannel.resetObject);
  },
  getWindowBounds() {
    return ipcRenderer.invoke(IpcChannel.getWindowBounds) as Promise<WindowOrigin>;
  },
  onWindowBounds(callback: (origin: WindowOrigin) => void) {
    const listener = (_event: Electron.IpcRendererEvent, origin: WindowOrigin) => {
      callback(origin);
    };
    ipcRenderer.on(IpcChannel.windowBounds, listener);
    return () => ipcRenderer.removeListener(IpcChannel.windowBounds, listener);
  },
  getDisplayLayout() {
    return ipcRenderer.invoke(IpcChannel.getDisplayLayout) as Promise<DisplayLayout>;
  },
  onDisplayLayout(callback: (layout: DisplayLayout) => void) {
    const listener = (_event: Electron.IpcRendererEvent, layout: DisplayLayout) => {
      callback(layout);
    };
    ipcRenderer.on(IpcChannel.displayLayout, listener);
    return () => ipcRenderer.removeListener(IpcChannel.displayLayout, listener);
  },
  onState(callback: (state: AppState) => void) {
    const listener = (_event: Electron.IpcRendererEvent, next: AppState) => {
      callback(next);
    };
    ipcRenderer.on(IpcChannel.appState, listener);
    const resetListener = () => {
      window.dispatchEvent(new Event("kinetic-reset"));
    };
    ipcRenderer.on(IpcChannel.resetObject, resetListener);
    return () => {
      ipcRenderer.removeListener(IpcChannel.appState, listener);
      ipcRenderer.removeListener(IpcChannel.resetObject, resetListener);
    };
  },
  onBenchControl(callback: (command: "start" | "stop") => void) {
    const listener = (_event: Electron.IpcRendererEvent, command: "start" | "stop") => {
      callback(command);
    };
    ipcRenderer.on(IpcChannel.benchControl, listener);
    return () => ipcRenderer.removeListener(IpcChannel.benchControl, listener);
  },
  sendBenchResult(payload: unknown) {
    ipcRenderer.send(IpcChannel.benchResult, payload);
  },
};

contextBridge.exposeInMainWorld("desk", api);
