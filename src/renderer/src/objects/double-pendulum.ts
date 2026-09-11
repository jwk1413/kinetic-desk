import { WINDOW_WIDTH, type PhysicsSettings } from "../../../shared/types";
import {
  bobPositions,
  clampVelocities,
  defaultPendulumParams,
  driveTowardEnergy,
  kineticEnergy,
  isFiniteState,
  downwardReach,
  behindSpan,
  jointSpan,
  pendulumCount,
  restEnergy,
  rodSegments,
  stepRk4,
  projectStickGrab,
  stickGrabTorque,
  type LockedJoint,
  type PendulumParams,
  type PendulumState,
  type PivotAccel,
  type RodSegment,
  type StickGrab,
} from "../physics/double-pendulum";
import {
  PHYS_DT,
  PHYS_MAX_STEPS,
  STICK_DRIVEN_DAMPING,
  STICK_GRAB_FMAX,
  STICK_GRAB_KD,
  STICK_GRAB_KP,
  STICK_NATURAL_DAMPING,
  STICK_OMEGA_LIMIT,
  stickDriveTorque,
  stickGeometry,
} from "../physics/swinging-sticks";
import {
  pruneSamples,
  recentVelocity,
  type PathSample,
} from "../physics/drag";
import { clamp, distanceToSegment, lerp } from "../physics/math";
import { palette } from "../render/palette";
import { drawChromePin, drawChromeRod, drawGlassRod, drawPendulumShadow, drawPuck, drawStandBase } from "../render/shapes";
import type { DeskObject, DragMeta, DrawEnv, HitPart, HitResult, SimEnv } from "./types";

const PIVOT_RADIUS = 9;
const BOB_RADII = [11, 12, 12];
const BOB_COLORS = [palette.bob1, palette.bob2, palette.bob3];
const BOB_PARTS: HitPart[] = ["bob1", "bob2", "bob3"];
const ROD_PARTS: HitPart[] = ["rod1", "rod2", "rod3"];
const ROD_WIDTH = 6;
const STICK_WIDTH = 5.4;
const PIN_RADIUS = 4.2;
const HIT_PADDING = 8;
const MAX_OMEGA = 18;
const TRAIL_DURATION_MS = 4000;
const TRAIL_LAYERS = 6;
const LAYOUT_PADDING = 120;
const STAND_HEIGHT = 112;
const STAND_HALF = 24;
const STAND_BASE_H = 16;
const STAND_CLEARANCE = 13;
const TRAIL_BREAK_PX = 96;
const SHADOW_PAD = 28;
const SHADOW_BLEED = 8;
const WINDOW_CORNER_PAD = 24;

const SAMPLE_KEEP_MS = 180;
const MAX_PIVOT_ACCEL = 90;
const DRAG_STILL_PX = 1.2;
const TRAIL_MIN_DIST = 1.4;

export class DoublePendulumObject implements DeskObject {
  readonly id = "double-pendulum";
  origin = { x: 350, y: 360 };
  private scale = 118;
  private visualScale = 1;
  private params: PendulumParams = { ...defaultPendulumParams, masses: [...defaultPendulumParams.masses], lengths: [...defaultPendulumParams.lengths] };
  private physics: PhysicsSettings | null = null;
  private state: PendulumState = initialState(2);
  private dragging: HitPart | null = null;
  private dragPointer = { x: 0, y: 0 };
  private dragStill = false;
  private pivotInertia = false;
  private pivotSamples: PathSample[] = [];
  private lastPivotVelocity = { vx: 0, vy: 0, time: 0 };
  private pivotAccel: PivotAccel = { x: 0, y: 0 };
  private trail: Array<{ x: number; y: number; t: number }> = [];
  private prevState: PendulumState | null = null;
  private frameAlpha = 1;
  private placed = false;
  private canvasSize = { width: 700, height: 720 };
  private dragScreen = { x: 0, y: 0 };
  private physAccum = 0;
  private lastGood: PendulumState | null = null;
  private stickStartKick = true;
  private stickGrab: StickGrab | null = null;
  private windowShift = { x: 0, y: 0 };

