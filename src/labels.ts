// KaTeX label elements and their measurement.

import katex from "katex";
import type { Box, LabelPlacement } from "./render";

export interface LabelElement {
  el: HTMLElement;
  box: Box;
}

/** Render LaTeX math into a positioned label; invalid input falls back to its literal source. */
export function createLabel(
  container: HTMLElement,
  tex: string,
  colour: string | null,
  kind: "node" | "arrow",
): LabelElement {
  const el = document.createElement("div");
  el.className = `label ${kind}`;
  if (tex.trim() === "") {
    el.hidden = true;
  } else {
    try {
      katex.render(tex, el, {
        throwOnError: true,
        displayMode: false,
        output: "html",
        trust: false,
        strict: "ignore",
      });
    } catch (err) {
      el.classList.add("invalid");
      el.textContent = tex;
      el.title = err instanceof Error ? err.message : String(err);
    }
  }
  if (colour) el.style.color = colour;
  container.appendChild(el);
  return { el, box: { w: 0, h: 0 } };
}

/** Measure unscaled sizes; transforms do not affect offset sizes. */
export function measure(labels: readonly LabelElement[]): void {
  for (const l of labels) {
    l.box.w = l.el.hidden ? 0 : l.el.offsetWidth;
    l.box.h = l.el.hidden ? 0 : l.el.offsetHeight;
  }
}

export function place(label: LabelElement, p: LabelPlacement | null, z: number): void {
  if (!p || !p.visible || label.box.w === 0) {
    label.el.style.visibility = "hidden";
    return;
  }
  label.el.style.visibility = "visible";
  label.el.style.transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px) translate(-50%, -50%) scale(${p.scale.toFixed(4)})`;
  label.el.style.zIndex = String(z);
}
