import { FrameDebug } from "./frame-debug";
import type { AppState } from "../../shared/types";
import { WINDOW_HEIGHT, WINDOW_WIDTH, defaultAppState } from "../../shared/types";
import { DoublePendulumObject } from "./objects/double-pendulum";
import type { HitPart } from "./objects/types";
import { perf } from "./perf";
import { invalidateSizeCaches, prepareShadowBuffer } from "./render/shapes";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas 2D is not available");
const ctx = context;
const frameDebug = new FrameDebug();
function syncFrameDebug(): void {
  perf.setDebug(Boolean(appState.frameDebug));
  frameDebug.configure(Boolean(appState.frameDebug), targetFps(), sceneIdle(), document.visibilityState === "hidden");
}

const params = new URLSearchParams(location.search);
const benchMode = params.has("bench");
const benchObjects = Math.max(1, Math.min(30, Number(params.get("objects") ?? 1) || 1));
const drawShadows = params.get("shadows") !== "0";
const desk = window.desk;

let objects: DoublePendulumObject[] = [new DoublePendulumObject()];
let appState: AppState = { ...defaultAppState, physics: { ...defaultAppState.physics } };
let hovered: HitPart | null = null;
let hoverObject: DoublePendulumObject | null = null;
let dragging: HitPart | null = null;
let dragObject: DoublePendulumObject | null = null;
let pointerId: number | null = null;
let lastOverObject = false;
let lastTime = performance.now();
let nextDraw = 0;
let scheduledFps = 0;
let lastMouse = { x: 0, y: 0 };
let lastScreen = { x: 0, y: 0 };
let frames = 0;
let fpsTime = performance.now();
let viewWidth = WINDOW_WIDTH;
let viewHeight = WINDOW_HEIGHT;
let dirty = true;
let loopActive = false;
let rafId = 0;
let wasHidden = document.visibilityState === "hidden";

function primary(): DoublePendulumObject {
  return objects[0];
}

function spawnObjects(count: number): void {
  for (const object of objects) object.dispose();
  objects = [];
  for (let i = 0; i < count; i += 1) {
    const object = new DoublePendulumObject();
    object.layout(viewWidth, viewHeight);
    object.applyPhysics(appState.physics);
    if (i > 0) {
      object.consumeWindowShift();
      placeBenchObject(object, i);
    }
    objects.push(object);
  }
}

function placeBenchObject(object: DoublePendulumObject, index: number): void {
  const col = (index - 1) % 6;
  const row = Math.floor((index - 1) / 6);
  object.origin = {
    x: 80 + col * Math.min(160, viewWidth / 6),
    y: 80 + row * Math.min(150, viewHeight / 5),
  };
}

function hitScene(x: number, y: number): { object: DoublePendulumObject; part: HitPart } | null {
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const hit = objects[i].hitTest(x, y);
    if (hit) return { object: objects[i], part: hit.part };
  }
  return null;
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  viewWidth = window.innerWidth || WINDOW_WIDTH;
  viewHeight = window.innerHeight || WINDOW_HEIGHT;
  canvas.width = Math.round(viewWidth * dpr);
  canvas.height = Math.round(viewHeight * dpr);
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  prepareShadowBuffer(viewWidth, viewHeight, dpr);
  invalidateSizeCaches();
  for (let i = 0; i < objects.length; i += 1) {
    objects[i].layout(viewWidth, viewHeight);
    if (i === 0) applyWindowShift();
    else {
      objects[i].consumeWindowShift();
      placeBenchObject(objects[i], i);
    }
  }
  markDirty();
}

function applyWindowShift(): void {
  const shift = primary().consumeWindowShift();
  // Report first: the main process clamps the move against the pivot, so it
  // needs the position the object has *already* settled into.
  pushObjectAnchor();
  // A correction, not a move: it cancels a shift the object just made inside the
  // canvas, so clamping it would drag the object away from where the user put it.
  if (shift.x !== 0 || shift.y !== 0) desk?.moveWindowBy(shift.x, shift.y, false);
}

