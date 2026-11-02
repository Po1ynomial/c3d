// Per-frame projection of the scene into SVG strokes and label placements.

import { Vector3 } from "three";
import type { Camera } from "./camera";
import {
  arrowNormal,
  bentCurve,
  chordDirection,
  evalCurve,
  loopCurve,
  sampleCurve,
  snappedNormal,
  vec,
  type Curve,
} from "./geometry";
import {
  bounds,
  cumulative,
  distanceToPolyline,
  distanceToRect,
  exitLength,
  inside,
  leftOf,
  normalize2,
  offsetPolyline,
  pointAt,
  rectsOverlap,
  segmentIntersection,
  slice,
  subtractIntervals,
  type Pt,
  type Rect,
  type Vec2,
} from "./planar";
import type { ArrowSpec, Scene } from "./scene";

export type Sizing = "diagram" | "spatial";

export type Focus = { kind: "node"; index: number } | { kind: "arrow"; index: number };

export interface RenderOptions {
  sizing: Sizing;
  snapNormals: boolean;
  /** Overall size multiplier for labels, strokes and tips. */
  sizeFactor: number;
  /** Pixels per world unit at which spatial sizing equals diagram sizing. */
  referenceScale: number;
  focus: Focus | null;
  pivot: Vector3;
  showPivot: boolean;
}

/** Unscaled label size in CSS pixels, as measured from the DOM. */
export interface Box {
  w: number;
  h: number;
}

export interface LabelPlacement {
  x: number;
  y: number;
  scale: number;
  depth: number;
  visible: boolean;
}

export interface Frame {
  svg: string;
  nodeLabels: LabelPlacement[];
  arrowLabels: (LabelPlacement | null)[];
  nodeRects: (Rect | null)[];
  arrowLabelRects: (Rect | null)[];
  arrowLines: Vec2[][][];
}

// Reference metrics in CSS pixels at size factor 1.
const M = {
  stroke: 1.15,
  doubleSep: 2.7,
  head: { len: 6.4, half: 4.5 },
  doubleHead: { len: 8.6, half: 6.6 },
  twoHeadGap: 0.6,
  hook: 2.6,
  labelPad: 3.5,
  crossMargin: 3,
  sharedEndClearance: 10,
  dash: [4.5, 3.5],
  dot: 2.6,
  focusHalo: 7,
  pickTolerance: 6,
};

/** Screen-space bucket size for crossing detection, in CSS pixels. */
const GRID_CELL = 48;
const CURVE_SEGMENTS = 32;
const LOOP_SEGMENTS = 48;

interface Piece {
  arrow: number;
  pts: Pt[];
  cum: number[];
  startTrue: boolean;
  endTrue: boolean;
  gaps: [number, number][];
}

interface ArrowFrame {
  factor: number;
  sideSign: number;
  pieces: Piece[];
}

export class Renderer {
  private readonly nodePos: Vector3[];
  private readonly nodeIndex = new Map<string, number>();
  private readonly arrowEnds: {
    from: number;
    to: number;
    p0: Vector3;
    p1: Vector3;
    d: Vector3;
    n: Vector3;
  }[];
  /** Last snapped-normal sign per arrow, kept to avoid flicker when the sign is ambiguous. */
  private readonly snapSigns: number[];
  /** Scene radius in world units; sets depth tolerances. */
  radius = 1;

  constructor(
    readonly scene: Scene,
    private readonly nodeBoxes: Box[],
    private readonly arrowLabelBoxes: (Box | null)[],
  ) {
    scene.nodes.forEach((n, i) => this.nodeIndex.set(n.id, i));
    this.nodePos = scene.nodes.map((n) => vec(n.pos));
    this.arrowEnds = scene.arrows.map((a) => {
      const from = this.nodeIndex.get(a.from)!;
      const to = this.nodeIndex.get(a.to)!;
      const p0 = this.nodePos[from]!;
      const p1 = this.nodePos[to]!;
      const d = a.loop ? vec(a.loop.axis).normalize() : chordDirection(p0, p1);
      return { from, to, p0, p1, d, n: arrowNormal(d, a.theta) };
    });
    this.snapSigns = scene.arrows.map(() => 1);
  }

  /** Arrow geometry with the stored (unsnapped) normal; used for focusing and fitting. */
  storedCurve(i: number): Curve {
    return this.curveWith(i, this.arrowEnds[i]!.n);
  }

