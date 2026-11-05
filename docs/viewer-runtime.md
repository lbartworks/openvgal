# Viewer & Runtime

How `viewer.html` loads a gallery, resolves asset paths, applies materials, and renders a live preview. For lighting see [Lighting](lighting.md).

← Back to [Architecture index](../ARCHITECTURE.md)

---

## Viewer engine

The viewer is a Babylon.js app that:

1. Reads `building_v2.json` and creates the entrance hall (the one with `parent: "none"`).
2. For each hall, tries to load the `resource` GLB first; if it doesn't exist, loads the `template` GLB instead.
3. Places artwork textures at the JSON positions via `item_builder()`.
4. Creates 3D text labels for room names via `text3D_builder()`.
5. Adds door click handlers — clicking a door loads the connected hall.
6. Keeps visited halls in memory for faster return navigation.

**Controls:**

- **Keyboard/mouse:** arrow keys to move, mouse to look.
- **Touch:** 1-finger drag to move forward, 2-finger to rotate.
- **Joystick:** on-screen, beside the button row: up/down to walk, left/right to turn; the further it is pushed, the faster.
- **Doors:** click to navigate between halls.

**Overlay UI (`overlay.js`):**

- Top: map button, "Made with OpenVGal" badge, tour record button.
- Bottom button row: help, previous/next artwork, cinematic visit, music volume (only when the gallery has music).
- Artwork sheet: clicking an artwork flies to it and opens its title, subtitle, info fields and dimensions.
- Multi-language help (English, Spanish, Japanese, Chinese).
- Plaques follow the gallery's `show_plaques` setting; visitors can't toggle them.

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

## Placement mode

`viewer.html?placement=1` opens the hall named by `gallery` (or the entrance) with placement mode on, with or without `preview=iframe`. A person can move, resize and swap the artworks of the hall they stand in. The viewer never saves anything. On a standalone or self-hosted gallery the mode is a toy; a hosting page that embeds the viewer from the same origin receives the result as a message.

- **Select:** tap an artwork. It shows a move handle (centre), a resize handle (corner) and a Swap button, and the camera eases in to face it from close range. Walking works as usual afterwards.
- **Move:** drag along the wall and up/down. The artwork keeps its facing and stays inside the `Occupancy_*` plane it hangs on, frame margin included. If the frame is larger than the plane in one direction, it is centred on the plane in that direction, and the hint says so. The packer does not use the plane's height, so an artwork can start partly outside its plane; the first drag snaps it inside.
- **Resize:** keeps the aspect ratio. The longest edge stays between 20 and 250 cm. In each direction the frame may grow until it fills the plane, or up to the size it had when the mode started if that was larger.
- **Swap:** picks another artwork of the same hall from thumbnails of the images it already loaded. The two entries trade `location` and `vector`; each keeps its own `width`/`height`. Keys and key order don't change.
- **Overlaps:** artworks whose frame rectangles overlap on the same wall are outlined. Overlaps are allowed.
- After every move, resize or swap, the hall's frames and plaques are rebuilt from the edited entries. The template is not reloaded.
- **Lighting:** the lightmap is not baked in this mode. Halls show their own materials under the ambient light, with no shadows, so nothing stays behind where a frame used to hang.
- Edits are kept in an in-memory copy of the manifest, so a hall that is left and revisited during the session shows them. In preview mode the parent's `openvgal_config` object is never modified.

**Messages.** Sent with `window.parent.postMessage(data, location.origin)`, and only when the parent is same-origin. Without one, Done and Cancel just leave the mode.

Done:

```json
{
  "type": "openvgal:placement",
  "rooms": {
    "<hall name>": {
      "<artwork key>": {
        "location": "[x,z,y]",
        "vector": "[x,z]",
        "width": "120.00",
        "height": "80.40"
      }
    }
  }
}
```

- `rooms` holds only the artworks whose `location`, `vector`, `width` or `height` changed, across every hall edited in the session. Each changed artwork carries all four fields. `rooms` is `{}` when nothing changed.
- Values are strings in the manifest's own formats: `location` `"[x,z,y]"` (Z up, 3 decimals), `vector` `"[x,z]"` (1 decimal), `width`/`height` in cm (2 decimals). Swapped entries carry the other entry's strings unchanged.
- The host merges each entry into its manifest under `<hall name>.<artwork key>`; every other field is unchanged. It may also set `Technical.hand_placed` (see [Gallery JSON](gallery-json.md#technical-section-currently-obsolete)).

Cancel restores the layout and sends:

```json
{ "type": "openvgal:placement-cancel" }
```

Both close the mode. The script (`placement.js`) is only loaded when `placement=1` is set: CDN copy first, local copy as the fallback.

---

## Key technical notes

- **`file://` doesn't work** in Chrome (cross-origin iframe restrictions). Always serve over HTTP.
- **Cross-origin checks:** `doesFileExist()` requires a 2xx status to work across origins.
- **`overlay.html`** is fetched at runtime by `overlay.js` and must be present in any deployment. `overlay.js` tries `cdn_base + '/core/overlay.html'` first and falls back to a local `overlay.html`.
- **Image formats:** jpg, jpeg, png, webp.

---

## See also

- [Generator & ZIP Flow](generator.md) — how a deployable package is built and what dev mode overrides.
- [Gallery JSON Format](gallery-json.md) — the file the viewer reads.
- [Lighting](lighting.md) — the load-time lightmap bake.
