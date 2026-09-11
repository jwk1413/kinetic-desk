import { clamp, shadeHex, withAlpha } from "../physics/math";
import { perf } from "../perf";

const shadowBuffer = document.createElement("canvas");
const shadowCtx = shadowBuffer.getContext("2d");
const SHADOW_SCALE = 0.5;
const SHADOW_GROW = 96;
const ROD_BAND_LIMIT = 72;
const PIN_CACHE_LIMIT = 24;

const rodBandCache = new Map<string, HTMLCanvasElement>();
const pinCache = new Map<string, HTMLCanvasElement>();
const puckCache = new Map<string, HTMLCanvasElement>();
let standCache: { key: string; canvas: HTMLCanvasElement } | null = null;
const PUCK_CACHE_LIMIT = 32;

export function prepareShadowBuffer(viewWidth: number, viewHeight: number, dpr: number): void {
  const maxW = Math.max(1, Math.ceil(viewWidth * dpr * SHADOW_SCALE) + SHADOW_GROW);
  const maxH = Math.max(1, Math.ceil(viewHeight * dpr * SHADOW_SCALE) + SHADOW_GROW);
  if (shadowBuffer.width > maxW || shadowBuffer.height > maxH) {
    shadowBuffer.width = maxW;
    shadowBuffer.height = maxH;
  }
}

export function invalidateSizeCaches(): void {
  rodBandCache.clear();
  pinCache.clear();
  puckCache.clear();
  standCache = null;
}

const KEY = normalize3(-0.4, -0.82, 0.5);
const KEY_H = halfVector(KEY);