  nodePosition(i: number): Vector3 {
    return this.nodePos[i]!.clone();
  }

  private curveWith(i: number, n: Vector3): Curve {
    const a = this.scene.arrows[i]!;
    const e = this.arrowEnds[i]!;
    return a.loop ? loopCurve(e.p0, e.d, n, a.loop.radius) : bentCurve(e.p0, e.p1, n, a.bend);
  }

  frame(camera: Camera, opts: RenderOptions): Frame {
    const factorAt = (p: Vector3): number => {
      if (opts.sizing === "diagram") return opts.sizeFactor;
      const s = camera.scaleAt(p);
      if (s === null) return opts.sizeFactor;
      return opts.sizeFactor * Math.min(6, Math.max(0.05, s / opts.referenceScale));
    };

    // Node labels and their trimming rectangles.
    const nodeLabels: LabelPlacement[] = [];
    const nodeRects: (Rect | null)[] = [];
    this.nodePos.forEach((p, i) => {
      const q = camera.project(p);
      if (q === null) {
        nodeLabels.push({ x: 0, y: 0, scale: 1, depth: 0, visible: false });
        nodeRects.push(null);
        return;
      }
      const f = factorAt(p);
      const box = this.nodeBoxes[i]!;
      const hw = (box.w / 2 + M.labelPad) * f;
      const hh = (box.h / 2 + M.labelPad) * f;
      nodeLabels.push({ x: q.x, y: q.y, scale: f, depth: q.depth, visible: box.w > 0 });
      nodeRects.push({ x0: q.x - hw, y0: q.y - hh, x1: q.x + hw, y1: q.y + hh });
    });

    // Arrow geometry in screen space.
    const arrows: ArrowFrame[] = [];
    const arrowLabels: (LabelPlacement | null)[] = [];
    const arrowLabelRects: (Rect | null)[] = [];
    const eps = this.radius * 1e-3;

    this.scene.arrows.forEach((a, i) => {
      const e = this.arrowEnds[i]!;
      let n = e.n;
      if (opts.snapNormals) {
        const mid = e.p0.clone().add(e.p1).multiplyScalar(0.5);
        const snapped = snappedNormal(e.d, e.n, camera.viewDirection(mid), this.snapSigns[i]!);
        this.snapSigns[i] = snapped.sign;
        n = snapped.normal;
      }
      const curve = this.curveWith(i, n);
      const mid3 = evalCurve(curve, 0.5);
      const factor = factorAt(mid3);
      const sideSign = screenSideSign(camera, curve, n, eps);

      const pts3 = sampleCurve(curve, a.loop ? LOOP_SEGMENTS : CURVE_SEGMENTS);
      const pieces: Piece[] = [];
      for (const raw of clipAndProject(camera, pts3)) {
        let pts = raw.pts;
        if (a.shift !== 0) pts = offsetPolyline(pts, sideSign * a.shift * factor);
        let cum = cumulative(pts);
        const total = cum[cum.length - 1]!;
        const srcRect = raw.startTrue ? nodeRects[e.from] : null;
        const dstRect = raw.endTrue ? nodeRects[e.to] : null;
        const s0 = srcRect ? exitLength(pts, cum, srcRect) : 0;
        const rev = pts.slice().reverse();
        const s1 = dstRect ? exitLength(rev, cumulative(rev), dstRect) : 0;
        if (total - s1 - s0 < 1) continue;
        pts = slice(pts, cum, s0, total - s1);
        cum = cumulative(pts);
        pieces.push({
          arrow: i,
          pts,
          cum,
          startTrue: raw.startTrue,
          endTrue: raw.endTrue,
          gaps: [],
        });
      }
      arrows.push({ factor, sideSign, pieces });

      const placed = a.label
        ? this.placeArrowLabel(camera, a, i, curve, n, sideSign, factorAt, eps)
        : null;
      arrowLabels.push(placed?.placement ?? null);
      arrowLabelRects.push(placed?.rect ?? null);
    });

    const pad = 64;
    this.applyCrossingGaps(arrows, nodeRects, eps, {
      x0: -pad,
      y0: -pad,
      x1: camera.width + pad,
      y1: camera.height + pad,
    });

    // Emit SVG.
    const out: string[] = [];
    if (opts.focus?.kind === "arrow") {
      const af = arrows[opts.focus.index];
      if (af) {
        for (const p of af.pieces) {
          out.push(
            `<path class="halo" d="${pathData(p.pts)}" stroke-width="${fmt(M.focusHalo * af.factor)}"/>`,
          );
        }
      }
    }
    this.scene.arrows.forEach((a, i) => out.push(drawArrow(a, arrows[i]!)));
    if (opts.showPivot) {
      const q = camera.project(opts.pivot);
      if (q) {
        out.push(
          `<g class="pivot"><circle cx="${fmt(q.x)}" cy="${fmt(q.y)}" r="5"/>` +
            `<path d="M${fmt(q.x - 8)} ${fmt(q.y)}H${fmt(q.x + 8)}M${fmt(q.x)} ${fmt(q.y - 8)}V${fmt(q.y + 8)}"/></g>`,
        );
      }
    }

    return {
      svg: out.join(""),
      nodeLabels,
      arrowLabels,
      nodeRects,
      arrowLabelRects,
      arrowLines: arrows.map((af) => af.pieces.map((p) => p.pts)),
    };
  }

