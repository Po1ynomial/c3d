// Screen-space polyline utilities. Coordinates are CSS pixels with y pointing down.

export interface Pt {
  x: number;
  y: number;
  /** Viewing depth carried along for crossing decisions. */
  depth: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Visual left of a direction of travel (y down): rotating (1, 0) gives (0, −1), i.e. up. */
export function leftOf(t: Vec2): Vec2 {
  return { x: t.y, y: -t.x };
}

export function normalize2(v: Vec2): Vec2 | null {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-9 ? { x: v.x / len, y: v.y / len } : null;
}

export function cumulative(pts: readonly Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return cum;
}

function lerpPt(a: Pt, b: Pt, u: number): Pt {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    depth: a.depth + (b.depth - a.depth) * u,
  };
}

/** Point at arc length `s` (clamped). */
export function pointAt(pts: readonly Pt[], cum: readonly number[], s: number): Pt {
  const total = cum[cum.length - 1]!;
  if (s <= 0) return pts[0]!;
  if (s >= total) return pts[pts.length - 1]!;
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < s) i++;
  const len = cum[i]! - cum[i - 1]!;
  return lerpPt(pts[i - 1]!, pts[i]!, len > 0 ? (s - cum[i - 1]!) / len : 0);
}

/** Sub-polyline between arc lengths s0 < s1. */
export function slice(pts: readonly Pt[], cum: readonly number[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [pointAt(pts, cum, s0)];
  for (let i = 0; i < pts.length; i++) {
    if (cum[i]! > s0 && cum[i]! < s1) out.push(pts[i]!);
  }
  out.push(pointAt(pts, cum, s1));
  return out;
}

/** Offset each vertex by `dist` along the left normal of the averaged adjacent segment directions. */
export function offsetPolyline(pts: readonly Pt[], dist: number): Pt[] {
  if (dist === 0 || pts.length < 2) return pts.slice();
  const dirs: Vec2[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = normalize2({ x: pts[i]!.x - pts[i - 1]!.x, y: pts[i]!.y - pts[i - 1]!.y });
    dirs.push(d ?? dirs[dirs.length - 1] ?? { x: 1, y: 0 });
  }
  return pts.map((p, i) => {
    const before = dirs[Math.max(0, i - 1)]!;
    const after = dirs[Math.min(dirs.length - 1, i)]!;
    const avg = normalize2({ x: before.x + after.x, y: before.y + after.y }) ?? after;
    // Miter correction keeps parallel offsets at constant distance around gentle bends.
    const cos = Math.max(0.5, avg.x * after.x + avg.y * after.y);
    const n = leftOf(avg);
    return { x: p.x + (n.x * dist) / cos, y: p.y + (n.y * dist) / cos, depth: p.depth };
  });
}

export function inside(r: Rect, p: Vec2): boolean {
  return p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
}

export function distanceToRect(r: Rect, p: Vec2): number {
  const dx = Math.max(r.x0 - p.x, 0, p.x - r.x1);
  const dy = Math.max(r.y0 - p.y, 0, p.y - r.y1);
  return Math.hypot(dx, dy);
}

/** Arc length at which the polyline, walked from its start, first leaves `r` (0 if it starts outside). */
export function exitLength(pts: readonly Pt[], cum: readonly number[], r: Rect): number {
  if (!inside(r, pts[0]!)) return 0;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    if (inside(r, b)) continue;
    const a = pts[i - 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let u = 1;
    if (dx > 0) u = Math.min(u, (r.x1 - a.x) / dx);
    if (dx < 0) u = Math.min(u, (r.x0 - a.x) / dx);
    if (dy > 0) u = Math.min(u, (r.y1 - a.y) / dy);
    if (dy < 0) u = Math.min(u, (r.y0 - a.y) / dy);
    return cum[i - 1]! + Math.max(0, u) * (cum[i]! - cum[i - 1]!);
  }
  return cum[cum.length - 1]!;
}

export interface Intersection {
  /** Segment-local parameters in [0, 1]. */
  u: number;
  v: number;
  x: number;
  y: number;
}

export function segmentIntersection(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): Intersection | null {
  const rx = a1.x - a0.x;
  const ry = a1.y - a0.y;
  const sx = b1.x - b0.x;
  const sy = b1.y - b0.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qx = b0.x - a0.x;
  const qy = b0.y - a0.y;
  const u = (qx * sy - qy * sx) / denom;
  const v = (qx * ry - qy * rx) / denom;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, x: a0.x + u * rx, y: a0.y + u * ry };
}

export function bounds(pts: readonly Vec2[]): Rect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.x0 - margin <= b.x1 && b.x0 - margin <= a.x1 && a.y0 - margin <= b.y1 && b.y0 - margin <= a.y1
  );
}

/** Remove the union of `holes` from [lo, hi]. */
export function subtractIntervals(
  lo: number,
  hi: number,
  holes: readonly [number, number][],
): [number, number][] {
  const sorted = holes
    .map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cursor = lo;
  for (const [a, b] of sorted) {
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < hi) out.push([cursor, hi]);
  return out;
}

export function distanceToPolyline(pts: readonly Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)));
  }
  return best;
}
