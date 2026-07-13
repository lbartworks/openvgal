# Generator, ZIP & Local Development

The browser generator at `/create` turns image folders into a deployable gallery. This covers the build/ZIP flow, the Customize editor, and how to run everything locally without a round-trip.

← Back to [Architecture index](../ARCHITECTURE.md)

---

## Generator & ZIP flow

The generator builds a complete, self-contained deployment package:

1. User drops image folders into the generator (drop-zone wiring in `js/gallery-page.js`).
2. Generator fetches `cdn/templates/catalog.json` and the selected style's GLBs.
3. Each image is sized at a default 120 cm longest edge (cm preserved in the JSON); the user can adjust per-artwork in the [Customize editor](#customize-editor) before download.
4. Layout runs (`packIntoRooms`, see [Layout & Catalog](layout-and-catalog.md)) — overflow rooms spawn automatically.
5. Everything is packaged into a ZIP:

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
    T_root.glb  T_pannels.glb  T_nopannels.glb  T_small.glb
  materials/
    BJS_*.json  logo.png  shadow.png  concrete-23/  rust2/  Wallpaper/
  gallery1/
    image1.jpg  image2.jpg
  gallery2/ ...
  icons/ ...
  README.md
```

The ZIP uses relative paths (`openvgal_location = '.'`), so it works in any subfolder on any web server without configuration.

After **Download ZIP** (or the JSON-only download), the generator opens `/ready.html?name=<firstRoom>` in a new tab — a lightweight post-save page with a free-hosting walkthrough, a coming-soon "host it for me" CTA (`/hosting.html`), and Web-Share / X / Facebook / Instagram-caption-copy buttons. The window is opened synchronously inside the click handler so mobile browsers don't drop it as a deferred popup.

### CDN-first mode

`/create?cdn=1` produces a lighter ZIP containing only images + configuration; templates, materials, and viewer code load from `cdn.openvgal.com` at runtime. Do **not** ship a ZIP downloaded with `?cdn=1&dev=1` — that bakes `CDN_BASE = '/cdn'` into the thin client and won't work outside dev.

---

## Customize editor

`site/create/customize.html` + `customize.js` load on demand the first time the user clicks **Customize**. The editor mounts inside the result section, hides the rest of the page while open, and operates on a **deep copy** of the generated JSON — so closing without re-laying-out leaves the underlying state untouched.

Per artwork it exposes:

- **Title and subtitle**, written back into `metadata` as `"<title>\n<subtitle>"` (the existing `ID #N` prefix is preserved so plaque and overlay code keep working).
- **Size:** S / M / L bucket buttons (60 / 120 / 180 cm longest edge) plus a free slider capped at 250 cm. Display unit toggles cm ↔ inches; aspect ratio is preserved from the source image.

Sizes are stored as cm strings in `width` / `height`. Re-laying-out after a size change calls `relayoutRoom`, which feeds the same `packIntoRooms` packer and emits new `location` / `vector` strings.

---

## Local Development

### Viewer dev mode

Add `?dev=1` to the viewer URL to skip the ZIP/generator round-trip and load the checked-in fixture directly.

1. From the repo root, run any static server (e.g. `python -m http.server 8080`).
2. Open `http://localhost:8080/site/viewer.html?dev=1`.

`?dev=1` sets:

- `window.openvgal_location = '/examples'` — viewer reads `/examples/building_v2.json` and image folders directly.
- `window.openvgal_cdn_base = '/cdn'` — templates and materials come from the local `cdn/` folder, not the deployed CDN.

`overlay.js` fetches `cdn_base + '/core/overlay.html'` first and falls back to local `overlay.html` if that 404s. `cdn/core/` is built by CI and is absent locally, so the fallback is what makes dev mode work end-to-end.

Edit any file under `site/`, `cdn/`, or `examples/` and refresh — no ZIP, no second server, no generator UI. Same code paths as production; only the source URLs change.

### Generator dev mode

`create/index.html?dev=1` applies the same trick to the generator: `CDN_BASE` is rewritten to `/cdn`, so the style picker, ZIP bundler, and `extractOccupanciesFromGLB` all read from the local `cdn/` folder. The preview iframe inherits `openvgal_cdn_base` from `window.parent`, so the rendered scene also uses your local templates.

```
http://localhost:8080/site/create/index.html?dev=1
```

Use this when iterating on `Occupancy_*` planes, fixture geometry, materials, or any other template-time asset the generator consumes before the viewer runs. Workflow: edit `cdn/templates/*.glb` in Blender → save → drop image folders → Build → Preview. No CDN upload.

> **Caveat:** a ZIP downloaded with `?cdn=1&dev=1` bakes `CDN_BASE = '/cdn'` into the thin-client output and won't work outside dev. Use `?cdn=1` alone when producing a real CDN ZIP.

---

## See also

- [Layout & Catalog](layout-and-catalog.md) — the packer the generator runs.
- [Creating Custom Templates](creating-templates.md) — the assets the generator bundles.
- [Viewer & Runtime](viewer-runtime.md) — preview mode and path resolution.
