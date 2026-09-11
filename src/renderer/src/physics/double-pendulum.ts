import { STICK_LENGTHS, stickGeometry } from "./swinging-sticks";

export interface PendulumState {
  theta: number[];
  omega: number[];
}

export type RodModel = "point" | "compound";

export interface PendulumParams {
  masses: number[];
  lengths: number[];
  g: number;
  model?: RodModel;
  pivotAlong?: number[];
}

export interface PivotAccel {
  x: number;
  y: number;
}

export interface LockedJoint {
  index: number;
  alpha: number;
}

export const defaultPendulumParams: PendulumParams = {
  masses: [1.15, 1],
  lengths: [1, 0.88],
  g: 9.81,
  model: "point",
};

export { STICK_LENGTHS };
export const STICK_PIVOT_ALONG = stickGeometry(3).pivotAlong;

export function downwardReach(params: PendulumParams): number {
  const n = pendulumCount(params);
  let lowest = 0;
  let chain = 0;
  for (let i = 0; i < n; i += 1) {
    lowest = Math.max(lowest, chain + behindSpan(params, i), chain + jointSpan(params, i));
    chain += jointSpan(params, i);
  }
  return lowest;
}

export function pendulumCount(params: PendulumParams): number {
  return Math.min(params.masses.length, params.lengths.length);
}

export function restEnergy(params: PendulumParams): number {
  const n = pendulumCount(params);
  let total = 0;
  for (let k = 0; k < n; k += 1) {
    for (let i = 0; i < n; i += 1) {
      total -= params.masses[k] * params.g * lever(params, k, i);
    }
  }
  return total;
}

export function kineticEnergy(state: PendulumState, params: PendulumParams): number {
  const n = pendulumCount(params);
  let kinetic = 0;
  for (let i = 0; i < n; i += 1) {
    kinetic += 0.5 * rodInertia(params, i) * state.omega[i] * state.omega[i];
    for (let j = 0; j < n; j += 1) {
      const coupled = coupling(params, i, j);
      kinetic += 0.5 * coupled * state.omega[i] * state.omega[j] * Math.cos(state.theta[i] - state.theta[j]);
    }
  }
  return kinetic;
}

export function energy(state: PendulumState, params: PendulumParams): number {
  const n = pendulumCount(params);
  let potential = 0;
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < n; k += 1) {
      potential -= params.masses[k] * params.g * lever(params, k, i) * Math.cos(state.theta[i]);
    }
  }
  return kineticEnergy(state, params) + potential;
}

/**
 * Lagrange EOM for n rods. θ_i = 0 hangs down (canvas +y). Q_i is a generalized
 * torque about joint i (drive). Point-mass rods use lever = L on the child side.
 * Compound rods: CM lever (1/2 − p)L on that rod, child CMs through jointSpan,
 * plus I_cm = m L²/12. Translational m d² sits in coupling().
 */
export function accelerations(
  state: PendulumState,
  params: PendulumParams,
  pivotAccel: PivotAccel = { x: 0, y: 0 },
  locked: LockedJoint[] = [],
  driveTorque: number[] = [],
): number[] {
  const n = pendulumCount(params);
  const gx = -pivotAccel.x;
  const gy = params.g - pivotAccel.y;
  const mass = massScratch;
  const rhs = rhsScratch;
  for (let i = 0; i < n; i += 1) {
    rhs[i] = 0;
    for (let j = 0; j < n; j += 1) mass[i][j] = 0;
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const coupled = coupling(params, i, j);
      const delta = state.theta[i] - state.theta[j];
      mass[i][j] = coupled * Math.cos(delta);
      rhs[i] -= coupled * Math.sin(delta) * state.omega[j] * state.omega[j];
    }
    mass[i][i] += rodInertia(params, i) + 1e-10;
    let gravityArm = 0;
    for (let k = 0; k < n; k += 1) gravityArm += params.masses[k] * lever(params, k, i);
    rhs[i] += gravityArm * (gx * Math.cos(state.theta[i]) - gy * Math.sin(state.theta[i]));
    rhs[i] += driveTorque[i] ?? 0;
  }

  for (const joint of locked) {
    const i = joint.index;
    if (i < 0 || i >= n) continue;
    for (let j = 0; j < n; j += 1) mass[i][j] = 0;
    mass[i][i] = 1;
    rhs[i] = joint.alpha;
  }

  return solveLinear(n);
}

