# Layout & Catalog

How the generator decides which room shapes to use and where each artwork hangs. Two pieces: the **catalog** (`catalog.json`, the data) and the **packer** (`gallery-generator.js`, the algorithm).

← Back to [Architecture index](../ARCHITECTURE.md)

---

## Catalog

`cdn/templates/catalog.json` is the single source of everything the generator needs to lay out a gallery. It replaced the old `styles.json`.

```json
{
  "shapes": {
    "small":     { "occupancies": [ ... ] },
    "nopannels": { "occupancies": [ ... ] },
    "pannels":   { "occupancies": [ ... ] }
  },
  "selectionOrder": ["small", "nopannels", "pannels"],
  "minSpacing": 0.5,
  "styles": {
    "classic": {
      "name": "Classic",
      "description": "Mix of modern and classic materials",
      "thumbnail": "classic_thumb.jpg",
      "root": "T_root.glb",
      "rootDoors": 10,
      "glbs": { "small": "T_small.glb", "nopannels": "T_nopannels.glb", "pannels": "T_pannels.glb" }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `shapes.<id>.occupancies` | Pre-extracted strips for each wall/panel side. Each entry: `name`, `center` `[x, y, z]` (world space), `normal` `[x, y, z]` (world unit vector pointing into the room), `width` (along-wall extent in Babylon m). |
| `selectionOrder` | Smallest → largest sequence the packer walks when fitting items. The first shape that fits the whole batch wins; otherwise the largest overflows into successive rooms. |
| `minSpacing` | Default minimum gap between consecutive items on a strip, in Babylon m. A room/page can override per call. |
| `styles.<id>` | Visual variant. `root` is the hub-hall GLB; `glbs` maps shape id → exhibition-hall GLB; `thumbnail` (under `cdn/templates/`) is shown by the style picker. |
| `styles.<id>.rootDoors` | How many `d_*` door meshes the style's `root` GLB has — the hub's door budget. See [Hub capacity](#hub-capacity) below. |

**Authoring shapes.** The [Catalog Manager](https://openvgal.com/tools/catalog-manager.html) (source: `site/tools/catalog-manager.html`) drops a GLB, finds every mesh named `Occupancy_*`, projects each onto its dominant axis using the first vertex normal, and writes `center` / `normal` / `width` into `shapes.<id>.occupancies`. Its matrix UI ticks `(style × shape)` cells, so a partial set can ship — missing entries drop out of `selectionOrder` at packing time.

Dropping a **root** GLB does the other job: the manager counts its `d_*` meshes and writes `rootDoors` onto every style that names that file as its `root`. Export warns (and asks for confirmation) if any style is still missing the field, so a new style cannot ship without one.

**Runtime fallback.** If `shapes.<id>.occupancies` is missing or empty, `gallery-generator.js` runs the same probe in a `BABYLON.NullEngine` against the live GLB. A freshly authored template therefore works before the catalog is regenerated (handy in dev), at the cost of a one-off GLB load per shape.

---

## Hub capacity

Top-level galleries hang off the hub (`root`). `rootDoors` is how many doors that hub has, and therefore how many rooms it can reach:

- The **first hub** carries `rootDoors − 1` galleries plus one door onward to the next hub.
- Each **chained hub** (`root#1`, `root#2`, …) carries `rootDoors − 2`, spending one door going back as well.

Overflow beyond that chains another hub automatically. What *doesn't* work is overflow beyond the doors that physically exist in the GLB: `room_builder_aux.js` renames every surplus door to `dummydoor`, so those rooms exist in `building_v2.json` and are unreachable in the scene — a console line and nothing else.

**Why declare it rather than probe.** `gallery-generator.js` reads `styleEntry.rootDoors` first. Without it, it loads the root GLB in a `NullEngine` just to count doors (`countDoorsInGLB`), and if that fetch fails it assumes `DEFAULT_DOORS_ROOT` — 10 — which is simply wrong for any hub built with fewer. Declaring the number makes hub capacity knowable from the catalog alone, with no model download and no guess. The probe stays as the fallback for catalogs written before the field existed.

---

## Layout algorithm

`gallery-generator.js` (`packIntoRooms`) is the occupancy-driven packer. The old hardcoded 30×60 rectangle logic is gone; everything reads from `catalog.json` and the `Occupancy_*` strips.

**Inputs per item:** `widthM` (real cm × `2.5/120`), original index, optional metadata.

**Packing pass (per gallery):**

1. For each shape in `selectionOrder` (smallest → largest), call `tryFitItems`. It walks items in order and assigns each to the lowest-density occupancy that can still hold it without exceeding `width` after adding the item plus `minSpacing` between consecutive items. The first shape that places every item wins.
2. If even the largest shape can't hold the whole batch, `maxPrefixFit` finds the longest in-order prefix that does fit, places it in the largest shape, and recurses on the remainder. Each chunk becomes its own room, hung off the previous one.
3. `placeItems` distributes items along each occupancy with **equal margins and gaps** (`(width − Σ widthM) / (n + 1)`). When that gap would dip below `minSpacing`, it locks the gap at the floor and centres the pack instead. Position is `center + alongAxis × t`, where `alongAxis = normalize(N × Y)`; the world-space row is emitted as `[worldX, worldZ, worldY]` to match the JSON convention.

**Outputs per room:** `{ shape, glbName, occupancies, positions, vectors, indices }`. The generator turns each room into a hall in `building_v2.json`, hangs the door pair, and stamps `width` / `height` in centimetres.

**Why width-aware matters.** Every artwork carries its own real-world width in cm. Mixed-size collections (a 250 cm landscape next to a clutch of 60 cm prints) pack correctly because capacity is `Σ width + (n − 1) × minSpacing ≤ occupancy.width`, not a simple item count.

**Frame yaw.** `room_builder_aux.js` rotates each frame by `atan2(N.x, N.z)` so artworks face into the room on walls at any angle, not only the four cardinal directions.

---

## See also

- [Creating Custom Templates](creating-templates.md) — authoring the `Occupancy_*` strips the packer consumes.
- [Gallery JSON Format](gallery-json.md) — the `location` / `vector` output the packer produces.
- [Generator & ZIP Flow](generator.md) — where `packIntoRooms` runs in the build pipeline.
