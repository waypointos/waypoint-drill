#!/usr/bin/env python3
"""Measure drill solids from the CAD exports in rover26/design/STL.

The constants in dashboard/src/drill/geometry.ts are re-measured with this tool
rather than read off bounding boxes: a bounding box hides bores, flange steps,
window spans and tooth pitch, all of which the render needs.

Standard library only. Lengths are millimetres in CAD Z.

Modes:
  bounds  FILE                       axis-aligned extents and triangle count
  slice   FILE --z Z                 radii present on a horizontal plane
  arcs    FILE --z Z [--rmin R] [--rmax R] [--bins N]
                                     azimuth spans occupied on a plane, which
                                     is how window and bin arcs were read
  ray     FILE --from X,Y,Z --dir DX,DY,DZ
                                     ordered surface hits along a ray, which is
                                     how tooth pitch and ribbon thickness were
                                     read

Azimuth is degrees CCW from +X in the CAD XY plane.
"""

import argparse
import math
import struct
import sys

EPS = 1e-9


def load_stl(path):
    """Triangles as ((x, y, z), (x, y, z), (x, y, z)), binary or ASCII."""
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) >= 84:
        count = struct.unpack_from("<I", data, 80)[0]
        if len(data) == 84 + 50 * count:
            return _load_binary(data, count)
    return _load_ascii(data.decode("utf-8", "replace"))


def _load_binary(data, count):
    tris = []
    for i in range(count):
        base = 84 + 50 * i
        v = struct.unpack_from("<12f", data, base)
        tris.append((v[3:6], v[6:9], v[9:12]))
    return tris


def _load_ascii(text):
    tris = []
    verts = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[0] == "vertex":
            verts.append(tuple(float(p) for p in parts[1:]))
            if len(verts) == 3:
                tris.append(tuple(verts))
                verts = []
    return tris


def seg_z(tri, z):
    """Segment where a triangle crosses the plane z, or None."""
    below = [v for v in tri if v[2] < z]
    above = [v for v in tri if v[2] > z]
    if not below or not above:
        return None
    lone = below[0] if len(below) == 1 else above[0]
    pair = above if len(below) == 1 else below
    pts = []
    for other in pair:
        span = other[2] - lone[2]
        if abs(span) < EPS:
            continue
        t = (z - lone[2]) / span
        pts.append((
            lone[0] + t * (other[0] - lone[0]),
            lone[1] + t * (other[1] - lone[1]),
        ))
    return tuple(pts) if len(pts) == 2 else None


def slice_points(tris, z, samples=8):
    """Points along every cross-section segment on the plane z."""
    out = []
    for tri in tris:
        seg = seg_z(tri, z)
        if seg is None:
            continue
        (x0, y0), (x1, y1) = seg
        for i in range(samples + 1):
            t = i / samples
            out.append((x0 + t * (x1 - x0), y0 + t * (y1 - y0)))
    return out


def polar(pt):
    x, y = pt
    return math.hypot(x, y), math.degrees(math.atan2(y, x)) % 360.0


def spans(occupied, bins):
    """Contiguous runs of occupied bins, as (from_deg, to_deg) with wrap."""
    width = 360.0 / bins
    runs = []
    start = None
    for i in range(bins):
        if occupied[i] and start is None:
            start = i
        elif not occupied[i] and start is not None:
            runs.append((start * width, i * width))
            start = None
    if start is not None:
        runs.append((start * width, 360.0))
    if len(runs) > 1 and runs[0][0] == 0.0 and runs[-1][1] == 360.0:
        first = runs.pop(0)
        last = runs.pop()
        runs.append((last[0], first[1] + 360.0))
    return runs


