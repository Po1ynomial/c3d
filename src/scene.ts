// Scene data model and validation of the handwritten JSON format.

export type Vec3 = [number, number, number];

export type HeadStyle = "normal" | "twohead" | "none";
export type TailStyle = "none" | "mapsto" | "hook" | "hook'";
export type ShaftStyle = "solid" | "dashed" | "dotted";

export interface NodeSpec {
  id: string;
  pos: Vec3;
  /** LaTeX source, rendered in math mode. May be empty. */
  label: string;
  color: string | null;
}

export interface ArrowLabel {
  /** LaTeX source, rendered in math mode. */
  text: string;
  /** Curve parameter of the anchor point, in [0, 1]. */
  t: number;
  /** Signed offset along the (projected) normal, in reference pixels. 0 centres the label on the arrow. */
  offset: number;
}

export interface LoopSpec {
  /** Supplies the direction `d` of the normal frame. */
  axis: Vec3;
  /** Extent of the loop away from its node, in world units. */
  radius: number;
}

export interface ArrowStyle {
  head: HeadStyle;
  tail: TailStyle;
  shaft: ShaftStyle;
  double: boolean;
  color: string | null;
}

export interface ArrowSpec {
  /** Explicit id, or a positional `#index` key. Used for diagnostics. */
  id: string;
  from: string;
  to: string;
  label: ArrowLabel | null;
  /** Normal angle in degrees. */
  theta: number;
  /** Signed world-space midpoint displacement along the normal. */
  bend: number;
  /** Signed screen-space displacement along the normal, in reference pixels (parallel arrows). */
  shift: number;
  loop: LoopSpec | null;
  style: ArrowStyle;
}

export interface Scene {
  nodes: NodeSpec[];
  arrows: ArrowSpec[];
}

export class SceneError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "SceneError";
  }
}

const HEADS: readonly HeadStyle[] = ["normal", "twohead", "none"];
const TAILS: readonly TailStyle[] = ["none", "mapsto", "hook", "hook'"];
const SHAFTS: readonly ShaftStyle[] = ["solid", "dashed", "dotted"];

const DEFAULT_LABEL_OFFSET = 6;
const DEFAULT_LOOP: LoopSpec = { axis: [1, 0, 0], radius: 0.5 };

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: Json): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isColor(v: string): boolean {
  // CSS is unavailable outside the browser (e.g. in unit tests).
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return v.length > 0;
  return CSS.supports("color", v);
}

class Checker {
  readonly problems: string[] = [];

  fail(where: string, msg: string): void {
    this.problems.push(`${where}: ${msg}`);
  }

  keys(where: string, obj: Record<string, Json>, allowed: readonly string[]): void {
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) this.fail(where, `unknown key "${k}"`);
    }
  }

  vec3(where: string, v: Json): Vec3 | null {
    if (Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber))
      return [v[0], v[1], v[2]] as Vec3;
    this.fail(where, "expected an array of three finite numbers");
    return null;
  }

  number(where: string, v: Json, fallback: number): number {
    if (v === undefined) return fallback;
    if (isFiniteNumber(v)) return v;
    this.fail(where, "expected a finite number");
    return fallback;
  }

  string(where: string, v: Json, fallback: string): string {
    if (v === undefined) return fallback;
    if (typeof v === "string") return v;
    this.fail(where, "expected a string");
    return fallback;
  }

  color(where: string, v: Json): string | null {
    if (v === undefined) return null;
    if (typeof v === "string" && isColor(v)) return v;
    this.fail(where, "expected a CSS colour string");
    return null;
  }

  oneOf<T extends string>(where: string, v: Json, options: readonly T[], fallback: T): T {
    if (v === undefined) return fallback;
    if (typeof v === "string" && (options as readonly string[]).includes(v)) return v as T;
    this.fail(where, `expected one of ${options.map((o) => JSON.stringify(o)).join(", ")}`);
    return fallback;
  }
}

