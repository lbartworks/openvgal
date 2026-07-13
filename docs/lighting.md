# Lighting

How OpenVGAL lights a gallery, and why it does it the way it does. This is the **conceptual reference** — the reasoning behind the v4 load-time lightmap bake and the light models it simulates. For the object-naming spec you actually author against, see [Creating Custom Templates](creating-templates.md).

← Back to [Architecture index](../ARCHITECTURE.md)

Implementation: [`site/openvgal-lighting.js`](../site/openvgal-lighting.js).

---

## The problem

A gallery room is **static** — walls, floor, ceiling, and light fixtures never move; only the visitor's camera does, and the artwork is placed once at load. That should make lighting easy. In practice, the two obvious ways to light it each fail in their own way.

### Why not bake in Blender

The classic answer for static scenes is to bake lighting offline into textures. It looks great, but for a template platform it's the wrong tool:

- **Slow to author.** Every lighting tweak means a full Blender bake — minutes per iteration, before you even see it in the viewer.
- **A maintenance multiplier.** OpenVGAL ships each template in several styles (classic, dark, modern, …). An offline bake is frozen into the GLB, so every style — and every future edit to any of them — is its own re-bake and re-export. The lighting stops being data you can change and becomes an asset you have to regenerate.
- **Heavy.** Baked lightmaps ride inside the GLB. Higher quality means bigger textures means slower downloads, on files already carrying geometry and material maps.
- **Completely static.** A Blender bake can't respond to anything decided at load time. It's the same photons forever.

### Why not just use Babylon lights

The other answer is real-time lighting — let Babylon light the room every frame. That's dynamic and needs no bake step, but it runs headlong into WebGL's ceiling:

- **Light count.** Babylon caps simultaneous lights per material (`maxSimultaneousLights`, 14 here). A room that wants a row of ceiling fixtures plus accent spots plus fill blows past that budget fast.
- **Shadows are expensive and limited.** Each shadow-casting light needs its own shadow generator and per-frame depth render. A handful is fine; a fixture-lit gallery's worth is not — especially on the mid-range and mobile GPUs a web visitor actually has.
- **Area lights cost more.** `RectAreaLight` fixtures — the ones that read as glowing panels — are heavier still, and every one of them is paid again on every single frame the visitor is in the room.
- **It's per-frame waste.** The room never changes. Recomputing its lighting sixty times a second is spending a GPU budget on an answer that was already settled at load.

---

## The solution: bake at load time, in the browser

OpenVGAL keeps the "free at runtime" win of baking and the "just author it in the GLB, change it freely" win of dynamic lighting, by doing the bake **in the browser, once, when the room loads** — then throwing the lights away.

The move:

1. Read the lights the template author placed as **named markers** in the GLB.
2. **Bake** their full contribution — cone falloff, area-light softness, cast shadows, ambient, ambient occlusion — into a per-surface **lightmap texture**, computed on the GPU via render-to-texture.
3. **Disable every runtime light** and **freeze** the materials. From this point the room draws as `albedo × baked lightmap` — a plain texture multiply, no lights in the shader at all.