  private placeArrowLabel(
    camera: Camera,
    a: ArrowSpec,
    i: number,
    curve: Curve,
    n: Vector3,
    sideSign: number,
    factorAt: (p: Vector3) => number,
    eps: number,
  ): { placement: LabelPlacement; rect: Rect } | null {
    const label = a.label!;
    const box = this.arrowLabelBoxes[i];
    const anchor3 = evalCurve(curve, label.t);
    const q = camera.project(anchor3);
    if (!box || q === null) return null;
    const f = factorAt(anchor3);
    let ax = q.x;
    let ay = q.y;
    if (a.shift !== 0) {
      const tangent = screenTangent(camera, curve, label.t);
      if (tangent) {
        const l = leftOf(tangent);
        ax += l.x * sideSign * a.shift * f;
        ay += l.y * sideSign * a.shift * f;
      }
    }
    const w = box.w * f;
    const h = box.h * f;
    if (label.offset !== 0) {
      const dir =
        projectedDirection(camera, anchor3, n, eps) ??
        fallbackNormal(camera, curve, label.t, sideSign);
      const sign = Math.sign(label.offset);
      const support = Math.abs(dir.x) * (w / 2) + Math.abs(dir.y) * (h / 2);
      const dist = Math.abs(label.offset) * f + support;
      ax += dir.x * sign * dist;
      ay += dir.y * sign * dist;
    }
    return {
      placement: { x: ax, y: ay, scale: f, depth: q.depth, visible: true },
      rect: { x0: ax - w / 2, y0: ay - h / 2, x1: ax + w / 2, y1: ay + h / 2 },
    };
  }

