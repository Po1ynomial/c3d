// World-space arrow geometry: normal frames, bends, and loops.

import { Vector3 } from "three";
import type { Vec3 } from "./scene";

const Z = new Vector3(0, 0, 1);
const X = new Vector3(1, 0, 0);

/** Below this |d × ẑ|, a direction is treated as vertical and θ = 0 falls back to x̂. */
export const VERTICAL_TOLERANCE = 1e-6;

/** Half-angle between a loop's departure and return directions. */
const LOOP_SPREAD = Math.PI / 4;

export function vec(v: Vec3): Vector3 {
  return new Vector3(v[0], v[1], v[2]);
}

/** θ = 0 reference: ẑ projected onto the plane orthogonal to the unit direction `d`; x̂ if `d` is vertical. */
export function referenceNormal(d: Vector3): Vector3 {
  const n0 = Z.clone().addScaledVector(d, -d.dot(Z));
  if (n0.length() < VERTICAL_TOLERANCE) return X.clone();
  return n0.normalize();
}

/** n(θ) = cos θ · n₀ + sin θ · (d × n₀): positive θ turns right-handedly about `d`. */
export function arrowNormal(d: Vector3, thetaDeg: number): Vector3 {
  const theta = (thetaDeg * Math.PI) / 180;
  const n0 = referenceNormal(d);
  const b = d.clone().cross(n0);
  return n0.multiplyScalar(Math.cos(theta)).addScaledVector(b, Math.sin(theta));
}

/** Unit direction from `a` to `b`; x̂ for coincident points. */
export function chordDirection(a: Vector3, b: Vector3): Vector3 {
  const d = b.clone().sub(a);
  return d.lengthSq() > 0 ? d.normalize() : X.clone();
}

export type Curve =
  | { kind: "quadratic"; p0: Vector3; c: Vector3; p1: Vector3 }
  | { kind: "cubic"; p0: Vector3; c1: Vector3; c2: Vector3; p1: Vector3 };

/** Quadratic Bézier whose midpoint is displaced by exactly `bend` along `n` from the chord midpoint. */
export function bentCurve(p0: Vector3, p1: Vector3, n: Vector3, bend: number): Curve {
  // B(½) = (p0 + 2c + p1) / 4, so a control displacement of 2·bend moves the midpoint by bend.
  const c = p0
    .clone()
    .add(p1)
    .multiplyScalar(0.5)
    .addScaledVector(n, 2 * bend);
  return { kind: "quadratic", p0: p0.clone(), c, p1: p1.clone() };
}

/**
 * Teardrop loop at `p` in the plane spanned by `d` and `n`. It departs on the +d side, reaches
 * `2 · radius` along `n` at its midpoint, and returns on the −d side.
 */
export function loopCurve(p: Vector3, d: Vector3, n: Vector3, radius: number): Curve {
  // B(½) = p + ¾ · L · cos(α) · n for this symmetric cubic.
  const len = (2 * radius) / (0.75 * Math.cos(LOOP_SPREAD));
  const out = n.clone().multiplyScalar(Math.cos(LOOP_SPREAD));
  const side = d.clone().multiplyScalar(Math.sin(LOOP_SPREAD));
  const c1 = p.clone().addScaledVector(out.clone().add(side), len);
  const c2 = p.clone().addScaledVector(out.clone().sub(side), len);
  return { kind: "cubic", p0: p.clone(), c1, c2, p1: p.clone() };
}

export function evalCurve(curve: Curve, t: number): Vector3 {
  const s = 1 - t;
  if (curve.kind === "quadratic") {
    return curve.p0
      .clone()
      .multiplyScalar(s * s)
      .addScaledVector(curve.c, 2 * s * t)
      .addScaledVector(curve.p1, t * t);
  }
  return curve.p0
    .clone()
    .multiplyScalar(s * s * s)
    .addScaledVector(curve.c1, 3 * s * s * t)
    .addScaledVector(curve.c2, 3 * s * t * t)
    .addScaledVector(curve.p1, t * t * t);
}

export function isStraight(curve: Curve): boolean {
  if (curve.kind !== "quadratic") return false;
  const mid = curve.p0.clone().add(curve.p1).multiplyScalar(0.5);
  return mid.distanceToSquared(curve.c) === 0;
}

/** Sample a curve uniformly in its parameter. Straight curves need only their endpoints. */
export function sampleCurve(curve: Curve, segments: number): Vector3[] {
  if (isStraight(curve)) return [curve.p0.clone(), curve.p1.clone()];
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) pts.push(evalCurve(curve, i / segments));
  return pts;
}

/**
 * View-snapped normal (rendering only): the direction perpendicular to both the chord `d` and the
 * viewing direction `view`, with the sign closest to the stored normal. When the sign is ambiguous
 * the previous sign is kept; when the view is end-on the stored normal is returned unchanged.
 */
export function snappedNormal(
  d: Vector3,
  stored: Vector3,
  view: Vector3,
  previousSign: number,
): { normal: Vector3; sign: number } {
  const m = view.clone().cross(d);
  if (m.length() < 1e-4) return { normal: stored.clone(), sign: previousSign };
  m.normalize();
  const dot = m.dot(stored);
  const sign = Math.abs(dot) < 1e-3 ? previousSign : Math.sign(dot);
  return { normal: m.multiplyScalar(sign), sign };
}