The result costs essentially **nothing per frame** (the expensive Babylon shadow/area-light paths are gone), ships **no baked textures in the GLB** (they're generated on the client), and stays **fully data-driven** — the same template bakes differently per style because the bake reads the style's markers at load, with no re-export. The trade is a few seconds of work at load, behind the *"Setting up lights"* progress bar.

This is an unusual way to use Babylon. The engine's normal modes are "light every frame" or "load an offline bake." Here the GPU is used as a **one-shot lightmap baker at startup** and then the lighting system deletes itself.

> Applies to **template galleries** the viewer furnishes. A **full designed GLB** loaded via `resource` is drawn exactly as authored and is *not* re-baked — bake its lighting in Blender and ship it.

---

## How the bake works

### 1. Lights are markers, not lights

The author never writes lighting code. They place named objects in the GLB — spot markers (`splash_N`, `sun_N`), rectangular fixture panels (`F_N_…`), and ambient empties. At load the viewer resolves each into a world-space light description; the actual Babylon light objects are only *authoring markers* and get switched off before the first frame. (Exact names, direction encoding, and coordinate conversion: [Creating Custom Templates](creating-templates.md).)

Sources are resolved in priority order: authored `sun_N` / `splash_N` spots → `F_` fixtures → a single template marker spot as a last resort.

### 2. Each surface rasterizes into its own lightmap

Every bakeable mesh carries a second UV channel (**UV2**) laid out as a lightmap atlas. A custom **bake shader** does the trick that makes this work: its *vertex* stage remaps `UV2 → clip space`, so drawing the mesh rasterizes it flat into its own 0..1 lightmap texture instead of onto the screen. Its *fragment* stage evaluates the lighting at each texel's interpolated **world position** and writes the result. One half-float render target per mesh holds that mesh's lightmap. (Half-float, so many lights can accumulate without banding.)

### 3. One pass per light, accumulated

Rather than loop every light inside one shader (which the light-count ceiling limits, and which can't fold in per-light shadows cleanly), the bake runs **one render pass per light** into a ping-pong pair of buffers: each pass reads the running total, adds this light's contribution × its shadow term, and writes the new total. Because it's additive and offline-to-the-frame, there is **no practical light ceiling** — a room's budget is `BAKE_MAX_LIGHTS` samples, not Babylon's 14. Hemispheric ambient (darkened by AO) seeds the first pass.

### 4. Disable, freeze, done

After accumulation each mesh's display material is pointed at its finished lightmap and frozen; the runtime lights are disabled. The room is now static texture data.

---

## The light models

Different fixtures want different physics. The bake picks the model from the marker's **prefix**, so one shader handles all of them.

### Splash lights (`splash_N`)

The workhorse accent light — and the one the older docs mislabeled as a "point light." It is not a point light. A **splash** is a **divergent cone** emitted from a point: it has an angular cone (full brightness within the inner angle, smooth falloff to the outer angle) *and* a **reach** — a distance falloff, `_R{range}`, past which it fades to nothing. That's what makes it read as a soft pool of light splashed onto a wall or floor, rather than a hard uniform spot. Cone angle comes from the light object in the GLB; intensity and reach come from the name (or fall back to global defaults).

### Sun lights (`sun_N`)

For light coming *into* the room — shafts through a roof opening. A **sun** is the opposite of a splash: **parallel rays** along the aim direction, **no cone and no distance falloff**, so every shaft stays equally bright and dead-parallel. Its shadow uses an **orthographic** projection framed to the room, so the openings that carve the shafts sample the shadow map evenly (no perspective moiré). All the shape in the result comes from the roof geometry blocking the parallel rays.

### Fixtures as area lights (`F_N_…`)

A fixture is a **flat rectangular panel** (usually wearing the `BJS_glow` material, so it also reads as a lit panel). A single point can't produce a fixture's soft, wide, wrap-around light. So each panel is baked as a **stratified grid of sub-lights** spread across its rectangle, each at `1/count` intensity. Their offset shadows average into a genuine **soft penumbra** — a real area light, built by reusing the same per-light pass and depth machinery, no special shader. Samples scale with edge length (a long strip gets more along its length, no gaps; a short side isn't over-sampled), capped per axis and by the global budget.

---

## Shadows

Baked lights **do** cast shadows. Each gets its **own depth map** — linear distance from the light in meters, rendered once from the light's point of view with a custom depth material. The bake samples that map (3×3 PCF) and multiplies it into the light's contribution. Using our own linear-depth map, with the *same* view-projection for both the render and the sample, keeps the whole thing independent of Babylon's internal shadow encoding and of handedness/NDC conventions.

The projection is matched to the light model:

- **Splash** → a **perspective** map, its field of view sized to the authored cone so the whole lit disc stays inside the map.
- **Sun** → an **orthographic** map framed to the room (see above).
- **Fixture sub-lights** → up to **six world-axis "cube-face" maps** each, so a wide-emitting panel is depth-tested in every direction it throws light — with a gate in the shader ensuring each texel is tested against exactly one face (no double-shadowing, no seams).

Texels that fall **outside** a light's depth frustum don't default to "lit" (which would leak light through walls). They fall back to a **voxel occupancy march**: the room is voxelized (see AO below) and the shader steps that coarse grid toward the light — coarse, but a wall always blocks.

Thin decorative planes — wall plaques (`lbl_plaque_`) and the 3D door labels (`T_`) — are excluded as occluders so they don't cast "ghost" shadows onto the wall behind them.

---

## Ambient occlusion

Depth maps see the room from each *light's* side, but not the soft contact darkening in corners, along skirting, or under a bench — that comes from nearby geometry blocking *ambient*. For that the room is **voxelized into a coarse solid-occupancy grid** (packed as a flat-3D atlas in one 2D texture so a shader can sample it). Per surface texel, the AO pass **ray-marches a hemisphere of short rays** through that grid and darkens where nearby geometry blocks them. Because the grid includes interior objects, this produces **real contact shadows**, not flat fill. The AO is baked into a low-resolution per-mesh buffer (it's low-frequency) and folded into the ambient term on the first bake pass.

---

## Cost, trade-offs, and limits

- **Load-time cost.** The bake blocks for a few seconds on room entry (depth maps → AO grid → AO march → per-light accumulation), paced across frames behind the *"Setting up lights"* bar so it animates instead of freezing. On revisit the geometry-only steps are cached; only the lightmap contents are refilled.
- **Runtime cost.** Near zero. No runtime lights, no per-frame shadows, frozen materials, one texture multiply.
- **Static only.** The bake assumes nothing moves. This is a gallery — it doesn't. Anything that *must* be dynamic has to stay a live Babylon light, outside the baked set.
- **Requires half-float render targets.** Without them the bake aborts (and logs); the room falls back to whatever unbaked lighting remains.
- **Budgeted.** A very light-heavy room coarsens its fixture sample grids before it drops any light, and only drops lights (loudly) past the hard `BAKE_MAX_LIGHTS` ceiling.

After the bake, [`freezeGalleryMaterials()`](../site/openvgal-lighting.js) freezes the `BJS_` node materials. This must happen **after** the bake — freezing earlier locks in the wrong shader state and the lighting won't take.

---

## See also

- [Creating Custom Templates](creating-templates.md) — the light-naming spec and authoring checklist that places every marker described here.
- [Viewer & Runtime](viewer-runtime.md) — the material system the bake writes its result into.
