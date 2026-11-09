"""生成 Office Copilot 图标（纯标准库，无第三方依赖）"""

import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")

BG = (37, 99, 235)      # #2563EB
FG = (255, 255, 255)


def clamp01(v):
    return 0.0 if v < 0 else (1.0 if v > 1 else v)


def sd_round_rect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ax = max(qx, 0.0)
    ay = max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r


def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def cov(sd, size):
    return clamp01(0.5 - sd * size)


def over(dst, src, a):
    sr, sg, sb = src
    dr, dg, db, da = dst
    oa = a + da * (1 - a)
    if oa <= 0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        (sr * a + dr * da * (1 - a)) / oa,
        (sg * a + dg * da * (1 - a)) / oa,
        (sb * a + db * da * (1 - a)) / oa,
        oa,
    )


def render(size):
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            u = (x + 0.5) / size
            v = (y + 0.5) / size
            px = (0.0, 0.0, 0.0, 0.0)

            d1 = sd_round_rect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22)
            c1 = cov(d1, size)
            if c1 > 0:
                px = over(px, BG, c1)

            # 白色对话气泡
            d2 = sd_round_rect(u, v, 0.5, 0.44, 0.24, 0.15, 0.075)
            d3 = sd_circle(u, v, 0.36, 0.62, 0.06)
            c2 = cov(min(d2, d3), size)
            if c2 > 0:
                px = over(px, FG, c2)

            # 三个点（小尺寸用一个横条）
            if size >= 48:
                for dx in (-0.10, 0.0, 0.10):
                    c3 = cov(sd_circle(u, v, 0.5 + dx, 0.44, 0.028), size)
                    if c3 > 0:
                        px = over(px, BG, c3)
            else:
                c3 = cov(sd_round_rect(u, v, 0.5, 0.44, 0.095, 0.026, 0.026), size)
                if c3 > 0:
                    px = over(px, BG, c3)

            r, g, b, a = px
            row += bytes((
                int(round(clamp01(r / 255) * 255)),
                int(round(clamp01(g / 255) * 255)),
                int(round(clamp01(b / 255) * 255)),
                int(round(clamp01(a) * 255)),
            ))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)
    comp = zlib.compress(raw, 9)

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", comp)
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size, name in ((16, "icon-16.png"), (32, "icon-32.png"), (64, "icon-64.png"), (80, "icon-80.png")):
        rows = render(size)
        n = write_png(os.path.join(OUT, name), size, rows)
        print("wrote %s (%d bytes, %dx%d)" % (name, n, size, size))


if __name__ == "__main__":
    main()
