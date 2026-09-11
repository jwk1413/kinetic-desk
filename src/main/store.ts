import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPhysicsSettings, physicsLimits, type DisplayFps, type PhysicsSettings } from "../shared/types";

export interface StoredSettings {
  physics: PhysicsSettings;
  pivotInertia: boolean;
  displayFps: DisplayFps;
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
  const next = { ...defaultPhysicsSettings, ...input };
  (Object.keys(physicsLimits) as Array<Exclude<keyof PhysicsSettings, "style">>).forEach((key) => {
    if (key === "bobCount") return;
    const { min, max } = physicsLimits[key];
    const value = Number(next[key]);
    next[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : defaultPhysicsSettings[key];
  });
  const count = Math.min(3, Math.max(1, Math.round(Number(next.bobCount))));
  next.bobCount = (count === 1 || count === 3 ? count : 2) as PhysicsSettings["bobCount"];
  next.style = next.style === "sticks" ? "sticks" : "bobs";
  return next;
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
    };
    const physics = clampPhysics(migrateWindowSize(parsed.physics ?? parsed));
    const fps = Number(parsed.displayFps) === 60 ? 60 : 30;
    return {
      physics,
      pivotInertia: Boolean(parsed.pivotInertia),
      displayFps: fps,
    };
  } catch {
    return { physics: { ...defaultPhysicsSettings }, pivotInertia: false, displayFps: 30 };
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
  const current = loadSettings();
  saveSettings({ physics, pivotInertia: current.pivotInertia, displayFps: current.displayFps });
}