  layout(width: number, height: number): void {
    const keepAnchor = this.placed;
    const anchor = keepAnchor ? this.canvasAnchor() : null;
    this.canvasSize = { width, height };
    this.updateScale();
    if (!this.placed) {
      const visual = this.physics?.windowSize ?? WINDOW_WIDTH;
      const sticks = this.params.model === "compound";
      this.origin = this.clampedOrigin({
        x: sticks ? width / 2 : width - 28 - visual * 0.42,
        y: sticks ? height * 0.38 : height * 0.22,
      });
      this.placed = true;
    } else if (anchor) {
      this.placeOriginAtAnchor(anchor);
    }
    this.fitOriginOnCanvas(keepAnchor);
  }

  applyPhysics(physics: PhysicsSettings): void {
    const next = paramsFromPhysics(physics);
    const countChanged = pendulumCount(next) !== pendulumCount(this.params);
    const styleChanged = next.model !== this.params.model;
    const keepAnchor = this.placed && !styleChanged;
    const anchor = keepAnchor ? this.canvasAnchor() : null;
    this.physics = physics;
    this.params = next;
    this.updateScale();
    if (styleChanged && next.model === "compound") {
      this.origin = this.clampedOrigin({
        x: this.canvasSize.width / 2,
        y: this.canvasSize.height * 0.38,
      });
    } else if (styleChanged) {
      this.origin = this.clampedOrigin(this.origin);
    } else if (anchor) {
      this.placeOriginAtAnchor(anchor);
    }
    this.fitOriginOnCanvas(keepAnchor);
    if (countChanged || styleChanged) {
      this.reset();
    }
  }

  consumeWindowShift(): { x: number; y: number } {
    const shift = this.windowShift;
    this.windowShift = { x: 0, y: 0 };
    return shift;
  }

  reset(): void {
    this.state = initialState(pendulumCount(this.params), this.params.model === "compound");
    this.dragging = null;
    this.dragStill = false;
    this.pivotSamples = [];
    this.pivotAccel = { x: 0, y: 0 };
    this.lastPivotVelocity = { vx: 0, vy: 0, time: 0 };
    this.trail = [];
    this.physAccum = 0;
    this.stickStartKick = true;
    this.stickGrab = null;
    this.prevState = { theta: [...this.state.theta], omega: [...this.state.omega] };
    this.frameAlpha = 1;
    this.lastGood = { theta: [...this.state.theta], omega: [...this.state.omega] };
  }

  dispose(): void {
    this.trail = [];
    this.pivotSamples = [];
    this.dragging = null;
    this.stickGrab = null;
    this.prevState = null;
    this.lastGood = null;
  }

  positions() {
    return bobPositions(this.state, this.origin, this.scale, this.params);
  }

  containsPoint(x: number, y: number): boolean {
    return this.hitTest(x, y) !== null;
  }

  hitTest(x: number, y: number): HitResult | null {
    if (this.params.model === "compound") return this.hitTestSticks(x, y);
    const bobs = this.positions();
    const { origin } = this;
    const n = bobs.length;
    const { pivot, bobs: bobR, rod, hit } = this.radii();
    for (let i = n - 1; i >= 0; i -= 1) {
      if (Math.hypot(x - bobs[i].x, y - bobs[i].y) <= bobR[i] + hit) return { part: BOB_PARTS[i] };
    }
    if (Math.hypot(x - origin.x, y - origin.y) <= pivot + hit + 4 * this.visualScale) return { part: "pivot" };
    for (let i = n - 1; i >= 0; i -= 1) {
      const start = i === 0 ? origin : bobs[i - 1];
      const end = bobs[i];
      if (distanceToSegment(x, y, start.x, start.y, end.x, end.y) <= rod + hit) return { part: ROD_PARTS[i] };
    }
    return null;
  }