/** Validate parsed JSON and produce a fully-defaulted scene. Throws `SceneError` listing every problem. */
export function parseScene(input: Json): Scene {
  const c = new Checker();
  if (!isObject(input)) throw new SceneError(["scene: expected a JSON object"]);
  c.keys("scene", input, ["nodes", "arrows"]);

  const nodes: NodeSpec[] = [];
  const nodeIds = new Set<string>();
  if (!Array.isArray(input.nodes)) {
    c.fail("scene", `"nodes" must be an array`);
  } else {
    input.nodes.forEach((raw, i) => {
      if (!isObject(raw)) return c.fail(`node #${i}`, "expected an object");
      const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : null;
      const where = id === null ? `node #${i}` : `node "${id}"`;
      if (id === null) c.fail(where, `"id" must be a non-empty string`);
      else if (nodeIds.has(id)) c.fail(where, "duplicate id");
      else nodeIds.add(id);
      c.keys(where, raw, ["id", "pos", "label", "color"]);
      const pos = c.vec3(`${where}.pos`, raw.pos);
      const label = c.string(`${where}.label`, raw.label, id ?? "");
      const color = c.color(`${where}.color`, raw.color);
      if (id !== null && pos !== null) nodes.push({ id, pos, label, color });
    });
  }

  const arrows: ArrowSpec[] = [];
  const arrowIds = new Set<string>();
  const arrowsRaw = input.arrows === undefined ? [] : input.arrows;
  if (!Array.isArray(arrowsRaw)) {
    c.fail("scene", `"arrows" must be an array`);
  } else {
    arrowsRaw.forEach((raw, i) => {
      if (!isObject(raw)) return c.fail(`arrow #${i}`, "expected an object");
      let id = `#${i}`;
      if (raw.id !== undefined) {
        if (typeof raw.id !== "string" || raw.id === "")
          c.fail(`arrow #${i}`, `"id" must be a non-empty string`);
        else id = raw.id;
      }
      const where = raw.id === undefined ? `arrow #${i}` : `arrow "${id}"`;
      if (arrowIds.has(id)) c.fail(where, "duplicate id");
      arrowIds.add(id);
      c.keys(where, raw, ["id", "from", "to", "label", "theta", "bend", "shift", "loop", "style"]);

      const from = c.string(`${where}.from`, raw.from, "");
      const to = c.string(`${where}.to`, raw.to, "");
      if (!nodeIds.has(from)) c.fail(`${where}.from`, `unknown node "${from}"`);
      if (!nodeIds.has(to)) c.fail(`${where}.to`, `unknown node "${to}"`);

      let label: ArrowLabel | null = null;
      if (typeof raw.label === "string") {
        label = { text: raw.label, t: 0.5, offset: DEFAULT_LABEL_OFFSET };
      } else if (isObject(raw.label)) {
        const lw = `${where}.label`;
        c.keys(lw, raw.label, ["text", "t", "offset"]);
        const t = c.number(`${lw}.t`, raw.label.t, 0.5);
        if (t < 0 || t > 1) c.fail(`${lw}.t`, "must lie in [0, 1]");
        label = {
          text: c.string(`${lw}.text`, raw.label.text, ""),
          t,
          offset: c.number(`${lw}.offset`, raw.label.offset, DEFAULT_LABEL_OFFSET),
        };
      } else if (raw.label !== undefined) {
        c.fail(`${where}.label`, "expected a string or an object");
      }

      const theta = c.number(`${where}.theta`, raw.theta, 0);
      const bend = c.number(`${where}.bend`, raw.bend, 0);
      const shift = c.number(`${where}.shift`, raw.shift, 0);

      let loop: LoopSpec | null = null;
      if (from === to) {
        if (raw.bend !== undefined) c.fail(`${where}.bend`, "does not apply to loops");
        if (raw.shift !== undefined) c.fail(`${where}.shift`, "does not apply to loops");
        if (raw.loop === undefined) {
          loop = { axis: [...DEFAULT_LOOP.axis], radius: DEFAULT_LOOP.radius };
        } else if (isObject(raw.loop)) {
          const lw = `${where}.loop`;
          c.keys(lw, raw.loop, ["axis", "radius"]);
          const axis =
            raw.loop.axis === undefined
              ? ([...DEFAULT_LOOP.axis] as Vec3)
              : c.vec3(`${lw}.axis`, raw.loop.axis);
          if (axis !== null && Math.hypot(...axis) < 1e-9) c.fail(`${lw}.axis`, "must be non-zero");
          const radius = c.number(`${lw}.radius`, raw.loop.radius, DEFAULT_LOOP.radius);
          if (radius <= 0) c.fail(`${lw}.radius`, "must be positive");
          loop = { axis: axis ?? [...DEFAULT_LOOP.axis], radius };
        } else {
          c.fail(`${where}.loop`, "expected an object");
        }
      } else if (raw.loop !== undefined) {
        c.fail(`${where}.loop`, "only applies when from and to coincide");
      }

      const style: ArrowStyle = {
        head: "normal",
        tail: "none",
        shaft: "solid",
        double: false,
        color: null,
      };
      if (isObject(raw.style)) {
        const sw = `${where}.style`;
        c.keys(sw, raw.style, ["head", "tail", "shaft", "double", "color"]);
        style.head = c.oneOf(`${sw}.head`, raw.style.head, HEADS, "normal");
        style.tail = c.oneOf(`${sw}.tail`, raw.style.tail, TAILS, "none");
        style.shaft = c.oneOf(`${sw}.shaft`, raw.style.shaft, SHAFTS, "solid");
        if (raw.style.double !== undefined && typeof raw.style.double !== "boolean") {
          c.fail(`${sw}.double`, "expected a boolean");
        } else {
          style.double = raw.style.double === true;
        }
        style.color = c.color(`${sw}.color`, raw.style.color);
      } else if (raw.style !== undefined) {
        c.fail(`${where}.style`, "expected an object");
      }

      arrows.push({ id, from, to, label, theta, bend, shift, loop, style });
    });
  }

  if (c.problems.length > 0) throw new SceneError(c.problems);
  return { nodes, arrows };
}
