import { Menu, Tray, type BrowserWindow } from "electron";
import type { AppState, InteractionMode, MotionMode, PhysicsSettings } from "../shared/types";
import { createTrayIcon } from "./icon";

const WINDOW_SIZES = [
  { label: "작게", value: 500 },
  { label: "보통", value: 700 },
  { label: "크게", value: 900 },
  { label: "아주 크게", value: 1100 },
];

const TIME_SCALES = [
  { label: "0.5×", value: 0.5 },
  { label: "0.75×", value: 0.75 },
  { label: "1×", value: 1 },
  { label: "1.5×", value: 1.5 },
  { label: "2×", value: 2 },
];

export interface TrayHandlers {
  setInteractionMode: (mode: InteractionMode) => void;
  setMotionMode: (mode: MotionMode) => void;
  togglePause: () => void;
  setFrameDebug: (enabled: boolean) => void;
  reset: () => void;
  setTrails: (enabled: boolean) => void;
  setPivotInertia: (enabled: boolean) => void;
  setDisplayFps: (fps: 30 | 60) => void;
  patchPhysics: (patch: Partial<PhysicsSettings>) => void;
  resetPhysics: () => void;
  quit: () => void;
}

export function createAppTray(
  window: BrowserWindow,
  getState: () => AppState,
  handlers: TrayHandlers,
): { tray: Tray; rebuild: () => void } {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip("키네틱 데스크");
  if (process.platform === "darwin") tray.setTitle("키네틱");

  const rebuild = () => {
    const state = getState();
    const size = nearest(WINDOW_SIZES.map((item) => item.value), state.physics.windowSize);
    const time = nearest(TIME_SCALES.map((item) => item.value), state.physics.timeScale);
    const menu = Menu.buildFromTemplate([
      {
        label: "조작 모드",
        type: "radio",
        checked: state.interactionMode === "control",
        click: () => handlers.setInteractionMode("control"),
      },
      {
        label: "감상 모드 (클릭 통과)",
        type: "radio",
        checked: state.interactionMode === "passthrough",
        click: () => handlers.setInteractionMode("passthrough"),
      },
      { type: "separator" },
      {
        label: "자연히 멈추기",
        type: "radio",
        checked: state.motionMode === "natural",
        click: () => handlers.setMotionMode("natural"),
      },
      {
        label: "움직임 유지",
        type: "radio",
        checked: state.motionMode === "driven",
        click: () => handlers.setMotionMode("driven"),
      },
      { type: "separator" },
      {
        label: "형태",
        submenu: [
          { label: "추 진자", value: "bobs" as const },
          { label: "스윙잉 스틱스", value: "sticks" as const },
        ].map((item) => ({
          label: item.label,
          type: "radio" as const,
          checked: state.physics.style === item.value,
          click: () => handlers.patchPhysics({ style: item.value }),
        })),
      },
      {
        label: "진자",
        submenu: [
          { label: "1중 진자", value: 1 as const },
          { label: "2중 진자", value: 2 as const },
          { label: "3중 진자", value: 3 as const },
        ].map((item) => ({
          label: item.label,
          type: "radio" as const,
          checked: state.physics.bobCount === item.value,
          click: () => handlers.patchPhysics({ bobCount: item.value }),
        })),
      },
      {
        label: "창 크기",
        submenu: WINDOW_SIZES.map((item) => ({
          label: item.label,
          type: "radio" as const,
          checked: item.value === size,
          click: () => handlers.patchPhysics({ windowSize: item.value }),
        })),
      },
      {
        label: "시간",
        submenu: TIME_SCALES.map((item) => ({
          label: item.label,
          type: "radio" as const,
          checked: item.value === time,
          click: () => handlers.patchPhysics({ timeScale: item.value }),
        })),
      },
      {
        label: "잔상",
        type: "checkbox",
        checked: state.trails,
        click: (item) => handlers.setTrails(item.checked),
      },
      {
        label: "감상 주사율",
        submenu: [
          { label: "30fps (절전)", value: 30 as const },
          { label: "60fps (부드러움)", value: 60 as const },
        ].map((item) => ({
          label: item.label,
          type: "radio" as const,
          checked: state.displayFps === item.value,
          click: () => handlers.setDisplayFps(item.value),
        })),
      },
      ...(__KINETIC_DEV_TOOLS__
        ? [
            {
              label: "실시간 프레임 표시 (디버그)",
              type: "checkbox" as const,
              checked: state.frameDebug,
              click: (item: { checked: boolean }) => handlers.setFrameDebug(item.checked),
            },
          ]
        : []),
      {
        label: "고정점 이동 시 흔들림",
        type: "checkbox",
        checked: state.pivotInertia,
        toolTip: "고정점을 옮길 때 추도 관성에 따라 흔들립니다.",
        click: (item) => handlers.setPivotInertia(item.checked),
      },
      {
        label: "고정점을 옮길 때 추도 관성에 따라 흔들립니다.",
        enabled: false,
      },
      { type: "separator" },
      {
        label: state.paused ? "계속" : "일시정지",
        click: () => handlers.togglePause(),
      },
      {
        label: "진자 초기화",
        click: () => handlers.reset(),
      },
      {
        label: "기본값",
        click: () => handlers.resetPhysics(),
      },
      { type: "separator" },
      {
        label: "종료",
        click: () => handlers.quit(),
      },
    ]);
    tray.setContextMenu(menu);
  };

  rebuild();
  tray.on("click", () => {
    window.showInactive();
    tray.popUpContextMenu();
  });

  return { tray, rebuild };
}

function nearest(options: number[], value: number): number {
  return options.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best,
  );
}
