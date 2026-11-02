import "katex/dist/katex.min.css";
import "./style.css";

import { Vector3 } from "three";
import { Camera } from "./camera";
import { evalCurve, sampleCurve } from "./geometry";
import { createLabel, measure, place, type LabelElement } from "./labels";
import { hitTest, Renderer, type Focus, type Frame, type Sizing } from "./render";
import { parseScene, SceneError, type Scene } from "./scene";

const DEG = Math.PI / 180;
const DEFAULT_ORIENTATION = { yaw: 120 * DEG, pitch: -22 * DEG };
const PRESETS: Record<string, { yaw: number; pitch: number; orthographic?: boolean }> = {
  oblique: { yaw: 115 * DEG, pitch: -20 * DEG, orthographic: true },
  front: { yaw: 90 * DEG, pitch: 0 },
  top: { yaw: 90 * DEG, pitch: -90 * DEG },
  side: { yaw: 180 * DEG, pitch: 0 },
};
const ORBIT_SPEED = 0.006;
const LOOK_SPEED = 0.003;
const CLICK_SLOP = 4;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

const viewport = $<HTMLDivElement>("viewport");
const svg = $<HTMLElement>("strokes") as unknown as SVGSVGElement;
const labelLayer = $<HTMLDivElement>("labels");
const errorPanel = $<HTMLDivElement>("error");
const helpPanel = $<HTMLDivElement>("help");
const statusLine = $<HTMLDivElement>("status");
const exampleSelect = $<HTMLSelectElement>("example");
const fileInput = $<HTMLInputElement>("file");

const camera = new Camera();

interface Loaded {
  scene: Scene;
  renderer: Renderer;
  nodeLabels: LabelElement[];
  arrowLabels: (LabelElement | null)[];
  /** Node positions and stored-curve samples, used for fitting. */
  points: Vector3[];
  radius: number;
  /** Cached sizing reference for the current viewport size. */
  reference: { width: number; height: number; scale: number } | null;
}

let loaded: Loaded | null = null;
let lastFrame: Frame | null = null;

const view = {
  sizing: "diagram" as Sizing,
  snapNormals: false,
  sizeFactor: 1,
  focus: null as Focus | null,
  pivot: new Vector3(),
  orbiting: false,
};

let dirty = true;
const requestRender = () => {
  dirty = true;
};

// ---------------------------------------------------------------- loading

function clearScene(): void {
  loaded = null;
  lastFrame = null;
  labelLayer.replaceChildren();
  svg.replaceChildren();
  view.focus = null;
  view.pivot.set(0, 0, 0);
}

function showError(title: string, problems: string[]): void {
  errorPanel.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = title;
  const list = document.createElement("ul");
  for (const p of problems) {
    const li = document.createElement("li");
    li.textContent = p;
    list.appendChild(li);
  }
  errorPanel.append(h, list);
  errorPanel.hidden = false;
}

function loadScene(name: string, text: string): void {
  clearScene();
  errorPanel.hidden = true;
  let scene: Scene;
  try {
    scene = parseScene(JSON.parse(text));
  } catch (err) {
    const problems =
      err instanceof SceneError ? err.problems : [err instanceof Error ? err.message : String(err)];
    showError(`Could not load ${name}`, problems);
    requestRender();
    return;
  }

  const nodeLabels = scene.nodes.map((n) => createLabel(labelLayer, n.label, n.color, "node"));
  const arrowLabels = scene.arrows.map((a) =>
    a.label ? createLabel(labelLayer, a.label.text, a.style.color, "arrow") : null,
  );
  const all = [...nodeLabels, ...arrowLabels.filter((l): l is LabelElement => l !== null)];
  measure(all);

  const renderer = new Renderer(
    scene,
    nodeLabels.map((l) => l.box),
    arrowLabels.map((l) => l?.box ?? null),
  );
  const { points, radius } = sceneBounds(scene, renderer);
  renderer.radius = radius;
  loaded = { scene, renderer, nodeLabels, arrowLabels, points, radius, reference: null };

  camera.near = radius * 1e-3;
  resetView();
  // KaTeX fonts may arrive after the first measurement.
  void document.fonts.ready.then(() => {
    if (loaded?.nodeLabels === nodeLabels) {
      measure(all);
      requestRender();
    }
  });
}

function sceneBounds(scene: Scene, renderer: Renderer): { points: Vector3[]; radius: number } {
  const points: Vector3[] = scene.nodes.map((_, i) => renderer.nodePosition(i));
  scene.arrows.forEach((_, i) => points.push(...sampleCurve(renderer.storedCurve(i), 16)));
  if (points.length === 0) return { points: [new Vector3()], radius: 1 };
  const min = points[0]!.clone();
  const max = points[0]!.clone();
  for (const p of points) {
    min.min(p);
    max.max(p);
  }
  return { points, radius: Math.max(1, max.distanceTo(min) / 2) };
}

