import { Menu, Tray, type BrowserWindow } from "electron";
import {
  GLOBAL_TOGGLE_ACCELERATOR,
  type AppState,
  type BobCount,
  type InteractionMode,
  type MotionMode,
  type PendulumStyle,
  type PhysicsSettings,
} from "../shared/types";
import { createTrayIcon } from "./icon";

/** A set of mutually exclusive values shown as a submenu of radio items. */
interface Choice<T> {
  label: string;
  value: T;
}

const SHAPES: Choice<PendulumStyle>[] = [
  { label: "추 진자", value: "bobs" },
  { label: "스윙잉 스틱스", value: "sticks" },
];

const COUNTS: Choice<BobCount>[] = [
  { label: "1중", value: 1 },
  { label: "2중", value: 2 },
  { label: "3중", value: 3 },
];

const SIZES: Choice<number>[] = [
  { label: "작게", value: 500 },
  { label: "보통", value: 700 },
  { label: "크게", value: 900 },
  { label: "아주 크게", value: 1100 },
];

const SPEEDS: Choice<number>[] = [
  { label: "0.5×", value: 0.5 },
  { label: "0.75×", value: 0.75 },
  { label: "1×", value: 1 },
  { label: "1.5×", value: 1.5 },
  { label: "2×", value: 2 },
];

const FRAME_RATES: Choice<30 | 60>[] = [
  { label: "30fps", value: 30 },
  { label: "60fps", value: 60 },
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

  /**
   * A submenu of radio items whose parent shows the current value, so the whole
   * setup is readable without opening anything.
   */
  function choice<T>(
    title: string,
    options: Choice<T>[],
    current: T,
    onPick: (value: T) => void,
    toolTip?: string,
  ) {
    const picked = options.find((option) => option.value === current) ?? options[0];
    return {
      label: `${title}: ${picked.label}`,
      toolTip,
      submenu: options.map((option) => ({
        label: option.label,
        type: "radio" as const,
        checked: option.value === current,
        click: () => onPick(option.value),
      })),
    };
  }

  const rebuild = () => {
    const state = getState();
    const { physics } = state;
    const menu = Menu.buildFromTemplate([
      {
        label: "클릭 통과",
        type: "checkbox",
        checked: state.interactionMode === "passthrough",
        // Shown, not registered: the global shortcut is already bound. Without
        // it here there is nothing to tell you how to get back once clicks pass
        // through and the object can no longer be clicked.
        accelerator: GLOBAL_TOGGLE_ACCELERATOR,
        registerAccelerator: false,
        toolTip: "켜면 모든 클릭이 뒤쪽 창으로 지나갑니다.",
        click: (item) => handlers.setInteractionMode(item.checked ? "passthrough" : "control"),
      },
      {
        label: "계속 흔들기",
        type: "checkbox",
        checked: state.motionMode === "driven",
        toolTip: "끄면 저절로 느려지다 멈춥니다.",
        click: (item) => handlers.setMotionMode(item.checked ? "driven" : "natural"),
      },
      { type: "separator" },
      choice("모양", SHAPES, physics.style, (style) => handlers.patchPhysics({ style })),
      choice("진자 수", COUNTS, physics.bobCount, (bobCount) => handlers.patchPhysics({ bobCount })),
      choice("크기", SIZES, nearest(SIZES, physics.windowSize), (windowSize) => handlers.patchPhysics({ windowSize })),
      choice("속도", SPEEDS, nearest(SPEEDS, physics.timeScale), (timeScale) => handlers.patchPhysics({ timeScale })),
      choice("프레임", FRAME_RATES, state.displayFps, handlers.setDisplayFps, "30fps는 배터리를 덜 씁니다."),
      {
        label: "잔상",
        type: "checkbox",
        checked: state.trails,
        click: (item) => handlers.setTrails(item.checked),
      },
      {
        label: "옮길 때 흔들리기",
        type: "checkbox",
        checked: state.pivotInertia,
        toolTip: "고정점을 옮기면 추도 관성에 따라 흔들립니다.",
        click: (item) => handlers.setPivotInertia(item.checked),
      },
      ...(__KINETIC_DEV_TOOLS__
        ? [
            {
              label: "프레임 정보 (개발용)",
              type: "checkbox" as const,
              checked: state.frameDebug,
              click: (item: { checked: boolean }) => handlers.setFrameDebug(item.checked),
            },
          ]
        : []),
      { type: "separator" },
      {
        label: state.paused ? "계속" : "일시정지",
        click: () => handlers.togglePause(),
      },
      {
        label: "움직임 초기화",
        toolTip: "진자를 처음 자세로 되돌립니다. 설정은 그대로입니다.",
        click: () => handlers.reset(),
      },
      {
        label: "설정 초기화",
        toolTip: "모양·크기·속도를 기본값으로 되돌립니다.",
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

/** The preset closest to a stored value, which may have been clamped to fit a display. */
function nearest(options: Choice<number>[], value: number): number {
  return options.reduce((best, option) =>
    Math.abs(option.value - value) < Math.abs(best - value) ? option.value : best,
  options[0].value);
}
