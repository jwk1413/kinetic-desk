export type InteractionMode = "control" | "passthrough";
export type MotionMode = "natural" | "driven";
export type PendulumStyle = "bobs" | "sticks";

export type BobCount = 1 | 2 | 3;

/** Everything the menu bar can change. The shape of the pendulum itself is fixed
 * in the physics module — see PENDULUM in src/renderer/src/physics. */
export interface PhysicsSettings {
  windowSize: number;
  timeScale: number;
  bobCount: BobCount;
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
  timeScale: 1,
  bobCount: 2,
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

export const physicsLimits: Record<Exclude<keyof PhysicsSettings, "style" | "bobCount">, { min: number; max: number }> = {
  windowSize: { min: 360, max: 1200 },
  timeScale: { min: 0.2, max: 2.5 },
};

export const WINDOW_WIDTH = 700;
export const WINDOW_HEIGHT = 720;

export const GLOBAL_TOGGLE_ACCELERATOR = "CommandOrControl+Alt+P";
