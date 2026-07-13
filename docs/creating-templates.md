# Creating Custom Templates

A **template** is a GLB file that defines the shell of a gallery room — walls, floor, ceiling, doors, lighting, and the strips where artwork can hang. The viewer loads a template and furnishes it at runtime with the artworks listed in [`building_v2.json`](gallery-json.md). Author templates in Blender (or any tool that exports glTF/GLB) following the mesh naming conventions below. You would typically create them in Blender or a similar tool.

← Back to [Architecture index](../ARCHITECTURE.md)

---

## Three kinds of GLB

| Kind | Role | Furnished at runtime? |
|------|------|-----------------------|
| **Hub template** (`T_root*`) | The gallery entrance — a hub with doors to other halls. | Yes (doors, lighting) |
| **Exhibition template** (`T_small`, `T_nopannels`, `T_pannels`, …) | A room where artworks hang on `Occupancy_*` strips. | Yes (artworks, doors, lighting) |
| **Full gallery GLB** | A complete, hand-designed hall loaded via the `resource` field. | **No** — rendered exactly as authored. |

In general it is convenient to have rooms of different capacities and choose accordingly. v3 introduced styles where you can have a catalog of rooms with a certain style. The first two are reusable *templates* selected by the generator. The third is a one-off, covered in [Full gallery GLBs](#full-gallery-glbs).

---

## Naming convention

Templates follow `T_<shape>_B.glb` for the default style and `T_<shape>_<style>_B.glb` for others. Each style ships a complete set — one GLB per shape in the catalog's `selectionOrder`, plus a root hub. 

| Shape (role) | Example (classic) | Example (dark) |
|--------------|-------------------|----------------|
| Root hub | `T_root_B.glb` | `T_root_dark_B.glb` |
| `small` room | `T_small_B.glb` | `T_small_dark_B.glb` |
| `nopannels` room | `T_nopannels_B.glb` | `T_nopannels_dark_B.glb` |
| `pannels` room | `T_pannels_B.glb` | `T_pannels_dark_B.glb` |

> Filenames are just keys in `catalog.json` — the viewer loads whatever filename the JSON names. The `small` / `nopannels` / `pannels` shape ids are conventions from the shipped styles, not hard-coded; you can define your own shapes. See [Styles](#registering-a-style).

---

## ESSENTIAL ELEMENTS. 

## Required meshes

### Architectureal elements

- Use any name except the reserved ones that you will see below.
- Meshes must be UV unwrapped with 2 UV maps (you can simply duplicate them)

### Starting poing `Start`

- Where the camera sets at creation time.

### Doors — `d_0`, `d_1`, `d_2`, …

- Sequential, single-plane meshes positioned at each doorway.
- The viewer renames them at runtime (`d_<roomName>_N`) and attaches click handlers that navigate to the connected hall.
- If a template has **more than 10 doors**, raise the `doors_root` limit in the layout code.
- They are meant to be invisible or transparent, not real doors.

### Occupancy strips — `Occupancy_0`, `Occupancy_1`, … (exhibition templates only)

These flat planes mark where artwork can hang. One plane per wall or panel side or in the air (is up to you).

- The plane's **first vertex normal must point into the room** — this becomes the artwork facing direction.
- Its **longest local extent is taken as the strip width** (the along-wall length available for hanging).
- Hidden at runtime.

Without any `Occupancy_*` planes, an exhibition template has nowhere to place artwork and the layout algorithm can't use it. The generator extracts each strip's `center` / `normal` / `width`; see [Layout & Catalog](layout-and-catalog.md) for the exact projection.

### Materials — `BJS_` prefix

- Meshes can use embedded materials, or reference a Babylon node material by name with the `BJS_` prefix (e.g. `BJS_rough_white`).
- When a material name starts with `BJS_`, the viewer fetches the matching JSON from the materials folder instead of using the embedded material. See [Viewer & Runtime → Material System](viewer-runtime.md#material-system).
- PBR materials on walls and floors give the softest result under the baked lightmaps.

---

## Lighting

Lighting is authored entirely as **named objects inside the GLB** — no Babylon light code. In v4 the viewer *bakes* these into per-surface lightmaps when the room loads, then freezes the materials; the fixture meshes stay in the scene as decorative bulbs. USE ONLY these "lights", all ohers will be rejected. The bake reads three inputs:

| Object | Name pattern | Purpose |
|--------|--------------|---------|
| Ambient empties | `ambientLightUp_I{value}`, `ambientLightDown_I{value}` | Override the hemispheric ambient intensities. |
| Spot lights | `splash_{N}` or `splash_{N}_I{value}_R{range}` | A spot light numbered; intensity from the name or the JSON fallback. The angle is taken from the light object property. Range is optional |
| Fixtures | `F_{N}_{dx}_{dy}_{dz}_I{intensity}` | A rectangular area light — position, size, direction, and intensity all from the mesh. |
| Sun | `sun_{N}_I{intensity}` | A spot light with unlimited range. |

The full naming spec, coordinate conversion for the direction vector, and the bake behaviour are in the [Lighting](lighting.md) reference. The short version for authoring:

1. **Ambient:** add two empties, `ambientLightUp_I{value}` and `ambientLightDown_I{value}`. Position is irrelevant — only the name matters. Omit them to inherit `Technical.ambientLight` from the JSON.
2. **Spot lights or Sun:** add spot lights named `splash` or `sun` .
3. **Fixtures:** model flat rectangles where you want area lights and name them `F_{N}_{dx}_{dy}_{dz}_I{intensity}`. The mesh shape sets the light's width and depth; its position sets the light's position; the name encodes the aim direction (Blender coordinates, `n` prefix = negative) and intensity. Give them the `BJS_glow` material so the bulb reads as a glowing fixture.

---

## Coordinate system (Blender → Babylon)

Blender is Z-up; Babylon is Y-up. glTF export swaps Y and Z for you, but you must account for it when reading names and authoring the JSON.

- **World:** Blender `(bx, by, bz)` → Babylon `(bx, bz, by)`. Only the X axis is unchanged.
- **Artwork `location`** in the JSON is `[x, y, z]` with **Z up** — swapped from Babylon world coords.
- **Artwork `vector`** in the JSON is `[x, y]` — the floor-plane normal the artwork faces.
- **Fixture aim** in an `F_` name is a Blender-space vector; the code converts it the same way.

See [gallery-json.md → Coordinate conventions](gallery-json.md#coordinate-conventions) for the JSON side.

---

## Registering a style

Templates are discovered through `cdn/templates/catalog.json`. A **style** is a named set of templates (root hub + one GLB per shape). To add one:

1. **Pick a style key** — lowercase, no spaces (e.g. `zen`).
2. **Author every GLB** the style needs: a root hub and one per shape in `selectionOrder`, following the mesh conventions above.
3. **Create any new materials** (`BJS_*.json` + textures) under `cdn/materials/`.
4. **Add a thumbnail** (JPG, a corner shot of a furnished room) under `cdn/templates/`.
5. **Register the style** in `cdn/templates/catalog.json`:

   ```json
   "zen": {
     "name": "Zen",
     "description": "Wood and paper, soft diffuse light",
     "thumbnail": "zen_thumb.jpg",
     "root": "T_root_zen_B.glb",
     "glbs": {
       "small": "T_small_zen_B.glb",
       "nopannels": "T_nopannels_zen_B.glb",
       "pannels": "T_pannels_zen_B.glb"
     }
   }
   ```

6. **Extract occupancies** for each new template. Either use the [Catalog Manager](https://openvgal.com/tools/catalog-manager.html) (drop a GLB, tick the `style × shape` cells, export) so the strips are precomputed into `shapes.<id>.occupancies`, or leave them empty and let the viewer probe the GLB at runtime (fine for dev, adds a one-off load per shape).
7. **Bundle new materials** — add any new `BJS_*` names to the ZIP bundler list in `site/create/index.html` so self-contained ZIPs include them.

The generator reads the selected style and passes the right template filename per chosen shape into the layout algorithm. The viewer never sees styles — it just loads whatever filename ends up in `building_v2.json`.

See [Layout & Catalog](layout-and-catalog.md) for the full `catalog.json` schema (`shapes`, `selectionOrder`, `minSpacing`, `styles`).


---

## Blender workflow (checklist)

1. Model the room shell (walls, floor, ceiling) and assign `BJS_` or embedded materials.
2. Add door planes named `d_0`, `d_1`, …
3. (Exhibition rooms) Add `Occupancy_*` planes on each hangable side, first-vertex normal pointing into the room.
4. Add lighting objects: ambient empties, `splash_*`, and `F_*` fixtures (see [Lighting](lighting.md)).
5. Export as **GLB**. Empties become TransformNodes; meshes and lights are preserved.
6. Register the template in `catalog.json` and extract occupancies (Catalog Manager or runtime probe).
7. Test in [dev mode](generator.md#local-development) with `?dev=1` — no upload needed.

---

## See also

- [Lighting](lighting.md) — full light-naming spec and the v4 bake.
- [Layout & Catalog](layout-and-catalog.md) — `catalog.json` schema and the packer.
- [Gallery JSON Format](gallery-json.md) — what the furnished output looks like.
