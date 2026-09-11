import { accelerations, bobPositions, defaultPendulumParams, downwardReach, driveTowardEnergy, energy, kineticEnergy, restEnergy, rodSegments, stepRk4, stickGrabTorque } from "./double-pendulum";
import { balancedPivotAlong, stickDriveTorque, stickGeometry, STICK_GRAB_FMAX, STICK_GRAB_KD, STICK_GRAB_KP, STICK_INNER_RESIDUAL, STICK_OUTER_ECCENTRICITY } from "./swinging-sticks";
import { clampToReach, elbowSign, followBob1, followBob2, followChain, followStickTheta, grabOffset, grabTarget, recentAngularRates, stickGrabAngleOffset } from "./drag";

const origin = { x: 0, y: 0 };
const L1 = 100;
const L2 = 88;
const L3 = 72;
let failed = 0;

function assert(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`pass  ${name}`);
  else {
    failed += 1;
    console.error(`fail  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const b1 = { x: 0, y: L1 };
const offset = grabOffset({ x: 12, y: L1 + 8 }, b1);
assert("grab offset keeps the cursor off the joint center", offset.x === 12 && offset.y === 8);
const target = grabTarget({ x: 40, y: L1 + 8 }, offset);
assert("grab target subtracts the same offset", target.x === 28 && target.y === L1);

const stickPivot = { x: 0, y: 0 };
const frontGrab = stickGrabAngleOffset(stickPivot, { x: 40, y: 80 }, Math.atan2(40, 80));
assert("front stick grab keeps the heading offset near zero", Math.abs(frontGrab) < 1e-9);
const backTheta = 0.4;
const backClick = { x: -Math.sin(backTheta) * 60, y: -Math.cos(backTheta) * 60 };
const backGrab = stickGrabAngleOffset(stickPivot, backClick, backTheta);
const pulledBack = followStickTheta(stickPivot, { x: 90, y: 10 }, backGrab, backTheta);
const backDir = { x: Math.sin(pulledBack), y: Math.cos(pulledBack) };
assert("back stick grab turns the long end toward the cursor", backDir.x * 90 + backDir.y * 10 < -80);
const frontFollow = followStickTheta(stickPivot, { x: 80, y: 20 }, 0, 0.2);
assert("front stick grab aims the short end at the cursor", Math.abs(frontFollow - Math.atan2(80, 20)) < 1e-9);
const wrapped = followStickTheta(stickPivot, { x: 10, y: 80 }, 0, Math.PI * 6);
assert("stick drag keeps multi-turn angle continuous", Math.abs(wrapped - Math.PI * 6) < 0.2);
assert("near the pin stick drag does not snap", followStickTheta(stickPivot, { x: 2, y: 2 }, 0, 1.2) === 1.2);

const theta = followBob1(origin, { x: 80, y: 60 }, 0.4);
const px = L1 * Math.sin(theta);
const py = L1 * Math.cos(theta);
assert("bob1 stays on the first rod length", Math.abs(Math.hypot(px, py) - L1) < 1e-6);
assert("bob1 heading matches the target", Math.abs(Math.atan2(80, 60) - theta) < 1e-9);

const far = clampToReach(origin, { x: 0, y: 400 }, Math.abs(L1 - L2), L1 + L2);
assert("unreachable bob2 clamps to max reach", Math.abs(Math.hypot(far.x, far.y) - (L1 + L2)) < 1e-6);

const currentB1 = { x: 30, y: 90 };
const folded = followBob2(origin, { x: 40, y: 120 }, L1, L2, currentB1, 1);
const solved = bobPositions(
  { theta: [folded.theta1, folded.theta2], omega: [0, 0] },
  origin,
  1,
  { masses: [1.15, 1], lengths: [L1, L2], g: 9.81 },
);
assert("ik keeps rod 1 length", Math.abs(Math.hypot(solved[0].x, solved[0].y) - L1) < 1e-4);
assert(
  "ik keeps rod 2 length",
  Math.abs(Math.hypot(solved[1].x - solved[0].x, solved[1].y - solved[0].y) - L2) < 1e-4,
);
const flipped = followBob2(origin, { x: 40, y: 120 }, L1, L2, currentB1, -1);
assert("elbow sign is preserved for the two solutions", elbowSign(origin, solved[0], solved[1]) !== 0);
assert(
  "opposite elbow preference yields a different middle joint",
  Math.abs(folded.theta1 - flipped.theta1) > 0.05,
);

const chain = followChain(
  origin,
  { x: 40, y: 180 },
  [L1, L2, L3],
  [{ x: 20, y: L1 }, { x: 40, y: L1 + L2 }, { x: 10, y: L1 + L2 + L3 }],
);
const chained = bobPositions(
  { theta: chain, omega: [0, 0, 0] },
  origin,
  1,
  { masses: [1.15, 1, 0.88], lengths: [L1, L2, L3], g: 9.81 },
);
assert("3-link ik keeps rod 1 length", Math.abs(Math.hypot(chained[0].x, chained[0].y) - L1) < 1e-3);
assert(
  "3-link ik keeps rod 2 length",
  Math.abs(Math.hypot(chained[1].x - chained[0].x, chained[1].y - chained[0].y) - L2) < 1e-3,
);
assert(
  "3-link ik keeps rod 3 length",
  Math.abs(Math.hypot(chained[2].x - chained[1].x, chained[2].y - chained[1].y) - L3) < 1e-3,
);

const still = [
  { time: 0, thetas: [1, 2] },
  { time: 400, thetas: [1.4, 2.2] },
  { time: 2000, thetas: [1.4, 2.2] },
  { time: 2080, thetas: [1.4, 2.2] },
];
const held = recentAngularRates(still, 2080, 80, 18);
assert("holding still for 2s does not keep old drag speed", Math.abs(held[0]) < 1e-6 && Math.abs(held[1]) < 1e-6);

const flick = [
  { time: 1000, thetas: [0.2, 0.1] },
  { time: 1080, thetas: [0.2 + 0.08 * 6, 0.1 + 0.08 * 4] },
];
const thrown = recentAngularRates(flick, 1080, 80, 18);
assert("recent motion becomes release omega", Math.abs(thrown[0] - 6) < 0.05 && Math.abs(thrown[1] - 4) < 0.05);

const single = { masses: [1.15], lengths: [1], g: 9.81 };
const singleState = { theta: [0.7], omega: [0] };
const singleAlpha = accelerations(singleState, single);
assert("single pendulum matches -g/l sin theta", Math.abs(singleAlpha[0] + (9.81 / 1) * Math.sin(0.7)) < 1e-8);

const doubleState = { theta: [0.9, 1.1], omega: [1.2, -0.8] };
const general = accelerations(doubleState, defaultPendulumParams);
const closed = closedDouble(doubleState.theta[0], doubleState.theta[1], doubleState.omega[0], doubleState.omega[1], defaultPendulumParams);
assert("two-link accelerations match the closed-form equations", Math.abs(general[0] - closed[0]) < 1e-8 && Math.abs(general[1] - closed[1]) < 1e-8);

function decay(dt: number): number {
  let state = { theta: [0.9, 1.1], omega: [2.4, -1.8] };
  const params = { ...defaultPendulumParams };
  const damping = 0.014;
  let t = 0;
  while (t < 1) {
    state = stepRk4(state, params, dt, damping);
    t += dt;
  }
  return energy(state, params);
}

const e60 = decay(1 / 60);
const e144 = decay(1 / 144);
assert("damping over 1s stays close across 60 and 144 fps", Math.abs(e60 - e144) / Math.abs(e60) < 0.08);

function driven(dt: number): number {
  let state = { theta: [0.3, 0.4], omega: [0.2, 0.1] };
  const params = { ...defaultPendulumParams };
  const target = restEnergy(params) + 28;
  let t = 0;
  while (t < 1) {
    state = stepRk4(state, params, dt, 0.0035);
    state = driveTowardEnergy(state, params, target, dt);
    t += dt;
  }
  return energy(state, params);
}

const d30 = driven(1 / 30);
const d120 = driven(1 / 120);
assert("driven energy over 1s stays close across 30 and 120 fps", Math.abs(d30 - d120) / Math.abs(d30) < 0.12);

function heldBob1Energy(dt: number): number {
  let state = { theta: [0.9, 1.1], omega: [0, -2.4] };
  const params = { ...defaultPendulumParams };
  let t = 0;
  while (t < 1) {
    state = stepRk4(state, params, dt, 0, { x: 0, y: 0 }, [{ index: 0, alpha: 0 }]);
    t += dt;
  }
  return energy(state, params);
}

const heldStart = energy({ theta: [0.9, 1.1], omega: [0, -2.4] }, defaultPendulumParams);
const heldEnd = heldBob1Energy(1 / 120);
assert("holding bob1 still does not add energy to the free bob", Math.abs(heldEnd - heldStart) / Math.abs(heldStart) < 0.03);

const bobGrabPose = { theta: [0.4, 0.7], omega: [0, 0] };
const qBobTip = stickGrabTorque(bobGrabPose, defaultPendulumParams, { index: 1, along: 0.88, perp: 0 }, { x: 1.4, y: 0.2 }, STICK_GRAB_KP, STICK_GRAB_KD, STICK_GRAB_FMAX);
assert("pulling the outer bob torques both joints", qBobTip[0] !== 0 && qBobTip[1] !== 0);
const qBobInner = stickGrabTorque(bobGrabPose, defaultPendulumParams, { index: 0, along: 1, perp: 0 }, { x: 1.2, y: 0.1 }, STICK_GRAB_KP, STICK_GRAB_KD, STICK_GRAB_FMAX);
assert("pulling the inner bob does not apply a direct outer torque", qBobInner[0] !== 0 && qBobInner[1] === 0);
let pulledBob = { theta: [...bobGrabPose.theta], omega: [0, 0] };
let tb = 0;
while (tb < 0.45) {
  const pull = stickGrabTorque(pulledBob, defaultPendulumParams, { index: 1, along: 0.88, perp: 0 }, { x: 1.4, y: 0.2 }, STICK_GRAB_KP, STICK_GRAB_KD, STICK_GRAB_FMAX);
  pulledBob = stepRk4(pulledBob, defaultPendulumParams, 1 / 240, 0.0035, { x: 0, y: 0 }, [], pull);
  tb += 1 / 240;
}
assert("outer bob pull moves the inner joint", Math.abs(pulledBob.theta[0] - bobGrabPose.theta[0]) > 0.05);

const tripleParams = { masses: [1.15, 1, 0.88], lengths: [1, 0.88, 0.76], g: 9.81 };
const tripleStart = { theta: [0.6, 0.9, 1.2], omega: [0.8, -0.5, 0.4] };
const tripleE0 = energy(tripleStart, tripleParams);
let triple = { theta: [...tripleStart.theta], omega: [...tripleStart.omega] };
let t = 0;
while (t < 1) {
  triple = stepRk4(triple, tripleParams, 1 / 240, 0);
  t += 1 / 240;
}
assert("triple pendulum conserves energy without damping", Math.abs(energy(triple, tripleParams) - tripleE0) / Math.abs(tripleE0) < 0.04);

const balancedStick = { masses: [1], lengths: [1], g: 9.81, model: "compound" as const, pivotAlong: [0.5] };
const balancedAlpha = accelerations({ theta: [0.9], omega: [0] }, balancedStick);
assert("centered stick has no gravity torque", Math.abs(balancedAlpha[0]) < 1e-8);

const endStick = { masses: [1], lengths: [1], g: 9.81, model: "compound" as const, pivotAlong: [0] };
const endAlpha = accelerations({ theta: [0.6], omega: [0] }, endStick);
assert("end-pivoted rod matches 3g/2L", Math.abs(endAlpha[0] + 1.5 * 9.81 * Math.sin(0.6)) < 1e-6);

const spec2 = stickGeometry(2);
const balancedInner = balancedPivotAlong(spec2.masses);
const centeredInner = {
  masses: spec2.masses,
  lengths: spec2.lengths,
  g: 9.81,
  model: "compound" as const,
  pivotAlong: [balancedInner[0], 0.5],
};
const balancedPair = accelerations({ theta: [0.8, -1.1], omega: [0, 0] }, centeredInner);
assert("inner stick is gravity-balanced when the outer CM sits on the coupling", Math.abs(balancedPair[0]) < 1e-6);
assert("centered outer stick has no own gravity torque", Math.abs(balancedPair[1]) < 1e-6);
assert("designed inner residual is applied after balance", Math.abs(spec2.pivotAlong[0] - (balancedInner[0] + STICK_INNER_RESIDUAL)) < 1e-9);
assert("innermost stick is a 3:1 arm", Math.abs(spec2.pivotAlong[0] / (1 - spec2.pivotAlong[0]) - 3) < 1e-9);

const spec3 = stickGeometry(3);
assert("triple innermost stick is a 3:1 arm", Math.abs(spec3.pivotAlong[0] / (1 - spec3.pivotAlong[0]) - 3) < 1e-9);
const balancedTriple = balancedPivotAlong(spec3.masses);
const centeredTriple = {
  masses: spec3.masses,
  lengths: spec3.lengths,
  g: 9.81,
  model: "compound" as const,
  pivotAlong: [balancedTriple[0], balancedTriple[1], 0.5],
};
const balancedChain = accelerations({ theta: [0.7, -0.9, 1.1], omega: [0, 0, 0] }, centeredTriple);
assert("triple inner stick is gravity-balanced when child CMs sit on the couplings", Math.abs(balancedChain[0]) < 1e-6);
assert("triple middle stick is gravity-balanced when the outer CM sits on the coupling", Math.abs(balancedChain[1]) < 1e-6);

const stickParams = {
  masses: spec2.masses,
  lengths: spec2.lengths,
  g: 9.81,
  model: "compound" as const,
  pivotAlong: spec2.pivotAlong,
};
const stickStart = { theta: [0.8, -1.1], omega: [1.2, -0.9] };
const stickE0 = energy(stickStart, stickParams);
let stick = { theta: [...stickStart.theta], omega: [...stickStart.omega] };
let ts = 0;
while (ts < 1) {
  stick = stepRk4(stick, stickParams, 1 / 240, 0);
  ts += 1 / 240;
}
assert("swinging sticks conserve energy without damping", Math.abs(energy(stick, stickParams) - stickE0) / Math.abs(stickE0) < 0.05);
assert("outer stick eccentricity is the designed offset", Math.abs(spec2.pivotAlong[1] - (0.5 + STICK_OUTER_ECCENTRICITY)) < 1e-9);

const grabPose = { theta: [0.3, -0.5], omega: [0, 0] };
const qOuter = stickGrabTorque(grabPose, stickParams, { index: 1, along: 0.3, perp: 0 }, { x: 1.5, y: 0.2 }, STICK_GRAB_KP, STICK_GRAB_KD, STICK_GRAB_FMAX);
assert("pulling the short stick torques the long stick too", qOuter[0] !== 0 && qOuter[1] !== 0);
const qLong = stickGrabTorque(grabPose, stickParams, { index: 0, along: -0.3, perp: 0 }, { x: -1.2, y: 0.2 }, STICK_GRAB_KP, STICK_GRAB_KD, STICK_GRAB_FMAX);
assert("pulling the long stick does not apply a direct outer torque", qLong[0] !== 0 && qLong[1] === 0);
let yanked = { theta: [...grabPose.theta], omega: [0, 0] };
let ty = 0;
while (ty < 0.45) {
  const pull = stickGrabTorque(yanked, stickParams, { index: 1, along: 0.3, perp: 0 }, { x: 1.2, y: 0.1 }, STICK_GRAB_KP, STICK_GRAB_KD, STICK_GRAB_FMAX);
  yanked = stepRk4(yanked, stickParams, 1 / 240, 0.0032, { x: 0, y: 0 }, [], pull);
  ty += 1 / 240;
}
assert("short-stick pull moves the long stick", Math.abs(yanked.theta[0] - grabPose.theta[0]) > 0.05);

let damped = { theta: [...stickStart.theta], omega: [...stickStart.omega] };
const dampedE0 = energy(damped, stickParams);
let td = 0;
while (td < 2) {
  damped = stepRk4(damped, stickParams, 1 / 240, 0.02);
  td += 1 / 240;
}
assert("natural stick damping reduces energy", energy(damped, stickParams) < dampedE0 - 0.01);

const q = stickDriveTorque({ theta: [1.2, -0.4], omega: [0.4, -0.2] }, 0.08);
assert("stick drive torques only the inner joint", q[0] !== 0 && q[1] === 0);
const qHigh = stickDriveTorque({ theta: [1.2, -0.4], omega: [0.4, -0.2] }, 1.2);
assert("stick drive idles above the energy band", qHigh[0] === 0 && qHigh[1] === 0);
const qRest = stickDriveTorque({ theta: [0, 0], omega: [0, 0] }, 0);
assert("stopped hanging sticks are not bounced by drive", qRest[0] === 0);
const qKick = stickDriveTorque({ theta: [0, 0], omega: [0, 0] }, 0, { startKick: true });
assert("start kick is a one-shot inner torque", qKick[0] !== 0 && qKick[1] === 0);

let stickRun = { theta: [0.35, -0.85], omega: [0.26, -0.1] };
let maxOmega = 0;
let reversals = 0;
let prevSign = [Math.sign(stickRun.omega[0]) || 1, Math.sign(stickRun.omega[1]) || 1];
let te = 0;
while (te < 30) {
  const torque = stickDriveTorque(stickRun, kineticEnergy(stickRun, stickParams));
  stickRun = stepRk4(stickRun, stickParams, 1 / 240, 0.0032, { x: 0, y: 0 }, [], torque);
  maxOmega = Math.max(maxOmega, ...stickRun.omega.map(Math.abs));
  for (let i = 0; i < 2; i += 1) {
    const nextSign = Math.sign(stickRun.omega[i] ?? 0) || prevSign[i];
    if (nextSign !== prevSign[i]) reversals += 1;
    prevSign[i] = nextSign;
  }
  te += 1 / 240;
}
assert("driven sticks stay below the omega safety limit", maxOmega < 16);
assert("driven sticks reverse through coupling, not a timer", reversals >= 1);

for (const n of [1, 2, 3]) {
  const spec = stickGeometry(n);
  const params = {
    masses: spec.masses,
    lengths: spec.lengths,
    g: 9.81,
    model: "compound" as const,
    pivotAlong: spec.pivotAlong,
  };
  const standHeight = 112;
  const clearance = 13;
  const scale = (standHeight - clearance) / downwardReach(params);
  let lowest = 0;
  const poses = 1 << n;
  for (let mask = 0; mask < poses; mask += 1) {
    const theta = params.lengths.map((_, i) => ((mask >> i) & 1 ? Math.PI : 0));
    const hanging = { theta, omega: theta.map(() => 0) };
    lowest = Math.max(
      lowest,
      ...rodSegments(hanging, { x: 0, y: 0 }, scale, params).flatMap((segment) => [segment.front.y, segment.back.y]),
    );
  }
  assert(`sticks n=${n} stay above the stand`, lowest <= standHeight - clearance + 1e-6);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall drag/physics checks passed");

function closedDouble(
  theta1: number,
  theta2: number,
  omega1: number,
  omega2: number,
  params: { masses: number[]; lengths: number[]; g: number },
): [number, number] {
  const m1 = params.masses[0];
  const m2 = params.masses[1];
  const l1 = params.lengths[0];
  const l2 = params.lengths[1];
  const g = params.g;
  const delta = theta1 - theta2;
  const denom = 2 * m1 + m2 - m2 * Math.cos(2 * delta);
  const alpha1 =
    (
      -g * (2 * m1 + m2) * Math.sin(theta1)
      - m2 * g * Math.sin(theta1 - 2 * theta2)
      - 2 * Math.sin(delta) * m2 * (omega2 * omega2 * l2 + omega1 * omega1 * l1 * Math.cos(delta))
    ) / (l1 * denom);
  const alpha2 =
    (
      2 * Math.sin(delta) * (
        omega1 * omega1 * l1 * (m1 + m2)
        + g * Math.cos(theta1) * (m1 + m2)
        + omega2 * omega2 * l2 * m2 * Math.cos(delta)
      )
    ) / (l2 * denom);
  return [alpha1, alpha2];
}
