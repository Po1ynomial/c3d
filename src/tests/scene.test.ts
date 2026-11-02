import { describe, expect, it } from "vitest";
import { parseScene, SceneError } from "../scene";

function problemsOf(raw: unknown): string[] {
  try {
    parseScene(raw);
    return [];
  } catch (err) {
    if (err instanceof SceneError) return err.problems;
    throw err;
  }
}

describe("scene validation", () => {
  it("fills defaults", () => {
    const s = parseScene({
      nodes: [
        { id: "A", pos: [0, 0, 0] },
        { id: "B", pos: [1, 0, 0], label: "B" },
      ],
      arrows: [
        { from: "A", to: "B", label: "f" },
        { from: "A", to: "A" },
      ],
    });
    expect(s.nodes[0]!.label).toBe("A");
    expect(s.arrows[0]!).toMatchObject({ id: "#0", theta: 0, bend: 0, shift: 0, loop: null });
    expect(s.arrows[0]!.label).toEqual({ text: "f", t: 0.5, offset: 6 });
    expect(s.arrows[1]!.loop).toEqual({ axis: [1, 0, 0], radius: 0.5 });
  });

  it("reports every problem with its node or arrow", () => {
    const raw = {
      nodes: [
        { id: "A", pos: [0, 0, 0] },
        { id: "A", pos: [1, 0] },
        { id: "B", pos: [2, 0, 0], colour: "red" },
      ],
      arrows: [
        { id: "f", from: "A", to: "Missing" },
        { id: "g", from: "A", to: "B", style: { head: "triangle" }, label: { text: "g", t: 2 } },
        { from: "B", to: "B", bend: 1 },
      ],
    };
    expect(problemsOf(raw)).toEqual([
      'node "A": duplicate id',
      'node "A".pos: expected an array of three finite numbers',
      'node "B": unknown key "colour"',
      'arrow "f".to: unknown node "Missing"',
      'arrow "g".label.t: must lie in [0, 1]',
      'arrow "g".style.head: expected one of "normal", "twohead", "none"',
      "arrow #2.bend: does not apply to loops",
    ]);
  });

  it("rejects a non-object scene", () => {
    expect(() => parseScene([])).toThrow(SceneError);
  });
});