export function stepRk4(
  state: PendulumState,
  params: PendulumParams,
  dt: number,
  damping: number,
  pivotAccel: PivotAccel = { x: 0, y: 0 },
  locked: LockedJoint[] = [],
  driveTorque: number[] = [],
): PendulumState {
  let lockedMask = 0;
  for (const joint of locked) {
    if (joint.index >= 0 && joint.index < 32) lockedMask |= 1 << joint.index;
  }

  const derivative = (current: PendulumState): PendulumState => {
    const alpha = accelerations(current, params, pivotAccel, locked, driveTorque);
    return {
      theta: current.omega.map((omega, i) => ((lockedMask >> i) & 1 ? 0 : omega)),
      omega: current.omega.map((omega, i) => ((lockedMask >> i) & 1 ? 0 : alpha[i] - damping * omega)),
    };
  };

  const k1 = derivative(state);
  const k2 = derivative(addScaled(state, k1, dt / 2));
  const k3 = derivative(addScaled(state, k2, dt / 2));
  const k4 = derivative(addScaled(state, k3, dt));

  return {
    theta: state.theta.map((theta, i) => (
      (lockedMask >> i) & 1
        ? theta
        : theta + (dt / 6) * (k1.theta[i] + 2 * k2.theta[i] + 2 * k3.theta[i] + k4.theta[i])
    )),
    omega: state.omega.map((omega, i) => (
      (lockedMask >> i) & 1
        ? omega
        : omega + (dt / 6) * (k1.omega[i] + 2 * k2.omega[i] + 2 * k3.omega[i] + k4.omega[i])
    )),
  };
}

export function driveTowardEnergy(
  state: PendulumState,
  params: PendulumParams,
  target: number,
  dt: number,
): PendulumState {
  const current = energy(state, params);
  const next: PendulumState = {
    theta: [...state.theta],
    omega: [...state.omega],
  };
  if (current < target) {
    const gain = 0.85 * (target - current);
    let dir = 1;
    for (let i = 0; i < next.omega.length; i += 1) {
      dir = Math.sign(state.omega[i]) || Math.sign(Math.sin(state.theta[i])) || dir;
      next.omega[i] += dir * gain * dt * (i === 0 ? 1 : 0.8);
    }
  } else if (current > target + 6) {
    const bleed = Math.exp(-0.4805 * dt);
    next.omega = next.omega.map((omega) => omega * bleed);
  }
  return next;
}

export function isFiniteState(state: PendulumState): boolean {
  return [...state.theta, ...state.omega].every(Number.isFinite);
}

export interface StickGrab {
  index: number;
  along: number;
  perp: number;
}

export function projectStickGrab(
  pivot: { x: number; y: number },
  theta: number,
  cursor: { x: number; y: number },
  scale: number,
  alongMin: number,
  alongMax: number,
): { along: number; perp: number } {
  const dirX = Math.sin(theta);
  const dirY = Math.cos(theta);
  const nX = Math.cos(theta);
  const nY = -Math.sin(theta);
  const dx = cursor.x - pivot.x;
  const dy = cursor.y - pivot.y;
  const along = Math.max(alongMin, Math.min(alongMax, (dx * dirX + dy * dirY) / scale));
  const perp = (dx * nX + dy * nY) / scale;
  return { along, perp };
}

export function stickGrabTorque(
  state: PendulumState,
  params: PendulumParams,
  grab: StickGrab,
  target: { x: number; y: number },
  stiffness: number,
  damping: number,
  maxForce: number,
): number[] {
  const n = pendulumCount(params);
  const torque = Array.from({ length: n }, () => 0);
  const k = grab.index;
  if (k < 0 || k >= n) return torque;

  const J = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  let x = 0;
  let y = 0;
  for (let i = 0; i < k; i += 1) {
    const theta = state.theta[i] ?? 0;
    const span = jointSpan(params, i);
    const nX = Math.cos(theta);
    const nY = -Math.sin(theta);
    J[i].x += span * nX;
    J[i].y += span * nY;
    x += span * Math.sin(theta);
    y += span * Math.cos(theta);
  }
  const theta = state.theta[k] ?? 0;
  const dirX = Math.sin(theta);
  const dirY = Math.cos(theta);
  const nX = Math.cos(theta);
  const nY = -Math.sin(theta);
  J[k].x += grab.along * nX - grab.perp * dirX;
  J[k].y += grab.along * nY - grab.perp * dirY;
  x += grab.along * dirX + grab.perp * nX;
  y += grab.along * dirY + grab.perp * nY;

  let vx = 0;
  let vy = 0;
  for (let i = 0; i <= k; i += 1) {
    vx += J[i].x * (state.omega[i] ?? 0);
    vy += J[i].y * (state.omega[i] ?? 0);
  }

  let fx = stiffness * (target.x - x) - damping * vx;
  let fy = stiffness * (target.y - y) - damping * vy;
  const mag = Math.hypot(fx, fy);
  if (mag > maxForce && mag > 1e-9) {
    fx *= maxForce / mag;
    fy *= maxForce / mag;
  }
  for (let i = 0; i <= k; i += 1) {
    torque[i] = J[i].x * fx + J[i].y * fy;
  }
  return torque;
}