  /**
   * Interrupt the farther stroke at every projected crossing between distinct arrows. Segments are
   * bucketed in a screen-space grid; a crossing is handled only in the cell containing it, so each
   * is found once. Crossings outside the (padded) viewport are ignored.
   */
  private applyCrossingGaps(
    arrows: ArrowFrame[],
    nodeRects: (Rect | null)[],
    eps: number,
    viewport: Rect,
  ): void {
    const pieces = arrows.flatMap((af) => af.pieces);
    const segPiece: number[] = [];
    const segIndex: number[] = [];
    const cells = new Map<number, number[]>();
    const cellOf = (v: number, lo: number) => Math.floor((v - lo) / GRID_CELL);
    const key = (cx: number, cy: number) => cx * 100003 + cy;
    const maxX = cellOf(viewport.x1, viewport.x0);
    const maxY = cellOf(viewport.y1, viewport.y0);

    pieces.forEach((piece, pi) => {
      for (let s = 1; s < piece.pts.length; s++) {
        const b = bounds([piece.pts[s - 1]!, piece.pts[s]!]);
        if (!rectsOverlap(b, viewport)) continue;
        const id = segPiece.length;
        segPiece.push(pi);
        segIndex.push(s);
        const cx0 = Math.max(0, cellOf(b.x0, viewport.x0));
        const cx1 = Math.min(maxX, cellOf(b.x1, viewport.x0));
        const cy0 = Math.max(0, cellOf(b.y0, viewport.y0));
        const cy1 = Math.min(maxY, cellOf(b.y1, viewport.y0));
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cy = cy0; cy <= cy1; cy++) {
            const k = key(cx, cy);
            const list = cells.get(k);
            if (list) list.push(id);
            else cells.set(k, [id]);
          }
        }
      }
    });

    for (const [k, list] of cells) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const pa = pieces[segPiece[list[i]!]!]!;
          const pb = pieces[segPiece[list[j]!]!]!;
          if (pa.arrow === pb.arrow) continue;
          const s = segIndex[list[i]!]!;
          const t = segIndex[list[j]!]!;
          const a0 = pa.pts[s - 1]!,
            a1 = pa.pts[s]!,
            b0 = pb.pts[t - 1]!,
            b1 = pb.pts[t]!;
          const hit = segmentIntersection(a0, a1, b0, b1);
          if (!hit || key(cellOf(hit.x, viewport.x0), cellOf(hit.y, viewport.y0)) !== k) continue;
          const clearance =
            M.sharedEndClearance * Math.max(arrows[pa.arrow]!.factor, arrows[pb.arrow]!.factor);
          const nearShared = this.sharedNodes(pa.arrow, pb.arrow).some((n) => {
            const r = nodeRects[n];
            return r != null && distanceToRect(r, hit) < clearance;
          });
          if (nearShared) continue;
          const da = a0.depth + (a1.depth - a0.depth) * hit.u;
          const db = b0.depth + (b1.depth - b0.depth) * hit.v;
          // Larger depth is farther; ties go to the lower arrow index for stability.
          const aIsRear = Math.abs(da - db) <= eps ? pa.arrow < pb.arrow : da > db;
          const [rear, front, rs, ru, ra0, ra1, fa0, fa1] = aIsRear
            ? [pa, pb, s, hit.u, a0, a1, b0, b1]
            : [pb, pa, t, hit.v, b0, b1, a0, a1];
          const rearDir = normalize2({ x: ra1.x - ra0.x, y: ra1.y - ra0.y });
          const frontDir = normalize2({ x: fa1.x - fa0.x, y: fa1.y - fa0.y });
          if (!rearDir || !frontDir) continue;
          const sin = Math.abs(rearDir.x * frontDir.y - rearDir.y * frontDir.x);
          const frontStyle = this.scene.arrows[front.arrow]!.style;
          const ff = arrows[front.arrow]!.factor;
          const halfWidth =
            ((frontStyle.double ? M.doubleSep / 2 : 0) + M.stroke / 2 + M.crossMargin) * ff;
          const half = halfWidth / Math.max(sin, 0.25);
          const at = rear.cum[rs - 1]! + ru * (rear.cum[rs]! - rear.cum[rs - 1]!);
          rear.gaps.push([at - half, at + half]);
        }
      }
    }
  }

  private sharedNodes(i: number, j: number): number[] {
    const a = this.arrowEnds[i]!;
    const b = this.arrowEnds[j]!;
    return [a.from, a.to].filter((k) => k === b.from || k === b.to);
  }
}

/** Find what lies under a screen point: labels first, then strokes. */
export function hitTest(frame: Frame, nodeDepths: number[], x: number, y: number): Focus | null {
  const p = { x, y };
  let node = -1;
  for (let i = 0; i < frame.nodeRects.length; i++) {
    const r = frame.nodeRects[i];
    if (r && inside(r, p) && (node < 0 || nodeDepths[i]! < nodeDepths[node]!)) node = i;
  }
  if (node >= 0) return { kind: "node", index: node };
  for (let i = 0; i < frame.arrowLabelRects.length; i++) {
    const r = frame.arrowLabelRects[i];
    if (r && inside(r, p)) return { kind: "arrow", index: i };
  }
  let arrow = -1;
  let best: number = M.pickTolerance;
  frame.arrowLines.forEach((pieces, i) => {
    for (const pts of pieces) {
      const dist = distanceToPolyline(pts, p);
      if (dist <= best) {
        best = dist;
        arrow = i;
      }
    }
  });
  return arrow >= 0 ? { kind: "arrow", index: arrow } : null;
}