/**
 * Pixels per world unit at which spatial sizing equals diagram sizing: the scale of the fitted
 * default orientation, taken orthographically so it does not depend on the current camera.
 */
function referenceScale(l: Loaded): number {
  if (l.reference && l.reference.width === camera.width && l.reference.height === camera.height) {
    return l.reference.scale;
  }
  const probe = new Camera();
  probe.width = camera.width;
  probe.height = camera.height;
  probe.yaw = DEFAULT_ORIENTATION.yaw;
  probe.pitch = DEFAULT_ORIENTATION.pitch;
  probe.projection = "orthographic";
  probe.fit(l.points);
  l.reference = { width: camera.width, height: camera.height, scale: probe.orthoScale };
  return probe.orthoScale;
}

async function loadExample(file: string): Promise<void> {
  try {
    const res = await fetch(`examples/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadScene(file, await res.text());
  } catch (err) {
    clearScene();
    showError(`Could not fetch ${file}`, [err instanceof Error ? err.message : String(err)]);
  }
}

async function initExamples(): Promise<void> {
  let entries: { file: string; title: string }[] = [];
  try {
    const res = await fetch("examples/index.json");
    entries = (await res.json()) as typeof entries;
  } catch {
    showError("Could not fetch examples/index.json", []);
  }
  for (const e of entries) {
    const opt = document.createElement("option");
    opt.value = e.file;
    opt.textContent = e.title;
    exampleSelect.appendChild(opt);
  }
  const wanted = new URLSearchParams(location.search).get("example");
  const initial =
    entries.find((e) => e.file === wanted || e.file === `${wanted}.json`) ?? entries[0];
  if (initial) {
    exampleSelect.value = initial.file;
    await loadExample(initial.file);
  }
}

exampleSelect.addEventListener("change", () => {
  if (exampleSelect.value) void loadExample(exampleSelect.value);
  exampleSelect.blur();
});

$("open").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  exampleSelect.value = "";
  loadScene(file.name, await file.text());
  fileInput.value = "";
});

// ---------------------------------------------------------------- view commands

function resetView(): void {
  camera.yaw = DEFAULT_ORIENTATION.yaw;
  camera.pitch = DEFAULT_ORIENTATION.pitch;
  fitScene();
}

function fitScene(): void {
  if (loaded) camera.fit(loaded.points);
  requestRender();
}

function toggleProjection(): void {
  camera.setProjection(
    camera.projection === "perspective" ? "orthographic" : "perspective",
    view.pivot,
  );
  requestRender();
}

/** Orient the camera to a preset and frame the whole scene. */
function applyPreset(name: string): void {
  const p = PRESETS[name];
  if (!p) return;
  if (p.orthographic) camera.setProjection("orthographic", view.pivot);
  camera.yaw = p.yaw;
  camera.pitch = p.pitch;
  fitScene();
}

function setFocus(focus: Focus | null): void {
  view.focus = focus;
  if (!loaded || focus === null) view.pivot.set(0, 0, 0);
  else if (focus.kind === "node") view.pivot.copy(loaded.renderer.nodePosition(focus.index));
  else view.pivot.copy(evalCurve(loaded.renderer.storedCurve(focus.index), 0.5));
  requestRender();
}

function resizeSize(factor: number): void {
  view.sizeFactor = Math.min(4, Math.max(0.25, view.sizeFactor * factor));
  requestRender();
}

const commands: Record<string, () => void> = {
  projection: toggleProjection,
  oblique: () => applyPreset("oblique"),
  sizing: () => {
    view.sizing = view.sizing === "diagram" ? "spatial" : "diagram";
    requestRender();
  },
  normals: () => {
    view.snapNormals = !view.snapNormals;
    requestRender();
  },
  smaller: () => resizeSize(1 / 1.1),
  larger: () => resizeSize(1.1),
  fit: fitScene,
  reset: resetView,
  help: () => {
    helpPanel.hidden = !helpPanel.hidden;
  },
};

for (const [id, run] of Object.entries(commands)) {
  $(`cmd-${id}`).addEventListener("click", (e) => {
    run();
    (e.currentTarget as HTMLElement).blur();
  });
}

// ---------------------------------------------------------------- input

const held = new Set<string>();

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if ("wasdqe".includes(key) && key.length === 1) {
    held.add(key);
    e.preventDefault();
    return;
  }
  const bindings: Record<string, () => void> = {
    escape: () => setFocus(null),
    p: commands.projection!,
    o: commands.oblique!,
    g: commands.sizing!,
    n: commands.normals!,
    "[": commands.smaller!,
    "]": commands.larger!,
    f: commands.fit!,
    r: commands.reset!,
    h: commands.help!,
    "?": commands.help!,
    "1": () => applyPreset("front"),
    "2": () => applyPreset("top"),
    "3": () => applyPreset("side"),
  };
  const run = bindings[key];
  if (run) {
    run();
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => held.clear());

let drag: {
  button: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  moved: boolean;
} | null = null;

viewport.addEventListener("contextmenu", (e) => e.preventDefault());
viewport.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  if ((e.target as HTMLElement).closest(".panel")) return;
  drag = {
    button: e.button,
    x: e.clientX,
    y: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    moved: false,
  };
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > CLICK_SLOP)
    drag.moved = true;
  if (!drag.moved) return;
  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  if (drag.button === 0) {
    view.orbiting = true;
    camera.orbit(view.pivot, -dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
  } else {
    camera.look(-dx * LOOK_SPEED, -dy * LOOK_SPEED);
  }
  requestRender();
});
const endDrag = (e: PointerEvent) => {
  if (!drag) return;
  if (!drag.moved && drag.button === 0 && lastFrame && loaded) {
    const r = viewport.getBoundingClientRect();
    const depths = lastFrame.nodeLabels.map((l) => l.depth);
    const hit = hitTest(lastFrame, depths, e.clientX - r.left, e.clientY - r.top);
    if (hit) setFocus(hit);
  }
  drag = null;
  view.orbiting = false;
  requestRender();
};
viewport.addEventListener("pointerup", endDrag);
viewport.addEventListener("pointercancel", endDrag);

viewport.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    camera.zoom(Math.exp(delta * 0.0015), view.pivot);
    requestRender();
  },
  { passive: false },
);

function resize(): void {
  const r = viewport.getBoundingClientRect();
  camera.width = Math.max(1, r.width);
  camera.height = Math.max(1, r.height);
  svg.setAttribute("width", String(camera.width));
  svg.setAttribute("height", String(camera.height));
  requestRender();
}
new ResizeObserver(resize).observe(viewport);

// ---------------------------------------------------------------- frame loop

let lastTime = performance.now();

function tick(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (held.size > 0 && loaded) {
    const speed = loaded.radius * 0.9 * dt;
    const axis = (pos: string, neg: string) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
    camera.fly(axis("w", "s") * speed, axis("d", "a") * speed, axis("e", "q") * speed);
    requestRender();
  }
  if (dirty) {
    dirty = false;
    draw();
  }
  requestAnimationFrame(tick);
}

function draw(): void {
  updateStatus();
  if (!loaded) return;
  const frame = loaded.renderer.frame(camera, {
    sizing: view.sizing,
    snapNormals: view.snapNormals,
    sizeFactor: view.sizeFactor,
    referenceScale: referenceScale(loaded),
    focus: view.focus,
    pivot: view.pivot,
    showPivot: view.focus !== null || view.orbiting,
  });
  lastFrame = frame;
  svg.innerHTML = frame.svg;

  // Nearer labels stack above farther ones.
  const entries: { label: LabelElement; p: Frame["nodeLabels"][number] | null }[] = [];
  loaded.nodeLabels.forEach((label, i) => entries.push({ label, p: frame.nodeLabels[i]! }));
  loaded.arrowLabels.forEach((label, i) => {
    if (label) entries.push({ label, p: frame.arrowLabels[i] ?? null });
  });
  entries.sort((a, b) => (b.p?.depth ?? 0) - (a.p?.depth ?? 0));
  entries.forEach(({ label, p }, z) => place(label, p, z + 1));

  loaded.nodeLabels.forEach((l, i) => {
    l.el.classList.toggle("focused", view.focus?.kind === "node" && view.focus.index === i);
  });
  loaded.arrowLabels.forEach((l, i) => {
    l?.el.classList.toggle("focused", view.focus?.kind === "arrow" && view.focus.index === i);
  });
}

function updateStatus(): void {
  const focus = (() => {
    if (!loaded || !view.focus) return "origin";
    if (view.focus.kind === "node") return `node ${loaded.scene.nodes[view.focus.index]!.id}`;
    return `arrow ${loaded.scene.arrows[view.focus.index]!.id}`;
  })();
  statusLine.textContent = [
    camera.projection === "perspective" ? "Perspective" : "Orthographic",
    view.sizing === "diagram" ? "Diagram sizing" : "Spatial sizing",
    view.snapNormals ? "View-snapped normals" : "Stored normals",
    `Size ×${view.sizeFactor.toFixed(2)}`,
    `Pivot: ${focus}`,
  ].join("  ·  ");
}

resize();
requestAnimationFrame(tick);
void initExamples();
