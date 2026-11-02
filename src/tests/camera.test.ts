import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Camera } from "../camera";

function frontCamera(): Camera {
  const c = new Camera();
  c.width = 800;
  c.height = 600;
  c.yaw = Math.PI / 2;
  c.pitch = 0;
  c.position.set(0, -10, 0);
  return c;
}

describe("camera", () => {
  it("projects the look-at point to the screen centre", () => {
    const q = frontCamera().project(new Vector3(0, 0, 0))!;
    expect(q.x).toBeCloseTo(400);
    expect(q.y).toBeCloseTo(300);
  });

  it("keeps the pivot fixed on screen while orbiting", () => {
    const c = frontCamera();
    const pivot = new Vector3(1, 2, 0.5);
    const before = c.project(pivot)!;
    c.orbit(pivot, 0.7, -0.4);
    const after = c.project(pivot)!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.depth).toBeCloseTo(before.depth);
  });

  it("keeps the pivot fixed on screen while zooming orthographically", () => {
    const c = frontCamera();
    c.projection = "orthographic";
    const pivot = new Vector3(1, 0, 0.5);
    const before = c.project(pivot)!;
    c.zoom(0.5, pivot);
    const after = c.project(pivot)!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("preserves apparent scale at the pivot across projection switches", () => {
    const c = frontCamera();
    const pivot = new Vector3(0, 0, 0);
    const s0 = c.scaleAt(pivot)!;
    c.setProjection("orthographic", pivot);
    expect(c.scaleAt(pivot)).toBeCloseTo(s0);
    c.zoom(0.5, pivot);
    const s1 = c.scaleAt(pivot)!;
    c.setProjection("perspective", pivot);
    expect(c.scaleAt(pivot)).toBeCloseTo(s1);
  });

  it("flies horizontally along the heading regardless of pitch", () => {
    const c = frontCamera();
    c.pitch = 1;
    c.fly(1, 0, 0);
    expect(c.position.z).toBeCloseTo(0);
    expect(c.position.y).toBeCloseTo(-9);
  });
});
