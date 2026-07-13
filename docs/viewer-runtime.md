# Viewer & Runtime

How `viewer.html` loads a gallery, resolves asset paths, applies materials, and renders a live preview. For lighting see [Lighting](lighting.md).

← Back to [Architecture index](../ARCHITECTURE.md)

---

## Viewer engine

The viewer is a Babylon.js app that:

1. Reads `building_v2.json` and creates the root hall.
2. For each hall, tries to load the `resource` GLB first; if it doesn't exist, loads the `template` GLB instead.
3. Places artwork textures at the JSON positions via `item_builder()`.
4. Creates 3D text labels for room names via `text3D_builder()`.
5. Adds door click handlers — clicking a door loads the connected hall.
6. Keeps visited halls in memory for faster return navigation.

**Controls:**

- **Keyboard/mouse:** arrow keys to move, mouse to look.
- **Touch:** 1-finger drag to move forward, 2-finger to rotate.
- **Doors:** click to navigate between halls.

**Overlay UI (`overlay.js`):**

- Artwork metadata on hover.
- Navigation arrows for the automatic tour.
- Multi-language help (English, Spanish, Japanese, Chinese).
- Extensible action buttons (purchase, mint, favourite — disabled by default).

---

## Material System

OpenVGAL uses Babylon.js **node materials** stored as JSON. Templates reference a material by name with the `BJS_` prefix; when a name starts with `BJS_`, the viewer fetches the JSON from the materials folder instead of using an embedded material.

**Available materials:**

| Material | Use |
|----------|-----|
| `BJS_white` | White frame |
| `BJS_rough_white` | Matte white surfaces |
| `BJS_black_metal` | 3D text labels |
| `BJS_chrome` | Reflective chrome |
| `BJS_glow` | Self-illuminating (logo, light fixtures) |
| `BJS_glow_masked` | Masked glow effect |
| `BJS_rust` | Rusty metallic texture |
| `BJS_default_wall` | Default wall surface |
| `BJS_default_ceiling` | Default ceiling |
| `BJS_default_floor` | Default floor |

**URL rewriting.** Material JSONs reference textures with `http://localhost/materials/` paths. The loader strips that prefix, then uses the actual materials folder as `rootUrl` — avoiding a double `materials/materials/` path.

You can radically change the galleries' look just by editing or replacing the material JSONs and their textures.

---

## Path Resolution

`declarations.js` controls where the viewer looks for assets:

| Variable | Default (online) | Default (ZIP) | Description |
|----------|------------------|---------------|-------------|
| `window.openvgal_location` | `.` | `.` | Base path for `building_v2.json` and images |
| `window.openvgal_cdn_base` | `https://cdn.openvgal.com` | (empty or `.`) | Base URL for templates and materials |

When running from a ZIP, the CDN base is overridden to local files. The viewer checks for local templates/materials first with `doesFileExist()`, which tests for a **2xx status** (not merely "not 404") so it behaves correctly across origins.

---

## Preview Mode

The generator's **Preview** button opens an iframe to `../viewer.html?preview=iframe`. On seeing `preview=iframe`, the viewer reads configuration and blob URLs from `window.parent` instead of fetching from disk:

- `window.parent.openvgal_buildingJSON` — the generated JSON
- `window.parent.openvgal_fileMap` — image filename → blob URL map
- `window.parent.openvgal_preview_mode` — signals preview mode

This gives a live preview without writing any files.

---

## Key technical notes

- **`file://` doesn't work** in Chrome (cross-origin iframe restrictions). Always serve over HTTP.
- **Cross-origin checks:** `doesFileExist()` requires a 2xx status to work across origins.
- **`overlay.html`** is fetched at runtime by `overlay.js` and must be present in any deployment. `overlay.js` tries `cdn_base + '/core/overlay.html'` first and falls back to a local `overlay.html`.
- **Image formats:** jpg, jpeg, png, tif, tiff, webp.

---

## See also

- [Generator & ZIP Flow](generator.md) — how a deployable package is built and what dev mode overrides.
- [Gallery JSON Format](gallery-json.md) — the file the viewer reads.
- [Lighting](lighting.md) — the load-time lightmap bake.
