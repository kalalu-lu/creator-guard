"""Generate simple shield icons without external image libraries."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

NAVY = (15, 23, 42, 255)
WHITE = (255, 255, 255, 255)
GREEN = (34, 197, 94, 255)


def inside_polygon(x: float, y: float, points: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y):
            x_intersect = (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
            if x < x_intersect:
                inside = not inside
        j = i
    return inside


def dist_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    qx, qy = ax + t * dx, ay + t * dy
    return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5


def color_at(u: float, v: float) -> tuple[int, int, int, int]:
    # rounded-square background
    margin = 0.075
    radius = 0.18
    x0, y0, x1, y1 = margin, margin, 1 - margin, 1 - margin

    def rounded(x: float, y: float) -> bool:
        cx = min(max(x, x0 + radius), x1 - radius)
        cy = min(max(y, y0 + radius), y1 - radius)
        return ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 <= radius

    if not rounded(u, v):
        return (0, 0, 0, 0)

    shield = [(0.28, 0.23), (0.72, 0.23), (0.72, 0.57), (0.50, 0.80), (0.28, 0.57)]
    if inside_polygon(u, v, shield):
        # subtle green border
        border = 0.035
        inner = [(x, y) for x, y in shield]
        # check mark first
        d1 = dist_to_segment(u, v, 0.39, 0.50, 0.47, 0.59)
        d2 = dist_to_segment(u, v, 0.47, 0.59, 0.64, 0.39)
        if min(d1, d2) <= 0.045:
            return GREEN
        return WHITE
    return NAVY


def make_icon(size: int) -> bytes:
    scale = 4
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)  # PNG filter type: none
        for x in range(size):
            r = g = b = a = 0
            for sy in range(scale):
                for sx in range(scale):
                    rr, gg, bb, aa = color_at((x + (sx + 0.5) / scale) / size, (y + (sy + 0.5) / scale) / size)
                    r += rr
                    g += gg
                    b += bb
                    a += aa
            n = scale * scale
            pixels.extend((r // n, g // n, b // n, a // n))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return header + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(pixels), 9)) + chunk(b"IEND", b"")


for icon_size in (16, 48, 128):
    (OUT / f"icon{icon_size}.png").write_bytes(make_icon(icon_size))
    print("wrote", OUT / f"icon{icon_size}.png")
