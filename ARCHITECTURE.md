# OpenVGAL Architecture

Technical reference for developers and contributors. For a general overview and quick start, see [README.md](README.md).

---

## Table of Contents

- [Gallery JSON Format](#gallery-json-format)
- [Layout Algorithm](#layout-algorithm)
- [Viewer Engine](#viewer-engine)
- [Material System](#material-system)
- [Generator and ZIP Flow](#generator-and-zip-flow)
- [Preview Mode](#preview-mode)
- [Path Resolution](#path-resolution)
- [Templates](#templates)
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
  "width": 1.00,
  "height": 0.74,
  "location": [15.0, -14.6, 2.0],
  "vector": [-1.0, 0.0],
  "metadata": "Beach bike"
}
```

| Field | Description |
|-------|-------------|
| `resource` | Path to the image file (relative to gallery root) or GLB name for doors |
| `resource_type` | `"image"` or `"door"` |
| `width`, `height` | Normalized dimensions (0 to 1). The longer side is 1. |
| `location` | `[x, y, z]` position in 3D space. Z is up. |
| `vector` | `[x, y]` normal vector indicating which direction the artwork faces. |
| `metadata` | Text shown when hovering on the artwork. |

### Technical Section

The JSON includes a `Technical` section at the bottom:

```json
"Technical": {
  "ambientLight": 0.5,
  "pointLight": 50,
  "scaleFactor": 2.5,
  "verticalPosition": 0.4
}
```

---

## Layout Algorithm

The layout engine (`gallery-generator.js`, ported from `VR_gallery.py`) determines where to place artworks in a gallery template. The core class is `GalleryWithOptionalPanels`.

**Gallery geometry:**
- Default dimensions: 30 wide x 60 long units
- Panel length: 15 units (can be disabled)
- Item height: 2 units
- Free space from walls: 0.75 units
- Max item size: 2.5 units
- Min spacing between items: 3 units
- Door width: 1 unit

**Placement areas:** 14 total (6 walls + 8 panel sides)

**Placement strategy (3 fallback levels):**
1. Fill empty wall segments first
2. Fill walls by density saturation
3. Open panels if needed (when panel_length > 0)

Returns -1 if the items don't fit in the template.

**Key methods:**
- `maxCapacity()` -- Maximum artworks the template can hold
- `assignOccupancy(n)` -- Distribute n artworks across walls and panels
- `solveGallery(n)` -- Return positions, vectors, and template choice

For large collections (hundreds of images) the generator automatically breaks them into multiple halls.

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

1. User drops image folders into the generator
2. Generator runs the layout algorithm to produce `building_v2.json`
3. Generator fetches templates and materials from `cdn.openvgal.com`
4. Packages everything into a ZIP:

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

---

## Preview Mode

The generator's Preview button opens an iframe to `../viewer.html?preview=iframe`. When the viewer detects the `preview=iframe` parameter, it reads configuration and blob URLs from `window.parent` instead of fetching files from disk:

- `window.parent.openvgal_buildingJSON` -- The generated JSON
- `window.parent.openvgal_fileMap` -- Map of image filenames to blob URLs
- `window.parent.openvgal_preview_mode` -- Signals preview mode

This allows live preview without writing any files.

---

## Path Resolution

`declarations.js` controls where the viewer looks for assets:

| Variable | Default (online) | Default (ZIP) | Description |
|----------|------------------|---------------|-------------|
| `window.openvgal_location` | `.` | `.` | Base path for `building_v2.json` and images |
| `window.openvgal_cdn_base` | `https://cdn.openvgal.com` | (empty or `.`) | Base URL for templates and materials |

When running from a ZIP, the CDN base is overridden to use local files. The viewer checks for local templates/materials first using a `doesFileExist()` call that checks for 2xx status (not just "not 404") to handle cross-origin correctly.

---

## Templates

Four pre-built room templates are included:

| Template | Description |
|----------|-------------|
| `T_root.glb` | Hub/entrance room. Contains doors to other galleries. |
| `T_pannels.glb` | Exhibition hall with center panels for displaying art on both sides. |
| `T_nopannels.glb` | Exhibition hall without center panels. Art on walls only. |
| `T_small.glb` | Smaller exhibition hall for collections with fewer items. |

All templates are Babylon.js-compatible GLB files with named meshes for doors (`d_0`, `d_1`, etc.) and point lights for positioning.

---

## Creating Custom Templates

You can create your own GLB templates to change the look of the galleries.

### Hub Hall Templates

Requirements:
- Door meshes named `d_0`, `d_1`, etc. (single-plane meshes preferred)
- Point light sources (positions only, intensity is set by the viewer)
- Materials: either embedded or prefixed `BJS_` for server-side loading

If the template has more than 10 doors, modify the `doors_root` variable in the layout code.

### Exhibition Hall Templates

Requirements:
- Same door and light requirements as hub halls
- A corresponding layout class (equivalent to `GalleryWithOptionalPanels`) that implements:
  - `maxCapacity()` -- Returns the max number of artworks the template can hold
  - `solveGallery(n)` -- Returns `{ positions, vectors, template }` for n artworks

### Full Gallery GLBs

OpenVGAL supports loading a fully pre-designed `.glb` file as the `resource` field. In this case the template is bypassed and the GLB is rendered as-is. This enables high-quality rendering with baked textures and custom lighting.

---

## Key Technical Notes

- **`file://` protocol does not work** in Chrome due to cross-origin iframe restrictions. Always use an HTTP server for local development.
- **Cross-origin checks:** `doesFileExist()` checks for 2xx status (not just "not 404") to work correctly across origins.
- **`overlay.html`** is fetched at runtime by `overlay.js` and must be included in any deployment.
- **Image formats supported:** jpg, jpeg, png, tif, tiff, webp.
