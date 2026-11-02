import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Camera } from "../camera";
import { Renderer, type RenderOptions } from "../render";
import { parseScene } from "../scene";

const options: RenderOptions = {
  sizing: "diagram",
  snapNormals: false,
  sizeFactor: 1,
  referenceScale: 100,
  focus: null,
  pivot: new Vector3(),
  showPivot: false,
};

function frontCamera(projection: "perspective" | "orthographic" = "orthographic"): Camera {
  const c = new Camera();
  c.width = 800;
  c.height = 600;
  c.yaw = Math.PI / 2; // looking along +y
  c.pitch = 0;
  c.position.set(0, -10, 0);
  c.projection = projection;
  c.orthoScale = 100;
  return c;
}

/** Number of shaft paths (those without round caps, i.e. excluding tips) per arrow id. */
function shaftCounts(svg: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of svg.matchAll(/<g [^>]*data-arrow="([^"]+)">(.*?)<\/g>/g)) {
    out[m[1]!] = [...m[2]!.matchAll(/stroke-linecap="butt"/g)].length;
  }
  return out;
}

function render(scene: unknown, camera: Camera) {
  const s = parseScene(scene);
  const r = new Renderer(
    s,
    s.nodes.map(() => ({ w: 10, h: 12 })),
    s.arrows.map((a) => (a.label ? { w: 8, h: 10 } : null)),
  );
  r.radius = 2;
  return r.frame(camera, options);
}

describe("crossing gaps", () => {
  const crossing = (nearY: number, farY: number) => ({
    nodes: [
      { id: "a", pos: [-1, nearY, 0] },
      { id: "b", pos: [1, nearY, 0] },
      { id: "c", pos: [0, farY, -1] },
      { id: "d", pos: [0, farY, 1] },
    ],
    arrows: [
      { id: "near", from: "a", to: "b" },
      { id: "far", from: "c", to: "d" },
    ],
  });

  it("interrupts the farther arrow only", () => {
    expect(shaftCounts(render(crossing(0, 1), frontCamera()).svg)).toEqual({ near: 1, far: 2 });
    expect(shaftCounts(render(crossing(1, 0), frontCamera()).svg)).toEqual({ near: 2, far: 1 });
  });

  it("breaks depth ties stably by arrow order", () => {
    expect(shaftCounts(render(crossing(0, 0), frontCamera()).svg)).toEqual({ near: 2, far: 1 });
  });

  it("ignores crossings at a shared endpoint", () => {
    const scene = {
      nodes: [
        { id: "a", pos: [0, 0, 0] },
        { id: "b", pos: [1, 0, 0.05] },
        { id: "c", pos: [1, 1, -0.05] },
      ],
      arrows: [
        { id: "p", from: "a", to: "b" },
        { id: "q", from: "a", to: "c" },
      ],
    };
    expect(shaftCounts(render(scene, frontCamera()).svg)).toEqual({ p: 1, q: 1 });
  });
});

describe("clipping and trimming", () => {
  it("trims arrows at their endpoint labels", () => {
    const scene = {
      nodes: [
        { id: "a", pos: [-1, 0, 0] },
        { id: "b", pos: [1, 0, 0] },
      ],
      arrows: [{ from: "a", to: "b" }],
    };
    const f = render(scene, frontCamera());
    const pts = f.arrowLines[0]![0]!;
    // Labels are 10 px wide plus 3.5 px padding: ends sit 8.5 px from the node centres at x = 300, 500.
    expect(pts[0]!.x).toBeCloseTo(308.5);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(491.5);
  });

  it("drops the head of an arrow whose target lies behind the camera", () => {
    const scene = {
      nodes: [
        { id: "a", pos: [0, 0, 0] },
        { id: "b", pos: [3, -20, 0] },
      ],
      arrows: [{ id: "x", from: "a", to: "b" }],
    };
    const f = render(scene, frontCamera("perspective"));
    expect(f.arrowLines[0]!.length).toBe(1);
    expect(f.svg).not.toContain("stroke-linejoin");
    expect(f.nodeLabels[1]!.visible).toBe(false);
  });
});

describe("performance", () => {
  it("renders 100 nodes and 300 curved arrows comfortably within a frame", () => {
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`,
      pos: [rand() * 10, rand() * 10, rand() * 10],
    }));
    const arrows = Array.from({ length: 300 }, (_, i) => ({
      from: `n${i % 100}`,
      to: `n${Math.floor(rand() * 100)}`,
      label: "f",
      bend: i % 2 ? 0.5 : 0,
    })).map((a) => (a.from === a.to ? { from: a.from, to: a.to, label: a.label } : a));
    const s = parseScene({ nodes, arrows });
    const r = new Renderer(
      s,
      s.nodes.map(() => ({ w: 10, h: 12 })),
      s.arrows.map(() => ({ w: 8, h: 10 })),
    );
    r.radius = 10;
    const c = frontCamera("perspective");
    c.position.set(5, -30, 5);
    r.frame(c, options);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) r.frame(c, options);
    const ms = (performance.now() - t0) / 10;
    expect(ms).toBeLessThan(50);
    console.log(`frame: ${ms.toFixed(1)} ms`);
  });
});
