// Z-up camera with yaw/pitch orientation (no roll), perspective or orthographic projection.

import { Vector3 } from "three";

export type Projection = "perspective" | "orthographic";

export interface Projected {
  /** Screen position in CSS pixels, origin top-left, y down. */
  x: number;
  y: number;
  /** Distance along the viewing direction. */
  depth: number;
  /** Local world-to-screen scale in pixels per world unit. */
  scale: number;
}

const Z = new Vector3(0, 0, 1);
const HALF_PI = Math.PI / 2;

export class Camera {
  position = new Vector3(0, -10, 0);
  /** Heading in radians, measured counterclockwise from +x in the XY plane. */
  yaw = HALF_PI;
  /** Elevation in radians, within [−π/2, π/2]. */
  pitch = 0;
  projection: Projection = "perspective";
  /** Orthographic pixels per world unit. */
  orthoScale = 100;
  /** Vertical field of view in radians (perspective). */
  readonly fovY = (30 * Math.PI) / 180;
  /** Perspective near distance in world units. */
  near = 0.01;
  width = 1;
  height = 1;

  forward(): Vector3 {
    const cp = Math.cos(this.pitch);
    return new Vector3(cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch));
  }

  /** Horizontal right vector; well defined even when looking straight up or down. */
  right(): Vector3 {
    return new Vector3(Math.sin(this.yaw), -Math.cos(this.yaw), 0);
  }

  up(): Vector3 {
    return this.right().cross(this.forward());
  }

  /** Horizontal heading used for WASD flight. */
  heading(): Vector3 {
    return new Vector3(Math.cos(this.yaw), Math.sin(this.yaw), 0);
  }

  focal(): number {
    return this.height / 2 / Math.tan(this.fovY / 2);
  }

  /** Viewing-direction depth of a world point. */
  depthOf(p: Vector3): number {
    return p.clone().sub(this.position).dot(this.forward());
  }

  /** Project a world point; `null` if it lies behind the perspective near plane. */
  project(p: Vector3): Projected | null {
    const rel = p.clone().sub(this.position);
    const x = rel.dot(this.right());
    const y = rel.dot(this.up());
    const depth = rel.dot(this.forward());
    let scale: number;
    if (this.projection === "perspective") {
      if (depth < this.near) return null;
      scale = this.focal() / depth;
    } else {
      scale = this.orthoScale;
    }
    return { x: this.width / 2 + x * scale, y: this.height / 2 - y * scale, depth, scale };
  }

  /** Direction along which a world point is seen. */
  viewDirection(p: Vector3): Vector3 {
    if (this.projection === "orthographic") return this.forward();
    const v = p.clone().sub(this.position);
    return v.lengthSq() > 0 ? v.normalize() : this.forward();
  }

  /** Projection scale at a point, used by spatial sizing and projection switching. */
  scaleAt(p: Vector3): number | null {
    if (this.projection === "orthographic") return this.orthoScale;
    const depth = this.depthOf(p);
    return depth < this.near ? null : this.focal() / depth;
  }

  /** Change the viewing direction in place. */
  look(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -HALF_PI, HALF_PI);
  }

  /** Rigidly rotate the camera about `pivot`: yaw about world Z, pitch about the camera's right axis. */
  orbit(pivot: Vector3, dYaw: number, dPitch: number): void {
    const newPitch = clamp(this.pitch + dPitch, -HALF_PI, HALF_PI);
    const appliedPitch = newPitch - this.pitch;
    const offset = this.position.clone().sub(pivot);
    offset.applyAxisAngle(this.right(), appliedPitch);
    offset.applyAxisAngle(Z, dYaw);
    this.position.copy(pivot).add(offset);
    this.pitch = newPitch;
    this.yaw += dYaw;
  }

  /** Translate by heading-relative horizontal amounts and a world-Z amount. */
  fly(forward: number, right: number, up: number): void {
    this.position
      .addScaledVector(this.heading(), forward)
      .addScaledVector(this.right(), right)
      .addScaledVector(Z, up);
  }

  /**
   * factor < 1 zooms in: perspective dollies toward `pivot`; orthographic scales the view.
   * Either way the pivot keeps its screen position.
   */
  zoom(factor: number, pivot: Vector3): void {
    if (this.projection === "orthographic") {
      const before = this.orthoScale;
      this.orthoScale = clamp(this.orthoScale / factor, 1e-3, 1e6);
      const rel = pivot.clone().sub(this.position);
      const keep = 1 - before / this.orthoScale;
      this.position
        .addScaledVector(this.right(), rel.dot(this.right()) * keep)
        .addScaledVector(this.up(), rel.dot(this.up()) * keep);
      return;
    }
    const offset = this.position.clone().sub(pivot);
    const dist = offset.length();
    const next = Math.max(dist * factor, this.near * 4);
    if (dist > 0) this.position.copy(pivot).addScaledVector(offset, next / dist);
  }

  /** Switch projection while preserving the apparent scale at `pivot`. */
  setProjection(next: Projection, pivot: Vector3): void {
    if (next === this.projection) return;
    if (next === "orthographic") {
      const scale = this.scaleAt(pivot);
      if (scale !== null) this.orthoScale = scale;
    } else {
      const wanted = this.focal() / this.orthoScale;
      const current = this.depthOf(pivot);
      this.position.addScaledVector(this.forward(), current - wanted);
    }
    this.projection = next;
  }

  /**
   * Frame `points` without changing orientation: start from their bounding sphere, then refine so
   * their projected bounding box is centred and fills `fill` of the viewport.
   */
  fit(points: readonly Vector3[], fill = 0.8): void {
    if (points.length === 0) return;
    const center = new Vector3();
    for (const p of points) center.add(p);
    center.divideScalar(points.length);
    const radius = Math.max(1e-3, ...points.map((p) => p.distanceTo(center)));

    const aspect = this.width / this.height;
    const fovX = 2 * Math.atan(Math.tan(this.fovY / 2) * aspect);
    const distance = (radius * 1.1) / Math.sin(Math.min(this.fovY, fovX) / 2);
    this.position.copy(center).addScaledVector(this.forward(), -distance);
    this.orthoScale = Math.min(this.width, this.height) / 2 / (radius * 1.1);

    for (let iter = 0; iter < 4; iter++) {
      const projected = points.map((p) => this.project(p));
      if (projected.some((q) => q === null)) break;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const q of projected as Projected[]) {
        x0 = Math.min(x0, q.x);
        y0 = Math.min(y0, q.y);
        x1 = Math.max(x1, q.x);
        y1 = Math.max(y1, q.y);
      }
      const s = this.scaleAt(center);
      if (s === null) break;
      const dx = (x0 + x1) / 2 - this.width / 2;
      const dy = (y0 + y1) / 2 - this.height / 2;
      this.position.addScaledVector(this.right(), dx / s).addScaledVector(this.up(), -dy / s);
      const k = Math.max((x1 - x0) / (this.width * fill), (y1 - y0) / (this.height * fill), 1e-3);
      if (this.projection === "orthographic") {
        this.orthoScale /= k;
      } else {
        const depth = this.depthOf(center);
        this.position.addScaledVector(this.forward(), depth - depth * k);
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