let lastAnchor = { pivotX: NaN, pivotY: NaN, reach: NaN };

/**
 * Tells the main process where the object hangs inside the window so it can keep
 * it reachable. The window clamp on its own only knows the window, which is
 * mostly empty space — the object could be dragged or resized off the desktop
 * while the window still technically overlapped it.
 */
function pushObjectAnchor(): void {
  if (!desk) return;
  const object = primary();
  if (!object) return;
  const next = object.anchorInfo();
  if (next.pivotX === lastAnchor.pivotX && next.pivotY === lastAnchor.pivotY
    && next.reach === lastAnchor.reach) return;
  lastAnchor = next;
  desk.setObjectAnchor(next);
}

function pointer(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function syncClickThrough(overObject: boolean): void {
  if (!desk) return;
  if (appState.interactionMode === "passthrough") {
    if (lastOverObject) {
      lastOverObject = false;
      desk.setClickThrough(true);
    }
    return;
  }
  const capture = overObject || dragging !== null;
  if (capture === lastOverObject) return;
  lastOverObject = capture;
  desk.setClickThrough(!capture);
}

function movesOverlay(part: HitPart | null): boolean {
  if (!part) return false;
  if (appState.physics.style === "sticks") return part === "pivot";
  return part === "pivot" || part === "rod1";
}

function cursorFor(part: HitPart | null): string {
  if (appState.interactionMode === "passthrough") return "none";
  if (part === "pivot" || part === "rod1") return dragging ? "grabbing" : "move";
  if (part === "bob1" || part === "bob2" || part === "bob3" || part === "rod2" || part === "rod3") {
    return dragging ? "grabbing" : "grab";
  }
  return "default";
}

function dragVisual(part: HitPart | null): HitPart | null {
  if (part === "rod1") return "pivot";
  if (part === "rod2") return "bob2";
  if (part === "rod3") return "bob3";
  return part;
}

function releaseCapture(): void {
  if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) {
    canvas.releasePointerCapture(pointerId);
  }
  pointerId = null;
}

function finishDrag(): void {
  if (!dragging) return;
  dragObject?.endDrag();
  dragging = null;
  dragObject = null;
  releaseCapture();
  syncFrameDebug();
  markDirty();
}

function cancelPointerDrag(): void {
  if (!dragging) return;
  dragObject?.cancelDrag();
  dragging = null;
  dragObject = null;
  releaseCapture();
  syncFrameDebug();
  markDirty();
}

function onPointerDown(event: PointerEvent): void {
  if (appState.interactionMode !== "control") return;
  if (event.button === 2) return;
  const point = pointer(event);
  const hit = hitScene(point.x, point.y);
  if (!hit) return;
  dragging = hit.part;
  dragObject = hit.object;
  hovered = hit.part;
  hoverObject = hit.object;
  lastMouse = point;
  lastScreen = { x: event.screenX, y: event.screenY };
  pointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  hit.object.beginDrag({ part: hit.part }, point.x, point.y, {
    pivotInertia: appState.pivotInertia,
    screenX: event.screenX,
    screenY: event.screenY,
  });
  canvas.style.cursor = cursorFor(hit.part);
  syncFrameDebug();
  markDirty();
}

