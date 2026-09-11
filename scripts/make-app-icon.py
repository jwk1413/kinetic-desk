#!/usr/bin/env python3
"""Render a geometrically aligned kinetic-desk app icon."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageFilter

SIZE = 1024
SUPERSAMPLE = 2
MARGIN = 0.14


def mix(a: tuple[float, ...], b: tuple[float, ...], t: float) -> tuple[float, ...]:
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def smooth(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 0.0 if value < edge0 else 1.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def capsule(px: float, py: float, x1: float, y1: float, x2: float, y2: float, radius: float):
    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    along = (px - x1) * ux + (py - y1) * uy
    t = max(0.0, min(1.0, along / length))
    cx = x1 + ux * t * length
    cy = y1 + uy * t * length
    dist = math.hypot(px - cx, py - cy)
    across = (px - cx) * nx + (py - cy) * ny
    return dist - radius, across / radius, t


def disc(px: float, py: float, cx: float, cy: float, radius: float):
    dx = px - cx
    dy = py - cy
    dist = math.hypot(dx, dy)
    return dist - radius, dx / radius, dy / radius


def chrome_color(s: float) -> tuple[float, float, float]:
    highlight = math.exp(-((s + 0.06) * 4.2) ** 2)
    shade = 0.48 + 0.34 * (1.0 - abs(s) ** 1.2)
    base = mix((56, 64, 76), (222, 230, 238), shade)
    lit = mix(base, (255, 255, 255), 0.12 + 0.62 * highlight)
    if abs(s) > 0.72:
        lit = mix(lit, (92, 102, 114), (abs(s) - 0.72) / 0.28 * 0.28)
    return lit


def glass_color(nx: float, ny: float, tint: tuple[float, float, float], frost: float) -> tuple[float, float, float]:
    nlen = math.hypot(nx, ny)
    if nlen > 1:
        nx, ny = nx / nlen, ny / nlen
    z = math.sqrt(max(0.0, 1.0 - min(1.0, nx * nx + ny * ny)))
    light = max(0.0, nx * -0.35 + ny * -0.55 + z * 0.78)
    rim = smooth(0.55, 1.0, nlen)
    body = mix(mix((18, 24, 34), tint, 0.72), (236, 242, 248), 0.18 + 0.55 * light)
    body = mix(body, (255, 255, 255), 0.12 + 0.38 * frost * light)
    spec = math.exp(-((nx + 0.18) ** 2 + (ny + 0.22) ** 2) * 10.0) * (0.32 + 0.18 * z)
    body = mix(body, (255, 255, 255), spec)
    body = mix(body, tint, rim * 0.22)
    return body


def overlay(dst: list[float], src: tuple[float, ...], alpha: float) -> None:
    if alpha <= 0:
        return
    a = max(0.0, min(1.0, alpha))
    inv = 1.0 - a
    dst[0] = dst[0] * inv + src[0] * a
    dst[1] = dst[1] * inv + src[1] * a
    dst[2] = dst[2] * inv + src[2] * a


def paint_capsule(pixels, width: int, x1: float, y1: float, x2: float, y2: float, radius: float) -> None:
    pad = radius + 2
    min_x = max(0, int(min(x1, x2) - pad))
    max_x = min(width - 1, int(max(x1, x2) + pad))
    min_y = max(0, int(min(y1, y2) - pad))
    max_y = min(width - 1, int(max(y1, y2) + pad))
    for y in range(min_y, max_y + 1):
        row = pixels[y]
        for x in range(min_x, max_x + 1):
            sdf, s, _along = capsule(x + 0.5, y + 0.5, x1, y1, x2, y2, radius)
            alpha = 1.0 - smooth(-0.9, 0.9, sdf)
            if alpha <= 0:
                continue
            overlay(row[x], chrome_color(max(-1.0, min(1.0, s))), alpha)


def paint_sphere(
    pixels,
    width: int,
    cx: float,
    cy: float,
    radius: float,
    tint: tuple[float, float, float],
    frost: float,
    glow: tuple[float, float, float] | None = None,
) -> None:
    pad = radius * (1.55 if glow else 1.08) + 2
    min_x = max(0, int(cx - pad))
    max_x = min(width - 1, int(cx + pad))
    min_y = max(0, int(cy - pad))
    max_y = min(width - 1, int(cy + pad))
    for y in range(min_y, max_y + 1):
        row = pixels[y]
        for x in range(min_x, max_x + 1):
            px = x + 0.5
            py = y + 0.5
            sdf, nx, ny = disc(px, py, cx, cy, radius)
            if glow:
                halo = math.exp(-(max(0.0, sdf) / (radius * 0.42)) ** 2) * 0.22
                overlay(row[x], glow, halo)
            alpha = 1.0 - smooth(-0.9, 0.9, sdf)
            if alpha <= 0:
                continue
            overlay(row[x], glass_color(nx, ny, tint, frost), alpha)


def paint_pin(pixels, width: int, cx: float, cy: float, radius: float) -> None:
    pad = radius + 2
    min_x = max(0, int(cx - pad))
    max_x = min(width - 1, int(cx + pad))
    min_y = max(0, int(cy - pad))
    max_y = min(width - 1, int(cy + pad))
    for y in range(min_y, max_y + 1):
        row = pixels[y]
        for x in range(min_x, max_x + 1):
            sdf, nx, ny = disc(x + 0.5, y + 0.5, cx, cy, radius)
            alpha = 1.0 - smooth(-0.9, 0.9, sdf)
            if alpha <= 0:
                continue
            metal = chrome_color(max(-1.0, min(1.0, ny)))
            core = 1.0 - smooth(0.28, 0.58, math.hypot(nx, ny))
            metal = mix(metal, (42, 48, 58), 0.55 * core)
            overlay(row[x], metal, alpha)


def pose(width: int):
    cx = width * 0.5
    top = width * MARGIN
    usable = width * (1.0 - 2.0 * MARGIN)
    pivot = (cx + usable * 0.02, top + usable * 0.16)
    length1 = usable * 0.42
    length2 = usable * 0.36
    a1 = math.radians(-24)
    a2 = math.radians(46)
    joint = (
        pivot[0] + math.sin(a1) * length1,
        pivot[1] + math.cos(a1) * length1,
    )
    tip = (
        joint[0] + math.sin(a2) * length2,
        joint[1] + math.cos(a2) * length2,
    )
    return pivot, joint, tip, usable


def render() -> Image.Image:
    width = SIZE * SUPERSAMPLE
    pivot, joint, tip, usable = pose(width)
    rod = usable * 0.026
    pin = usable * 0.038
    inner_r = usable * 0.1
    outer_r = usable * 0.112

    pixels = []
    for y in range(width):
        t = y / (width - 1)
        row = []
        for x in range(width):
            g = t * 0.82 + (x / (width - 1)) * 0.18
            row.append(list(mix((28, 36, 51), (10, 13, 20), g)))
        pixels.append(row)

    shadow = Image.new("L", (width, width), 0)
    shadow_px = shadow.load()
    for y in range(width):
        for x in range(width):
            d1 = disc(x + 0.5, y + 0.5, joint[0], joint[1] + inner_r * 0.2, inner_r * 0.92)[0]
            d2 = disc(x + 0.5, y + 0.5, tip[0], tip[1] + outer_r * 0.25, outer_r * 1.05)[0]
            alpha = max(1.0 - smooth(-2, 8, d1), 1.0 - smooth(-2, 10, d2))
            if alpha > 0:
                shadow_px[x, y] = int(alpha * 120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=usable * 0.04))
    shadow_px = shadow.load()
    for y in range(width):
        row = pixels[y]
        for x in range(width):
            overlay(row[x], (8, 12, 20), shadow_px[x, y] / 255.0 * 0.55)

    def inset(start: tuple[float, float], end: tuple[float, float], amount: float) -> tuple[float, float]:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        length = math.hypot(dx, dy) or 1.0
        return (start[0] + dx / length * amount, start[1] + dy / length * amount)

    rod1_a = inset(pivot, joint, pin * 0.92)
    rod1_b = inset(joint, pivot, inner_r * 0.92)
    rod2_a = inset(joint, tip, inner_r * 0.92)
    rod2_b = inset(tip, joint, outer_r * 0.92)
    paint_capsule(pixels, width, rod1_a[0], rod1_a[1], rod1_b[0], rod1_b[1], rod)
    paint_capsule(pixels, width, rod2_a[0], rod2_a[1], rod2_b[0], rod2_b[1], rod)
    paint_sphere(pixels, width, joint[0], joint[1], inner_r, (198, 214, 230), 0.55)
    paint_sphere(pixels, width, tip[0], tip[1], outer_r, (91, 120, 255), 0.12, glow=(91, 120, 255))
    paint_pin(pixels, width, pivot[0], pivot[1], pin)
    paint_pin(pixels, width, joint[0], joint[1], pin)
    paint_pin(pixels, width, tip[0], tip[1], pin)

    data = [(int(p[0] + 0.5), int(p[1] + 0.5), int(p[2] + 0.5)) for row in pixels for p in row]
    image = Image.new("RGB", (width, width))
    image.putdata(data)
    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out = root / "build" / "icon.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    render().save(out, "PNG")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