export function drawGlassRod(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1) return;
  const radius = width / 2;
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const specS = highlightS(nx, ny);
  const specAmt = specular(specS, nx, ny);
  const band = getRodBand("glass", width, nx, ny);

  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(angle);

  roundRect(ctx, 0, -radius, length, width, radius);
  ctx.save();
  ctx.clip();
  fillRodBand(ctx, band, -radius, length, width);

  const y = specS * radius * 0.94;
  const ribbon = Math.max(1.15, radius * (0.22 + specAmt * 0.22));
  ctx.globalCompositeOperation = "lighter";
  roundRect(ctx, 1.5, y - ribbon * 0.5, Math.max(0, length - 3), ribbon, ribbon * 0.5);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + specAmt * 0.48})`;
  ctx.fill();

  const facing = KEY.x * Math.cos(angle) + KEY.y * Math.sin(angle);
  const glintX = length * clamp(0.18 + 0.5 * (0.5 + 0.5 * facing), 0.06, 0.72);
  const glintW = Math.min(length * 0.38, Math.max(16, length * 0.28));
  roundRect(ctx, glintX, y - ribbon * 0.72, glintW, ribbon * 1.4, ribbon);
  ctx.fillStyle = `rgba(236, 246, 255, ${0.08 + specAmt * 0.4})`;
  ctx.fill();

  ctx.globalCompositeOperation = "source-over";
  roundRect(
    ctx,
    3,
    -specS * radius * 0.58 - radius * 0.08,
    Math.max(0, length - 6),
    Math.max(1, radius * 0.16),
    radius * 0.08,
  );
  ctx.fillStyle = "rgba(22, 40, 62, 0.18)";
  ctx.fill();
  ctx.restore();

  roundRect(ctx, 0, -radius, length, width, radius);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.16 + specAmt * 0.28})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function drawChromeRod(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1) return;
  const radius = width / 2;
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  const specS = highlightS(nx, ny);
  const specAmt = specular(specS, nx, ny);
  const band = getRodBand("chrome", width, nx, ny);

  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(angle);
  roundRect(ctx, 0, -radius, length, width, radius);
  ctx.save();
  ctx.clip();
  fillRodBand(ctx, band, -radius, length, width);

  const y = specS * radius * 0.9;
  const ribbon = Math.max(0.9, radius * (0.18 + specAmt * 0.28));
  ctx.globalCompositeOperation = "lighter";
  roundRect(ctx, 1, y - ribbon * 0.5, Math.max(0, length - 2), ribbon, ribbon * 0.5);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.16 + specAmt * 0.55})`;
  ctx.fill();

  ctx.globalCompositeOperation = "source-over";
  roundRect(ctx, 2, -specS * radius * 0.5 - radius * 0.1, Math.max(0, length - 4), Math.max(1, radius * 0.14), radius * 0.07);
  ctx.fillStyle = "rgba(28, 34, 42, 0.22)";
  ctx.fill();
  ctx.restore();

  roundRect(ctx, 0, -radius, length, width, radius);
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 + specAmt * 0.32})`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function drawChromePin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  highlight = false,
): void {
  const sprite = getPinSprite(radius, highlight);
  const size = sprite.width;
  ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
}

export function drawStandBase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const sprite = getStandSprite(width, height);
  ctx.drawImage(sprite, x, y, width, height);
}

function fillRodBand(ctx: CanvasRenderingContext2D, band: HTMLCanvasElement, offsetY: number, length: number, width: number): void {
  ctx.drawImage(band, 0, offsetY, Math.max(1, length), width);
}

function remember<T>(cache: Map<string, T>, key: string, value: T, limit: number): T {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

function getRodBand(kind: "glass" | "chrome", width: number, nx: number, ny: number): HTMLCanvasElement {
  const w = Math.max(2, Math.round(width));
  const qn = (value: number) => Math.round(value * 48);
  const key = `${kind}:${w}:${qn(nx)}:${qn(ny)}`;
  const hit = rodBandCache.get(key);
  if (hit) return remember(rodBandCache, key, hit, ROD_BAND_LIMIT);
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = w;
  const band = canvas.getContext("2d");
  if (!band) return canvas;
  const shade = band.createLinearGradient(0, 0, 0, w);
  const steps = 10;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    shade.addColorStop(t, kind === "glass" ? glassShade(t * 2 - 1, nx, ny) : chromeShade(t * 2 - 1, nx, ny));
  }
  band.fillStyle = shade;
  band.fillRect(0, 0, 4, w);
  return remember(rodBandCache, key, canvas, ROD_BAND_LIMIT);
}

function getPinSprite(radius: number, highlight: boolean): HTMLCanvasElement {
  const size = Math.max(4, Math.ceil(radius * 2 + 2));
  const key = `${size}:${highlight ? 1 : 0}`;
  const hit = pinCache.get(key);
  if (hit) return remember(pinCache, key, hit, PIN_CACHE_LIMIT);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const pin = canvas.getContext("2d");
  if (!pin) return canvas;
  const x = size / 2;
  const y = size / 2;
  const face = pin.createRadialGradient(
    x - radius * 0.32,
    y - radius * 0.36,
    radius * 0.08,
    x,
    y,
    radius,
  );
  face.addColorStop(0, "#F3F6F8");
  face.addColorStop(0.45, "#C5CED6");
  face.addColorStop(1, "#7E8894");
  pin.beginPath();
  pin.arc(x, y, radius, 0, Math.PI * 2);
  pin.fillStyle = face;
  pin.fill();
  pin.strokeStyle = highlight ? "rgba(255, 255, 255, 0.7)" : "rgba(40, 46, 54, 0.35)";
  pin.lineWidth = 1;
  pin.stroke();
  pin.beginPath();
  pin.arc(x, y, Math.max(1.2, radius * 0.28), 0, Math.PI * 2);
  pin.fillStyle = highlight ? "#4A5360" : "#2E3540";
  pin.fill();
  return remember(pinCache, key, canvas, PIN_CACHE_LIMIT);
}

function getStandSprite(width: number, height: number): HTMLCanvasElement {
  const w = Math.max(2, Math.ceil(width));
  const h = Math.max(2, Math.ceil(height));
  const key = `${w}x${h}`;
  if (standCache?.key === key) return standCache.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const stand = canvas.getContext("2d");
  if (!stand) return canvas;
  roundRect(stand, 0, 0, w, h, Math.min(4, h * 0.28));
  const fill = stand.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, "#2A2A2A");
  fill.addColorStop(0.35, "#141414");
  fill.addColorStop(1, "#0A0A0A");
  stand.fillStyle = fill;
  stand.fill();
  stand.strokeStyle = "rgba(255, 255, 255, 0.08)";
  stand.lineWidth = 1;
  stand.stroke();
  standCache = { key, canvas };
  return canvas;
}

function getPuckSprite(radius: number, color: string, highlight: boolean): HTMLCanvasElement {
  const size = Math.max(4, Math.ceil(radius * 2 + 2));
  const key = `${size}:${color}:${highlight ? 1 : 0}`;
  const hit = puckCache.get(key);
  if (hit) return remember(puckCache, key, hit, PUCK_CACHE_LIMIT);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const puck = canvas.getContext("2d");
  if (!puck) return canvas;
  const x = size / 2;
  const y = size / 2;
  const face = puck.createRadialGradient(
    x - radius * 0.28,
    y - radius * 0.34,
    radius * 0.12,
    x,
    y,
    radius,
  );
  face.addColorStop(0, shadeHex(color, 0.22));
  face.addColorStop(0.45, color);
  face.addColorStop(1, shadeHex(color, -0.16));
  puck.beginPath();
  puck.arc(x, y, radius, 0, Math.PI * 2);
  puck.fillStyle = face;
  puck.fill();
  puck.beginPath();
  puck.arc(x, y, radius - 0.5, 0, Math.PI * 2);
  puck.strokeStyle = withAlpha(shadeHex(color, -0.38), 0.35);
  puck.lineWidth = 1;
  puck.stroke();
  puck.beginPath();
  puck.arc(x, y, radius * 0.72, Math.PI * 1.15, Math.PI * 1.75);
  puck.strokeStyle = withAlpha("#F4F7FB", highlight ? 0.42 : 0.24);
  puck.lineWidth = radius * 0.12;
  puck.lineCap = "butt";
  puck.stroke();
  return remember(puckCache, key, canvas, PUCK_CACHE_LIMIT);
}

function chromeShade(s: number, nx: number, ny: number): string {
  const nz = Math.sqrt(Math.max(0, 1 - s * s));
  const ndotl = Math.max(0, s * (nx * KEY.x + ny * KEY.y) + nz * KEY.z);
  const spec = specular(s, nx, ny);
  const r = Math.round(118 + spec * 110 + ndotl * 72);
  const g = Math.round(126 + spec * 102 + ndotl * 64);
  const b = Math.round(136 + spec * 92 + ndotl * 58);
  return `rgb(${r}, ${g}, ${b})`;
}

function glassShade(s: number, nx: number, ny: number): string {
  const nz = Math.sqrt(Math.max(0, 1 - s * s));
  const ndotl = Math.max(0, s * (nx * KEY.x + ny * KEY.y) + nz * KEY.z);
  const spec = specular(s, nx, ny);
  const fresnel = 0.07 + 0.7 * (1 - nz) ** 1.55;
  const r = Math.round(198 + spec * 57 + ndotl * 18);
  const g = Math.round(214 + spec * 36 + ndotl * 10);
  const b = Math.round(228 + spec * 24);
  const a = 0.045 + fresnel * 0.36 + spec * 0.5 + ndotl * 0.07;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function specular(s: number, nx: number, ny: number): number {
  const nz = Math.sqrt(Math.max(0, 1 - s * s));
  const ndoth = Math.max(0, s * (nx * KEY_H.x + ny * KEY_H.y) + nz * KEY_H.z);
  return ndoth ** 44;
}

function highlightS(nx: number, ny: number): number {
  const hn = KEY_H.x * nx + KEY_H.y * ny;
  const mag = Math.hypot(hn, KEY_H.z);
  if (mag < 1e-5) return 0;
  return clamp(hn / mag, -1, 1);
}

function normalize3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const inv = 1 / Math.hypot(x, y, z);
  return { x: x * inv, y: y * inv, z: z * inv };
}

function halfVector(light: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return normalize3(light.x, light.y, light.z + 1);
}

export function drawPuck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  highlight = false,
): void {
  const sprite = getPuckSprite(radius, color, highlight);
  const size = sprite.width;
  ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
}

export function drawPendulumShadow(
  ctx: CanvasRenderingContext2D,
  joints: Array<{ x: number; y: number }>,
  radii: number[],
  rodWidth: number,
  extraLines: Array<Array<{ x: number; y: number }>> = [],
  boxes: Array<{ x: number; y: number; width: number; height: number }> = [],
): void {
  const started = perf.now();
  drawPendulumShadowInner(ctx, joints, radii, rodWidth, extraLines, boxes);
  perf.add("shadowMs", perf.now() - started);
}

function drawPendulumShadowInner(
  ctx: CanvasRenderingContext2D,
  joints: Array<{ x: number; y: number }>,
  radii: number[],
  rodWidth: number,
  extraLines: Array<Array<{ x: number; y: number }>>,
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
): void {
  if (!shadowCtx) return;
  const points = [
    ...joints,
    ...extraLines.flat(),
    ...boxes.flatMap((box) => [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    ]),
  ];
  if (points.length === 0) return;
  const dpr = ctx.getTransform().a || 1;
  const pad = 28 + Math.max(rodWidth, ...radii, 6);
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  minX -= pad;
  minY -= pad;
  const cssW = Math.max(1, maxX + pad - minX);
  const cssH = Math.max(1, maxY + pad - minY);
  const needW = Math.max(1, Math.ceil(cssW * dpr * SHADOW_SCALE));
  const needH = Math.max(1, Math.ceil(cssH * dpr * SHADOW_SCALE));
  if (needW > shadowBuffer.width || needH > shadowBuffer.height) {
    shadowBuffer.width = Math.max(needW + SHADOW_GROW, shadowBuffer.width);
    shadowBuffer.height = Math.max(needH + SHADOW_GROW, shadowBuffer.height);
  }

  shadowCtx.setTransform(1, 0, 0, 1, 0, 0);
  shadowCtx.clearRect(0, 0, needW, needH);
  const pixelRatio = dpr * SHADOW_SCALE;
  shadowCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  shadowCtx.translate(-minX, -minY);

  const polylines = extraLines.length ? extraLines : [joints];
  paintSilhouette(shadowCtx, polylines, joints, radii, rodWidth, boxes, 3, 5, 3.5, "rgba(16, 22, 38, 0.22)");
  paintSilhouette(shadowCtx, polylines, joints, radii, rodWidth, boxes, 0, 0, 2, "rgba(236, 241, 248, 0.12)");

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(shadowBuffer, 0, 0, needW, needH, minX * dpr, minY * dpr, cssW * dpr, cssH * dpr);
  ctx.restore();
}

function paintSilhouette(
  target: CanvasRenderingContext2D,
  polylines: Array<Array<{ x: number; y: number }>>,
  discs: Array<{ x: number; y: number }>,
  radii: number[],
  rodWidth: number,
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
  dx: number,
  dy: number,
  blur: number,
  color: string,
): void {
  target.save();
  target.filter = `blur(${blur}px)`;
  target.translate(dx, dy);
  target.strokeStyle = color;
  target.fillStyle = color;
  target.lineCap = "round";
  target.lineJoin = "round";
  target.lineWidth = rodWidth + 3;
  for (const line of polylines) {
    if (line.length < 2) continue;
    target.beginPath();
    target.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i += 1) target.lineTo(line[i].x, line[i].y);
    target.stroke();
  }
  for (let i = 0; i < discs.length; i += 1) {
    fillDisc(target, discs[i].x, discs[i].y, radii[i] ?? radii[radii.length - 1] ?? rodWidth);
  }
  for (const box of boxes) {
    roundRect(target, box.x, box.y, box.width, box.height, Math.min(4, box.height * 0.28));
    target.fill();
  }
  target.restore();
}

function fillDisc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