function onPointerMove(event: PointerEvent): void {
  if (appState.interactionMode === "passthrough") {
    if (hovered !== null || hoverObject !== null) {
      hovered = null;
      hoverObject = null;
      canvas.style.cursor = "none";
      markDirty();
    }
    lastMouse = pointer(event);
    lastScreen = { x: event.screenX, y: event.screenY };
    return;
  }
  const point = pointer(event);
  const hit = hitScene(point.x, point.y);
  const previousHovered = hovered;
  const previousObject = hoverObject;
  hovered = dragging ?? hit?.part ?? null;
  hoverObject = dragObject ?? hit?.object ?? null;
  syncClickThrough(Boolean(hit) || dragging !== null);
  canvas.style.cursor = cursorFor(hovered);
  if (dragging || hovered !== previousHovered || hoverObject !== previousObject) markDirty();

  if (!dragging || !dragObject || appState.interactionMode !== "control") {
    lastMouse = point;
    lastScreen = { x: event.screenX, y: event.screenY };
    return;
  }

  if (movesOverlay(dragging) && dragObject === primary()) {
    const dx = event.screenX - lastScreen.x;
    const dy = event.screenY - lastScreen.y;
    if (dx !== 0 || dy !== 0) {
      const overflow = primary().shiftBy(dx, dy);
      pushObjectAnchor();
      if (overflow.x !== 0 || overflow.y !== 0) desk?.moveWindowBy(overflow.x, overflow.y);
    }
  }
  dragObject.dragTo(point.x, point.y, { screenX: event.screenX, screenY: event.screenY });
  lastMouse = point;
  lastScreen = { x: event.screenX, y: event.screenY };
}

function onPointerUp(event: PointerEvent): void {
  if (pointerId !== null && event.pointerId !== pointerId) return;
  const point = pointer(event);
  finishDrag();
  if (appState.interactionMode === "passthrough") {
    hovered = null;
    hoverObject = null;
    canvas.style.cursor = "none";
    markDirty();
    return;
  }
  const hit = hitScene(point.x, point.y);
  hovered = hit?.part ?? null;
  hoverObject = hit?.object ?? null;
  syncClickThrough(Boolean(hovered));
  canvas.style.cursor = cursorFor(hovered);
  markDirty();
}

function targetFps(): number {
  if (dragging) return 60;
  return appState.displayFps === 60 ? 60 : 30;
}

function sceneIdle(): boolean {
  return appState.paused && dragging === null;
}

function markDirty(): void {
  dirty = true;
  ensureLoop();
}

function ensureLoop(): void {
  if (document.visibilityState === "hidden") return;
  if (loopActive) return;
  loopActive = true;
  lastTime = performance.now();
  rafId = requestAnimationFrame(tick);
}

function tick(now: number): void {
  perf.raf();
  if (document.visibilityState === "hidden") {
    wasHidden = true;
    loopActive = false;
    return;
  }
  if (wasHidden) {
    wasHidden = false;
    lastTime = now;
    dirty = true;
  }

  const frameStart = perf.now();
  const debugBefore = appState.frameDebug ? perf.snapshot() : null;
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  const idle = sceneIdle();

  if (!idle) {
    const physicsStart = perf.now();
    const timeScale = appState.physics.timeScale || 1;
    const sim = {
      paused: appState.paused,
      motionMode: appState.motionMode,
      trails: appState.trails,
    };
    for (const object of objects) object.update(dt * timeScale, sim);
    perf.add("physicsMs", perf.now() - physicsStart);
  }

  const fps = targetFps();
  const interval = 1000 / fps;
  if (fps !== scheduledFps) { scheduledFps = fps; nextDraw = now; }
  // RAF timestamps jitter around the display cadence. Accept a slightly early
  // callback rather than losing a whole refresh; keep the original deadline
  // progression below so this allowance cannot accumulate into a faster rate.
  const earlyToleranceMs = 2;
  const due = now + earlyToleranceMs >= nextDraw;
  const earlyBy = nextDraw - now;
  const willDraw = (!idle || dirty) && due;
  if ((!idle || dirty) && due) {
    const drawStart = perf.now();
    ctx.clearRect(0, 0, viewWidth, viewHeight);
    const dragPart = appState.interactionMode === "control" ? dragVisual(dragging) : null;
    for (const object of objects) {
      const active = appState.interactionMode === "control" && (object === hoverObject || object === dragObject);
      object.draw(ctx, {
        interactionMode: appState.interactionMode,
        hovered: active ? hovered : null,
        dragging: object === dragObject ? dragPart : null,
        shadows: drawShadows,
      });
    }
    perf.add("drawMs", perf.now() - drawStart);
    perf.draw();
    frameDebug.draw(now);
    nextDraw += Math.max(1, Math.floor((now - nextDraw + 0.001) / interval) + 1) * interval;
    dirty = false;
  }
  perf.add("frameMs", perf.now() - frameStart);
  if (debugBefore) {
    const after = perf.snapshot();
    frameDebug.tick(now, frameStart, willDraw, !idle && !due ? earlyBy : 0, {
      physics: after.physicsMs - debugBefore.physicsMs,
      draw: after.drawMs - debugBefore.drawMs,
      shadow: after.shadowMs - debugBefore.shadowMs,
      total: after.frameMs - debugBefore.frameMs,
    });
  }

  frames += 1;
  if (now - fpsTime > 30000) {
    const fps = (frames * 1000) / (now - fpsTime);
    if (fps < 20) {
      console.log(`[kinetic] ${fps.toFixed(0)} ticks/s, dt=${(dt * 1000).toFixed(1)}ms`);
    }
    frames = 0;
    fpsTime = now;
  }

  if (sceneIdle() && !dirty) {
    loopActive = false;
    return;
  }
  rafId = requestAnimationFrame(tick);
}

