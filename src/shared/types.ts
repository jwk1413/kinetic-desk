export type InteractionMode = "control" | "passthrough";
export type MotionMode = "natural" | "driven";
export type PendulumStyle = "bobs" | "sticks";

export type BobCount = 1 | 2 | 3;

export interface PhysicsSettings {
  windowSize: number;
  naturalDamping: number;
  drivenDamping: number;
  driveEnergy: number;
  timeScale: number;
  gravity: number;
  bobCount: BobCount;
  length1: number;
  length2: number;
  length3: number;
  mass1: number;
  mass2: number;
  mass3: number;
  style: PendulumStyle;
}

export type DisplayFps = 30 | 60;

export interface AppState {
  interactionMode: InteractionMode;
  motionMode: MotionMode;
  paused: boolean;
  trails: boolean;
  pivotInertia: boolean;
  displayFps: DisplayFps;
  frameDebug: boolean;
  physics: PhysicsSettings;
}

export const defaultPhysicsSettings: PhysicsSettings = {
  windowSize: 700,
  naturalDamping: 0.014,
  drivenDamping: 0.0035,
  driveEnergy: 28,
  timeScale: 1,
  gravity: 9.81,
  bobCount: 2,
  length1: 1,
  length2: 0.88,
  length3: 0.76,
  mass1: 1.15,
  mass2: 1,
  mass3: 0.88,
  style: "bobs",
};

export const defaultAppState: AppState = {
  interactionMode: "control",
  motionMode: "driven",
  paused: false,
  trails: false,
  pivotInertia: false,
  displayFps: 30,
  frameDebug: false,
  physics: { ...defaultPhysicsSettings },
};

export const physicsLimits: Record<Exclude<keyof PhysicsSettings, "style">, { min: number; max: number; step: number; label: string; unit: string }> = {
  windowSize: { min: 360, max: 1200, step: 10, label: "창 크기", unit: "px" },
  timeScale: { min: 0.2, max: 2.5, step: 0.05, label: "시간", unit: "×" },
  naturalDamping: { min: 0, max: 0.12, step: 0.001, label: "감쇠", unit: "" },
  drivenDamping: { min: 0, max: 0.08, step: 0.001, label: "감쇠", unit: "" },
  driveEnergy: { min: 4, max: 48, step: 0.5, label: "구동", unit: "" },
  gravity: { min: 2, max: 20, step: 0.1, label: "중력", unit: "" },
  bobCount: { min: 1, max: 3, step: 1, label: "진자", unit: "" },
  length1: { min: 0.4, max: 1.6, step: 0.01, label: "막대 1", unit: "" },
  length2: { min: 0.4, max: 1.6, step: 0.01, label: "막대 2", unit: "" },
  length3: { min: 0.4, max: 1.6, step: 0.01, label: "막대 3", unit: "" },
  mass1: { min: 0.3, max: 3, step: 0.01, label: "추 1", unit: "" },
  mass2: { min: 0.3, max: 3, step: 0.01, label: "추 2", unit: "" },
  mass3: { min: 0.3, max: 3, step: 0.01, label: "추 3", unit: "" },
};

export const WINDOW_WIDTH = 700;
export const WINDOW_HEIGHT = 720;

export const GLOBAL_TOGGLE_ACCELERATOR = "CommandOrControl+Alt+P";
