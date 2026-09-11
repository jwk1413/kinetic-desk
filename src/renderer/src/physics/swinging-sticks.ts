/**
 * Swinging-sticks simulation design values — not measured product dimensions.
 *
 * Coordinates: θ = 0 hangs down (canvas +y). Rod i rotates about its pivot.
 * Front span = (1 − p_i) L_i toward the child joint; back span = p_i L_i.
 *
 * Uniform slender rods: CM at L/2, I_cm = m L²/12. Parallel-axis m d² with
 * d = (1/2 − p) L lives in the translational mass matrix. The stand is not mass.
 *
 * The innermost rod is a 3:1 arm (long back : short front). Child masses are
 * chosen so that, when every child CM sits on its coupling joint, gravity
 * torque on that rod’s pivot is zero at this split. A small designed residual
 * is then added to inner pivots, and the outermost rod gets a limited
 * eccentricity. Pose-independent static balance is not assumed; values are
 * simulation design, not product measurements.
 *
 * Driven mode: a bounded generalized torque on joint 0 only, when that rod
 * moves through a preferred sector and kinetic energy is below a band — a
 * simplified electromagnetic kick at the stand. Natural mode has no Q. No
 * counterweight: inner pivots are shifted instead of adding extra point masses.
 */
export const STICK_INNER_LENGTH = 1;
export const STICK_OUTER_WEIGHTS = [0.92, 0.86];
export const STICK_LONG_SHORT_RATIO = 3;
export const STICK_LINEAR_DENSITY = 1;
export const STICK_OUTER_ECCENTRICITY = 0.038;
export const STICK_INNER_RESIDUAL = 0.01;
export const STICK_NATURAL_DAMPING = 0.0045;
export const STICK_DRIVEN_DAMPING = 0.0032;
export const STICK_DRIVE_TORQUE_MAX = 0.05;
export const STICK_START_TORQUE = 0.07;
export const STICK_KE_LO = 0.05;
export const STICK_KE_HI = 0.22;
export const PHYS_DT = 1 / 240;
export const PHYS_MAX_STEPS = 32;
export const STICK_OMEGA_LIMIT = 16;
export const STICK_COAST_OMEGA = 0.08;
export const STICK_GRAB_KP = 36;
export const STICK_GRAB_KD = 7;
export const STICK_GRAB_FMAX = 22;

export function longStickPivotAlong(): number {
  return STICK_LONG_SHORT_RATIO / (STICK_LONG_SHORT_RATIO + 1);
}

export function stickLengths(count: number): number[] {
  const n = Math.max(1, Math.min(3, Math.round(count)));
  if (n === 1) return [STICK_INNER_LENGTH];
  const parent = STICK_INNER_LENGTH * STICK_LINEAR_DENSITY;
  const balanced = longStickPivotAlong() - STICK_INNER_RESIDUAL;
  const childTotal = parent * (balanced - 0.5) / (1 - balanced);
  if (n === 2) return [STICK_INNER_LENGTH, childTotal / STICK_LINEAR_DENSITY];
  const weight = STICK_OUTER_WEIGHTS[0] + STICK_OUTER_WEIGHTS[1];
  return [
    STICK_INNER_LENGTH,
    childTotal * STICK_OUTER_WEIGHTS[0] / weight / STICK_LINEAR_DENSITY,
    childTotal * STICK_OUTER_WEIGHTS[1] / weight / STICK_LINEAR_DENSITY,
  ];
}

export const STICK_LENGTHS = stickLengths(3);

export interface StickGeometry {
  lengths: number[];
  masses: number[];
  pivotAlong: number[];
}

export function stickMasses(count: number): number[] {
  return stickLengths(count).map((length) => length * STICK_LINEAR_DENSITY);
}

export function balancedPivotAlong(masses: number[]): number[] {
  const n = masses.length;
  const pivotAlong = masses.map(() => 0.5);
  for (let i = n - 2; i >= 0; i -= 1) {
    const self = masses[i];
    let after = 0;
    for (let k = i + 1; k < n; k += 1) after += masses[k];
    pivotAlong[i] = (0.5 * self + after) / (self + after);
  }
  return pivotAlong;
}

export function stickPivots(masses: number[]): number[] {
  const n = masses.length;
  const pivotAlong = balancedPivotAlong(masses);
  for (let i = 0; i < n - 1; i += 1) {
    pivotAlong[i] = Math.min(0.88, Math.max(0.12, pivotAlong[i] + STICK_INNER_RESIDUAL));
  }
  if (n > 0) pivotAlong[n - 1] = 0.5 + STICK_OUTER_ECCENTRICITY;
  return pivotAlong;
}

export function stickGeometry(count: number): StickGeometry {
  const n = Math.max(1, Math.min(3, Math.round(count)));
  const lengths = stickLengths(n);
  const masses = stickMasses(n);
  return { lengths, masses, pivotAlong: stickPivots(masses) };
}

export function stickDriveTorque(
  state: { theta: number[]; omega: number[] },
  kinetic: number,
  options: { startKick?: boolean } = {},
): number[] {
  const n = state.theta.length;
  const torque = Array.from({ length: n }, () => 0);
  if (n < 1) return torque;

  const omega1 = state.omega[0] ?? 0;
  const theta1 = state.theta[0] ?? 0;
  const slow = state.omega.every((omega) => Math.abs(omega) < 0.05);

  // One-shot rest start only. Repeating stall kicks would bounce the motion.
  if (options.startKick && kinetic < STICK_KE_LO && slow) {
    torque[0] = STICK_START_TORQUE * (Math.sign(omega1) || 1);
    return torque;
  }

  if (kinetic >= STICK_KE_HI) return torque;
  if (Math.abs(omega1) < STICK_COAST_OMEGA) return torque;

  // Assist the inner rod in the half-turn where sin(θ) matches ω, like a coil
  // beside the stand. Torque fades as ω → 0 so coupling can reverse the rod.
  // Outer joints are not driven.
  const moving = Math.sign(omega1);
  const sector = Math.max(0, Math.sin(theta1) * moving);
  const speed = Math.min(1, Math.abs(omega1) / 0.45);
  const span = Math.max(1e-6, STICK_KE_HI - STICK_KE_LO);
  const need = Math.max(0, Math.min(1, (STICK_KE_HI - kinetic) / span));
  torque[0] = moving * STICK_DRIVE_TORQUE_MAX * need * sector * speed;
  return torque;
}
