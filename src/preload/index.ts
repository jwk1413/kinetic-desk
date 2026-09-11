import { contextBridge, ipcRenderer } from "electron";
import { IpcChannel, type DeskApi, type ObjectAnchor, type WindowOrigin } from "../shared/ipc";
import type { AppState } from "../shared/types";

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
  setObjectAnchor(anchor: ObjectAnchor) {
    ipcRenderer.send(IpcChannel.setObjectAnchor, anchor);
  },
  dragObjectTo(x: number, y: number) {
    ipcRenderer.send(IpcChannel.dragObjectTo, x, y);
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