export function clampVelocities(state: PendulumState, maxOmega: number): PendulumState {
  return {
    theta: state.theta,
    omega: state.omega.map((omega) => Math.max(-maxOmega, Math.min(maxOmega, omega))),
  };
}

export function bobPositions(
  state: PendulumState,
  origin: { x: number; y: number },
  scale: number,
  params: PendulumParams,
): Array<{ x: number; y: number }> {
  return rodSegments(state, origin, scale, params).map((segment) => segment.front);
}

export interface RodSegment {
  pivot: { x: number; y: number };
  back: { x: number; y: number };
  front: { x: number; y: number };
}

export function rodSegments(
  state: PendulumState,
  origin: { x: number; y: number },
  scale: number,
  params: PendulumParams,
): RodSegment[] {
  const n = pendulumCount(params);
  const segments: RodSegment[] = [];
  let x = origin.x;
  let y = origin.y;
  for (let i = 0; i < n; i += 1) {
    const dirX = Math.sin(state.theta[i] ?? 0);
    const dirY = Math.cos(state.theta[i] ?? 0);
    const ahead = jointSpan(params, i) * scale;
    const behind = behindSpan(params, i) * scale;
    const pivot = { x, y };
    const front = { x: x + dirX * ahead, y: y + dirY * ahead };
    const back = { x: x - dirX * behind, y: y - dirY * behind };
    segments.push({ pivot, back, front });
    x = front.x;
    y = front.y;
  }
  return segments;
}

export function jointSpan(params: PendulumParams, index: number): number {
  if (params.model === "compound") {
    return (1 - pivotAlong(params, index)) * params.lengths[index];
  }
  return params.lengths[index];
}

export function behindSpan(params: PendulumParams, index: number): number {
  if (params.model === "compound") return pivotAlong(params, index) * params.lengths[index];
  return 0;
}

function pivotAlong(params: PendulumParams, index: number): number {
  return params.pivotAlong?.[index] ?? STICK_PIVOT_ALONG[index] ?? 0.2;
}

function lever(params: PendulumParams, rod: number, joint: number): number {
  if (joint > rod) return 0;
  if (params.model === "compound") {
    if (joint < rod) return jointSpan(params, joint);
    // Signed CM offset from this rod's pivot. I_pivot = I_cm + m d² via coupling.
    return (0.5 - pivotAlong(params, rod)) * params.lengths[rod];
  }
  return params.lengths[joint];
}

function coupling(params: PendulumParams, i: number, j: number): number {
  const n = pendulumCount(params);
  let total = 0;
  for (let k = 0; k < n; k += 1) {
    total += params.masses[k] * lever(params, k, i) * lever(params, k, j);
  }
  return total;
}

function rodInertia(params: PendulumParams, index: number): number {
  if (params.model !== "compound") return 0;
  const length = params.lengths[index];
  return params.masses[index] * length * length / 12; // I_cm; m d² is in coupling()
}

function addScaled(state: PendulumState, delta: PendulumState, scale: number): PendulumState {
  return {
    theta: state.theta.map((theta, i) => theta + delta.theta[i] * scale),
    omega: state.omega.map((omega, i) => omega + delta.omega[i] * scale),
  };
}

const massScratch: number[][] = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];
const rhsScratch = [0, 0, 0];
const augScratch: number[][] = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];
const alphaOut = [0, 0, 0];

function solveLinear(n: number): number[] {
  const rows = augScratch;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) rows[i][j] = massScratch[i][j];
    rows[i][n] = rhsScratch[i];
  }
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let row = i + 1; row < n; row += 1) {
      if (Math.abs(rows[row][i]) > Math.abs(rows[pivot][i])) pivot = row;
    }
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    const denom = rows[i][i];
    if (Math.abs(denom) < 1e-10) {
      for (let k = 0; k < n; k += 1) alphaOut[k] = 0;
      return alphaOut;
    }
    for (let col = i; col <= n; col += 1) rows[i][col] /= denom;
    for (let row = 0; row < n; row += 1) {
      if (row === i) continue;
      const factor = rows[row][i];
      for (let col = i; col <= n; col += 1) rows[row][col] -= factor * rows[i][col];
    }
  }
  for (let i = 0; i < n; i += 1) alphaOut[i] = rows[i][n];
  return alphaOut;
}
