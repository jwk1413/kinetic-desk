import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultPhysicsSettings,
  physicsLimits,
  type DisplayFps,
  type MotionMode,
  type PhysicsSettings,
} from "../shared/types";

export interface StoredSettings {
  physics: PhysicsSettings;
  pivotInertia: boolean;
  displayFps: DisplayFps;
  motionMode: MotionMode;
}

const WINDOW_SIZE_MIGRATION: Record<number, number> = {
  260: 500,
  400: 700,
  560: 900,
  720: 1100,
};

function migrateWindowSize(input: Partial<PhysicsSettings>): Partial<PhysicsSettings> {
  const size = Number(input.windowSize);
  if (!Number.isFinite(size) || WINDOW_SIZE_MIGRATION[size] === undefined) return input;
  return { ...input, windowSize: WINDOW_SIZE_MIGRATION[size] };
}

export function clampPhysics(input: Partial<PhysicsSettings>): PhysicsSettings {
  // Built key by key rather than spread: settings files written by older
  // versions carry ten fields that are constants now, and spreading them would
  // keep copying them forward forever.
  const number = (value: unknown, key: keyof typeof physicsLimits) => {
    const { min, max } = physicsLimits[key];
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : defaultPhysicsSettings[key];
  };
  const count = Math.round(Number(input.bobCount));
  return {
    windowSize: number(input.windowSize, "windowSize"),
    timeScale: number(input.timeScale, "timeScale"),
    bobCount: (Number.isFinite(count)
      ? Math.min(3, Math.max(1, count))
      : defaultPhysicsSettings.bobCount) as PhysicsSettings["bobCount"],
    style: input.style === "sticks" ? "sticks" : "bobs",
  };
}

function settingsPath(): string {
  return join(app.getPath("userData"), "physics.json");
}

export function loadSettings(): StoredSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<PhysicsSettings> & {
      physics?: Partial<PhysicsSettings>;
      pivotInertia?: boolean;
      displayFps?: number;
      motionMode?: string;
    };
    const physics = clampPhysics(migrateWindowSize(parsed.physics ?? parsed));
    const fps = Number(parsed.displayFps) === 60 ? 60 : 30;
    return {
      physics,
      pivotInertia: Boolean(parsed.pivotInertia),
      displayFps: fps,
      motionMode: parsed.motionMode === "natural" ? "natural" : "driven",
    };
  } catch {
    return {
      physics: { ...defaultPhysicsSettings },
      pivotInertia: false,
      displayFps: 30,
      motionMode: "driven",
    };
  }
}

export function saveSettings(settings: StoredSettings): void {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

export function loadPhysics(): PhysicsSettings {
  return loadSettings().physics;
}

export function savePhysics(physics: PhysicsSettings): void {
  saveSettings({ ...loadSettings(), physics });
}
