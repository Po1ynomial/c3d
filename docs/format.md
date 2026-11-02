# Scene format

A scene is a JSON object with `nodes` and `arrows`. It describes geometry and styling only: camera state, projection and sizing modes are viewer settings and never stored.

```json
{
  "nodes": [
    { "id": "A", "pos": [0, 0, 2], "label": "A" },
    { "id": "B", "pos": [2, 0, 2], "label": "B", "color": "#1d4ed8" }
  ],
  "arrows": [
    { "id": "f", "from": "A", "to": "B", "label": "f" },
    {
      "from": "B",
      "to": "A",
      "label": { "text": "g", "t": 0.5, "offset": -6 },
      "bend": 0.5,
      "theta": 180,
      "style": { "head": "twohead", "tail": "hook", "shaft": "dashed", "color": "#b45309" }
    },
    { "from": "A", "to": "A", "label": "e", "loop": { "axis": [1, 0, 0], "radius": 0.5 } }
  ]
}
```

World coordinates are Z-up and literal; there is no automatic layout. Validation is strict: unknown keys, bad values and dangling references are errors, and every problem is reported with the node or arrow it belongs to. An invalid scene is not rendered at all.

## Nodes

| Key     | Default      | Meaning                                       |
| ------- | ------------ | --------------------------------------------- |
| `id`    | required     | Unique non-empty string                       |
| `pos`   | required     | `[x, y, z]`                                   |
| `label` | the `id`     | LaTeX math rendered by KaTeX; `""` is a point |
| `color` | theme colour | Any CSS colour                                |

## Arrows

| Key            | Default                                | Meaning                                                                  |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `id`           | `#index`                               | Optional; used in diagnostics                                            |
| `from`, `to`   | required                               | Node ids; equal ids make a loop                                          |
| `label`        | none                                   | A string, or `{ "text", "t": 0.5, "offset": 6 }`                         |
| `theta`        | `0`                                    | Normal angle in degrees                                                  |
| `bend`         | `0`                                    | World-space displacement of the curve midpoint along the normal          |
| `shift`        | `0`                                    | Screen-space parallel displacement along the normal, in reference pixels |
| `loop`         | `{ "axis": [1, 0, 0], "radius": 0.5 }` | Loops only                                                               |
| `style.head`   | `"normal"`                             | `"normal"`, `"twohead"`, `"none"`                                        |
| `style.tail`   | `"none"`                               | `"none"`, `"mapsto"`, `"hook"`, `"hook'"`                                |
| `style.shaft`  | `"solid"`                              | `"solid"`, `"dashed"`, `"dotted"`                                        |
| `style.double` | `false`                                | Double-line shaft with a wide head                                       |
| `style.color`  | theme colour                           | Also colours the arrow label                                             |

`bend` and `shift` do not apply to loops; `loop` applies only to loops.

LaTeX is rendered by KaTeX without custom macros. Invalid LaTeX is shown as its source, marked in red, rather than failing the scene.

## The arrow normal

Every arrow has a normal direction `n`, set by `theta`. For the unit chord direction `d` (source to target; `loop.axis` for loops):

```text
n₀ = normalize(ẑ − (ẑ·d) d)        (x̂ if d is vertical)
n  = cos θ · n₀ + sin θ · (d × n₀)
```

So `theta: 0` points "up" for any non-vertical arrow, and positive angles turn right-handedly about `d`. Reversing an arrow reverses its angular orientation: for a pair `f: A → B` and `g: B → A` to bend apart, give them the same `bend` and `theta` values 180° apart. The reference direction jumps for chords near vertical; this is inherent in the convention.

The normal governs:

- **Bend:** the arrow is a quadratic curve whose midpoint is displaced by exactly `bend` along `n`.
- **Label:** anchored at curve parameter `t`, then moved along the projected normal by `offset` reference pixels, measured from the label's edge. Positive is the `n` side, negative the opposite side, and `0` centres the label on the arrow. Text always faces the camera, upright.
- **Shift:** a parallel offset toward the `n` side, measured on screen like tikz-cd's `shift left`. Use it for straight parallel arrows.
- **Hook:** `"hook"` curls toward the `n` side, `"hook'"` toward the opposite side.
- **Loop:** a teardrop in the plane spanned by `axis` and `n`. It departs on the `+axis` side, reaches `2 · radius` along `n`, and returns on the `−axis` side.

"Reference pixels" are screen pixels in diagram sizing, and scale with the projection in spatial sizing (see the [design notes](design.md#sizing)).