  beginDrag(hit: HitResult, x: number, y: number, meta: DragMeta = {}): void {
    const part = resolveDragPart(hit.part, this.params.model === "compound");
    const index = bobIndex(part);
    this.dragging = part;
    this.dragPointer = { x, y };
    this.dragStill = false;
    this.stickStartKick = false;
    this.pivotInertia = Boolean(meta.pivotInertia);
    this.pivotSamples = [];
    this.pivotAccel = { x: 0, y: 0 };
    this.lastPivotVelocity = { vx: 0, vy: 0, time: 0 };
    this.dragScreen = {
      x: typeof meta.screenX === "number" ? meta.screenX : x,
      y: typeof meta.screenY === "number" ? meta.screenY : y,
    };
    const now = performance.now();
    if (index !== null) {
      const pivot = rodSegments(this.state, this.origin, this.scale, this.params)[index]?.pivot ?? this.origin;
      const local = projectStickGrab(
        pivot,
        this.state.theta[index] ?? 0,
        { x, y },
        this.scale,
        -behindSpan(this.params, index),
        jointSpan(this.params, index),
      );
      this.stickGrab = { index, along: local.along, perp: local.perp };
    } else {
      this.stickGrab = null;
    }
    if (this.dragging === "pivot") {
      this.pivotSamples.push({ time: now, x: this.dragScreen.x, y: this.dragScreen.y });
    }
  }

  dragTo(x: number, y: number, meta: DragMeta = {}): void {
    if (!this.dragging) return;
    const screenX = typeof meta.screenX === "number" ? meta.screenX : x;
    const screenY = typeof meta.screenY === "number" ? meta.screenY : y;
    const dx = this.dragging === "pivot" ? screenX - this.dragScreen.x : x - this.dragPointer.x;
    const dy = this.dragging === "pivot" ? screenY - this.dragScreen.y : y - this.dragPointer.y;
    if (Math.hypot(dx, dy) < DRAG_STILL_PX) {
      this.dragStill = true;
      this.pivotAccel = { x: 0, y: 0 };
      return;
    }

    this.dragStill = false;
    this.dragPointer = { x, y };
    this.dragScreen = { x: screenX, y: screenY };
    const now = performance.now();
    if (this.draggingPivotInertia()) {
      this.pivotSamples.push({ time: now, x: screenX, y: screenY });
      this.pivotSamples = pruneSamples(this.pivotSamples, now, SAMPLE_KEEP_MS);
      this.updatePivotAccel(now);
    }
  }

  endDrag(): void {
    if (!this.dragging) return;
    this.clearDrag();
  }

  cancelDrag(): void {
    this.clearDrag();
  }

  isDragging(): boolean {
    return this.dragging !== null;
  }

  update(dt: number, env: SimEnv): void {
    if (env.paused && !this.dragging) {
      this.frameAlpha = 1;
      return;
    }

    const now = performance.now();
    if (this.dragStill) {
      this.pivotAccel = { x: 0, y: 0 };
    } else if (this.draggingPivotInertia()) {
      this.updatePivotAccel(now);
    }

    const stepping = !env.paused || Boolean(this.dragging);
    if (stepping) {
      const accel = this.draggingPivotInertia() && !this.dragStill ? this.pivotAccel : { x: 0, y: 0 };
      const locked: LockedJoint[] = [];

      const capped = Math.min(Math.max(dt, 0), 0.125);
      this.physAccum += capped;
      let steps = 0;
      while (this.physAccum + 1e-12 >= PHYS_DT && steps < PHYS_MAX_STEPS) {
        this.prevState = { theta: [...this.state.theta], omega: [...this.state.omega] };
        this.integrate(PHYS_DT, env, accel, locked);
        this.physAccum = Math.max(0, this.physAccum - PHYS_DT);
        steps += 1;
      }
      if (steps >= PHYS_MAX_STEPS) this.physAccum %= PHYS_DT;
      this.frameAlpha = this.dragging ? 1 : clamp(this.physAccum / PHYS_DT, 0, 1);
    }

    if (env.trails) {
      const visual = this.visualState();
      if (this.params.model === "compound") {
        const tip = stickTrailTip(this.params, rodSegments(visual, this.origin, this.scale, this.params));
        if (tip) this.pushTrail(tip);
      } else {
        const bobs = bobPositions(visual, this.origin, this.scale, this.params);
        this.pushTrail(bobs[bobs.length - 1]);
      }
    } else if (this.trail.length) {
      this.trail = [];
    }
  }

