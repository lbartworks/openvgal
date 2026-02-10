# OpenVGAL v3

Open-source 3D virtual gallery platform built on [Babylon.js](https://www.babylonjs.com/). Create interactive WebGL art galleries from your images, download a ZIP, host it anywhere.

**Website:** [openvgal.com](https://openvgal.com) &nbsp;|&nbsp; **Create a gallery:** [openvgal.com/create](https://openvgal.com/create) &nbsp;|&nbsp; **Live demo:** [nostromophoto.com/virtual](https://nostromophoto.com/virtual/virtual.html)

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

---

## What is this

OpenVGAL started in June 2022 as a personal project to give myself, and anyone, a way to build interactive 3D virtual galleries programmatically. No 3D modeling skills, no gallery design, no browser code to deal with. Just organize your images in folders and the code figures out the rest.

Version 1 required Python and manual configuration. Version 2 brought executables and an Electron app to lower the barrier. Version 3 removes all of that. Everything happens in the browser now. You go to [openvgal.com/create](https://openvgal.com/create), drop your folders, click build, and get a self-contained ZIP that works on any web server. No installs, no dependencies, no accounts.

The philosophy has not changed: **you own your gallery**. The output is plain HTML + JS files. There is no lock-in, no subscription, no tracking. Put the files on any server and they just work.

---

## Quick Start

1. Go to [openvgal.com/create](https://openvgal.com/create)
2. Drop your image folders into the generator (each folder becomes a room)
3. Preview your gallery in 3D
4. Click **Build Gallery** and download the ZIP
5. Extract the ZIP on any web server and open `viewer.html`

That's it. The ZIP contains everything: images, 3D room templates, PBR materials, the viewer, and configuration. Works in any subfolder, no configuration needed.

### Custom Logo

Replace `materials/logo.png` in the ZIP with your own image. Use white artwork on a black background (the white areas glow in the gallery). Recommended size: 1024x512 px, PNG format.

---

## What's New in v3

- **Browser-based generator.** No more Python, no more executables. Everything runs in the browser at [openvgal.com/create](https://openvgal.com/create).
- **Self-contained ZIP output.** The generated ZIP includes all assets. Drop it on a web server and it works. No CDN dependency, no external calls.
- **Live 3D preview.** Preview your gallery directly in the generator before building.
- **CDN architecture.** Templates and materials are served from [cdn.openvgal.com](https://cdn.openvgal.com) for the online tools. The ZIP bundles everything locally.
- **New landing page.** [openvgal.com](https://openvgal.com) has a proper homepage now.
- **Electron app removed.** It was a good experiment but the browser-based approach is simpler and more portable.
- **Repository restructured.** Clean separation between site, CDN assets, server, and legacy Python code.

The Python CLI still works and is available in [GitHub Releases](https://github.com/lbartworks/openvgal/releases) for those who prefer it, but the browser generator is the recommended path going forward.

---

## How It Works

OpenVGAL uses a `building_v2.json` file to describe interconnected gallery rooms. Each room references a GLB template and contains items (artworks or doors to other rooms). The viewer loads templates, applies PBR node materials, places artwork textures at calculated positions, and handles navigation between rooms via door meshes.

The browser generator at `/create` automates all of this: it takes your image folders, runs the layout algorithm, generates the JSON, fetches templates and materials from the CDN, and packages everything into a deployable ZIP.

For a deeper dive into the JSON format, the layout algorithm, the material system, and how to create custom templates, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Repository Structure

| Directory | Deploys to | Description |
|-----------|-----------|-------------|
| `site/` | openvgal.com | Landing page + 3D viewer + gallery generator |
| `cdn/` | cdn.openvgal.com (Cloudflare Pages) | GLB templates + node materials + textures |
| `server/` | api.openvgal.com (future) | API server for managed hosting |
| `python/` | GitHub Releases | Legacy CLI for gallery generation |
| `examples/` | Not deployed | Sample galleries for testing |

### site/

The main web application:
- `index.html` -- Landing page
- `viewer.html` -- 3D gallery viewer (Babylon.js)
- `create/index.html` -- Browser-based gallery generator
- `js/gallery-generator.js` -- Layout algorithm (ported from Python)
- `room_builder_aux.js` -- Room building and item placement
- `declarations.js` -- Asset path configuration
- `overlay.js`, `overlay.html`, `overlay.css` -- Viewer UI (artwork info, navigation help, automatic tour)

### cdn/

Static assets served with CORS headers:
- `templates/` -- GLB room templates (T_root, T_pannels, T_nopannels, T_small)
- `materials/` -- Babylon.js node material JSONs, PBR textures, logo, shadow
- `_headers` -- Cloudflare Pages CORS configuration

### python/

Legacy CLI tool. Generates `building_v2.json` from image folders and a CSV file. Being replaced by the browser generator.

---

## Local Development

Serve the `site/` directory with any static server:

```bash
npx serve site
```

Then open:
- `http://localhost:3000` -- Landing page
- `http://localhost:3000/viewer.html` -- 3D viewer
- `http://localhost:3000/create/` -- Gallery generator

Note: the `file://` protocol will not work in Chrome due to cross-origin iframe restrictions. You need an HTTP server.

---

## Deployment

| Component | Method |
|-----------|--------|
| **site/** | Auto-deploys via Coolify GitHub App on push |
| **cdn/** | Cloudflare Pages via GitHub Actions or manual (`npx wrangler pages deploy cdn --project-name=openvgal-cdn`) |
| **python/** | GitHub Releases on `v*` tags (builds Windows, Linux, macOS executables) |

---

## Changelog

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

## License

MIT License. See [LICENSE](LICENSE).

---

*If you want to receive updates, subscribe to the [newsletter](https://nostromophoto.com/newslettter/)*
