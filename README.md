https://github.com/lbartworks/openvgal/assets/121262093/517b6b67-7a87-4f2c-8166-b5c9314ff9e9

# OpenVGAL v3.4.5

Open-source 3D virtual gallery platform built on [Babylon.js](https://www.babylonjs.com/). Create interactive WebGL art galleries from your images, download a ZIP, host it anywhere.

**Website:** [openvgal.com](https://openvgal.com) &nbsp;|&nbsp; **Clone of this repository:** [demo.openvgal.com](https://demo.openvgal.com) &nbsp;|&nbsp; **Create a gallery:** [openvgal.com/create](https://openvgal.com/create) &nbsp;|&nbsp; **Live demo:** [nostromophoto.com/virtual](https://nostromophoto.com/virtual/virtual.html)

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

> [!WARNING]
> **Migrating from a pre-3.4 gallery?** v3.4 switched artwork `width` / `height` in `building_v2.json` from normalised units (longest edge = `1.00`) to real centimetres (default `120` cm). Older files render at ~2.5 cm in the 3.4 viewer. Drop your JSON into the **[pre-3.4 migration tool](https://openvgal.com/tools/migrate-pre34.html)** to get a rescaled copy back — runs locally in your browser, no upload.

---

## What is this ?

OpenVGAL started in June 2022 as a personal project to give myself, and anyone, a way to build interactive 3D virtual galleries programmatically. No 3D modeling skills, no gallery design, no browser code to deal with. Just organize your images in folders and the code figures out the rest.

Version 1 required Python and manual configuration. Version 2 brought executables and an Electron app to lower the barrier. Version 3 removes all of that. Everything happens in the browser now. You go to [openvgal.com/create](https://openvgal.com/create), drop your folders, click build, and get a self-contained ZIP that works on any web server. No installs, no dependencies, no accounts.

The philosophy has not changed: **you own your gallery**. The output is plain HTML + JS files. There is no lock-in, no subscription, no tracking. Put the files on any server and they just work.

---

## Quick Start

1. Organize your images into folders (one folder per gallery room). Hundreds of images per folder is not recommended.
2. Go to [openvgal.com/create](https://openvgal.com/create)
3. Drop your image folders into the generator (each folder becomes a room)
4. Click **Build Gallery** and preview your gallery in 3D
5. Click **Download ZIP**
6. Extract the ZIP on any web server and open `viewer.html`

That's it. The ZIP contains everything: images, 3D room templates, PBR materials, the viewer, and configuration. Works in any subfolder, no configuration needed.

### CDN-first mode

If you prefer smaller ZIPs and automatic updates, use [openvgal.com/create?cdn=1](https://openvgal.com/create/index.html?cdn=1). The ZIP only includes your images and configuration. Templates, materials, and viewer code load from `cdn.openvgal.com` at runtime. You can also import an existing gallery and add new rooms without regenerating everything.

### Customize before download

Click **Customize** in the generator to tweak each artwork before downloading: edit titles and subtitles, resize per artwork (S / M / L buckets or a free slider in cm or inches). Sizes are stored in real-world centimetres in `building_v2.json` so what you set is what visitors see.

### Custom Logo

Replace `materials/logo.png` in the ZIP with your own image. Use white artwork on a black background (the white areas glow in the gallery). Recommended size: 1024x512 px, PNG format.

---

## What's New in v3

- **Occupancy-driven layout.** Wall and panel placement is now defined by `Occupancy_*` planes inside each template GLB. The generator probes them once, packs artworks across the strips with width-aware density balancing, and walks `selectionOrder` (smallest → largest) to overflow into additional rooms automatically. Adding a new room shape is a Blender + `catalog.json` change — no JS edit required.
- **Single `catalog.json`.** Replaces the old `styles.json`. One file under `cdn/templates/catalog.json` describes shapes (with precomputed occupancies), `selectionOrder`, default `minSpacing`, and styles (each style maps shape → GLB). Build and edit it visually with the [Catalog Manager](https://openvgal.com/tools/catalog-manager.html).
- **Real-world artwork sizes.** `width` and `height` in `building_v2.json` are now centimetres, not normalized 0–1. The viewer applies a single global `2.5/120` factor to convert cm to babylon scene units, so a 120 cm landscape print reads at the old 2.5 m default.
- **Customize before download.** New per-artwork editor in the generator: edit title, subtitle, and size (S / M / L buckets or a free cm/inch slider, capped at 250 cm) without leaving the page.
- **Post-download "ready" page.** Downloading a ZIP now opens a small landing with a free-hosting walkthrough link, a future "host it for me" CTA, and one-click share buttons.
- **Browser-based generator.** No more Python, no more executables. Everything runs in the browser at [openvgal.com/create](https://openvgal.com/create).
- **Self-contained ZIP output.** The generated ZIP includes all assets. Drop it on a web server and it works. No CDN dependency, no external calls.
- **CDN-first mode.** A lightweight alternative: the ZIP contains only the JSON config and your images. Templates, materials, viewer code, and Babylon.js load from [cdn.openvgal.com](https://cdn.openvgal.com) at runtime. Smaller ZIPs, and your galleries automatically pick up viewer updates.
- **Gallery styles.** Choose between Classic, Minimalist, and Dark gallery styles. Each style provides a coordinated set of templates (root, rooms with panels, rooms without panels, small rooms) with matching materials and lighting. Select a style in the generator before building.
- **Template-driven lighting.** Templates embed lighting configuration directly in the GLB file. Empty objects named `ambientLightUp_I{value}` and `ambientLightDown_I{value}` control ambient light intensity per template. Fixture meshes named `F_N_dx_dy_dz_I{value}` define RectAreaLights — position, direction, and intensity are all read from the mesh name and bounding box. This lets each style (e.g. Dark) define its own lighting atmosphere without any code changes.
- **Gallery map.** A visual overview of all rooms in a gallery. Click any room card to jump directly to it. Shows a thumbnail from the first artwork and the artwork count per room.
- **Artwork plaques.** Museum-style labels rendered below each artwork showing title and subtitle. Toggle them on or off from the viewer overlay or the generator settings.
- **Live 3D preview.** Preview your gallery directly in the generator before building.
- **CDN architecture.** Templates and materials are served from [cdn.openvgal.com](https://cdn.openvgal.com) for the online tools. Self-contained ZIPs bundle everything locally.
- **New landing page.** [openvgal.com](https://openvgal.com) has a proper homepage now.
- **Electron app removed.** It was a good experiment but the browser-based approach is simpler and more portable.

The Python CLI still works and is available in [GitHub Releases](https://github.com/lbartworks/openvgal/releases) for those who prefer it, but the browser generator is the recommended path going forward.

---

## How It Works

OpenVGAL uses a `building_v2.json` file to describe interconnected gallery rooms. Each room references a GLB template and contains items (artworks or doors to other rooms). The viewer loads templates, applies PBR node materials, places artwork textures at calculated positions, and handles navigation between rooms via door meshes.

The placement of artworks is driven by `Occupancy_*` planes baked into each template GLB — one plane per wall or panel side, defining the available strip's centre, normal, and width. The generator reads them from `cdn/templates/catalog.json` (or probes the GLB at runtime as a fallback), then packs artworks across strips with width-aware density balancing and overflows into additional rooms when the largest shape can't fit the remainder.

The browser generator at `/create` automates all of this: it takes your image folders, runs the layout algorithm, generates the JSON, fetches templates and materials from the CDN, and packages everything into a deployable ZIP. A CDN-first mode at `/create?cdn=1` produces lighter ZIPs that load shared assets from `cdn.openvgal.com` at runtime.

For a deeper dive into the JSON format, the layout algorithm, the material system, and how to create custom templates, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Repository Structure

| Directory | Deploys to | Description |
|-----------|-----------|-------------|
| `site/` | openvgal.com | Landing page + 3D viewer + generator + editors |
| `cdn/` | cdn.openvgal.com | GLB templates + `catalog.json` + node materials + core scripts |
| `python/` | GitHub Releases | Legacy CLI for gallery generation |
| `examples/` | Not deployed | Sample galleries for testing |
| `reference/` | Not deployed | Technical reference docs (mesh naming, runtime flow, template authoring) |

### site/

The main web application:
- `index.html` -- Landing page
- `viewer.html` -- 3D gallery viewer (Babylon.js), includes gallery map
- `create/index.html` -- Browser-based gallery generator (self-contained ZIP, or CDN-first thin client with `?cdn=1`)
- `create/customize.html`, `customize.js` -- Per-artwork editor (size + metadata) lazy-loaded from the generator
- `ready.html` -- Post-download "your gallery is ready" page (hosting links + share buttons)
- `hosting.html` -- Coming-soon placeholder for the managed hosting service
- `tools/catalog-manager.html` -- Visual editor for `cdn/templates/catalog.json` (drop a GLB to extract `Occupancy_*` strips)
- `js/gallery-generator.js` -- Occupancy-driven layout: width-aware fit + density-balanced spread
- `js/gallery-page.js` -- Shared drop-zone, preview, and ready-page helpers for both generator pages
- `js/gallery-settings.js` -- Gallery-wide settings (plaques, etc.)
- `js/style-picker.js` -- Style selection UI (reads `catalog.json`)
- `room_builder_aux.js` -- Room building, item placement (cm → babylon scene unit conversion), plaque rendering
- `openvgal-lighting.js` -- Lighting system: ambient lights, RectAreaLights from template fixtures
- `declarations.js` -- Asset path configuration
- `overlay.js`, `overlay.html`, `overlay.css` -- Viewer UI (artwork info, navigation help, automatic tour, plaques toggle)

### cdn/

Static assets served with CORS headers. CI builds `core/` at deploy time from `site/` files (viewer scripts, overlay, icons, Babylon.js).
- `templates/` -- GLB room templates in three styles (Classic, Minimalist, Dark variants), style thumbnails, and `catalog.json` (shapes + selectionOrder + styles)
- `materials/` -- Babylon.js node material JSONs, PBR textures, logo, shadow
- `core/` -- (built by CI, not in repo) Viewer scripts, overlay, icons, Babylon.js
- `_headers` -- CORS configuration

### python/

Legacy CLI tool. Generates `building_v2.json` from image folders and a CSV file. Being replaced by the browser generator.

---

## Local Development

Serve the `site/` directory with any static server. For example, with Python (usually pre-installed):

```bash
python -m http.server 8000 --directory site
```

Or with Node.js:

```bash
npx serve site
```

Then open `http://localhost:8000` (or the port shown in your terminal) to access the landing page, viewer, and generator.

Note: the `file://` protocol will not work in Chrome due to cross-origin iframe restrictions. You need an HTTP server.

---

## Changelog

**v3.4.5 (June 2026)**
- Embed mode (`?embed=1`): parent-driven export — the builder hides its own export buttons and exports on `openvgal:export-request`, plus new `openvgal:gallery-ready` and `openvgal:resize` messages (see `docs/embed.md`)

**v3.4.4 (June 2026)**
- Embed mode (`?embed=1`): hide the step-3 "Show JSON preview" disclosure so the export card hugs its action row (no empty panel under the buttons)

**v3.4.3 (June 2026)**
- Embed mode (`?embed=1`): the builder hides its own step-3 export summary and relabels the export trigger to "Export gallery", so the host owns the post-export UI
- Fix the artwork-plaques toggle contrast on the light theme (the label was nearly invisible)
- Fix overlay icons in CDN / thin-client ZIPs by rewriting icon paths to the CDN base

**v3.4.2 (May 2026)**
- Pre-3.4 → 3.4 [migration tool](https://openvgal.com/tools/migrate-pre34.html): rescales normalised `width`/`height` in older `building_v2.json` files to real centimetres so they render correctly in the 3.4 viewer

**v3.4.1 (May 2026)**
- Bundle `openvgal-lighting.js` in the standard (self-contained) ZIP

**v3.4 (May 2026)**
- Occupancy-driven layout: wall and panel placement read from `Occupancy_*` planes in template GLBs; width-aware density-balanced packing replaces the old hardcoded rectangle algorithm
- Single `catalog.json` (shapes + selectionOrder + styles) replaces `styles.json`; visual [Catalog Manager](https://openvgal.com/tools/catalog-manager.html) for editing it
- Real-world artwork sizes in centimetres in `building_v2.json` (was normalized 0–1)
- Customize editor in the generator: per-artwork size (S / M / L buckets or free cm/inch slider) and metadata
- "Ready" page after ZIP download with free-hosting walkthrough and share buttons
- Frame yaw uses `atan2(N.x, N.z)` so artworks face correctly on walls at any angle, not just N/S/E/W

**v3.3 (March 2026)**
- Gallery styles: Classic, Minimalist, and Dark — each with coordinated templates, materials, and lighting
- Template-driven lighting: ambient levels and RectAreaLight fixtures defined in GLB files via named empties/meshes

**v3.2 (March 2026)**
- Gallery styles: Classic, Minimalist, and Dark — each with coordinated templates, materials, and lighting
- Template-driven lighting: ambient levels and RectAreaLight fixtures defined in GLB files via named empties/meshes
- CDN-first mode for lightweight ZIPs with automatic viewer updates
- Metadata editor for artwork titles and subtitles
- Gallery map for visual room navigation
- Artwork plaques (museum-style labels below each artwork)

**v3 (February 2026)**
- Browser-based gallery generator at openvgal.com/create
- Self-contained ZIP deployment (no external dependencies)
- Live 3D preview in the generator
- CDN for templates and materials (cdn.openvgal.com)
- New landing page and design system
- Electron app removed
- Repository restructured by deployment target

**v2.2 (July 2025)**
- Babylon.js library bundled for version stability (v8.25)

**v2.1 (July 2025)**
- Overlay with artwork information, navigation help, and automatic tour
- Redirect support for purchases/minting

**v2.0 (April 2025)**
- Electron app and standalone executables (Windows, macOS, Linux)
- Improved lighting and gallery design

**v1.4 (March 2024)**
- New loading bar for slow connections
- Small gallery template (T_small)

**v1.0 (March 2024)**
- Template-based architecture (GLB files instead of runtime geometry)
- Automatic item distribution across walls and panels
- Node materials for PBR rendering
- Multi-hall galleries with automatic splitting for large collections

**v0.x (2022-2023)**
- Initial release with Python-only workflow
- On-the-fly hall rendering
- Touch device support
- Artwork framing and metadata display

---

## FAQ

**Can I use this commercially?**
Yes. MIT license. No restrictions on how you use the generated galleries.

**Can I add shadows or baked lighting?**
The best approach is to design halls in Blender with baked textures and load them as full GLB files (using the `resource` field in `building_v2.json`). Lightmap support is planned but not yet implemented.

**Does it work on mobile?**
Yes. Touch devices are detected automatically. Navigation uses touch controls instead of keyboard/mouse.

**Can I host the gallery on any server?**
Yes. The ZIP output is fully self-contained. Any static file server works (Apache, Nginx, Netlify, GitHub Pages, S3, etc.).

**Do I need to keep the CDN connection?**
It depends on which mode you used. The standard generator produces a fully self-contained ZIP with no CDN dependency. The CDN-first generator produces a lighter ZIP that loads templates, materials, and viewer code from `cdn.openvgal.com` at runtime, so it does need an internet connection.

---

## TODO

- [ ] Support for VR devices
- [ ] Support for lightmaps ([early experiments](https://www.youtube.com/watch?v=mZzMPlagnQk))
- [ ] Alternative hall templates beyond rectangular halls
- [x] Code to detect overlapping artwork or erroneous configurations (v3.4)
- [ ] Logo upload in the generator (currently: replace `materials/logo.png` manually)
- [x] Occupancy-driven layout via `Occupancy_*` planes + `catalog.json` (v3.4)
- [x] Real-world cm artwork sizes + per-artwork customize editor (v3.4)
- [x] CDN-first deployment mode (v3.1)
- [x] Metadata editor (v3.1)
- [x] Gallery map (v3.1)
- [x] Artwork plaques (v3.1)
- [x] Browser-based generator (v3)
- [x] Self-contained ZIP deployment (v3)
- [x] Live 3D preview in generator (v3)
- [x] Overlay with artwork info, navigation help, automatic tour (v2.1)
- [x] Electron app and standalone executables (v2.0, later removed)
- [x] Template-based architecture with GLB files (v1.0)
- [x] On-the-fly hall rendering (v0.x)
- [x] Touch device support (v0.x)
- [x] Artwork framing and metadata display (v0.x)

---

## License

MIT License. See [LICENSE](LICENSE).

---

*If you want to receive updates, subscribe to the [newsletter](https://nostromophoto.com/newslettter/)*