  private visualState(): PendulumState {
    if (this.dragging || !this.prevState || this.frameAlpha >= 1) return this.state;
    return {
      theta: this.state.theta.map((theta, i) => lerp(this.prevState!.theta[i] ?? theta, theta, this.frameAlpha)),
      omega: this.state.omega,
    };
  }

  private integrate(dt: number, env: SimEnv, accel: PivotAccel, locked: LockedJoint[]): void {
    const sticks = this.params.model === "compound";
    const physics = this.physics;
    const damping = sticks
      ? (env.motionMode === "natural" ? STICK_NATURAL_DAMPING : STICK_DRIVEN_DAMPING)
      : env.motionMode === "natural"
        ? (physics?.naturalDamping ?? 0.014)
        : (physics?.drivenDamping ?? 0.0035);
    const n = pendulumCount(this.params);
    const grab = this.stickGrab;
    const driveTorque = grab && this.dragging
      ? stickGrabTorque(
        this.state,
        this.params,
        grab,
        {
          x: (this.dragPointer.x - this.origin.x) / this.scale,
          y: (this.dragPointer.y - this.origin.y) / this.scale,
        },
        STICK_GRAB_KP,
        STICK_GRAB_KD,
        STICK_GRAB_FMAX,
      )
      : sticks && !this.dragging && env.motionMode === "driven"
        ? stickDriveTorque(
          this.state,
          kineticEnergy(this.state, this.params),
          { startKick: this.stickStartKick },
        )
        : [];
    if (sticks && env.motionMode === "driven" && !this.dragging) this.stickStartKick = false;
    this.state = stepRk4(this.state, this.params, dt, damping, accel, locked, driveTorque);
    if (!sticks && !this.dragging && env.motionMode === "driven") {
      const driveEnergy = (physics?.driveEnergy ?? 28) * (n / 2);
      this.state = driveTowardEnergy(this.state, this.params, restEnergy(this.params) + driveEnergy, dt);
    }
    const limit = sticks ? STICK_OMEGA_LIMIT : MAX_OMEGA;
    if (this.state.omega.some((omega) => Math.abs(omega) > limit)) {
      console.log("[kinetic] omega clamp", this.state.omega.map((omega) => omega.toFixed(2)).join(","));
      this.state = clampVelocities(this.state, limit);
    }
    if (!isFiniteState(this.state)) {
      console.log("[kinetic] non-finite pendulum state; restoring last good");
      this.state = this.lastGood
        ? { theta: [...this.lastGood.theta], omega: [...this.lastGood.omega] }
        : initialState(n, sticks);
      this.physAccum = 0;
      return;
    }
    this.lastGood = { theta: [...this.state.theta], omega: [...this.state.omega] };
  }

  draw(ctx: CanvasRenderingContext2D, env: DrawEnv): void {
    if (this.params.model === "compound") {
      this.drawSticks(ctx, env);
      return;
    }
    const { origin } = this;
    const visual = this.visualState();
    const bobs = bobPositions(visual, origin, this.scale, this.params);
    const tip = bobs[bobs.length - 1];
    this.drawTrail(ctx, this.trail, tip);

    const interactive = env.interactionMode === "control";
    const { pivot, bobs: bobR, rod } = this.radii();
    const joints = [origin, ...bobs];
    if (env.shadows !== false) drawPendulumShadow(ctx, joints, [pivot, ...bobR], rod);
    let prev = origin;
    for (let i = 0; i < bobs.length; i += 1) {
      drawGlassRod(ctx, prev.x, prev.y, bobs[i].x, bobs[i].y, rod);
      prev = bobs[i];
    }
    drawPuck(ctx, origin.x, origin.y, pivot, palette.pivot, interactive && (env.hovered === "pivot" || env.dragging === "pivot"));
    for (let i = 0; i < bobs.length; i += 1) {
      const part = BOB_PARTS[i];
      drawPuck(ctx, bobs[i].x, bobs[i].y, bobR[i], BOB_COLORS[i], interactive && (env.hovered === part || env.dragging === part));
    }

    this.drawPivotHandle(ctx, env);
  }

