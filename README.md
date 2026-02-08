# OpenVGAL

Open-source 3D virtual gallery platform built on Babylon.js. Create interactive WebGL art galleries from your images.

**Live demo:** [openvgal.com](https://openvgal.com)

## Repository Structure

| Directory | Deploys to | Description |
|-----------|-----------|-------------|
| `site/` | openvgal.com (Cloudflare Pages) | Viewer + generator web app |
| `cdn/` | cdn.openvgal.com (Cloudflare Pages) | Templates (GLB) + materials (JSON/textures) |
| `server/` | api.openvgal.com (Coolify) | API server (future) |
| `python/` | GitHub Releases | Legacy CLI for gallery generation |
| `examples/` | Not deployed | Sample galleries for testing |

### site/

The main web application:
- `index.html` — 3D gallery viewer (Babylon.js)
- `create/index.html` — Browser-based gallery generator (no Python needed)
- `declarations.js` — Auto-detects environment (hosted vs local) for CDN paths
- `room_builder_aux.js`, `overlay.js` — Viewer components

### cdn/

Static assets served with CORS headers:
- `templates/` — GLB room templates (T_root, T_pannels, T_nopannels, T_small)
- `materials/` — Babylon.js node materials and textures
- `_headers` — Cloudflare Pages CORS configuration

### python/

Legacy command-line tool for gallery generation. Generates `building_v2.json` from folders of images. Being replaced by the browser-based generator at `/create`.

## Quick Start

### Browser Generator (Recommended)

1. Visit [openvgal.com/create](https://openvgal.com/create)
2. Add your image folders
3. Generate and download a complete ZIP
4. Deploy the ZIP to any web server

### Local Development

Serve the `site/` directory with any static server:

```bash
npx serve site
```

Then open `http://localhost:3000` for the viewer or `http://localhost:3000/create/` for the generator.

### Python CLI (Legacy)

```bash
cd python
pip install numpy pillow
python VR_gallery.py
```

## How It Works

OpenVGAL uses a `building_v2.json` file to describe interconnected gallery halls. Each hall references a GLB template and contains items (artworks or doors to other halls). The viewer loads templates from the CDN, places artwork dynamically, and handles navigation between halls.

For details on the JSON structure, template creation, and customization, see the [wiki](https://github.com/lbartworks/openvgal/wiki) or the source code documentation.

## Deployment

Pushes to `main` auto-deploy via GitHub Actions:

- **site/** changes deploy to openvgal.com
- **cdn/** changes deploy to cdn.openvgal.com
- **server/** changes deploy via Coolify's native GitHub auto-deploy

Python executables are built and released on `v*` tags.

### Required Secrets

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (Pages edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

## License

See [LICENSE](LICENSE).