window.addEventListener("resize", resize);
window.addEventListener("visibilitychange", () => {
  syncFrameDebug();
  if (document.visibilityState === "hidden") {
    wasHidden = true;
    loopActive = false;
    if (rafId) cancelAnimationFrame(rafId);
    return;
  }
  lastTime = performance.now();
  dirty = true;
  ensureLoop();
});
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("lostpointercapture", onPointerUp);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("kinetic-reset", () => {
  cancelPointerDrag();
  for (const object of objects) object.reset();
  pushObjectAnchor();
  hovered = null;
  hoverObject = null;
  syncClickThrough(false);
  canvas.style.cursor = cursorFor(null);
  markDirty();
});

desk?.onState((next) => {
  const leftControl = appState.interactionMode === "control" && next.interactionMode === "passthrough";
  const countChanged = next.physics.bobCount !== appState.physics.bobCount;
  const styleChanged = next.physics.style !== appState.physics.style;
  appState = next;
  syncFrameDebug();
  if (countChanged || styleChanged) cancelPointerDrag();
  for (const object of objects) object.applyPhysics(next.physics);
  applyWindowShift();
  for (let i = 1; i < objects.length; i += 1) {
    objects[i].consumeWindowShift();
    placeBenchObject(objects[i], i);
  }
  if (leftControl) {
    lastOverObject = true;
    finishDrag();
    hovered = null;
    hoverObject = null;
    canvas.style.cursor = "none";
  }
  syncClickThrough(Boolean(hitScene(lastMouse.x, lastMouse.y)));
  markDirty();
});

desk?.onBenchControl?.((command) => {
  if (command === "start") perf.start();
  if (command === "stop") {
    desk?.sendBenchResult?.({
      ...perf.stop(),
      dpr: window.devicePixelRatio || 1,
      viewWidth,
      viewHeight,
      objects: objects.length,
      shadows: drawShadows,
      displayFps: appState.displayFps,
      paused: appState.paused,
      trails: appState.trails,
      style: appState.physics.style,
    });
  }
});

resize();
if (benchObjects > 1) spawnObjects(benchObjects);
if (benchMode) {
  console.log(`[kinetic] bench loop objects=${objects.length} shadows=${drawShadows ? "on" : "off"}`);
}
ensureLoop();

void desk?.getState()?.then((state) => {
  appState = state;
  syncFrameDebug();
  for (const object of objects) object.applyPhysics(state.physics);
  applyWindowShift();
  markDirty();
});
desk?.ready();
syncClickThrough(false);