  private drawSticks(ctx: CanvasRenderingContext2D, env: DrawEnv): void {
    const visual = this.visualState();
    const segments = rodSegments(visual, this.origin, this.scale, this.params);
    const tip = stickTrailTip(this.params, segments);
    if (tip) this.drawTrail(ctx, this.trail, tip);

    const stand = this.standGeometry();
    const { rod, pin } = this.stickRadii();
    const lines = [
      [stand.left, stand.apex],
      [stand.right, stand.apex],
      ...segments.map((segment) => [segment.back, segment.front]),
    ];
    const discs = [stand.apex, ...segments.map((segment) => segment.pivot)];
    if (env.shadows !== false) {
      drawPendulumShadow(
        ctx,
        discs,
        discs.map(() => pin),
        rod,
        lines,
        [{ x: stand.baseX, y: stand.baseY, width: stand.baseW, height: stand.baseH }],
      );
    }

    drawChromeRod(ctx, stand.left.x, stand.left.y, stand.apex.x, stand.apex.y, rod);
    drawChromeRod(ctx, stand.right.x, stand.right.y, stand.apex.x, stand.apex.y, rod);
    drawStandBase(ctx, stand.baseX, stand.baseY, stand.baseW, stand.baseH);

    const interactive = env.interactionMode === "control";
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      drawChromeRod(ctx, segment.back.x, segment.back.y, segment.front.x, segment.front.y, rod);
      const root = i === 0;
      const part = BOB_PARTS[i];
      const highlight = interactive && (root
        ? env.hovered === "pivot" || env.dragging === "pivot" || env.hovered === "bob1" || env.dragging === "bob1"
        : env.hovered === part || env.dragging === part);
      drawChromePin(
        ctx,
        segment.pivot.x,
        segment.pivot.y,
        root ? pin + 0.6 : pin,
        highlight,
      );
    }
    this.drawPivotHandle(ctx, env);
  }

  private drawPivotHandle(ctx: CanvasRenderingContext2D, env: DrawEnv): void {
    if (env.interactionMode !== "control") return;
    const { origin } = this;
    const radius = (this.params.model === "compound" ? this.stickRadii().pin : this.radii().pivot) + 6 * this.visualScale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = env.hovered === "pivot" ? palette.handle : "rgba(203, 210, 220, 0.4)";
    ctx.lineWidth = 1.25 * this.visualScale;
    ctx.setLineDash([3 * this.visualScale, 4 * this.visualScale]);
    ctx.stroke();
    ctx.restore();
  }

  private pushTrail(point: { x: number; y: number }): void {
    appendTrail(this.trail, point);
  }

  private drawTrail(
    ctx: CanvasRenderingContext2D,
    trail: Array<{ x: number; y: number; t: number }>,
    tip: { x: number; y: number },
  ): void {
    const now = performance.now();
    pruneTrail(trail, now);
    const lastPoint = trail[trail.length - 1];
    const extra = lastPoint && Math.hypot(tip.x - lastPoint.x, tip.y - lastPoint.y) > 0.2;
    const count = trail.length + (extra ? 1 : 0);
    const last = count - 1;
    if (last < 1) return;
    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    for (let layer = 0; layer < TRAIL_LAYERS; layer += 1) {
      const start = Math.floor((layer / TRAIL_LAYERS) * last);
      if (last - start < 1) continue;
      const t = (layer + 1) / TRAIL_LAYERS;
      ctx.beginPath();
      traceSmoothPolyline(ctx, trail, start, trail.length - 1);
      if (extra && start <= trail.length - 1) ctx.lineTo(tip.x, tip.y);
      ctx.strokeStyle = this.params.model === "compound"
        ? `rgba(180, 190, 200, ${0.04 + 0.03 * t})`
        : `rgba(91, 120, 255, ${0.035 + 0.028 * t})`;
      ctx.lineWidth = (0.8 + 1.9 * t * t) * this.visualScale;
      ctx.stroke();
    }
    ctx.restore();
  }

  private draggingPivotInertia(): boolean {
    return this.pivotInertia && this.dragging === "pivot";
  }

  private updatePivotAccel(now: number): void {
    const latest = this.pivotSamples[this.pivotSamples.length - 1];
    if (!latest || now - latest.time > 40) {
      this.pivotAccel = { x: 0, y: 0 };
      this.lastPivotVelocity = { vx: 0, vy: 0, time: now };
      return;
    }
    const velocity = recentVelocity(this.pivotSamples, now);
    if (!this.lastPivotVelocity.time) {
      this.lastPivotVelocity = { ...velocity, time: now };
      this.pivotAccel = { x: 0, y: 0 };
      return;
    }
    const elapsed = (now - this.lastPivotVelocity.time) / 1000;
    if (elapsed < 0.008) return;
    if (Math.hypot(velocity.vx, velocity.vy) < 20) {
      this.pivotAccel = { x: 0, y: 0 };
      this.lastPivotVelocity = { vx: 0, vy: 0, time: now };
      return;
    }
    const scale = Math.max(24, this.scale);
    const ax = (velocity.vx - this.lastPivotVelocity.vx) / elapsed / scale;
    const ay = (velocity.vy - this.lastPivotVelocity.vy) / elapsed / scale;
    this.pivotAccel = {
      x: Math.max(-MAX_PIVOT_ACCEL, Math.min(MAX_PIVOT_ACCEL, ax)),
      y: Math.max(-MAX_PIVOT_ACCEL, Math.min(MAX_PIVOT_ACCEL, ay)),
    };
    this.lastPivotVelocity = { ...velocity, time: now };
  }

  private clearDrag(): void {
    this.dragging = null;
    this.dragStill = false;
    this.pivotInertia = false;
    this.pivotSamples = [];
    this.pivotAccel = { x: 0, y: 0 };
    this.lastPivotVelocity = { vx: 0, vy: 0, time: 0 };
    this.stickGrab = null;
  }

  private hitTestSticks(x: number, y: number): HitResult | null {
    const segments = rodSegments(this.state, this.origin, this.scale, this.params);
    const { rod, pin, hit } = this.stickRadii();
    const stand = this.standGeometry();
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i];
      if (distanceToSegment(x, y, segment.back.x, segment.back.y, segment.front.x, segment.front.y) <= rod + hit) {
        return { part: BOB_PARTS[i] };
      }
    }
    if (Math.hypot(x - stand.apex.x, y - stand.apex.y) <= pin + hit + 4 * this.visualScale) return { part: "pivot" };
    if (distanceToSegment(x, y, stand.left.x, stand.left.y, stand.apex.x, stand.apex.y) <= rod + hit) return { part: "pivot" };
    if (distanceToSegment(x, y, stand.right.x, stand.right.y, stand.apex.x, stand.apex.y) <= rod + hit) return { part: "pivot" };
    if (
      x >= stand.baseX
      && x <= stand.baseX + stand.baseW
      && y >= stand.baseY
      && y <= stand.baseY + stand.baseH
    ) {
      return { part: "pivot" };
    }
    return null;
  }

  private contentInsets(): { left: number; right: number; top: number; bottom: number } {
    const pad = this.drawPad();
    if (this.params.model === "compound") {
      const { rod, pin } = this.stickRadii();
      const swing = downwardReach(this.params) * this.scale + rod / 2 + pin + pad;
      const stand = this.standExtents();
      const side = Math.max(swing, stand.halfWidth + pad);
      return {
        left: side,
        right: side,
        top: swing,
        bottom: Math.max(swing, stand.depth + pad),
      };
    }
    const { pivot, bobs, rod } = this.radii();
    const chain = this.params.lengths.reduce((sum, length) => sum + length, 0) * this.scale;
    const tip = Math.max(pivot, rod / 2, ...bobs);
    const swing = chain + tip + pad;
    return { left: swing, right: swing, top: swing, bottom: swing };
  }

  private drawPad(): number {
    return SHADOW_PAD + SHADOW_BLEED + WINDOW_CORNER_PAD;
  }

  private standExtents(): { halfWidth: number; depth: number } {
    const s = this.visualScale;
    const half = STAND_HALF * s;
    const inset = STICK_WIDTH * s + 10 * s;
    return {
      halfWidth: half + inset,
      depth: (STAND_HEIGHT + STAND_BASE_H) * s,
    };
  }

  private clampedOrigin(next: { x: number; y: number }): { x: number; y: number } {
    const bounds = this.originBounds();
    return {
      x: clamp(next.x, bounds.minX, bounds.maxX),
      y: clamp(next.y, bounds.minY, bounds.maxY),
    };
  }

  private canvasAnchor(): { x: number; y: number } {
    if (this.params.model === "compound") {
      return {
        x: this.origin.x,
        y: this.origin.y + (STAND_HEIGHT + STAND_BASE_H) * this.visualScale,
      };
    }
    return { x: this.origin.x, y: this.origin.y };
  }

  private placeOriginAtAnchor(anchor: { x: number; y: number }): void {
    if (this.params.model === "compound") {
      this.moveOrigin({
        x: anchor.x,
        y: anchor.y - (STAND_HEIGHT + STAND_BASE_H) * this.visualScale,
      });
      return;
    }
    this.moveOrigin({ x: anchor.x, y: anchor.y });
  }

  private moveOrigin(next: { x: number; y: number }): void {
    const dx = next.x - this.origin.x;
    const dy = next.y - this.origin.y;
    if (dx === 0 && dy === 0) return;
    this.origin = { x: next.x, y: next.y };
    if (this.trail.length) {
      for (const point of this.trail) {
        point.x += dx;
        point.y += dy;
      }
    }
  }

  shiftBy(dx: number, dy: number): { x: number; y: number } {
    const next = { x: this.origin.x + dx, y: this.origin.y + dy };
    const bounds = this.originBounds();
    const x = clamp(next.x, bounds.minX, bounds.maxX);
    const y = clamp(next.y, bounds.minY, bounds.maxY);
    this.moveOrigin({ x, y });
    return { x: next.x - x, y: next.y - y };
  }

  private originBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const { width, height } = this.canvasSize;
    const inset = this.contentInsets();
    let minX = inset.left;
    let maxX = width - inset.right;
    let minY = inset.top;
    let maxY = height - inset.bottom;
    if (minX > maxX) {
      minX = width / 2;
      maxX = width / 2;
    }
    if (minY > maxY) {
      minY = height / 2;
      maxY = height / 2;
    }
    return { minX, minY, maxX, maxY };
  }

  private fitOriginOnCanvas(recordShift = true): void {
    const desired = { x: this.origin.x, y: this.origin.y };
    const { width, height } = this.canvasSize;
    if (width < 16 || height < 16) return;
    const bounds = this.originBounds();
    this.moveOrigin({
      x: clamp(this.origin.x, bounds.minX, bounds.maxX),
      y: clamp(this.origin.y, bounds.minY, bounds.maxY),
    });
    if (!recordShift) return;
    this.windowShift.x += desired.x - this.origin.x;
    this.windowShift.y += desired.y - this.origin.y;
  }

  private standGeometry() {
    const s = this.visualScale;
    const height = STAND_HEIGHT * s;
    const half = STAND_HALF * s;
    const baseH = STAND_BASE_H * s;
    const inset = STICK_WIDTH * s + 10 * s;
    const baseW = half * 2 + inset * 2;
    const baseY = this.origin.y + height;
    const embed = baseH * 0.7;
    return {
      apex: this.origin,
      left: { x: this.origin.x - half, y: baseY + embed },
      right: { x: this.origin.x + half, y: baseY + embed },
      baseX: this.origin.x - baseW / 2,
      baseY,
      baseW,
      baseH,
    };
  }

  private stickRadii() {
    const s = this.visualScale;
    return {
      rod: STICK_WIDTH * s,
      pin: PIN_RADIUS * s,
      hit: HIT_PADDING * s,
    };
  }

  private radii() {
    const s = this.visualScale;
    const n = pendulumCount(this.params);
    return {
      pivot: PIVOT_RADIUS * s,
      bobs: BOB_RADII.slice(0, n).map((radius) => radius * s),
      rod: ROD_WIDTH * s,
      hit: HIT_PADDING * s,
    };
  }

  private updateScale(): void {
    const size = this.physics?.windowSize ?? WINDOW_WIDTH;
    this.visualScale = size / WINDOW_WIDTH;
    if (this.params.model === "compound") {
      const usable = Math.max(12, (STAND_HEIGHT - STAND_CLEARANCE) * this.visualScale);
      this.scale = usable / Math.max(downwardReach(this.params), 0.2);
      return;
    }
    const reach = this.params.lengths.reduce((sum, length) => sum + length, 0);
    const padding = size * (LAYOUT_PADDING / WINDOW_WIDTH);
    const available = size / 2 - padding;
    this.scale = Math.max(12, available / Math.max(reach, 0.4)) * 0.72;
  }
}

