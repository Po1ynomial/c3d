import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  arrowNormal,
  bentCurve,
  evalCurve,
  loopCurve,
  referenceNormal,
  snappedNormal,
} from "../geometry";

function expectClose(a: Vector3, b: Vector3): void {
  expect(a.distanceTo(b)).toBeLessThan(1e-9);
}

describe("normal frame", () => {
  it("uses ẑ projected orthogonally to the chord", () => {
    expectClose(referenceNormal(new Vector3(1, 0, 0)), new Vector3(0, 0, 1));
    const d = new Vector3(1, 0, 1).normalize();
    expectClose(referenceNormal(d), new Vector3(-1, 0, 1).normalize());
  });

  it("falls back to x̂ for vertical chords in either direction", () => {
    expectClose(referenceNormal(new Vector3(0, 0, 1)), new Vector3(1, 0, 0));
    expectClose(referenceNormal(new Vector3(0, 0, -1)), new Vector3(1, 0, 0));
  });

  it("turns right-handedly about the chord", () => {
    // Rotating ẑ by +90° about x̂ gives −ŷ.
    expectClose(arrowNormal(new Vector3(1, 0, 0), 90), new Vector3(0, -1, 0));
    expectClose(arrowNormal(new Vector3(1, 0, 0), 180), new Vector3(0, 0, -1));
  });
});

describe("curves", () => {
  it("displaces the curve midpoint by exactly the bend", () => {
    const p0 = new Vector3(0, 0, 0);
    const p1 = new Vector3(2, 0, 0);
    const n = new Vector3(0, 0, 1);
    expectClose(evalCurve(bentCurve(p0, p1, n, 0.7), 0.5), new Vector3(1, 0, 0.7));
  });

  it("puts the loop apex at twice the radius along the normal", () => {
    const p = new Vector3(1, 1, 1);
    const c = loopCurve(p, new Vector3(1, 0, 0), new Vector3(0, 0, 1), 0.5);
    expectClose(evalCurve(c, 0.5), new Vector3(1, 1, 2));
    expectClose(evalCurve(c, 0), p);
    expectClose(evalCurve(c, 1), p);
  });
});

describe("view-snapped normal", () => {
  it("lies in the view plane, perpendicular to the chord, nearest the stored sign", () => {
    const d = new Vector3(1, 0, 0);
    const stored = new Vector3(0, -0.2, 1).normalize();
    const view = new Vector3(0, 1, 0);
    const { normal } = snappedNormal(d, stored, view, 1);
    expect(Math.abs(normal.dot(d))).toBeLessThan(1e-9);
    expect(Math.abs(normal.dot(view))).toBeLessThan(1e-9);
    expect(normal.dot(stored)).toBeGreaterThan(0);
  });

  it("keeps the stored normal when viewing a chord end-on", () => {
    const d = new Vector3(0, 1, 0);
    const stored = new Vector3(0, 0, 1);
    expectClose(snappedNormal(d, stored, d, 1).normal, stored);
  });
});
