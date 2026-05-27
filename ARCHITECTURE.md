# OpenVGAL Architecture

Technical reference for developers and contributors. For a general overview and quick start, see [README.md](README.md).

---

## Table of Contents

- [Gallery JSON Format](#gallery-json-format)
- [Catalog](#catalog)
- [Layout Algorithm](#layout-algorithm)
- [Viewer Engine](#viewer-engine)
- [Material System](#material-system)
- [Generator and ZIP Flow](#generator-and-zip-flow)
- [Customize Editor](#customize-editor)
- [Preview Mode](#preview-mode)
- [Local Development](#local-development)
- [Path Resolution](#path-resolution)
- [Gallery Styles](#gallery-styles)
- [Templates](#templates)
- [Lighting System](#lighting-system)
- [Creating Custom Templates](#creating-custom-templates)

---

## Gallery JSON Format

OpenVGAL uses a `building_v2.json` file to describe the structure and content of gallery halls. The format supports a single hall or interconnected halls in an arbitrary structure. It always starts with a root gallery hub.

### Level 1: Hall List

The top level lists all halls in the gallery:

```json
{
  "root": { ... },
  "gallery1": { ... },
  "gallery2": { ... },
  "Technical": { ... }
}
```

### Level 2: Hall Properties

Each hall has these fields:

| Field | Required | Description |
|-------|----------|-------------|
| `parent` | Yes | Name of the parent hall. `"none"` for root. |
| `resource` | Yes | GLB filename. If the file exists it loads as a fully designed gallery. Otherwise falls back to `template`. |
| `template` | Yes | Template GLB filename (prefixed `T_`). Used when `resource` doesn't exist. |
| `item_N` | No | Items in the hall (artworks or doors). Keys are arbitrary names. |

```json
"gallery1": {
  "parent": "root",
  "resource": "gallery1.glb",
  "template": "T_pannels.glb",
  "item1": { ... },
  "item2": { ... }
}
```

### Level 3: Items

Each item is either an artwork or a door:

**Door item:**
```json
"gallery1": {
  "resource": "gallery1.glb",
  "resource_type": "door"
}
```

**Artwork item:**
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
| `resource` | Path to the image file (relative to gallery root) or GLB name for doors |
| `resource_type` | `"image"` or `"door"` |
| `width`, `height` | Real-world dimensions in cm. Default longest edge = 120 cm (M bucket). Customize editor presets: S=60, M=120, L=180; max 250. The viewer multiplies by a single global factor (`2.5/120`) to convert cm to babylon scene meters — a 120 cm artwork reads to a viewer like the old 2.5 m default. |
| `location` | `[x, y, z]` position in 3D space. Z is up. |
| `vector` | `[x, y]` normal vector indicating which direction the artwork faces. |
| `metadata` | Text shown when hovering on the artwork. Title and subtitle are separated by `\n` (newline). The subtitle appears on a second line in the overlay and on artwork plaques. |

### Technical Section

The JSON includes a `Technical` section at the bottom:

```json
"Technical": {
  "ambientLight": 0.5,
  "pointLight": 50,
  "verticalPosition": 0.4
}
```

---

## Catalog

`cdn/templates/catalog.json` is the single source for everything the generator needs to lay out a gallery. It replaced the old `cdn/styles/styles.json`.

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
      "glbs": { "small": "T_small.glb", "nopannels": "T_nopannels.glb", "pannels": "T_pannels.glb" }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `shapes.<id>.occupancies` | Pre-extracted strips for each wall/panel side. Each entry: `name`, `center` `[x, y, z]` (world space), `normal` `[x, y, z]` (world unit vector pointing into the room), `width` (along-wall extent in babylon m). |
| `selectionOrder` | Smallest → largest sequence the packer walks when fitting items. The first shape that fits the entire batch wins; otherwise the largest in the list overflows into successive rooms. |
| `minSpacing` | Default minimum gap between consecutive items on a strip, in babylon m. The room/page can override per-call. |
| `styles.<id>` | Visual variant. `root` is the hub-hall GLB; `glbs` maps shape id → exhibition-hall GLB. `thumbnail` (under `cdn/templates/`) is shown by the style picker. |

**Authoring shapes.** The browser tool at [openvgal.com/tools/catalog-manager.html](https://openvgal.com/tools/catalog-manager.html) (source: `site/tools/catalog-manager.html`) drops a GLB, finds every mesh whose name starts with `Occupancy_`, projects each onto its dominant axis using the first vertex normal, and writes the resulting `center` / `normal` / `width` into `shapes.<id>.occupancies`. The matrix UI ticks `(style × shape)` cells so you can ship a partial set; missing entries are silently dropped from `selectionOrder` at packing time.

**Runtime fallback.** If `shapes.<id>.occupancies` is missing or empty, `gallery-generator.js` runs the same probe in a `BABYLON.NullEngine` against the live GLB. This means a freshly authored template works even before the catalog is regenerated — useful in dev — but it adds a one-off GLB load per shape.

---

## Layout Algorithm

`gallery-generator.js` (`packIntoRooms`) is the occupancy-driven packer. The old hardcoded 30×60 rectangle logic is gone; everything reads from `catalog.json` and the `Occupancy_*` strips.

**Inputs per item:** `widthM` (real cm × `2.5/120`), original index, optional metadata.

**Packing pass (per gallery):**
1. For each shape in `selectionOrder` (smallest → largest), call `tryFitItems`. It walks items in order and assigns each to the lowest-density occupancy that can still hold it without exceeding `width` after adding the new item plus `minSpacing` between consecutive items. The first shape that places every item wins.
2. If even the largest shape can't hold the whole batch, `maxPrefixFit` finds the longest in-order prefix that does fit, places it in the largest shape, and recurses on the remainder. Each chunk becomes its own room hung off the previous one.
3. `placeItems` distributes the items along each occupancy with **equal margins and gaps** (`(width − ΣwidthM) / (n + 1)`). When that gap would dip below `minSpacing`, it locks the gap at the floor and centres the pack instead. Position is `center + alongAxis × t` where `alongAxis = normalize(N × Y)`; the world-space row is emitted as `[worldX, worldZ, worldY]` to match the JSON convention.

**Outputs per room:** `{ shape, glbName, occupancies, positions, vectors, indices }`. The generator turns each room into a hall in `building_v2.json`, hangs the door pair, and stamps `width` / `height` in centimetres.

**Why width-aware matters.** Every artwork carries its own real-world width in cm. Mixed-size collections (a 250 cm landscape next to a clutch of 60 cm prints) pack correctly because capacity is `Σwidth + (n−1) × minSpacing ≤ occupancy.width`, not a count.

**Frame yaw.** `room_builder_aux.js` rotates each frame by `atan2(N.x, N.z)` so artworks face into the room at any wall angle, not only the four cardinal directions.

---

## Viewer Engine

The viewer (`viewer.html`) is a Babylon.js application that:

1. Reads `building_v2.json` and creates the root hall
2. For each hall, tries to load the `resource` GLB first. If it doesn't exist, loads the `template` GLB instead.
3. Places artwork textures at positions defined in the JSON using `item_builder()`
4. Creates 3D text labels for room names using `text3D_builder()`
5. Adds door event listeners. Clicking a door loads the connected hall.
6. Keeps previously visited halls in memory for faster return navigation.

**Controls:**
- Keyboard: arrow keys to move, mouse to look
- Touch: 1-finger drag to move forward, 2-finger to rotate
- Click on doors to navigate between halls

**Overlay UI (`overlay.js`):**
- Artwork metadata display on hover
- Navigation arrows for automatic touring
- Help system (English, Spanish, Japanese, Chinese)
- Extensible action buttons (purchase, mint, favorite -- disabled by default)

---

## Material System

OpenVGAL uses Babylon.js node materials stored as JSON files. Templates reference materials by name with the `BJS_` prefix. When a material name starts with `BJS_`, the viewer fetches the JSON from the materials folder instead of using an embedded material.

**Available materials:**

| Material | Use |
|----------|-----|
| `BJS_white` | White frame |
| `BJS_rough_white` | Matte white surfaces |
| `BJS_black_metal` | 3D text labels |
| `BJS_chrome` | Reflective chrome |
| `BJS_glow` | Self-illuminating (logo) |
| `BJS_glow_masked` | Masked glow effect |
| `BJS_rust` | Rusty metallic texture |
| `BJS_default_wall` | Default wall surface |
| `BJS_default_ceiling` | Default ceiling |
| `BJS_default_floor` | Default floor |

**URL rewriting:** Material JSONs reference textures with `http://localhost/materials/` paths. The loader replaces this prefix with an empty string, then uses the actual materials folder as `rootUrl`. This avoids double `materials/materials/` paths.

You can radically change the look of the galleries just by editing or replacing the material JSONs and their textures.

---

## Generator and ZIP Flow

The browser generator at `/create` builds a complete, self-contained deployment package:

1. User drops image folders into the generator (drop-zone wiring lives in `js/gallery-page.js`)
2. Generator fetches `cdn/templates/catalog.json` and the selected style's GLBs
3. Each image is sized at a default 120 cm longest edge (cm preserved in the JSON); the user can adjust per-artwork via the Customize editor before download
4. Layout runs (`packIntoRooms`) using the catalog occupancies — overflow rooms are spawned automatically
5. Packages everything into a ZIP:

```
gallery.zip/
  viewer.html
  babylon.js
  babylonjs.loaders.min.js
  room_builder_aux.js
  declarations.js          (openvgal_location = '.')
  overlay.html
  overlay.js
  overlay.css
  building_v2.json
  templates/
    T_root.glb
    T_pannels.glb
    T_nopannels.glb
    T_small.glb
  materials/
    BJS_*.json
    logo.png
    shadow.png
    concrete-23/
    rust2/
    Wallpaper/
  gallery1/
    image1.jpg
    image2.jpg
  gallery2/
    ...
  icons/
    ...
  README.md
```

The ZIP uses relative paths (`openvgal_location = '.'`). It works in any subfolder on any web server without configuration.

After the user clicks **Download ZIP** (or the JSON-only download), the generator opens `/ready.html?name=<firstRoom>` in a new tab — a lightweight post-save page with a free-hosting walkthrough link, a coming-soon "host it for me" CTA (`/hosting.html`), and Web-Share / X / Facebook / Instagram-caption-copy buttons. The window is opened synchronously inside the click handler so mobile browsers don't drop it as a deferred popup.

---

## Customize Editor

`site/create/customize.html` and `site/create/customize.js` are loaded on demand the first time the user clicks **Customize** in the generator. The editor mounts inside the result section, hides the rest of the page while open, and operates on a deep copy of the generated JSON so cancel-equivalent flows (close without re-laying-out) leave the underlying state untouched.

Per-artwork it exposes:
- Title and subtitle, written back into `metadata` as `"<title>\n<subtitle>"` (the existing `ID #N` prefix is preserved so plaque and overlay code keep working).
- Size: S / M / L bucket buttons (60 / 120 / 180 cm longest edge) plus a free slider, capped at 250 cm. Display unit toggles between cm and inches; aspect ratio is preserved from the source image.

Sizes are stored as cm strings in `width` / `height`. Re-laying-out after a size change calls `relayoutRoom` which feeds the same `packIntoRooms` packer and emits new `location` / `vector` strings.

---

## Preview Mode

The generator's Preview button opens an iframe to `../viewer.html?preview=iframe`. When the viewer detects the `preview=iframe` parameter, it reads configuration and blob URLs from `window.parent` instead of fetching files from disk:

- `window.parent.openvgal_buildingJSON` -- The generated JSON
- `window.parent.openvgal_fileMap` -- Map of image filenames to blob URLs
- `window.parent.openvgal_preview_mode` -- Signals preview mode

This allows live preview without writing any files.

---

## Local Development

Add `?dev=1` to the viewer URL to skip the ZIP / generator round-trip and load the checked-in fixture directly.

1. From the repo root, run any static file server (e.g. `python -m http.server 8080`).
2. Open `http://localhost:8080/site/viewer.html?dev=1`.

The `?dev=1` switch sets:

- `window.openvgal_location = '/examples'` -- viewer reads `/examples/building_v2.json` and image folders directly
- `window.openvgal_cdn_base = '/cdn'` -- templates and materials come from the local `cdn/` folder (NOT the deployed CDN)

`overlay.js` fetches `cdn_base + '/core/overlay.html'` first and falls back to local `overlay.html` if that 404s. `cdn/core/` is built by CI and is absent locally, so the fallback is what makes dev mode work end-to-end.

Edit any file under `site/`, `cdn/`, or `examples/` and refresh the browser -- no ZIP, no second server, no generator UI. Same code paths as production; only the source URLs change.

### Generator dev mode

`create/index.html?dev=1` applies the same trick to the generator: `CDN_BASE` is rewritten to `/cdn` so style picker, ZIP bundler, and `extractOccupanciesFromGLB` all read from the local `cdn/` folder. The preview iframe inherits `openvgal_cdn_base` from `window.parent`, so the rendered scene also uses your local templates.

```
http://localhost:8080/site/create/index.html?dev=1
```

Use this when iterating on `Occupancy_*` planes, fixture geometry, materials, or any other template-time asset that the generator consumes before the viewer ever runs. Workflow: edit `cdn/templates/*.glb` in Blender → save → drop image folders into the generator → Build → Preview. No upload to the deployed CDN.

Caveat: a ZIP downloaded with `?cdn=1&dev=1` (CDN-output mode in dev) bakes `CDN_BASE = '/cdn'` into the thin-client output and won't work outside dev. Use `?cdn=1` alone (no `?dev=1`) when producing a real CDN ZIP.

---

## Path Resolution

`declarations.js` controls where the viewer looks for assets:

| Variable | Default (online) | Default (ZIP) | Description |
|----------|------------------|---------------|-------------|
| `window.openvgal_location` | `.` | `.` | Base path for `building_v2.json` and images |
| `window.openvgal_cdn_base` | `https://cdn.openvgal.com` | (empty or `.`) | Base URL for templates and materials |

When running from a ZIP, the CDN base is overridden to use local files. The viewer checks for local templates/materials first using a `doesFileExist()` call that checks for 2xx status (not just "not 404") to handle cross-origin correctly.

---

## Gallery Styles

OpenVGAL ships with three visual styles. Each style is a coordinated set of templates (root hub, panels room, no-panels room, small room) with matching materials and lighting settings baked into the GLB files. Styles live in `cdn/templates/catalog.json` under the top-level `styles` key (see [Catalog](#catalog) for the full schema):

| Style | Description | Root Template |
|-------|-------------|---------------|
| **Classic** | Mix of modern and classic materials | `T_root.glb` |
| **Minimalist** | Clean lines, white walls, even lighting | `T_root_minimalist.glb` |
| **Dark** | Dark walls, backlight-style frames | `T_root_dark.glb` |

Each style maps every shape id in `selectionOrder` to a GLB:

```json
"dark": {
  "name": "Dark",
  "description": "Dark walls, backlight type of frames",
  "thumbnail": "dark_thumb.jpg",
  "root": "T_root_dark.glb",
  "glbs": {
    "small": "T_small_dark.glb",
    "nopannels": "T_nopannels_dark.glb",
    "pannels": "T_pannels_dark.glb"
  }
}
```

The generator reads the selected style and passes the correct template filename for each chosen shape into the layout algorithm. The viewer doesn't know about styles — it just loads whichever template filename is in `building_v2.json`.

---

## Templates

Each style includes four room templates:

| Template role | Classic | Minimalist | Dark |
|---------------|---------|------------|------|
| Root hub | `T_root.glb` | `T_root_minimalist.glb` | `T_root_dark.glb` |
| Panels room | `T_pannels.glb` | `T_pannels_minimalist.glb` | `T_pannels_dark.glb` |
| No-panels room | `T_nopannels.glb` | `T_nopannels_minimalist.glb` | `T_nopannels_dark.glb` |
| Small room | `T_small.glb` | `T_small_minimalist.glb` | `T_small_dark.glb` |

All templates are Babylon.js-compatible GLB files with:

- Door meshes named `d_0`, `d_1`, etc.
- One or more `Occupancy_*` planes per wall/panel side that artworks can hang on (see [Catalog](#catalog) for how their `center` / `normal` / `width` are extracted). Without these, the layout algorithm has nowhere to place items.
- Optional embedded lighting configuration (see [Lighting System](#lighting-system)).

---

## Lighting System

Lighting is managed by `openvgal-lighting.js`. The system has three types of lights: ambient hemispheric lights (one at the top, one at the bottom), point lights and RectAreaLights. The total maximum number of lights is 12 (this is a hard limitation).
1. ambient lights will always be created
2. point lights will only be implemented if they exist in the template, and at the location set in the template.
3. RectAreaLights will only be implemented if they exist in the template, and at the location set in the template.


### Initialization

When the scene is created, `initGalleryLighting()` creates two hemispheric lights (`hemiLight_up` pointing up, `hemiLight_down` pointing down) with intensities from `Technical.ambientLight` in `building_v2.json`. The down light is set to half the up light intensity. These are default values in case that the templates do not have the lighting setup.

### Implementation in the glb templates

### Ambient light empties

Templates can override the default ambient light intensities by including empty objects with specific names:

| Empty name | Controls |
|------------|----------|
| `ambientLightUp_I{value}` | Upper hemispheric light intensity |
| `ambientLightDown_I{value}` | Lower hemispheric light intensity |

The value is a float parsed from the name. For example, an empty named `ambientLightUp_I0.3` sets the upper ambient to 0.3. An empty named `ambientLightDown_I0` turns off the lower ambient entirely (useful for the Dark style). Name matching is case-insensitive.

If these empties are not present in the template, the ambient lights keep their values from `Technical.ambientLight`.

### Point lights
Any light in the GLB whose name starts with `pointLight` gets its intensity set. If the name contains `_I{value}` (e.g. `pointLight_I80`), that value is used. Otherwise it falls back to `Technical.pointLight`. 

### RectAreaLight fixtures

RectAreaLights are defined by placing flat mesh objects in the Blender scene. These planes will typically have the BJS_glow material to visualize the lights in the render. In addition to visualizing (simulating it), a Rectangular area light is created at that location and size.
The mesh name encodes the orientation of the light and the intensity:

```
F_{N}_{dx}_{dy}_{dz}_I{intensity}
```

| Segment | Description |
|---------|-------------|
| `F` | Fixture prefix (required) |
| `{N}` | Fixture index number (e.g. `0`, `1`, `2`) |
| `{dx}` | X component of light direction in **Blender** coordinates |
| `{dy}` | Y component of light direction in **Blender** coordinates |
| `{dz}` | Z component of light direction in **Blender** coordinates |
| `I{intensity}` | Light intensity (optional, defaults to 0) |

Think of (dx,dy,dz) as a vector guiding the orientation of the rectangular light.

**Direction values:** Use plain numbers for positive values, prefix with `n` for negative. For example, `n1` means -1.

**Coordinate conversion:** Blender uses (X, Y, Z) while Babylon.js uses (X, Z, Y). The code handles this automatically: `Blender (bx, by, bz) → Babylon (bx, bz, by)`.

**Examples:**

| Blender empty name | Meaning |
|--------------------|---------|
| `F_0_0_0_n1_I50` | Fixture 0, pointing straight down (Blender -Z → Babylon -Y), intensity 50 |
| `F_1_1_0_0_I30` | Fixture 1, pointing in Blender +X direction, intensity 30 |
| `F_2_n1_0_0_I40` | Fixture 2, pointing in Blender -X direction, intensity 40 |


### Material freezing

After lights are created and materials are assigned, `freezeGalleryMaterials()` freezes all `BJS_` node materials. This must happen **after** all RectAreaLights are created — freezing before lights are set up locks in the wrong shader defines and rect lights will have no effect.

### Putting it together in Blender

To set up lighting for a custom template:

1. **Ambient:** Add two empties named `ambientLightUp_I{value}` and `ambientLightDown_I{value}`. Position doesn't matter, only the name.
2. **Point lights:** Add point lights named `pointLight` (uses JSON fallback) or `pointLight_I{value}` (explicit intensity).
3. **RectAreaLights:** Model flat rectangular meshes where you want area lights. Name them `F_{N}_{dx}_{dy}_{dz}_I{intensity}`. The mesh shape defines the light's width and depth. The mesh position defines the light's position. The name encodes the direction and intensity.
4. **Export** as GLB. Empties become TransformNodes, meshes and lights are preserved.

---

## Creating Custom Templates

You can create your own GLB templates to change the look of the galleries.

### Hub Hall Templates

Requirements:
- Door meshes named `d_0`, `d_1`, etc. (single-plane meshes preferred)
- Materials: either embedded or prefixed `BJS_` for server-side loading
- Lighting objects (see [Lighting System](#lighting-system)):
  - Point lights named `pointLight` or `pointLight_I{value}`
  - (Optional) Empties named `ambientLightUp_I{value}` and `ambientLightDown_I{value}` to override ambient
  - (Optional) Flat meshes named `F_{N}_{dx}_{dy}_{dz}_I{intensity}` for RectAreaLights

If the template has more than 10 doors, modify the `doors_root` variable in the layout code.

### Exhibition Hall Templates

Requirements:
- Same door, material, and lighting requirements as hub halls
- One or more `Occupancy_*` planes that mark hangable strips. Each plane's first vertex normal must point into the room; its longest extent in local axes is taken as the strip width. Add the new template to `cdn/templates/catalog.json` (or use the [catalog manager](https://openvgal.com/tools/catalog-manager.html)) so the packer picks it up.
- An entry under `selectionOrder` if you want it considered automatically. Order matters: smallest → largest.

### Full Gallery GLBs

OpenVGAL supports loading a fully pre-designed `.glb` file as the `resource` field. In this case the template is bypassed and the GLB is rendered as-is. This enables high-quality rendering with baked textures and custom lighting.

---

## Key Technical Notes

- **`file://` protocol does not work** in Chrome due to cross-origin iframe restrictions. Always use an HTTP server for local development.
- **Cross-origin checks:** `doesFileExist()` checks for 2xx status (not just "not 404") to work correctly across origins.
- **`overlay.html`** is fetched at runtime by `overlay.js` and must be included in any deployment.
- **Image formats supported:** jpg, jpeg, png, tif, tiff, webp.