/** Split a 3D polyline at the perspective near plane and project the visible runs. */
function clipAndProject(
  camera: Camera,
  pts3: Vector3[],
): { pts: Pt[]; startTrue: boolean; endTrue: boolean }[] {
  const runs: { pts: Pt[]; startTrue: boolean; endTrue: boolean }[] = [];
  const near = camera.projection === "perspective" ? camera.near : -Infinity;
  const depths = pts3.map((p) => camera.depthOf(p));
  let current: Pt[] | null = null;
  let startTrue = false;
  const push = (p: Vector3) => {
    const q = camera.project(p);
    if (q && current) current.push({ x: q.x, y: q.y, depth: q.depth });
  };
  for (let i = 0; i < pts3.length; i++) {
    const vis = depths[i]! >= near;
    if (i > 0) {
      const prevVis = depths[i - 1]! >= near;
      if (prevVis !== vis) {
        // Cut marginally in front of the near plane so rounding cannot reject the cut point.
        const u = (near * 1.001 - depths[i - 1]!) / (depths[i]! - depths[i - 1]!);
        const cut = pts3[i - 1]!.clone().lerp(pts3[i]!, Math.min(1, Math.max(0, u)));
        if (vis) {
          current = [];
          startTrue = false;
          push(cut);
        } else {
          push(cut);
          if (current && current.length >= 2)
            runs.push({ pts: current, startTrue, endTrue: false });
          current = null;
        }
      }
    }
    if (vis) {
      if (current === null) {
        current = [];
        startTrue = i === 0;
      }
      push(pts3[i]!);
    }
  }
  if (current && current.length >= 2) runs.push({ pts: current, startTrue, endTrue: true });
  return runs;
}

/** Screen direction of a world direction `n` at `p`; null if seen end-on. */
function projectedDirection(camera: Camera, p: Vector3, n: Vector3, eps: number): Vec2 | null {
  const a = camera.project(p);
  const b = camera.project(p.clone().addScaledVector(n, eps));
  if (!a || !b) return null;
  return normalize2({ x: b.x - a.x, y: b.y - a.y });
}

function screenTangent(camera: Camera, curve: Curve, t: number): Vec2 | null {
  const a = camera.project(evalCurve(curve, Math.max(0, t - 0.01)));
  const b = camera.project(evalCurve(curve, Math.min(1, t + 0.01)));
  if (!a || !b) return null;
  return normalize2({ x: b.x - a.x, y: b.y - a.y });
}

function fallbackNormal(camera: Camera, curve: Curve, t: number, sideSign: number): Vec2 {
  const tangent = screenTangent(camera, curve, t) ?? { x: 1, y: 0 };
  const l = leftOf(tangent);
  return { x: l.x * sideSign, y: l.y * sideSign };
}

/** +1 if the projected normal points to the visual left of the arrow's screen direction, else −1. */
function screenSideSign(camera: Camera, curve: Curve, n: Vector3, eps: number): number {
  const tangent = screenTangent(camera, curve, 0.5);
  const dir = projectedDirection(camera, evalCurve(curve, 0.5), n, eps);
  if (!tangent || !dir) return 1;
  const l = leftOf(tangent);
  return l.x * dir.x + l.y * dir.y < 0 ? -1 : 1;
}

function fmt(v: number): string {
  return v.toFixed(2);
}