def ray_hits(tris, origin, direction):
    """Moller-Trumbore ray distances, sorted, duplicates collapsed."""
    ox, oy, oz = origin
    dx, dy, dz = direction
    hits = []
    for (a, b, c) in tris:
        e1 = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        e2 = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        px = dy * e2[2] - dz * e2[1]
        py = dz * e2[0] - dx * e2[2]
        pz = dx * e2[1] - dy * e2[0]
        det = e1[0] * px + e1[1] * py + e1[2] * pz
        if abs(det) < EPS:
            continue
        inv = 1.0 / det
        tx, ty, tz = ox - a[0], oy - a[1], oz - a[2]
        u = (tx * px + ty * py + tz * pz) * inv
        if u < -EPS or u > 1.0 + EPS:
            continue
        qx = ty * e1[2] - tz * e1[1]
        qy = tz * e1[0] - tx * e1[2]
        qz = tx * e1[1] - ty * e1[0]
        v = (dx * qx + dy * qy + dz * qz) * inv
        if v < -EPS or u + v > 1.0 + EPS:
            continue
        t = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv
        if t > EPS:
            hits.append(t)
    hits.sort()
    out = []
    for t in hits:
        if not out or t - out[-1] > 1e-6:
            out.append(t)
    return out


def cmd_bounds(tris, _args):
    lo = [min(v[i] for tri in tris for v in tri) for i in range(3)]
    hi = [max(v[i] for tri in tris for v in tri) for i in range(3)]
    print(f"triangles {len(tris)}")
    for i, axis in enumerate("xyz"):
        print(f"{axis} {lo[i]:.3f} .. {hi[i]:.3f}  span {hi[i] - lo[i]:.3f}")
    radii = [math.hypot(v[0], v[1]) for tri in tris for v in tri]
    print(f"r {min(radii):.3f} .. {max(radii):.3f}")


def cmd_slice(tris, args):
    pts = slice_points(tris, args.z)
    if not pts:
        print(f"z {args.z}: empty")
        return
    radii = sorted(polar(p)[0] for p in pts)
    print(f"z {args.z}: {len(pts)} points, r {radii[0]:.3f} .. {radii[-1]:.3f}")
    step = max(1, len(radii) // 20)
    print("  " + " ".join(f"{r:.2f}" for r in radii[::step]))


def cmd_arcs(tris, args):
    occupied = [False] * args.bins
    width = 360.0 / args.bins
    for pt in slice_points(tris, args.z):
        r, deg = polar(pt)
        if r < args.rmin or r > args.rmax:
            continue
        occupied[int(deg / width) % args.bins] = True
    runs = spans(occupied, args.bins)
    total = sum(hi - lo for lo, hi in runs)
    print(f"z {args.z}, r {args.rmin} .. {args.rmax}: {len(runs)} arcs, {total:.1f} deg")
    for lo, hi in runs:
        print(f"  {lo:7.2f} .. {hi:7.2f}  ({hi - lo:.2f} deg)")


def cmd_ray(tris, args):
    hits = ray_hits(tris, args.origin, args.dir)
    print(f"{len(hits)} hits")
    prev = None
    for t in hits:
        gap = "" if prev is None else f"  gap {t - prev:.3f}"
        print(f"  {t:.3f}{gap}")
        prev = t


def vec3(text):
    parts = [float(p) for p in text.split(",")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("expected three comma-separated numbers")
    return tuple(parts)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)

    p = sub.add_parser("bounds")
    p.add_argument("file")
    p.set_defaults(fn=cmd_bounds)

    p = sub.add_parser("slice")
    p.add_argument("file")
    p.add_argument("--z", type=float, required=True)
    p.set_defaults(fn=cmd_slice)

    p = sub.add_parser("arcs")
    p.add_argument("file")
    p.add_argument("--z", type=float, required=True)
    p.add_argument("--rmin", type=float, default=0.0)
    p.add_argument("--rmax", type=float, default=float("inf"))
    p.add_argument("--bins", type=int, default=360)
    p.set_defaults(fn=cmd_arcs)

    p = sub.add_parser("ray")
    p.add_argument("file")
    p.add_argument("--from", dest="origin", type=vec3, required=True)
    p.add_argument("--dir", dest="dir", type=vec3, required=True)
    p.set_defaults(fn=cmd_ray)

    args = ap.parse_args(argv)
    args.fn(load_stl(args.file), args)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
