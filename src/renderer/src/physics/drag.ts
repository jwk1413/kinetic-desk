import { clamp } from "./math";

export interface Point {
  x: number;
  y: number;
}

export interface AngleSample {
  time: number;
  thetas: number[];
}

export interface PathSample {
  time: number;
  x: number;
  y: number;
}

export function wrapDelta(current: number, previous: number): number {
  let delta = current - previous;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function elbowSign(origin: Point, b1: Point, b2: Point): number {
  const ax = b1.x - origin.x;
  const ay = b1.y - origin.y;
  const bx = b2.x - b1.x;
  const by = b2.y - b1.y;
  const cross = ax * by - ay * bx;
  return Math.sign(cross) || 1;
}

export function stickGrabAngleOffset(pivot: Point, cursor: Point, theta: number): number {
  return wrapDelta(Math.atan2(cursor.x - pivot.x, cursor.y - pivot.y), theta);
}

export function followStickTheta(
  pivot: Point,
  cursor: Point,
  angleOffset: number,
  currentTheta: number,
  minLever = 10,
): number {
  const dx = cursor.x - pivot.x;
  const dy = cursor.y - pivot.y;
  if (Math.hypot(dx, dy) < minLever) return currentTheta;
  const raw = Math.atan2(dx, dy) - angleOffset;
  return currentTheta + wrapDelta(raw, currentTheta);
}

export function grabOffset(cursor: Point, center: Point): Point {
  return { x: cursor.x - center.x, y: cursor.y - center.y };
}

export function grabTarget(cursor: Point, offset: Point): Point {
  return { x: cursor.x - offset.x, y: cursor.y - offset.y };
}

export function followChain(
  origin: Point,
  target: Point,
  lengths: number[],
  current: Point[],
): number[] {
  if (lengths.length === 1) {
    return [followBob1(origin, target, Math.atan2(current[0]?.x - origin.x, current[0]?.y - origin.y))];
  }
  if (lengths.length === 2) {
    const next = followBob2(
      origin,
      target,
      lengths[0],
      lengths[1],
      current[0] ?? { x: origin.x, y: origin.y + lengths[0] },
      elbowSign(origin, current[0] ?? origin, current[1] ?? target),
    );
    return [next.theta1, next.theta2];
  }

  const n = lengths.length;
  const pts: Point[] = [{ ...origin }, ...current.map((point) => ({ ...point }))];
  while (pts.length < n + 1) {
    const last = pts[pts.length - 1];
    pts.push({ x: last.x, y: last.y + lengths[pts.length - 1] });
  }
  const maxReach = lengths.reduce((sum, length) => sum + length, 0);
  const goal = clampToReach(origin, target, 0, maxReach);

  for (let iter = 0; iter < 12; iter += 1) {
    pts[n] = { ...goal };
    for (let i = n - 1; i >= 0; i -= 1) {
      pts[i] = pointAtLength(pts[i + 1], pts[i], lengths[i]);
    }
    pts[0] = { ...origin };
    for (let i = 0; i < n; i += 1) {
      pts[i + 1] = pointAtLength(pts[i], pts[i + 1], lengths[i]);
    }
  }

  return thetasFromPoints(origin, pts.slice(1));
}

export function followBob1(origin: Point, target: Point, currentTheta: number): number {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (Math.hypot(dx, dy) < 1e-8) return currentTheta;
  return Math.atan2(dx, dy);
}

function pointAtLength(from: Point, toward: Point, length: number): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / dist) * length, y: from.y + (dy / dist) * length };
}

export function thetasFromPoints(origin: Point, bobs: Point[]): number[] {
  const thetas: number[] = [];
  let prev = origin;
  for (const bob of bobs) {
    thetas.push(Math.atan2(bob.x - prev.x, bob.y - prev.y));
    prev = bob;
  }
  return thetas;
}

export function clampToReach(origin: Point, target: Point, minR: number, maxR: number): Point {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-8) {
    return { x: origin.x, y: origin.y + minR };
  }
  const radius = clamp(dist, minR, maxR);
  const scale = radius / dist;
  return { x: origin.x + dx * scale, y: origin.y + dy * scale };
}

export function followBob2(
  origin: Point,
  target: Point,
  length1: number,
  length2: number,
  currentB1: Point,
  preferredSign: number,
): { theta1: number; theta2: number } {
  const minR = Math.abs(length1 - length2);
  const maxR = length1 + length2;
  const clamped = clampToReach(origin, target, minR, maxR);
  const dx = clamped.x - origin.x;
  const dy = clamped.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-8) {
    return {
      theta1: Math.atan2(currentB1.x - origin.x, currentB1.y - origin.y),
      theta2: Math.atan2(clamped.x - currentB1.x, clamped.y - currentB1.y),
    };
  }

  const along = (length1 * length1 - length2 * length2 + dist * dist) / (2 * dist);
  const height = Math.sqrt(Math.max(0, length1 * length1 - along * along));
  const mx = origin.x + (along * dx) / dist;
  const my = origin.y + (along * dy) / dist;
  const px = (-dy / dist) * height;
  const py = (dx / dist) * height;
  const candidates = [
    { x: mx + px, y: my + py },
    { x: mx - px, y: my - py },
  ];

  const ranked = candidates.map((candidate) => {
    const sign = elbowSign(origin, candidate, clamped);
    return {
      candidate,
      sign,
      dist: Math.hypot(candidate.x - currentB1.x, candidate.y - currentB1.y),
    };
  });
  const matching = ranked.filter((item) => item.sign === preferredSign || item.sign === 0);
  const chosen = (matching.length ? matching : ranked).sort((a, b) => a.dist - b.dist)[0].candidate;

  return {
    theta1: Math.atan2(chosen.x - origin.x, chosen.y - origin.y),
    theta2: Math.atan2(clamped.x - chosen.x, clamped.y - chosen.y),
  };
}

export function recentAngularRates(
  samples: AngleSample[],
  now: number,
  windowMs = 80,
  maxOmega = 18,
): number[] {
  const window = samples.filter((sample) => now - sample.time <= windowMs && now - sample.time >= 0);
  const count = window[window.length - 1]?.thetas.length ?? window[0]?.thetas.length ?? 0;
  const zeros = Array.from({ length: count }, () => 0);
  if (window.length < 2) return zeros;
  const first = window[0];
  const last = window[window.length - 1];
  const dt = (last.time - first.time) / 1000;
  if (dt < 0.012) return zeros;
  return last.thetas.map((theta, i) => (
    clamp(wrapDelta(theta, first.thetas[i] ?? theta) / dt, -maxOmega, maxOmega)
  ));
}

export function recentVelocity(
  samples: PathSample[],
  now: number,
  windowMs = 50,
): { vx: number; vy: number } {
  const window = samples.filter((sample) => now - sample.time <= windowMs && now - sample.time >= 0);
  if (window.length < 2) return { vx: 0, vy: 0 };
  const first = window[0];
  const last = window[window.length - 1];
  const dt = (last.time - first.time) / 1000;
  if (dt < 0.012) return { vx: 0, vy: 0 };
  return {
    vx: (last.x - first.x) / dt,
    vy: (last.y - first.y) / dt,
  };
}

export function pruneSamples<T extends { time: number }>(samples: T[], now: number, keepMs: number): T[] {
  return samples.filter((sample) => now - sample.time <= keepMs);
}
