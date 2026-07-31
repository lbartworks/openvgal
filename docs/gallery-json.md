# Gallery JSON Format

`building_v2.json` is the single file that describes a gallery: its rooms, how they connect, and what hangs on the walls. Everything the viewer renders comes from this file (plus the GLB templates and materials it references).

← Back to [Architecture index](../ARCHITECTURE.md)

---

## Mental model

A gallery is a **tree of halls**. There is always one **root hub** (`parent: "none"`); every other hall hangs off a parent via a door. Each hall either:

- loads a **fully designed GLB** (its `resource`), rendered as-is, or
- falls back to a **template GLB** (`template`) that the viewer furnishes at runtime with the artworks listed in the JSON.

The file has three nesting levels:

```
{ hall: { item: { ...fields } } }
  │       │
  │       └─ Level 3 — items (artworks or doors)
  └───────── Level 2 — hall properties
────────────  Level 1 — the hall list
```

---

## Level 1 — Hall list

The top level is a flat map of hall name → hall object. Order is not significant; the tree is reconstructed from each hall's `parent`.

```json
{
  "root":     { "parent": "none", ... },
  "gallery1": { "parent": "root", ... },
  "gallery2": { "parent": "gallery1", ... },
  "Technical": { ... }
}
```

`Technical` is a reserved key (see [Technical section](#technical-section)); every other key is a hall.

---

## Level 2 — Hall properties

| Field | Required | Description |
|-------|----------|-------------|
| `parent` | Yes | Name of the parent hall. `"none"` for the root hub. |
| `resource` | Yes | GLB filename for a fully designed hall. If the file exists it loads as-is and the template is bypassed. If it doesn't exist, the viewer falls back to `template`. |
| `template` | Yes | Template GLB filename (prefixed `T_`), used when `resource` is absent. See [Creating Custom Templates](creating-templates.md). |
| `item_N` | No | Items in the hall — artworks or doors. Keys are arbitrary; only the `item`-vs-door distinction matters (via `resource_type`). |

```json
"gallery1": {
  "parent": "root",
  "resource": "gallery1.glb",
  "template": "T_pannels.glb",
  "item1": { ... },
  "item2": { ... }
}
```

> **resource vs template.** `resource` is tried first. This is what lets a gallery ship either as auto-furnished template rooms *or* as hand-designed GLBs, without changing the viewer. A missing `resource` GLB is not an error — it's the signal to furnish the `template`.

---

## Level 3 — Items

Every item is either an **artwork** or a **door**, distinguished by `resource_type`.

### Door item

A door connects the current hall to another hall. The `resource` names the destination hall's GLB; clicking the door in the viewer loads that hall.

```json
"gallery1": {
  "resource": "gallery1.glb",
  "resource_type": "door"
}
```

### Artwork item

```json
"item1": {
  "resource": "gallery1/photo.jpg",
  "resource_type": "image",
  "width": 120.00,
  "height": 88.80,
  "location": [15.0, -14.6, 2.0],
  "vector": [-1.0, 0.0],
  "metadata": "Beach bike"
}
```

| Field | Description |
|-------|-------------|
| `resource` | Path to the image file, relative to the gallery root (e.g. `room/image.jpg`). For doors, the destination GLB name instead. |
| `resource_type` | `"image"` for artwork, `"door"` for a doorway. |
| `width`, `height` | Real-world dimensions in **centimetres**. See [Sizes and units](#sizes-and-units). |
| `location` | `[x, y, z]` position. **Z is up** in this file. See [Coordinate conventions](#coordinate-conventions). |
| `vector` | `[x, y]` normal — the vector to indicate from what direction should be visible. |
| `metadata` | Hover/plaque text. Title and subtitle are split on `\n`. |

Supported image formats: `jpg`, `jpeg`, `png`, `webp`.

---

## Sizes and units

`width` / `height` are stored in **real-world centimetres**, not normalized units.

- Default longest edge is **120 cm** (the "M" bucket). The Customize editor offers **S = 60**, **M = 120**, **L = 180**, plus a free slider capped at **250 cm**.
- The viewer converts cm → Babylon scene metres with a single global factor of **`2.5 / 120`**. So a 120 cm artwork renders at the same on-screen size as the old 2.5 m default, and every other size scales proportionally.
- Aspect ratio is preserved from the source image; the editor sets the longest edge and derives the other dimension.

> **Migrating pre-3.4 files:** older galleries stored `width`/`height` as normalized values (longest edge = `1.00`). Those render at ~2.5 cm in a 3.4+ viewer. Rescale them with the [migration tool](https://openvgal.com/tools/migrate-pre34.html).

---

## Coordinate conventions

This is the most common source of confusion, because the JSON and the Babylon scene use different axis orders.

- **`location` is `[x, y, z]` with Z up.** In the Babylon scene, Y is up. The viewer maps JSON `[x, y, z]` → Babylon world `{ x, y: z, z: y }` (y and z are swapped).
- **`vector` is `[x, y]`** — the horizontal (floor-plane) normal the artwork faces. The frame is yawed by `atan2(vector.x, vector.y)` so artworks face into the room on walls at any angle, not only the four cardinal directions.

When a template is furnished automatically, the generator writes both of these for you from each `Occupancy_*` strip (see [Layout & Catalog](layout-and-catalog.md)). You only hand-author `location` / `vector` when placing artwork in a bespoke GLB.

---

## Metadata: title and subtitle

`metadata` is a single string. A newline (`\n`) separates the **title** from the **subtitle**:

```json
"metadata": "Beach bike\nOil on canvas, 2021"
```

- The title shows in the hover overlay and on the artwork plaque.
- The subtitle appears on a second line in both places.
- The generator may prefix an `ID #N` token; the Customize editor preserves it so plaque and overlay code keep working.

---

## Technical section (currently obsolete)

A reserved `Technical` block carries gallery-wide defaults. These are fallbacks — templates can override the ambient values via named empties (see [Lighting](lighting.md)).

```json
"Technical": {
  "ambientLight": 0.5,
  "pointLight": 50,
  "verticalPosition": 0.4
}
```

| Field | Description |
|-------|-------------|
| `ambientLight` | Default intensity for the hemispheric ambient lights. The lower hemisphere defaults to half this value. |
| `pointLight` | Default intensity for template point lights that don't encode their own `_I{value}`. |
| `verticalPosition` | Vertical placement hint used during layout. |

---

## Worked example

A minimal two-hall gallery: a root hub with one door into a room that holds two images.

```json
{
  "root": {
    "parent": "none",
    "resource": "root.glb",
    "template": "T_root.glb",
    "gallery1": {
      "resource": "gallery1.glb",
      "resource_type": "door"
    }
  },
  "gallery1": {
    "parent": "root",
    "resource": "gallery1.glb",
    "template": "T_pannels.glb",
    "item1": {
      "resource": "gallery1/photo1.jpg",
      "resource_type": "image",
      "width": 120.0, "height": 88.8,
      "location": [15.0, -14.6, 2.0],
      "vector": [-1.0, 0.0],
      "metadata": "Beach bike\nOil on canvas"
    },
    "item2": {
      "resource": "gallery1/photo2.jpg",
      "resource_type": "image",
      "width": 60.0, "height": 90.0,
      "location": [10.0, -14.6, 2.0],
      "vector": [-1.0, 0.0],
      "metadata": "Harbour"
    }
  },
  "Technical": {
    "ambientLight": 0.5,
    "pointLight": 50,
    "verticalPosition": 0.4
  }
}
```

You almost never write this by hand — the [generator](generator.md) produces it from your image folders. Author it directly only for full control over placement.

---

## See also

- [Layout & Catalog](layout-and-catalog.md) — how the generator turns image folders into the item positions above.
- [Creating Custom Templates](creating-templates.md) — the GLBs that `template` / `resource` point at.
- [Viewer & Runtime](viewer-runtime.md) — how the viewer reads this file and resolves paths.
