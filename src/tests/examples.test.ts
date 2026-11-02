import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScene, SceneError } from "../scene";

function example(name: string): unknown {
  const url = new URL(`../../public/examples/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

describe("bundled examples", () => {
  const index = example("index.json") as { file: string }[];

  it.each(index.filter((e) => e.file !== "invalid.json"))("$file is valid", ({ file }) => {
    expect(() => parseScene(example(file))).not.toThrow();
  });

  it("invalid.json is rejected", () => {
    expect(() => parseScene(example("invalid.json"))).toThrow(SceneError);
  });
});
