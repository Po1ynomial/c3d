# Design notes

This records what the viewer does and why. Scope is deliberately narrow: nodes and arrows between them, placed in 3D, viewed with a free camera. Higher cells, editing, persistence, automatic layout and LaTeX/Typst export are out of scope for now.

## Rendering pipeline

The scene stays in world space; each frame projects it to the screen and draws a flat illustration:

1. Sample each arrow's world-space curve, clip it at the perspective near plane and project it.
2. Trim the projected polyline where it leaves its endpoint labels.
3. Detect crossings between arrows on screen and cut gaps (see below).
4. Emit SVG for shafts, tips and tails; position KaTeX labels as HTML on top.

Three.js is used only for vector maths. There is no WebGL scene: the output is meant to look typeset, not lit.

## Camera

- Z is up. The camera has yaw and pitch but no roll.
- `W` `A` `S` `D` move along the heading projected onto world XY, so looking up or down does not change altitude; `Q` `E` move along world Z.
- Left drag rigidly rotates the camera about the pivot: the focused node, the focused arrow's curve midpoint, or the origin. Focusing changes only the pivot, never the camera.
- Right drag turns the camera in place.
- Scroll dollies toward the pivot in perspective and changes the scale in orthographic; either way the pivot stays fixed on screen.
- Perspective uses a 30° vertical field of view. Wider angles distorted deep scenes too much.

## Projections

Perspective and orthographic projections render the same scene. "Oblique" is an orthographic camera preset, not a separate projection. Switching projection preserves the apparent scale at the pivot.

## Sizing

Two presets control the screen size of labels, strokes and tips:

- **Diagram:** constant screen size, like a printed diagram.
- **Spatial:** sizes follow the local projection scale, so nearer elements are larger.

Both share a reference scale: the orthographic scale at which the scene fits the viewport in the default orientation. At that scale the presets agree, so switching does not make sizes jump. One overall size factor applies to both.

## Crossing gaps

Where two arrows cross on screen, the depths of both at the crossing are compared and the farther stroke is interrupted, like tikz-cd's `crossing over`, but derived from the geometry instead of declared. The gap is cut from the stroke itself rather than painted over it, so it does not depend on the background.

- Crossings close to a node shared by both arrows are ignored.
- Near-equal depths (true intersections in 3D) fall back to arrow order, which keeps the result stable while the camera moves.
- The gap widens for shallow crossing angles.

## Labels

Labels always face the camera with upright text.

Provisionally, labels take priority over strokes: each label knocks out the strokes beneath it with a thin halo in the background colour. The halo is shaped like the label's ink rather than its box. An SVG filter dilates the rendered label and then erodes it by less (a morphological closing), which fills the gaps between glyphs and covers fraction bars, overlines and KaTeX's SVG parts. Labels may still overlap one another; there is no collision avoidance.

A depth-aware alternative, where nearer arrows can pass in front of farther labels, would require moving labels into the SVG in depth order. It is deferred.

## View-snapped normals

The stored normal is a world-space direction, so a bend or label offset can point almost straight at the camera and become hard to read. The view-snapped mode replaces the normal while rendering with the direction perpendicular to both the chord and the viewing ray, with the sign nearest the stored normal. The scene data is untouched. End-on views fall back to the stored normal, and an ambiguous sign keeps its previous value to avoid flicker.

## Arrow styles

Tips, tails and shafts are independent properties, so they combine freely. The arrow tip imitates Computer Modern's curved barbs; double-line arrows get a wider tip. On double arrows each line gets its own hook, all curling to the same side, as in quiver.
