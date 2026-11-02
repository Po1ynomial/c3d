import { describe, expect, it } from "vitest";
import {
  cumulative,
  exitLength,
  offsetPolyline,
  segmentIntersection,
  subtractIntervals,
  type Pt,
} from "../planar";

function pt(x: number, y: number): Pt {
  return { x, y, depth: 0 };
}

describe("planar", () => {
  it("finds where a polyline leaves a rectangle", () => {
    const pts = [pt(0, 0), pt(10, 0)];
    expect(exitLength(pts, cumulative(pts), { x0: -3, y0: -3, x1: 3, y1: 3 })).toBeCloseTo(3);
    expect(exitLength(pts, cumulative(pts), { x0: 5, y0: -3, x1: 8, y1: 3 })).toBe(0);
  });

  it("intersects segments", () => {
    const hit = segmentIntersection(pt(0, 0), pt(2, 2), pt(0, 2), pt(2, 0));
    expect(hit).not.toBeNull();
    expect(hit!.u).toBeCloseTo(0.5);
    expect(hit!.v).toBeCloseTo(0.5);
    expect(segmentIntersection(pt(0, 0), pt(1, 0), pt(0, 1), pt(1, 1))).toBeNull();
  });

  it("subtracts merged gaps", () => {
    expect(
      subtractIntervals(0, 10, [
        [2, 4],
        [3, 5],
        [9, 12],
      ]),
    ).toEqual([
      [0, 2],
      [5, 9],
    ]);
  });

  it("offsets to the visual left (screen y down)", () => {
    const [a] = offsetPolyline([pt(0, 0), pt(10, 0)], 2);
    expect(a!.y).toBeCloseTo(-2);
  });
});
