export interface Vec2 {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

export function mixHex(hex: string, other: string, t: number): string {
  const a = parseHex(hex);
  const b = parseHex(other);
  return rgb(
    Math.round(lerp(a.r, b.r, t)),
    Math.round(lerp(a.g, b.g, t)),
    Math.round(lerp(a.b, b.b, t)),
  );
}

export function shadeHex(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const lift = (channel: number) => clamp(Math.round(channel + (amount < 0 ? channel : 255 - channel) * amount), 0, 255);
  return rgb(lift(r), lift(g), lift(b));
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  const raw = value.length === 3
    ? value.split("").map((part) => part + part).join("")
    : value;
  const numeric = Number.parseInt(raw, 16);
  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255,
  };
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}
