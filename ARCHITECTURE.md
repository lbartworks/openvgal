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
| `metadata` | Text shown when hovering on the artwork. Title and subtitle are separated by `\n` (newline). The subtitle appears on a second line in the overlay and on artwork plaques. |

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

## Gallery Styles

OpenVGAL ships with three visual styles. Each style is a coordinated set of templates (root hub, panels room, no-panels room, small room) with matching materials and lighting settings baked into the GLB files. Styles are defined in `cdn/styles/styles.json`:

| Style | Description | Root Template |
|-------|-------------|---------------|
| **Classic** | Mix of modern and classic materials | `T_root.glb` |
| **Minimalist** | Clean lines, white walls, even lighting | `T_root_minimalist.glb` |
| **Dark** | Dark walls, backlight-style frames | `T_root_dark.glb` |

Each style maps four template roles:

```json
{
  "dark": {
    "name": "Dark",
    "description": "Dark walls, backlight type of frames",
    "thumbnail": "dark_thumb.jpg",
    "root": "T_root_dark.glb",
    "templates": {
      "small": "T_small_dark.glb",
      "nopannels": "T_nopannels_dark.glb",
      "pannels": "T_pannels_dark.glb"
    }
  }
}
```

The generator reads the selected style and passes the correct template filenames to the layout algorithm. The viewer doesn't know about styles — it just loads whichever template filename is in `building_v2.json`.

---

## Templates

Each style includes four room templates:

| Template role | Classic | Minimalist | Dark |
|---------------|---------|------------|------|
| Root hub | `T_root.glb` | `T_root_minimalist.glb` | `T_root_dark.glb` |
| Panels room | `T_pannels.glb` | `T_pannels_minimalist.glb` | `T_pannels_dark.glb` |
| No-panels room | `T_nopannels.glb` | `T_nopannels_minimalist.glb` | `T_nopannels_dark.glb` |
| Small room | `T_small.glb` | `T_small_minimalist.glb` | `T_small_dark.glb` |

All templates are Babylon.js-compatible GLB files with named meshes for doors (`d_0`, `d_1`, etc.) and can embed lighting configuration (see [Lighting System](#lighting-system)).

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