function pathData(pts: readonly Vec2[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`).join("");
}

function drawArrow(a: ArrowSpec, af: ArrowFrame): string {
  const { style } = a;
  const f = af.factor;
  const w = M.stroke * f;
  const colour = style.color ?? "currentColor";
  const head = style.double ? M.doubleHead : M.head;
  const headLen = head.len * f;
  const headHalf = head.half * f;
  const parts: string[] = [];

  let dash = "";
  let cap = "butt";
  if (style.shaft === "dashed") dash = `${fmt(M.dash[0]! * f)} ${fmt(M.dash[1]! * f)}`;
  if (style.shaft === "dotted") {
    dash = `0 ${fmt(M.dot * f)}`;
    cap = "round";
  }
  const patternLength = style.shaft === "dashed" ? (M.dash[0]! + M.dash[1]!) * f : M.dot * f;

  for (const piece of af.pieces) {
    const total = piece.cum[piece.cum.length - 1]!;
    const hasHead = piece.endTrue && style.head !== "none";
    const hasTail = piece.startTrue && style.tail !== "none";
    const shaftEnd = hasHead ? total - (style.double ? 0.25 * headLen : 0.5 * w) : total;
    const intervals = subtractIntervals(0, shaftEnd, piece.gaps);
    for (const [s0, s1] of intervals) {
      const sub = slice(piece.pts, piece.cum, s0, s1);
      const lines = style.double
        ? [offsetPolyline(sub, (M.doubleSep * f) / 2), offsetPolyline(sub, (-M.doubleSep * f) / 2)]
        : [sub];
      const dashAttrs = dash
        ? ` stroke-dasharray="${dash}" stroke-dashoffset="${fmt(s0 % patternLength)}"`
        : "";
      for (const line of lines) {
        parts.push(
          `<path d="${pathData(line)}" stroke-width="${fmt(w)}" stroke-linecap="${cap}"${dashAttrs}/>`,
        );
      }
    }

    if (hasHead) {
      const tip = piece.pts[piece.pts.length - 1]!;
      const back = pointAt(piece.pts, piece.cum, total - Math.min(total, headLen));
      const u = normalize2({ x: tip.x - back.x, y: tip.y - back.y });
      if (u) {
        parts.push(tipPath(tip, u, headLen, headHalf, w));
        if (style.head === "twohead") {
          const second = {
            x: tip.x - u.x * headLen * M.twoHeadGap,
            y: tip.y - u.y * headLen * M.twoHeadGap,
          };
          parts.push(tipPath(second, u, headLen, headHalf, w));
        }
      }
    }

    if (hasTail) {
      const start = piece.pts[0]!;
      const ahead = pointAt(piece.pts, piece.cum, Math.min(total, headLen));
      const u = normalize2({ x: ahead.x - start.x, y: ahead.y - start.y });
      if (u) {
        const isHook = style.tail === "hook" || style.tail === "hook'";
        if (isHook && style.double) {
          // As in quiver: one hook per line, starting at that line's end, all curling to the same side.
          for (const d of [(M.doubleSep * f) / 2, (-M.doubleSep * f) / 2]) {
            const lineStart = offsetPolyline(piece.pts.slice(0, 2), d)[0]!;
            parts.push(tailPath(style.tail, lineStart, u, af.sideSign, headHalf, M.hook * f, w));
          }
        } else {
          parts.push(tailPath(style.tail, start, u, af.sideSign, headHalf, M.hook * f, w));
        }
      }
    }
  }

  if (parts.length === 0) return "";
  return `<g stroke="${colour}" fill="none" data-arrow="${escapeAttr(a.id)}">${parts.join("")}</g>`;
}

/** Computer Modern style arrow tip with curved barbs, pointing along `u` with its tip at `tip`. */
function tipPath(tip: Vec2, u: Vec2, len: number, half: number, w: number): string {
  const l = leftOf(u);
  const at = (a: number, b: number) =>
    `${fmt(tip.x + u.x * a + l.x * b)} ${fmt(tip.y + u.y * a + l.y * b)}`;
  return (
    `<path d="M${at(-len, half)}Q${at(-0.35 * len, 0.15 * half)} ${at(0, 0)}` +
    `Q${at(-0.35 * len, -0.15 * half)} ${at(-len, -half)}" stroke-width="${fmt(w)}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

function tailPath(
  kind: string,
  p: Vec2,
  u: Vec2,
  sideSign: number,
  half: number,
  hook: number,
  w: number,
): string {
  const l = leftOf(u);
  if (kind === "mapsto") {
    return `<path d="M${fmt(p.x + l.x * half)} ${fmt(p.y + l.y * half)}L${fmt(p.x - l.x * half)} ${fmt(p.y - l.y * half)}" stroke-width="${fmt(w)}" stroke-linecap="round"/>`;
  }
  // Hook: a semicircle bulging backwards, ending on the normal side ("hook") or the opposite side ("hook'").
  const side = sideSign * (kind === "hook" ? 1 : -1);
  const s = { x: l.x * side, y: l.y * side };
  const q = { x: p.x + s.x * 2 * hook, y: p.y + s.y * 2 * hook };
  const bulge = { x: p.x + s.x * hook - u.x * hook, y: p.y + s.y * hook - u.y * hook };
  const cross = (bulge.x - q.x) * (p.y - bulge.y) - (bulge.y - q.y) * (p.x - bulge.x);
  const sweep = cross > 0 ? 1 : 0;
  return `<path d="M${fmt(q.x)} ${fmt(q.y)}A${fmt(hook)} ${fmt(hook)} 0 0 ${sweep} ${fmt(p.x)} ${fmt(p.y)}" stroke-width="${fmt(w)}" stroke-linecap="round"/>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
