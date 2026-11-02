# c3d

A viewer for commutative diagrams laid out in 3D. Diagrams keep a tikz-cd/fletcher appearance (upright KaTeX labels, Computer Modern style arrow tips, crossing gaps) while the camera moves freely through them.

Status: a read-only viewer for handwritten JSON scenes. An editor comes later; LaTeX/Typst export is out of scope for now.

## Running

Requires Node.js and [pnpm](https://pnpm.io/).

```sh
pnpm install
pnpm dev          # local server with the viewer
pnpm test         # unit tests
pnpm lint         # oxlint
pnpm fmt          # oxfmt (pnpm fmt:check to verify only)
pnpm build        # typecheck and production build
```

Example scenes live in `public/examples/` and are listed in `public/examples/index.json`. Open one directly with `?example=cube`, or load a local file with **Open JSON…**.

## Controls

| Input           | Action                                                                    |
| --------------- | ------------------------------------------------------------------------- |
| `W` `A` `S` `D` | Fly within world XY, relative to the camera heading                       |
| `Q` `E`         | Down / up along world Z                                                   |
| Left drag       | Orbit around the pivot (the focused node or arrow, otherwise the origin)  |
| Right drag      | Turn the camera in place (yaw and pitch, no roll)                         |
| Scroll          | Zoom; dollies toward the pivot in perspective, scales in orthographic     |
| Click           | Focus a node (its position) or an arrow (its curve midpoint) as the pivot |
| `Esc`           | Clear focus                                                               |
| `P`             | Perspective / orthographic, preserving the apparent scale at the pivot    |
| `O`             | Oblique preset (an angled orthographic view)                              |
| `1` `2` `3`     | Front / top / side view                                                   |
| `G`             | Diagram / spatial sizing                                                  |
| `N`             | Stored / view-snapped normals                                             |
| `[` `]`         | Overall size                                                              |
| `F` / `R`       | Fit scene / reset view                                                    |
| `H` or `?`      | Toggle the key reference                                                  |

Presets and reset re-fit the whole scene.

## Documentation

- [Scene format](docs/format.md): the JSON format, including the arrow normal convention.
- [Design notes](docs/design.md): rendering and interaction decisions, and what is deliberately left out.

## Acknowledgements

c3d is inspired by [quiver](https://github.com/varkor/quiver) by varkor (MIT License), a 2D commutative diagram editor. c3d contains no quiver code; hooks on double arrows are drawn following quiver's approach.

## License

[MIT](LICENSE)