function paramsFromPhysics(physics: PhysicsSettings): PendulumParams {
  const n = physics.bobCount;
  const compound = physics.style === "sticks";
  if (compound) {
    const spec = stickGeometry(n);
    return {
      g: physics.gravity,
      masses: spec.masses,
      lengths: spec.lengths,
      model: "compound",
      pivotAlong: spec.pivotAlong,
    };
  }
  return {
    g: physics.gravity,
    masses: [physics.mass1, physics.mass2, physics.mass3].slice(0, n),
    lengths: [physics.length1, physics.length2, physics.length3].slice(0, n),
    model: "point",
  };
}

function resolveDragPart(part: HitPart, sticks: boolean): HitPart {
  if (sticks) {
    if (part === "rod1") return "bob1";
    if (part === "rod2") return "bob2";
    if (part === "rod3") return "bob3";
    return part;
  }
  if (part === "rod1") return "pivot";
  if (part === "rod2") return "bob2";
  if (part === "rod3") return "bob3";
  return part;
}

function bobIndex(part: HitPart): number | null {
  const index = BOB_PARTS.indexOf(part);
  return index >= 0 ? index : null;
}

function traceSmoothPolyline(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  start: number,
  last: number,
): void {
  ctx.moveTo(points[start].x, points[start].y);
  if (last - start === 1) {
    ctx.lineTo(points[last].x, points[last].y);
    return;
  }
  for (let i = start; i < last; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    if (i === start) ctx.lineTo(midX, midY);
    else ctx.quadraticCurveTo(current.x, current.y, midX, midY);
  }
  ctx.lineTo(points[last].x, points[last].y);
}

