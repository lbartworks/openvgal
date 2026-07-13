# OpenVGAL Architecture

Technical reference for developers and contributors. For a general overview and quick start, see [README.md](README.md).

A gallery is a tree of halls described by a single `building_v2.json` file. The viewer loads each hall's GLB — either a fully designed one or a reusable **template** it furnishes at runtime with artwork from the JSON. The browser **generator** produces that JSON and a deployable ZIP from your image folders. This doc set covers each piece.

---

## Documentation map

| Topic | What it covers |
|-------|----------------|
| **[Gallery JSON Format](docs/gallery-json.md)** | The `building_v2.json` spec — halls, items, sizes, coordinates, the `Technical` block. Start here. |
| **[Creating Custom Templates](docs/creating-templates.md)** | Authoring GLB templates — required meshes, materials, lighting, styles, and full-gallery GLBs. |
| **[Layout & Catalog](docs/layout-and-catalog.md)** | `catalog.json` schema and the occupancy-driven packing algorithm. |
| **[Viewer & Runtime](docs/viewer-runtime.md)** | Viewer engine, material system, path resolution, preview mode. |
| **[Lighting](docs/lighting.md)** | Why and how the v4 in-browser lightmap bake works — splash/sun/fixture light models, shadows, AO. |

---