function pruneTrail(trail: Array<{ x: number; y: number; t: number }>, now: number): void {
  const oldest = now - TRAIL_DURATION_MS;
  let drop = 0;
  while (drop < trail.length && trail[drop].t < oldest) drop += 1;
  if (drop) trail.splice(0, drop);
}

function appendTrail(trail: Array<{ x: number; y: number; t: number }>, point: { x: number; y: number }): void {
  const now = performance.now();
  pruneTrail(trail, now);
  const last = trail[trail.length - 1];
  if (last) {
    const dist = Math.hypot(point.x - last.x, point.y - last.y);
    if (dist < TRAIL_MIN_DIST) return;
    if (dist > TRAIL_BREAK_PX) trail.length = 0;
  }
  trail.push({ x: point.x, y: point.y, t: now });
}

function stickTrailTip(
  params: PendulumParams,
  segments: RodSegment[],
): { x: number; y: number } | null {
  const last = segments[segments.length - 1];
  if (!last) return null;
  const index = segments.length - 1;
  return behindSpan(params, index) >= jointSpan(params, index) ? last.back : last.front;
}

function jitter(base: number, spread: number): number {
  return base + (Math.random() * 2 - 1) * spread;
}

function initialState(count: number, sticks = false): PendulumState {
  const theta0 = sticks ? [0.35, -0.85, 0.2] : [2.05, 2.55, 2.15];
  const omega0 = sticks ? [0.26, -0.1, 0.06] : [0.85, -0.45, 0.55];
  const thetaSpread = sticks ? [0.08, 0.1, 0.08] : [0.14, 0.18, 0.16];
  const omegaSpread = sticks ? [0.04, 0.05, 0.03] : [0.22, 0.22, 0.2];
  return {
    theta: Array.from({ length: count }, (_, i) => jitter(theta0[i] ?? 2.2, thetaSpread[i] ?? 0.16)),
    omega: Array.from({ length: count }, (_, i) => jitter(omega0[i] ?? 0.4, omegaSpread[i] ?? 0.2)),
  };
}
