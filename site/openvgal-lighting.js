// OpenVGAL Lighting System
// Manages all scene illumination: hemispheric ambient plus the startup lightmap
// bake (sun_/splash_ spots + F_ fixture area lights baked into per-mesh UV2 maps).

var _ovgal_lights = {
	ambientUp: null,
	ambientDown: null
};

// ---------------------------------------------------------------------------
// Bake tuning presets — the single source of truth for every value the debug
// sliders expose. Once the sliders are removed these become the fixed bake
// settings; edit them here. Per-light cone angle/color authored in the GLB
// still override intensity/innerDeg/outerDeg/color at bake time (see _runBake);
// these are the fallback used when nothing is authored.
var BAKE_DEFAULTS = {
	intensity: 0.65,     // spot brightness multiplier
	maxDist: 12.0,       // light reach in meters ("reach" slider)
	innerDeg: 12.0,      // cone inner angle (full brightness)
	outerDeg: 48.5,      // cone outer angle (falloff to zero)
	color: { r: 1.0, g: 0.97, b: 0.93 },
	ambient: 1.0,        // multiplier on the baked-in hemispheric ambient (1 = match runtime)
	shadowRes: 1024,     // per-light depth map resolution
	shadowDarkness: 0.18,// 0 = black shadow, 1 = no shadow
	shadowBias: 0.04,    // depth-compare bias in meters (acne vs peter-panning)
	aoStrength: 0.36,    // 0 = no AO, 1 = full AO darkening of the ambient
	aoRadius: 1.3,       // meters — only blockers within this reach darken
	aoBias: 0.08,        // normal offset (meters) lifting the march off the surface
	size: 1024           // lightmap atlas resolution per mesh
};

/**
 * Initializes all lighting in the scene.
 * Call once after scene is created (before galleries load).
 * @param {BABYLON.Scene} scene
 * @param {Object} config - config_file_content (needs Technical.ambientLight)
 */
function initGalleryLighting(scene, config) {
	_ovgal_lights.ambientUp = new BABYLON.HemisphericLight("hemiLight_up", new BABYLON.Vector3(0, 1, 0), scene);
	_ovgal_lights.ambientDown = new BABYLON.HemisphericLight("hemiLight_down", new BABYLON.Vector3(0, -1, 0), scene);

	_ovgal_lights.ambientUp.intensity = config["Technical"]["ambientLight"];
	_ovgal_lights.ambientDown.intensity = config["Technical"]["ambientLight"] / 2;
}

/**
 * Sets up lighting for a newly loaded gallery room.
 * Call after template + artworks are loaded into the scene.
 * @param {BABYLON.Scene} scene
 * @param {Object} config - config_file_content
 */
function setupRoomLighting(scene, config) {
	// Set pointLight intensities: parse _I{value} from name, fall back to Technical.pointLight
	scene.lights.forEach(function(light) {
		if (light.name.startsWith("pointLight")) {
			var match = light.name.match(/_I(\d+(?:\.\d+)?)/);
			if (match) {
				light.intensity = parseFloat(match[1]);
			} else {
				light.intensity = config["Technical"]["pointLight"];
			}
		} else if (light.name.match(/^(?:sun|splash)_\d+/)) {
			// Authoring markers for the lightmap bake: their pose seeds the baked
			// spots, the runtime light itself stays off (zero-runtime-light design).
			light.setEnabled(false);
		} else if (light.name !== 'hemiLight_up' && light.name !== 'hemiLight_down') {
			light.setEnabled(false);
			console.log("Lighting: disabled unmanaged light '" + light.name + "')");
		}
	});

	// Read ambient intensity from template TransformNodes, fall back to Technical.ambientLight
	var ambUpNode = scene.transformNodes.find(function(n) { return n.name.match(/^ambientLightUp_I/i); });
	var ambDownNode = scene.transformNodes.find(function(n) { return n.name.match(/^ambientLightDown_I/i); });
	if (ambUpNode) {
		var m = ambUpNode.name.match(/_I(\d+(?:\.\d+)?)/);
		if (m && _ovgal_lights.ambientUp) {
			_ovgal_lights.ambientUp.intensity = parseFloat(m[1]);
			console.log("Lighting: ambientUp from template = " + m[1]);
		}
	}
	if (ambDownNode) {
		var m = ambDownNode.name.match(/_I(\d+(?:\.\d+)?)/);
		if (m && _ovgal_lights.ambientDown) {
			_ovgal_lights.ambientDown.intensity = parseFloat(m[1]);
			console.log("Lighting: ambientDown from template = " + m[1]);
		}
	}

	// Hide helper meshes from templates. F_ fixtures are decorative geometry only —
	// they seed the baked area lights (see _collectConesFromFixtures); no runtime
	// RectAreaLight is created from them anymore.
	scene.meshes.forEach(function(m) {
		if (m.name.match(/^Occupancy_/) || m.name === 'door_title') m.isVisible = false;
	});
}

/**
 * Freezes all BJS_materials — call after lights AND materials are assigned to meshes.
 */
function freezeGalleryMaterials() {
	if (typeof BJS_materials !== 'undefined') {
		for (var matName in BJS_materials) {
			BJS_materials[matName].freeze();
		}
		console.log("Lighting: froze BJS_materials");
	}
}

/**
 * Drops the bake's cached state. Call after disposing a room's AssetContainer:
 * the dispose destroys the bake's ShaderMaterials (they live in scene.materials),
 * and the _ensure* guards would otherwise keep handing out the disposed objects.
 * Everything is rebuilt from BAKE_DEFAULTS on the next setupLightmapBake.
 */
function resetLightmapBakeCache() {
	_ovgal_bake = null;
	window._bake = null;
}

// =====================================================================
// Spot-light cone collectors — shared by the lightmap bake. Resolve the
// authored spot markers (splash_N glTF spots, F_ fixtures, or a template
// marker spot) into world-space { pos, dir } cones the bake accumulates,
// one render pass per light. BAKE_MAX_LIGHTS caps how many a room may have.
// =====================================================================
var BAKE_MAX_LIGHTS = 100;

// Rect (area) light model. Each F_ fixture panel is baked as a grid of point
// sub-lights stratified across its rectangle, each at 1/samples intensity. The
// offset shadow casters average into a soft penumbra — a true area light, reusing
// the splash pass + per-light depth map with no shader change. Samples per edge
// scale with that edge's length (SPACING), so a long strip fills without a gap and
// a short side isn't over-sampled; MAX_PER_AXIS + BAKE_MAX_LIGHTS cap the total.
var BAKE_RECT_SPACING = 1.0;      // target meters between area-light samples
var BAKE_RECT_MAX_PER_AXIS = 15;  // per-edge sample cap
// Rect sub-lights emulate a Lambertian panel, not a spotlight. Two constraints:
//  (1) a 90-degree "cone" is not a cone: its outer edge is the plane through
//      the light with normal = aim, and that plane hits the floor/walls as a
//      dead-straight HARD LINE when the feather is thin. So the shoulder must
//      be WIDE — flat only within 45 of the aim, then a long smooth ramp — so
//      any cutoff reads as a soft gradient, never an edge.
//  (2) grazing (~90, the concave-corner texels of the adjacent wall) must get
//      a SMALL but nonzero amount: exactly-zero-at-90 leaves the corner strip
//      dark from both panels (dark wedge); full-at-90 over-lights it (bright
//      leak). Outer just past 90 puts grazing at ~10% on the wide ramp — soft
//      corner fill, no wedge either way. The tiny bleed a few degrees behind
//      the plane is visually negligible.
var BAKE_RECT_COS_OUTER = Math.cos(100 * Math.PI / 180);  // ~-0.174 — ~10% fill at grazing
var BAKE_RECT_COS_INNER = Math.cos(45 * Math.PI / 180);   // ~0.707 — wide soft shoulder

// Parse cone origins + aim directions from the F_ fixtures, expanded into the
// rect model's sample grid. Returns { lights, count }.
function _collectConesFromFixtures(scene) {
	var lights = [];   // per-cone { pos, dir } for the shadow bake
	var count = 0;

	function parseCoord(s) {
		if (s.charAt(0) === 'n') return -parseFloat(s.substring(1));
		return parseFloat(s);
	}

	var fixtures = scene.meshes.filter(function (m) { return m.name.match(/^F_\d+/); });

	// Pass 1: resolve each panel's aim + oriented frame + desired grid. Emission
	// waits until the sample budget is settled — the old emit-until-full loop cut
	// a panel off mid-grid (lit on one side only, and under-powered because
	// 1/(nu*nv) assumed the full grid) and left every later panel dark.
	var panels = [];
	for (var i = 0; i < fixtures.length; i++) {
		var fixture = fixtures[i];
		var parts = fixture.name.split("_");
		if (parts.length < 5) continue;

		var bx = parseCoord(parts[2]);
		var by = parseCoord(parts[3]);
		var bz = parseCoord(parts[4]);
		// Blender (x, y, z) -> Babylon (x, z, y), same mapping as the rect lights.
		var axis = new BABYLON.Vector3(bx, bz, by);
		if (axis.length() < 0.01) continue;
		axis.normalize();

		// Emission direction. The panel emits along the LOCAL -Z of a frame oriented
		// from the name vector (yaw = atan2(x,z), pitch = -atan2(-y, horiz)), not the
		// raw vector. Build that rotation and read its -Z, so the aim is derived with
		// no handedness assumption.
		var horizLen = Math.sqrt(axis.x * axis.x + axis.z * axis.z);
		var aimYaw = (horizLen < 0.01) ? 0 : Math.atan2(axis.x, axis.z);
		var aimPitch = -Math.atan2(-axis.y, horizLen);
		var aimRot = BABYLON.Matrix.RotationYawPitchRoll(aimYaw, aimPitch, 0);
		var aim = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(0, 0, -1), aimRot);
		aim.normalize();

		fixture.computeWorldMatrix(true);
		fixture.refreshBoundingInfo();
		var pos = fixture.getAbsolutePosition();
		var bb = fixture.getBoundingInfo().boundingBox;
		var wm = fixture.getWorldMatrix();
		var half = bb.extendSize;   // local half-sizes (respect the panel's own frame)

		// The panel's three oriented world axes (local X/Y/Z mapped through the world
		// matrix), each with its world half-extent = local half-size × axis scale.
		// Sorting by half-extent, the two largest are the rectangle's in-plane edges;
		// the smallest is its thickness (normal). This follows a rotated/tilted panel
		// exactly — unlike the axis-aligned bounding box, which a rotation skews.
		var ax = [
			{ d: BABYLON.Vector3.TransformNormal(BABYLON.Axis.X, wm), h: half.x },
			{ d: BABYLON.Vector3.TransformNormal(BABYLON.Axis.Y, wm), h: half.y },
			{ d: BABYLON.Vector3.TransformNormal(BABYLON.Axis.Z, wm), h: half.z }
		];
		for (var a = 0; a < 3; a++) { ax[a].h *= ax[a].d.length(); ax[a].d.normalize(); }
		ax.sort(function (p, q) { return q.h - p.h; });
		var U = ax[0], V = ax[1];   // in-plane edges (half-extents U.h, V.h)

		// Samples per edge proportional to its length: a long strip gets many
		// samples along its length (no middle gap) without wasting them across its
		// narrow side. Capped per axis and by the global light budget.
		var nu = Math.min(BAKE_RECT_MAX_PER_AXIS, Math.max(1, Math.round(2 * U.h / BAKE_RECT_SPACING)));
		var nv = Math.min(BAKE_RECT_MAX_PER_AXIS, Math.max(1, Math.round(2 * V.h / BAKE_RECT_SPACING)));
		// Authored per-fixture intensity (F_..._I{value}); null falls back to the
		// global slider in the bake driver.
		var intensity = _parseNameSuffix(fixture.name, "I");
		panels.push({ pos: pos, aim: aim, U: U, V: V, nu: nu, nv: nv, intensity: intensity });
	}

	// Over budget: shrink the densest grid one sample at a time, so every panel
	// keeps a full symmetric grid — just coarser. Only when there are more panels
	// than the budget itself are panels dropped, loudly.
	function _totalSamples() {
		var t = 0;
		for (var p = 0; p < panels.length; p++) t += panels[p].nu * panels[p].nv;
		return t;
	}
	while (_totalSamples() > BAKE_MAX_LIGHTS) {
		var big = panels[0];
		for (var q = 1; q < panels.length; q++) {
			if (panels[q].nu * panels[q].nv > big.nu * big.nv) big = panels[q];
		}
		if (big.nu * big.nv <= 1) {
			console.warn("Lighting: " + panels.length + " F_ panels exceed the bake light budget ("
				+ BAKE_MAX_LIGHTS + ") — panels beyond the budget are dropped");
			panels.length = BAKE_MAX_LIGHTS;
			break;
		}
		if (big.nu >= big.nv) big.nu--; else big.nv--;
	}

	// Pass 2: emit each panel's stratified sample grid.
	for (var k = 0; k < panels.length && count < BAKE_MAX_LIGHTS; k++) {
		var pn = panels[k];
		var rectScale = 1.0 / (pn.nu * pn.nv);   // total energy matches a single panel light
		for (var iu = 0; iu < pn.nu; iu++) {
			for (var iv = 0; iv < pn.nv; iv++) {
				// Cell-center offsets in meters from the panel center, along the
				// oriented edges (full 3D, so a tilted panel's samples follow its plane).
				var du = ((iu + 0.5) / pn.nu - 0.5) * 2 * pn.U.h;
				var dv = ((iv + 0.5) / pn.nv - 0.5) * 2 * pn.V.h;
				// 0.2 m off the panel ALONG THE AIM: identical to the old world -Y drop
				// for the usual down-facing panel, but a wall-mounted panel's samples now
				// sit in front of its face instead of slid down it (where its own mesh
				// shadow-clipped them).
				var sx = pn.pos.x + pn.aim.x * 0.2 + pn.U.d.x * du + pn.V.d.x * dv;
				var sy = pn.pos.y + pn.aim.y * 0.2 + pn.U.d.y * du + pn.V.d.y * dv;
				var sz = pn.pos.z + pn.aim.z * 0.2 + pn.U.d.z * du + pn.V.d.z * dv;
				lights.push({ pos: new BABYLON.Vector3(sx, sy, sz), dir: pn.aim.clone(), scale: rectScale,
					cosOuter: BAKE_RECT_COS_OUTER, cosInner: BAKE_RECT_COS_INNER,
					intensity: (typeof pn.intensity === 'number') ? pn.intensity : undefined });
				count++;
			}
		}
	}

	return { lights: lights, count: count };
}

// Parse an authored _<letter><number> suffix (e.g. _I10, _R6) from a name.
// Anchored: the numeric token must be followed by _ or end-of-string, so it is
// never matched inside an unrelated word. Returns the number (0 is valid), or
// null when the suffix is absent.
function _parseNameSuffix(name, letter) {
	if (!name) return null;
	var m = name.match(new RegExp("_" + letter + "(\\d+(?:\\.\\d+)?)(?=_|$)"));
	return m ? parseFloat(m[1]) : null;
}

// Cone source from glTF SpotLights. With nameFilter (e.g. /^splash_\d+/) it
// selects only the explicitly-authored splash spots; without it, any spot (the
// template's marker). Cone origin = spot world position, axis = spot world
// direction — both resolved by Babylon's glTF loader, so no manual handedness
// math. Static, so the visibility volume bakes once at load.
function _collectConesFromSpotLights(scene, nameFilter) {
	var lights = [];   // per-cone { pos, dir } for the shadow bake
	var count = 0;

	var spots = scene.lights.filter(function (l) {
		// Match on the parent NODE name (the Blender object) — the single source
		// of truth — not l.name (the KHR light DATA-BLOCK name), which authors
		// rarely rename in lockstep. Falls back to l.name when there's no parent.
		var authoredName = (l.parent && l.parent.name) ? l.parent.name : l.name;
		return l.getClassName && l.getClassName() === "SpotLight"
			&& (!nameFilter || nameFilter.test(authoredName));
	});
	for (var i = 0; i < spots.length && count < BAKE_MAX_LIGHTS; i++) {
		var spot = spots[i];
		// Marker lights are parented to their glTF node; refresh that matrix
		// then resolve world-space pos/dir (computeTransformedInformation fills
		// transformedPosition/Direction; locals are the unparented fallback).
		if (spot.parent && spot.parent.computeWorldMatrix) spot.parent.computeWorldMatrix(true);
		spot.computeTransformedInformation();
		var pos = spot.transformedPosition || spot.position;
		var dir = (spot.transformedDirection || spot.direction).clone();
		if (dir.length() < 0.01) continue;
		dir.normalize();

		// Cone aperture authored in the GLB: Babylon's glTF loader stores the
		// KHR_lights_punctual outerConeAngle/innerConeAngle as SpotLight.angle /
		// .innerAngle (FULL cone angles, radians). Our cone math compares against
		// the cosine of the half-angle (dot of fragment dir vs axis), so halve.
		// innerAngle is often 0 (exporters omit it) -> leave cosInner null so the
		// bake falls back to the global softness slider.
		var cosOuter = (typeof spot.angle === 'number' && spot.angle > 0)
			? Math.cos(spot.angle * 0.5) : null;
		var cosInner = (typeof spot.innerAngle === 'number' && spot.innerAngle > 0)
			? Math.cos(spot.innerAngle * 0.5) : null;

		// Per-light suffixes are authored on the Blender OBJECT, which the glTF
		// loader turns into this spot's parent NODE (e.g. "splash_0_I2_R0"). That
		// node name is the SINGLE SOURCE OF TRUTH. The KHR light data-block name
		// (spot.name, e.g. "splash_0") is exporter plumbing the user rarely edits,
		// so it is ignored for authoring — falling back to it only when the light
		// has no parent node at all.
		//   _I<value> -> per-light intensity (e.g. _I10). Absent -> null, so the
		//                bake falls back to the global intensity slider.
		//   _R<value> -> per-light reach (splash distance falloff radius, meters).
		//                Absent -> null, so the bake falls back to the reach slider.
		//                Ignored for suns (a sun has no distance falloff by definition).
		// The sun_/splash_ PREFIX chooses the light model: sun = parallel rays along the
		// aim, no cone, no falloff, orthographic shadow; splash = divergent cone + reach.
		var nodeName = (spot.parent && spot.parent.name) ? spot.parent.name : spot.name;
		var intensity = _parseNameSuffix(nodeName, "I");
		var reach = _parseNameSuffix(nodeName, "R");
		var isSun = /^sun_\d+/.test(nodeName);

		// If a suffix was mistakenly authored on the ignored light name and it
		// disagrees with the node, warn — the object name is what counts.
		if (spot.parent && spot.name && spot.name !== nodeName) {
			var lightI = _parseNameSuffix(spot.name, "I");
			var lightR = _parseNameSuffix(spot.name, "R");
			if ((lightI !== null && lightI !== intensity) || (lightR !== null && lightR !== reach)) {
				console.warn("Lighting: suffix on light name '" + spot.name
					+ "' ignored — author _I/_R on the object name ('" + nodeName + "').");
			}
		}

		lights.push({ pos: pos.clone(), dir: dir.clone(), cosOuter: cosOuter, cosInner: cosInner, intensity: intensity, reach: reach, sun: isSun });
		count++;
	}

	return { lights: lights, count: count };
}

// =====================================================================
// Startup lightmap bake (Lightmap V3) — EXPERIMENTAL. Enable with ?bake=1.
// Bakes the contribution of every spot light into a per-mesh UV2 lightmap
// at load time, then displays it. Spot sources in priority order: splash_N
// spots → F_ fixtures → template marker spot, evaluated with analytic cone
// math but baked into texels instead of per-fragment — which is what lets us
// fold in shadows + many lights for ~zero per-frame cost.
//
// Technique: a bake ShaderMaterial whose VERTEX shader writes UV2 as clip
// position (uv2*2-1), so each mesh rasterizes into its own 0..1 lightmap;
// the FRAGMENT shader evaluates the spots at the interpolated world pos and
// writes irradiance to a half-float RTT (float = no banding when many
// lights accumulate). Per-mesh UV2 → one RTT per mesh → the mesh's shared
// GLB material is CLONED so each can carry its own map.
//
// PHASE 3 (this): per-light shadows folded into the bake. The single-pass
// "loop all spots" shader is replaced by ONE render pass per light into a
// ping-pong pair of half-float RTTs: each pass reads the previous accumulation,
// adds this light's cone contribution MULTIPLIED by a shadow term sampled from
// that light's depth map, and writes the sum. Hemispheric ambient is folded
// into the first pass. B toggles the baked view on/off.
//
// Shadows use our own depth map per light (linear distance from the light,
// stored in meters) rendered with a custom depth ShaderMaterial — no dependence
// on Babylon's internal shadow-map encoding. The light view-projection used to
// render each depth map is the SAME matrix sampled in the bake, so the convention
// is self-consistent regardless of handedness / NDC depth range.
// =====================================================================
var _ovgal_bake = null;

// Splash shadow frustum FLOOR. Each splash depth map is sized to its own authored
// outer cone (fov = 2*outer + margin, see _buildShadowMaps), so a cone wider than
// this grows the frustum to match; narrower cones just use this floor. Sun/splash
// texels past the frustum fall back to the voxel-grid march in the bake shader
// (sampleShadow -> voxelShadow); the depth-map FOV is sized from the authored
// cone so the lit ring stays inside the map rather than on the coarse fallback.
var BAKE_SHADOW_FOV = 110 * Math.PI / 180;
// Extra FOV past 2*outer so the 3x3 PCF taps at the cone edge stay inside the map
// (same reasoning as BAKE_RECT_FACE_FOV's 120 for a 109.5 requirement), and a hard
// cap where perspective texels degenerate near 180 (voxelShadow covers wider).
var BAKE_SHADOW_FOV_MARGIN = 10 * Math.PI / 180;
var BAKE_SHADOW_FOV_CAP = 150 * Math.PI / 180;

// Rect sub-lights instead get FULL-coverage shadowing: up to 6 depth maps per
// sub-light, one per world axis ("cube faces"), and one gated bake pass per map
// so every texel is depth-tested against exactly one face — never the voxel
// march. The voxel fallback at ~12 cm quantization was the source of both the
// wall/ceiling staircase (floor() parity made it differ on 2 of 4 edges) and
// the dark corner bands (wall-hugging rays false-hitting the adjacent wall's
// voxel layer). A cube-face region spans up to 54.74 deg off its axis (the
// corner direction), so the face FOV must exceed 109.5 deg for the 3x3 PCF taps
// at the region edge to stay inside the map.
var BAKE_RECT_FACE_FOV = 120 * Math.PI / 180;
var BAKE_RECT_FACE_AXES = [
	[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];   // index = face id, must match the dominant-axis pick in the bake shader
var BAKE_SHADOW_NEAR = 0.2;
var BAKE_SHADOW_FAR = 50.0;

// Ambient occlusion (voxel ray-march). The room is voxelized into a coarse solid
// occupancy grid; per surface texel we trace short rays over the hemisphere and
// darken where nearby geometry blocks them. Unlike external depth maps, this sees
// interior objects (the bench, the backs of frames), so it produces real contact
// shadows — corners, skirting, and a pool under the bench — not flat fill.
var BAKE_AO_GRID = 96;    // voxels along the room's longest axis (cubic voxels)
var BAKE_AO_BUF = 256;    // per-mesh AO buffer resolution (AO is low-frequency)
var BAKE_AO_DIRS = 24;    // hemisphere sample rays (sphere dirs, back hemisphere culled)
var BAKE_AO_STEPS = 24;   // max march steps per ray (capped by radius)
var BAKE_AO_SS = 6;       // supersample: re-march the ray set rotated by N stratified angles, averaged
var _bakeAoDirsCache = null;

// Evenly distributed unit directions (Fibonacci sphere). Built lazily — BABYLON
// isn't guaranteed loaded at module-parse time, so we keep plain {x,y,z} objects.
function _bakeAODirs() {
	if (_bakeAoDirsCache) return _bakeAoDirsCache;
	var dirs = [];
	var n = BAKE_AO_DIRS;
	var ga = Math.PI * (3 - Math.sqrt(5));   // golden angle
	for (var i = 0; i < n; i++) {
		var y = 1 - (i + 0.5) / n * 2;       // 1 .. -1
		var r = Math.sqrt(Math.max(0, 1 - y * y));
		var phi = i * ga;
		dirs.push({ x: Math.cos(phi) * r, y: y, z: Math.sin(phi) * r });
	}
	_bakeAoDirsCache = dirs;
	return dirs;
}

function _refreshBakeAngles() {
	var b = _ovgal_bake;
	b.cosInner = Math.cos(b.innerDeg * Math.PI / 180);
	b.cosOuter = Math.cos(b.outerDeg * Math.PI / 180);
}

// Define the bake ShaderMaterial once. Vertex remaps UV2 -> clip space so the
// mesh draws into its lightmap; fragment evaluates ONE light (cone * shadow) and
// adds it to the previous accumulation read back from prevTex (ping-pong).
function _ensureBakeMaterial(scene) {
	if (_ovgal_bake.material) return;

	BABYLON.Effect.ShadersStore["ovgalBakeVertexShader"] =
		"precision highp float;\n" +
		"attribute vec3 position;\n" +
		"attribute vec3 normal;\n" +
		"attribute vec2 uv2;\n" +
		"uniform mat4 world;\n" +
		"varying vec3 vPositionW;\n" +
		"varying vec3 vNormalW;\n" +
		"varying vec2 vUV2;\n" +
		"void main(void){\n" +
		"  vec4 wp = world * vec4(position, 1.0);\n" +
		"  vPositionW = wp.xyz;\n" +
		"  vNormalW = normalize((world * vec4(normal, 0.0)).xyz);\n" +
		"  vUV2 = uv2;\n" +                     // sample the previous accumulation at the same texel
		"  vec2 clip = uv2 * 2.0 - 1.0;\n" +    // 0..1 lightmap UV -> NDC; flip Y here if the bake reads upside down
		"  gl_Position = vec4(clip, 0.0, 1.0);\n" +
		"}\n";

	BABYLON.Effect.ShadersStore["ovgalBakeFragmentShader"] =
		"precision highp float;\n" +
		"varying vec3 vPositionW;\n" +
		"varying vec3 vNormalW;\n" +
		"varying vec2 vUV2;\n" +
		"uniform vec4 bakeGlobals;\n" +    // x=sun flag (>0.5 = directional sun), y=unused, z=intensity, w=reach (splash maxDist; <=0 = no falloff)
		"uniform vec4 bakeColor;\n" +      // rgb=light color
		"uniform vec4 bakeAmbient;\n" +    // x=hemi intensity up, y=hemi intensity down (white, ground=black)
		"uniform vec4 bakeLight;\n" +      // xyz=this light world pos, w=cosInner (per-light)
		"uniform vec4 bakeAxis0;\n" +      // xyz=this light aim dir, w=cosOuter (per-light, from GLB)
		"uniform vec4 shadowParams;\n" +   // x=darkness, y=bias(m), z=isFirstPass, w=texelSize
		"uniform mat4 lightMatrix;\n" +    // this light view-projection (for the shadow UV)
		"uniform vec4 aoParams;\n" +       // x = AO strength (0=off, 1=full), y = voxel size (m), z = 1 when the occupancy grid is bound
		"uniform vec4 faceParams;\n" +     // x = cube-face id this pass covers (-1 = ungated), y = shadow-texel world size per meter of distance
		"uniform vec3 gridMin;\n" +        // occupancy grid corner (shared with the AO pass)
		"uniform vec4 gridN;\n" +          // xyz = voxel counts per axis
		"uniform vec4 gridTile;\n" +       // x=tilesX, y=tilesY, z=texW, w=texH
		"uniform sampler2D prevTex;\n" +   // previous accumulation (ping-pong)
		"uniform sampler2D shadowSampler;\n" + // this light's depth map (linear meters in .r)
		"uniform sampler2D aoSampler;\n" + // this mesh's baked AO (.r = AO, .g = 1)
		"uniform sampler2D aoGrid;\n" +    // room occupancy atlas (voxel-march fallback)
		"float sampleGrid(vec3 P){\n" +
		"  vec3 vc = floor((P - gridMin) / aoParams.y);\n" +
		"  if (vc.x < 0.0 || vc.y < 0.0 || vc.z < 0.0 ||\n" +
		"      vc.x >= gridN.x || vc.y >= gridN.y || vc.z >= gridN.z) return 0.0;\n" +
		"  float tx = mod(vc.z, gridTile.x);\n" +
		"  float ty = floor(vc.z / gridTile.x);\n" +
		"  float px = tx * gridN.x + vc.x + 0.5;\n" +
		"  float py = ty * gridN.y + vc.y + 0.5;\n" +
		"  return texture2D(aoGrid, vec2(px / gridTile.z, py / gridTile.w)).r;\n" +
		"}\n" +
		// Coverage fallback for texels outside a light's depth-map frustum, which used
		// to return "fully lit" (light leaked through walls into neighbouring rooms).
		// Only sun/splash lights can land here now — rect sub-lights carry full
		// cube-face map coverage, so they never take this ~voxel-quantized path.
		// Out-of-frustum texels march the room's voxel occupancy grid toward the
		// light instead: coarse, but a wall always blocks. Start lifted off the
		// surface's own voxel layer; stop 2 voxels short of the light so the emitting
		// panel's voxels (the light sits 0.2 m from them) never self-occlude.
		// Corner de-hug: rays from texels near a wall/wall or wall/ceiling junction run
		// parallel to the adjacent surface inside its own voxel layer and false-hit it
		// for meters (staircase bands along corners). A 6-tap occupancy gradient at the
		// texel gives a per-axis "escape" offset (1.5 voxels per hugged surface, not
		// normalized — a corner needs full clearance on every axis). The offset tapers
		// to zero at the light so the far end never drifts into the fixture housing;
		// that matches the geometry, since a hugged surface is closest at the texel
		// and the straight ray gains clearance toward the light.
		"float voxelShadow(vec3 P, vec3 N){\n" +
		"  if (aoParams.z < 0.5) return 1.0;\n" +
		"  vec3 L = bakeLight.xyz - P;\n" +
		"  float dist = length(L);\n" +
		"  vec3 d = L / max(dist, 1e-4);\n" +
		"  float vs = aoParams.y;\n" +
		"  vec2 e = vec2(vs, 0.0);\n" +
		"  vec3 esc = vec3(\n" +
		"    sampleGrid(P - e.xyy) - sampleGrid(P + e.xyy),\n" +
		"    sampleGrid(P - e.yxy) - sampleGrid(P + e.yxy),\n" +
		"    sampleGrid(P - e.yyx) - sampleGrid(P + e.yyx));\n" +
		"  esc -= d * dot(esc, d);\n" +
		"  vec3 off = esc * (vs * 1.5);\n" +
		"  vec3 P0 = P + N * vs * 1.5;\n" +
		"  float end = dist - 2.0 * vs;\n" +
		"  for (int s = 1; s <= 192; s++){\n" +   // 192 * voxel >= grid diagonal
		"    float t = vs * float(s);\n" +
		"    if (t > end) break;\n" +
		"    if (sampleGrid(P0 + d * t + off * (1.0 - t / end)) > 0.5) return shadowParams.x;\n" +
		"  }\n" +
		"  return 1.0;\n" +
		"}\n" +
		// Normal-offset (rect faces only, faceParams.y > 0): lift the receiver off its
		// surface by ~1-3 shadow texels' world size before projecting. At a concave
		// corner the adjacent wall is edge-on to the light, so its stored depths share
		// the receiver's shadow-map texel with a huge gradient no depth bias covers —
		// the classic grazing-blocker seam. Shifting the receiver along its own normal
		// moves its projected UV off that wall's silhouette band instead.
		"float sampleShadow(vec3 P, vec3 N, float ndl){\n" +
		"  float nOff = faceParams.y * length(P - bakeLight.xyz) * (1.0 + 2.0 * (1.0 - ndl));\n" +
		"  nOff = min(nOff, 0.02);\n" +   // cap: a picture frame stands only ~3 cm proud, so an offset larger than that shoves the receiver in front of the frame's lower rail and erases the contact shadow below it. 2 cm still clears corner acne.
		"  vec3 Ps = P + N * nOff;\n" +
		"  vec4 sc = lightMatrix * vec4(Ps, 1.0);\n" +
		"  if (sc.w <= 0.0) return voxelShadow(P, N);\n" +
		"  vec2 uv = (sc.xy / sc.w) * 0.5 + 0.5;\n" +
		"  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return voxelShadow(P, N);\n" +
		"  float cur = length(Ps - bakeLight.xyz);\n" +
		// Slope-scaled bias: a surface the light grazes (small ndl) has steep depth
		// gradients across a depth texel, so a constant bias can't prevent self-acne.
		// Scale the bias up toward grazing angles. Head-on (ndl=1) -> base bias.
		"  float bias = shadowParams.y * (1.0 + 6.0 * (1.0 - clamp(ndl, 0.0, 1.0)));\n" +
		"  float t = shadowParams.w;\n" +
		"  float sh = 0.0;\n" +
		"  for (int dx = -1; dx <= 1; dx++){\n" +
		"    for (int dy = -1; dy <= 1; dy++){\n" +
		"      float stored = texture2D(shadowSampler, uv + vec2(float(dx), float(dy)) * t).r;\n" +
		"      sh += (cur - bias > stored) ? 0.0 : 1.0;\n" +
		"    }\n" +
		"  }\n" +
		"  sh /= 9.0;\n" +
		"  return mix(shadowParams.x, 1.0, sh);\n" +   // occluded -> darkness, lit -> 1
		"}\n" +
		"void main(void){\n" +
		"  vec3 N = normalize(vNormalW);\n" +
		// Vector light->fragment from the light's finite position: always needed for the
		// shadow depth compare, and for a splash's divergent direction + distance falloff.
		"  vec3 L = vPositionW - bakeLight.xyz;\n" +
		"  float dist = length(L);\n" +
		"  vec3 dirPoint = L / max(dist, 1e-4);\n" +
		// sun (bakeGlobals.x > 0.5): parallel rays along the authored aim direction, no
		// cone, no distance falloff — the 5 shafts stay parallel and equally bright, and
		// the openings come purely from the roof shadow. splash: rays fan out from the
		// point with an angular cone + reach falloff.
		"  bool isSun = bakeGlobals.x > 0.5;\n" +
		"  vec3 dir = isSun ? bakeAxis0.xyz : dirPoint;\n" +
		"  float cone = isSun ? 1.0 : smoothstep(bakeAxis0.w, bakeLight.w, dot(dirPoint, bakeAxis0.xyz));\n" +
		"  float radial = isSun ? 1.0 : ((bakeGlobals.w <= 0.0) ? 1.0 : 1.0 - smoothstep(0.0, bakeGlobals.w, dist));\n" +
		"  float ndl = max(dot(N, -dir), 0.0);\n" +
		// Cube-face gate: a rect sub-light runs one pass per face map, and each texel
		// must be lit by exactly one of them — the one whose axis dominates its
		// light->texel direction. The >= tie-breaks are deterministic (same result
		// every pass), so the partition is exact: no double-lit, no gap, no seam.
		"  float gate = 1.0;\n" +
		"  if (faceParams.x > -0.5){\n" +
		"    vec3 aD = abs(dirPoint);\n" +
		"    float f = (aD.x >= aD.y && aD.x >= aD.z) ? (dirPoint.x >= 0.0 ? 0.0 : 1.0)\n" +
		"            : (aD.y >= aD.z) ? (dirPoint.y >= 0.0 ? 2.0 : 3.0)\n" +
		"            : (dirPoint.z >= 0.0 ? 4.0 : 5.0);\n" +
		"    if (abs(f - faceParams.x) > 0.1) gate = 0.0;\n" +
		"  }\n" +
		// Skip the shadow work (9 depth taps or a voxel march) where this light
		// contributes nothing anyway — most texels of most passes with a wide cone.
		"  float occ = 1.0;\n" +
		"  if (gate * cone * radial * ndl > 1e-5) occ = sampleShadow(vPositionW, N, ndl);\n" +
		"  vec3 lit = vec3(gate * cone * radial * ndl) * bakeColor.rgb * bakeGlobals.z * occ;\n" +
		"  vec3 prev;\n" +
		"  if (shadowParams.z > 0.5){\n" +
		"    // first pass: no previous buffer; seed with the baked-in hemi ambient,\n" +
		"    // darkened by baked AO (geometry boxing the point in -> less ambient).\n" +
		"    float hemi = (N.y * 0.5 + 0.5) * bakeAmbient.x\n" +
		"               + (-N.y * 0.5 + 0.5) * bakeAmbient.y;\n" +
		"    vec2 ao2 = texture2D(aoSampler, vUV2).rg;\n" +
		"    float ao = ao2.y > 0.0 ? clamp(ao2.x / ao2.y, 0.0, 1.0) : 1.0;\n" +
		"    float aoF = mix(1.0, ao, aoParams.x);\n" +
		"    prev = vec3(hemi * aoF);\n" +
		"  } else {\n" +
		"    prev = texture2D(prevTex, vUV2).rgb;\n" +
		"  }\n" +
		"  gl_FragColor = vec4(prev + lit, 1.0);\n" +
		"}\n";

	var mat = new BABYLON.ShaderMaterial("ovgalBake", scene,
		{ vertex: "ovgalBake", fragment: "ovgalBake" },
		{
			attributes: ["position", "normal", "uv2"],
			uniforms: ["world", "bakeGlobals", "bakeColor", "bakeAmbient", "bakeLight",
				"bakeAxis0", "shadowParams", "lightMatrix", "aoParams", "faceParams",
				"gridMin", "gridN", "gridTile"],
			samplers: ["prevTex", "shadowSampler", "aoSampler", "aoGrid"]
		});
	// Texture-space winding is arbitrary, so never cull or we drop texels.
	mat.backFaceCulling = false;
	_ovgal_bake.material = mat;
}

// PHASE 5 display shader — shows the baked room through the real camera, NOT a
// debug emissive view: surface albedo (UV1) multiplied by the baked lightmap
// (UV2). Deliberately avoids the BJS_ NodeMaterials — we only READ their albedo
// texture, never rewire the graph. Cloned per mesh so each carries its own
// albedo + lightmap. Falls back to lightmap-only (hasAlbedo=0) when a mesh has
// no recognizable base-color texture.
function _ensureDisplayMaterial(scene) {
	if (_ovgal_bake.displayMat) return;

	BABYLON.Effect.ShadersStore["ovgalDisplayVertexShader"] =
		"precision highp float;\n" +
		"attribute vec3 position;\n" +
		"attribute vec2 uv;\n" +
		"attribute vec2 uv2;\n" +
		"uniform mat4 worldViewProjection;\n" +
		"uniform vec4 uvScaleOffset;\n" +  // xy = albedo uScale/vScale, zw = uOffset/vOffset (KHR_texture_transform)
		"varying vec2 vUV;\n" +
		"varying vec2 vUV2;\n" +
		"void main(void){\n" +
		"  vUV = uv * uvScaleOffset.xy + uvScaleOffset.zw;\n" +  // apply the texture's tiling scale + offset
		"  vUV2 = uv2;\n" +
		"  gl_Position = worldViewProjection * vec4(position, 1.0);\n" +
		"}\n";

	BABYLON.Effect.ShadersStore["ovgalDisplayFragmentShader"] =
		"precision highp float;\n" +
		"varying vec2 vUV;\n" +
		"varying vec2 vUV2;\n" +
		"uniform sampler2D albedoSampler;\n" +
		"uniform sampler2D lightSampler;\n" +
		"uniform float hasAlbedo;\n" +    // 1 = multiply by albedo texture, 0 = use albedoColor
		"uniform vec3 albedoColor;\n" +   // flat base-color fallback (gamma space); white when none
		"uniform vec2 lmTexel;\n" +       // 1/lightmapSize — one texel step in UV2
		// Coverage-weighted bilinear: the lightmap (NEAREST) stores alpha=1 on baked
		// texels, 0 on the uncovered border past each UV island. Manually blend the 4
		// surrounding texels weighting by coverage so uncovered (black) texels never
		// darken the lit edge — this dilates across the seam while staying smooth.
		"vec3 sampleLightmap(vec2 uv){\n" +
		"  vec2 t = lmTexel;\n" +
		"  vec2 p = uv / t - 0.5;\n" +
		"  vec2 base = (floor(p) + 0.5) * t;\n" +
		"  vec2 f = fract(p);\n" +
		"  vec4 c00 = texture2D(lightSampler, base);\n" +
		"  vec4 c10 = texture2D(lightSampler, base + vec2(t.x, 0.0));\n" +
		"  vec4 c01 = texture2D(lightSampler, base + vec2(0.0, t.y));\n" +
		"  vec4 c11 = texture2D(lightSampler, base + t);\n" +
		"  float w00 = (1.0 - f.x) * (1.0 - f.y) * c00.a;\n" +
		"  float w10 = f.x * (1.0 - f.y) * c10.a;\n" +
		"  float w01 = (1.0 - f.x) * f.y * c01.a;\n" +
		"  float w11 = f.x * f.y * c11.a;\n" +
		"  float wsum = w00 + w10 + w01 + w11;\n" +
		"  if (wsum > 1e-4){\n" +
		"    return (c00.rgb*w00 + c10.rgb*w10 + c01.rgb*w01 + c11.rgb*w11) / wsum;\n" +
		"  }\n" +
		// Deep hole (all 4 neighbors uncovered): widen to a ring search for the nearest
		// covered texel. Rare — only fires for fragments well off any UV island.
		"  for (int r = 1; r <= 4; r++){\n" +
		"    for (int dx = -1; dx <= 1; dx++){\n" +
		"      for (int dy = -1; dy <= 1; dy++){\n" +
		"        vec4 n = texture2D(lightSampler, uv + vec2(float(dx*r), float(dy*r)) * t);\n" +
		"        if (n.a > 0.5) return n.rgb;\n" +
		"      }\n" +
		"    }\n" +
		"  }\n" +
		"  return vec3(0.0);\n" +
		"}\n" +
		"void main(void){\n" +
		"  vec3 lm = sampleLightmap(vUV2);\n" +
		"  vec3 alb = hasAlbedo > 0.5 ? texture2D(albedoSampler, vUV).rgb : albedoColor;\n" +
		"  gl_FragColor = vec4(alb * lm, 1.0);\n" +
		"}\n";

	// Template only — every mesh clones this and binds its own samplers.
	_ovgal_bake.displayMat = new BABYLON.ShaderMaterial("ovgalDisplay", scene,
		{ vertex: "ovgalDisplay", fragment: "ovgalDisplay" },
		{
			attributes: ["position", "uv", "uv2"],
			uniforms: ["worldViewProjection", "uvScaleOffset", "hasAlbedo", "albedoColor", "lmTexel"],
			samplers: ["albedoSampler", "lightSampler"]
		});
}

// Best-effort base-color texture from a mesh's original material, without
// touching the NodeMaterial graph. StandardMaterial/PBR expose diffuse/albedo
// directly. NodeMaterials (BJS_*) are read via getTextureBlocks() — NOT
// getActiveTextures(), which stays empty until the material's first render and
// so misses the albedo during the startup bake. We pick the block whose name,
// or whose texture URL, reads like a base color (skipping bump/normal maps).
var _ALBEDO_RE = /albedo|color|basecolor|diffuse/i;
function _findAlbedoTexture(material) {
	if (!material) return null;
	if (material.diffuseTexture) return material.diffuseTexture;
	if (material.albedoTexture) return material.albedoTexture;

	var blocks = material.attachedBlocks || (typeof material.getTextureBlocks === "function" ? material.getTextureBlocks() : null);
	if (blocks && blocks.length) {
		// Prefer a block named like a base color (e.g. "albedo"); fall back to a
		// block whose texture URL reads as color (e.g. *_Color.jpg).
		for (var b = 0; b < blocks.length; b++) {
			if (blocks[b].texture && _ALBEDO_RE.test(blocks[b].name || "")) return blocks[b].texture;
		}
		for (var c = 0; c < blocks.length; c++) {
			var bt = blocks[c].texture;
			if (bt && _ALBEDO_RE.test((bt.name || "") + " " + (bt.url || ""))) return bt;
		}
	}

	if (typeof material.getActiveTextures !== "function") return null;
	var texs = material.getActiveTextures();
	for (var i = 0; i < texs.length; i++) {
		var n = (texs[i].name || "") + " " + (texs[i].url || "");
		if (_ALBEDO_RE.test(n)) return texs[i];
	}
	return null;
}

// Flat base-color factor fallback for meshes with no base-color texture — e.g. a
// Blender Principled BSDF whose Base Color is a solid swatch (no image node)
// exports to glTF as baseColorFactor with no texture, loading as a PBRMaterial
// with only albedoColor set. BJS stores albedoColor/diffuseColor in LINEAR space
// (glTF factors are linear); the display shader multiplies the lightmap against
// raw-sampled (sRGB-encoded) albedo textures, so gamma-encode here to match.
function _findAlbedoColor(material) {
	if (!material) return null;
	var c = material.albedoColor || material.diffuseColor;
	return (c && typeof c.toGammaSpace === "function") ? c.toGammaSpace() : c;
}

// Custom depth material: writes linear distance (meters) from the light to the
// fragment. We supply the light view-projection directly (lightVP uniform), so
// the depth render is independent of any camera projection/handedness.
function _ensureDepthMaterial(scene) {
	if (_ovgal_bake.depthMat) return;

	BABYLON.Effect.ShadersStore["ovgalBakeDepthVertexShader"] =
		"precision highp float;\n" +
		"attribute vec3 position;\n" +
		"uniform mat4 world;\n" +
		"uniform mat4 lightVP;\n" +
		"varying vec3 vDw;\n" +
		"void main(void){\n" +
		"  vec4 wp = world * vec4(position, 1.0);\n" +
		"  vDw = wp.xyz;\n" +
		"  gl_Position = lightVP * wp;\n" +
		"}\n";

	BABYLON.Effect.ShadersStore["ovgalBakeDepthFragmentShader"] =
		"precision highp float;\n" +
		"varying vec3 vDw;\n" +
		"uniform vec4 lightInfo;\n" +   // xyz = light world pos
		"void main(void){\n" +
		"  float d = length(vDw - lightInfo.xyz);\n" +
		"  gl_FragColor = vec4(d, d, d, 1.0);\n" +
		"}\n";

	var mat = new BABYLON.ShaderMaterial("ovgalBakeDepth", scene,
		{ vertex: "ovgalBakeDepth", fragment: "ovgalBakeDepth" },
		{ attributes: ["position"], uniforms: ["world", "lightVP", "lightInfo"] });
	// Render both sides: a single-face occluder (e.g. a one-sided beam plane) only
	// casts a shadow if it's drawn regardless of which way its normal faces the light.
	mat.backFaceCulling = false;
	_ovgal_bake.depthMat = mat;
}

// AO material (voxel ray-march). Reuses the bake vertex (rasterizes the mesh into
// its own UV2 buffer). The fragment, for each texel's world position + normal,
// traces a few short hemisphere rays through the room's occupancy grid (a flat-3D
// atlas in a single 2D texture) and writes ambient occlusion = 1 - blocked fraction.
// One pass per mesh, no ping-pong: the result is AO in .r (and 1 in .g so the main
// bake's existing ao = .r/.g read keeps working).
function _ensureAOMaterials(scene) {
	if (_ovgal_bake.aoMat) return;

	BABYLON.Effect.ShadersStore["ovgalAOFragmentShader"] =
		"precision highp float;\n" +
		"varying vec3 vPositionW;\n" +
		"varying vec3 vNormalW;\n" +
		"uniform vec3 aoDirs[" + BAKE_AO_DIRS + "];\n" + // hemisphere sample rays (sphere set)
		"uniform vec4 aoParams;\n" +   // x=radius(m), y=normalOffset(m), z=voxelSize(m), w=stepLen(m)
		"uniform vec3 gridMin;\n" +    // world-space corner of the occupancy grid
		"uniform vec4 gridN;\n" +      // xyz = voxel counts per axis
		"uniform vec4 gridTile;\n" +   // x=tilesX, y=tilesY, z=texW, w=texH (Z-slice atlas layout)
		"uniform sampler2D aoGrid;\n" +
		// Sample the flat-3D occupancy atlas at world point P: 1.0 if that voxel is solid.
		"float sampleGrid(vec3 P){\n" +
		"  vec3 vc = floor((P - gridMin) / aoParams.z);\n" +
		"  if (vc.x < 0.0 || vc.y < 0.0 || vc.z < 0.0 ||\n" +
		"      vc.x >= gridN.x || vc.y >= gridN.y || vc.z >= gridN.z) return 0.0;\n" +
		"  float tx = mod(vc.z, gridTile.x);\n" +              // which Z-slice tile
		"  float ty = floor(vc.z / gridTile.x);\n" +
		"  float px = tx * gridN.x + vc.x + 0.5;\n" +
		"  float py = ty * gridN.y + vc.y + 0.5;\n" +
		"  return texture2D(aoGrid, vec2(px / gridTile.z, py / gridTile.w)).r;\n" +
		"}\n" +
		// Per-texel base angle: any banding left after the supersample averages then
		// decorrelates between neighbours (faint noise instead of coherent rings).
		"float hash12(vec2 p){\n" +
		"  vec3 p3 = fract(vec3(p.xyx) * 0.1031);\n" +
		"  p3 += dot(p3, p3.yzx + 33.33);\n" +
		"  return fract((p3.x + p3.y) * p3.z);\n" +
		"}\n" +
		"void main(void){\n" +
		"  vec3 N = normalize(vNormalW);\n" +
		"  vec3 P0 = vPositionW + N * aoParams.y;\n" +   // lift off surface to skip its own voxel
		"  float base = hash12(gl_FragCoord.xy) * 6.2831853;\n" +
		"  float aoSum = 0.0;\n" +
		// Supersample (ssao's per-sample-rotation trick, baked): re-march the SAME
		// hemisphere set rotated about N by BAKE_AO_SS stratified angles, then average.
		// Rotation preserves dot(N,d), so weights and contact behaviour are identical;
		// it only sweeps each ray's azimuth, so the voxel/direction quantization that
		// bands at large radius lands somewhere different per rotation and averages
		// into a smooth gradient. The march itself is untouched.
		"  for (int j = 0; j < " + BAKE_AO_SS + "; j++){\n" +
		"    float ang = base + 6.2831853 * float(j) / float(" + BAKE_AO_SS + ");\n" +
		"    float ca = cos(ang); float sa = sin(ang);\n" +
		"    float occ = 0.0;\n" +
		"    float sw = 0.0;\n" +
		"    for (int i = 0; i < " + BAKE_AO_DIRS + "; i++){\n" +
		"      vec3 d0 = aoDirs[i];\n" +
		"      float w = dot(N, d0);\n" +
		"      if (w > 0.0){\n" +                         // only the surface's own hemisphere
		"        sw += w;\n" +
		"        vec3 d = d0 * ca + cross(N, d0) * sa + N * w * (1.0 - ca);\n" +  // Rodrigues rot about N
		"        for (int s = 1; s <= " + BAKE_AO_STEPS + "; s++){\n" +
		"          float t = aoParams.w * float(s);\n" +
		"          if (t > aoParams.x) break;\n" +        // past the AO radius -> open
		"          if (sampleGrid(P0 + d * t) > 0.5){ occ += w; break; }\n" +  // blocked
		"        }\n" +
		"      }\n" +
		"    }\n" +
		"    aoSum += (sw > 0.0) ? clamp(1.0 - occ / sw, 0.0, 1.0) : 1.0;\n" +
		"  }\n" +
		"  float ao = aoSum / float(" + BAKE_AO_SS + ");\n" +
		"  gl_FragColor = vec4(ao, 1.0, 0.0, 1.0);\n" +
		"}\n";

	var amat = new BABYLON.ShaderMaterial("ovgalAO", scene,
		{ vertex: "ovgalBake", fragment: "ovgalAO" },
		{
			attributes: ["position", "normal", "uv2"],
			uniforms: ["world", "aoDirs", "aoParams", "gridMin", "gridN", "gridTile"],
			samplers: ["aoGrid"]
		});
	// Texture-space winding is arbitrary, so never cull or we drop texels.
	amat.backFaceCulling = false;
	_ovgal_bake.aoMat = amat;
}

// A room surface the bake covers (shadow caster, AO receiver, lightmap target):
// any visible mesh that isn't a template helper. Shared by every bake pass so the
// skip list can't drift between them.
function _isBakeableMesh(m) {
	return m.isVisible && !m.name.match(/^Occupancy_/) && m.name !== 'door_title';
}

// Plaques are thin unlit label planes floating a few cm off the wall; T_ meshes are
// the 3D destination labels floated in each door opening (text3D_builder). As bake
// occluders they cast shadows (depth maps) and darken ambient (AO grid) onto the
// wall around/behind them — the "ghost shadows". They carry no UV2 so they were
// never bake targets anyway; exclude them from both occlusion passes so they stay
// purely decorative.
function _isBakeOccluder(m) {
	return _isBakeableMesh(m) && !m.name.match(/^lbl_plaque_/) && !m.name.match(/^T_/);
}

// Combined world-space AABB of a mesh list (each mesh's world bounding box unioned).
function _computeRoomAABB(meshes) {
	var min = new BABYLON.Vector3(1e9, 1e9, 1e9);
	var max = new BABYLON.Vector3(-1e9, -1e9, -1e9);
	meshes.forEach(function (m) {
		var bb = m.getBoundingInfo().boundingBox;
		min = BABYLON.Vector3.Minimize(min, bb.minimumWorld);
		max = BABYLON.Vector3.Maximize(max, bb.maximumWorld);
	});
	return { min: min, max: max };
}

// Dispose the pooled depth target(s). Called on a resolution change; the room
// dispose (AssetContainer.moveAllFromScene) handles them on navigation.
function _disposeShadowPool() {
	var b = _ovgal_bake;
	if (!b || !b.shadowPool) return;
	Object.keys(b.shadowPool).forEach(function (r) { b.shadowPool[r].dispose(); });
	b.shadowPool = null;
}

// One reusable depth target per distinct resolution (splash/sun use b.shadowRes,
// rect sub-lights a quarter of it). Created on first use against the caster set
// _buildShadowMaps just captured.
function _shadowMapFor(res) {
	var b = _ovgal_bake;
	if (!b.shadowPool) b.shadowPool = {};
	var dm = b.shadowPool[res];
	if (!dm) {
		dm = new BABYLON.RenderTargetTexture("bakeDepth_" + res, res, b.scene,
			false, true, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT);
		dm.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
		dm.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
		dm.renderList = b.casters;
		b.casters.forEach(function (m) { dm.setMaterialForRendering(m, b.depthMat); });
		b.shadowPool[res] = dm;
	}
	return dm;
}

// Render one pass's depth map from its light's POV into the shared target for its
// resolution, and hand it back for binding. Must run immediately before the pass is
// consumed: the next pass at the same resolution overwrites it.
function _renderShadowPass(ps) {
	var b = _ovgal_bake;
	var dm = _shadowMapFor(ps.res);
	b.depthMat.setMatrix("lightVP", ps.vp);
	b.depthMat.setVector4("lightInfo",
		new BABYLON.Vector4(ps.pos.x, ps.pos.y, ps.pos.z, BAKE_SHADOW_FAR));
	dm.render();
	return dm;
}

// Resolve one bake pass per light (view-projection, resolution, normal offset).
// Geometry-only, so this runs once per room. The depth maps themselves are
// rendered lazily, one at a time, as each pass is consumed.
function _buildShadowMaps(scene) {
	var b = _ovgal_bake;

	// Drop any pooled target (resolution change).
	_disposeShadowPool();
	b.passes = [];   // one per map: {light, faceId, vp, res, pos, texel, normOff}

	// Casters = the room surfaces the bake covers, minus plaques (see _isBakeOccluder).
	// Keep them always-active so the light-POV render isn't culled by the user camera.
	var casters = scene.meshes.filter(_isBakeOccluder);
	casters.forEach(function (m) { m.alwaysSelectAsActiveMesh = true; });
	b.casters = casters;

	// Combined room AABB — a far light (e.g. a sun above a roof opening) sits well
	// beyond the fixed 50 m far plane, so its casters would be clipped out of the
	// depth map and every texel would read as occluded. Push each light's far plane
	// out to cover the whole room from that light's distance. Cached for _buildAOGrid,
	// which runs right after over the same caster set.
	var aabb = _computeRoomAABB(casters);
	var rMin = aabb.min, rMax = aabb.max;
	b.roomAABB = aabb;

	var lh = !scene.useRightHandedSystem;

	// Register a bake pass. The depth map is NOT rendered here: the bake loop is
	// light-outer (each pass is bound once, consumed by every mesh, then never
	// revisited), so one shared target per resolution is re-rendered from each
	// light's POV just in time — see _renderShadowPass. One map per light instead
	// cost ~8 MB each held for the whole session: ~740 MB on the 88-light panels
	// template, enough to push mobile Safari past its per-tab memory limit.
	function _addPass(k, pos, vp, res, faceId, normOff) {
		b.passes.push({ light: k, faceId: faceId, vp: vp, res: res, pos: pos,
			texel: 1.0 / res, normOff: normOff });
	}

	function _lookAt(pos, dir) {
		// Up vector must not be parallel to a near-vertical aim (gallery spots
		// often point straight down) or LookAt degenerates.
		var up = (Math.abs(dir.y) > 0.99) ? new BABYLON.Vector3(0, 0, 1)
			: new BABYLON.Vector3(0, 1, 0);
		var target = pos.add(dir);
		return lh ? BABYLON.Matrix.LookAtLH(pos, target, up)
			: BABYLON.Matrix.LookAtRH(pos, target, up);
	}

	// Farthest room corner from pos + 5% margin, floored at the baseline, so a
	// far source still covers the room.
	function _farFor(pos) {
		var far = BAKE_SHADOW_FAR;
		for (var cx = 0; cx < 2; cx++) for (var cy = 0; cy < 2; cy++) for (var cz = 0; cz < 2; cz++) {
			var corner = new BABYLON.Vector3(cx ? rMax.x : rMin.x, cy ? rMax.y : rMin.y, cz ? rMax.z : rMin.z);
			far = Math.max(far, BABYLON.Vector3.Distance(pos, corner) * 1.05);
		}
		return far;
	}

	for (var k = 0; k < b.lights.length; k++) {
		var pos = b.lights[k].pos;
		var dir = b.lights[k].dir;

		// Rect sub-light: up to 6 world-axis cube-face maps (see BAKE_RECT_FACE_FOV).
		// Quarter-res each — a face map only ever serves 1/6 of the directions, and a
		// panel's many overlapping sub-lights average into the penumbra anyway.
		if (b.lights[k].scale) {
			var res = Math.max(128, b.shadowRes >> 2);
			var normOff = 2 * Math.tan(BAKE_RECT_FACE_FOV / 2) / res;
			var far0 = _farFor(pos);
			var fproj = lh ? BABYLON.Matrix.PerspectiveFovLH(BAKE_RECT_FACE_FOV, 1, BAKE_SHADOW_NEAR, far0)
				: BABYLON.Matrix.PerspectiveFovRH(BAKE_RECT_FACE_FOV, 1, BAKE_SHADOW_NEAR, far0);
			// Skip a face only when its whole region sits beyond the cone's outer
			// angle: angle(axis, aim) - 54.74 (face corner) > outer. For a down-aimed
			// panel that drops just the +Y face.
			var outer = Math.acos((typeof b.lights[k].cosOuter === 'number') ? b.lights[k].cosOuter : b.cosOuter);
			var skipDot = Math.cos(Math.min(Math.PI, outer + 0.9553));
			for (var f = 0; f < 6; f++) {
				var axv = BAKE_RECT_FACE_AXES[f];
				var faceAxis = new BABYLON.Vector3(axv[0], axv[1], axv[2]);
				if (BABYLON.Vector3.Dot(faceAxis, dir) < skipDot) continue;
				_addPass(k, pos, _lookAt(pos, faceAxis).multiply(fproj), res, f, normOff);
			}
			continue;
		}

		var view = _lookAt(pos, dir);
		var proj;
		// Normal-offset for the splash shadow (mirrors the rect-face fix, otherwise gated
		// to rect sub-lights). Set in the splash branch below from this map's own texel
		// size; stays 0 for the sun (parallel/ortho, no grazing texel-sharing seam).
		var splashNormOff = 0;
		if (b.lights[k].sun) {
			// Sun: orthographic (parallel) projection tightly framed to the room in this
			// light's VIEW space. Uniform texel density everywhere means the extreme
			// openings sample the depth map as well as the centre — no perspective
			// foreshortening, so the grazing-angle moiré ("interference rings") is gone.
			var vmin = new BABYLON.Vector3(1e9, 1e9, 1e9);
			var vmax = new BABYLON.Vector3(-1e9, -1e9, -1e9);
			for (var sx = 0; sx < 2; sx++) for (var sy = 0; sy < 2; sy++) for (var sz = 0; sz < 2; sz++) {
				var vc = BABYLON.Vector3.TransformCoordinates(
					new BABYLON.Vector3(sx ? rMax.x : rMin.x, sy ? rMax.y : rMin.y, sz ? rMax.z : rMin.z), view);
				vmin = BABYLON.Vector3.Minimize(vmin, vc);
				vmax = BABYLON.Vector3.Maximize(vmax, vc);
			}
			var mg = 0.2; // meters of padding around the room box
			// View-space depth: LH looks down +z (scene z positive), RH down -z (negative).
			proj = lh
				? BABYLON.Matrix.OrthoOffCenterLH(vmin.x - mg, vmax.x + mg, vmin.y - mg, vmax.y + mg,
					Math.max(BAKE_SHADOW_NEAR, vmin.z - mg), vmax.z + mg)
				: BABYLON.Matrix.OrthoOffCenterRH(vmin.x - mg, vmax.x + mg, vmin.y - mg, vmax.y + mg,
					Math.max(BAKE_SHADOW_NEAR, -vmax.z - mg), -vmin.z + mg);
		} else {
			// Splash: perspective, far enough to cover the room from this light. FOV is
			// sized to this light's authored outer cone so the whole lit disc stays inside
			// the map (mirrors the rect branch's outer resolve, ~line 955), floored at
			// BAKE_SHADOW_FOV and capped at BAKE_SHADOW_FOV_CAP.
			var outer = Math.acos((typeof b.lights[k].cosOuter === 'number') ? b.lights[k].cosOuter : b.cosOuter);
			var fov = Math.max(BAKE_SHADOW_FOV,
				Math.min(2 * outer + BAKE_SHADOW_FOV_MARGIN, BAKE_SHADOW_FOV_CAP));
			proj = lh ? BABYLON.Matrix.PerspectiveFovLH(fov, 1, BAKE_SHADOW_NEAR, _farFor(pos))
				: BABYLON.Matrix.PerspectiveFovRH(fov, 1, BAKE_SHADOW_NEAR, _farFor(pos));
			// Perspective texel world-size per meter of distance (same form as the rect
			// branch's normOff, line ~955). sampleShadow multiplies by distance + grazing
			// factor and caps at 2 cm, so this lifts the door front off the shared
			// grazing-angle depth texel that self-shadows the recessed panel.
			splashNormOff = 2 * Math.tan(fov / 2) / b.shadowRes;
		}
		_addPass(k, pos, view.multiply(proj), b.shadowRes, -1, splashNormOff);
	}
}

// Voxelize the room into a coarse solid-occupancy grid, packed as a flat-3D atlas
// (Z-slices tiled across one 2D R8 texture) so the AO shader can sample it with
// plain texture2D. Surface voxelization: each triangle is sampled finely enough
// (<= half a voxel) that no voxel it crosses is skipped. Depends only on geometry,
// so this runs once — the AO radius/offset are runtime params applied in _runAO.
function _buildAOGrid(scene) {
	var b = _ovgal_bake;
	if (b.aoGridTex) { b.aoGridTex.dispose(); b.aoGridTex = null; }

	// Plaques are excluded here so they never occlude ambient (see _isBakeOccluder).
	var casters = scene.meshes.filter(_isBakeOccluder);

	// Padded world AABB -> cubic voxel size from the longest axis. Reuse the room
	// AABB _buildShadowMaps just computed over the same caster set (falling back to a
	// fresh compute if the grid is ever built standalone).
	var aabb = b.roomAABB || _computeRoomAABB(casters);
	var min = aabb.min, max = aabb.max;
	var pad = 0.1;
	min = new BABYLON.Vector3(min.x - pad, min.y - pad, min.z - pad);
	max = new BABYLON.Vector3(max.x + pad, max.y + pad, max.z + pad);
	var ext = max.subtract(min);
	var longest = Math.max(ext.x, ext.y, ext.z);

	// Pick the grid resolution, shrinking if the tiled atlas would exceed the
	// texture-size cap (Z-slices are laid out in a roughly-square tile grid).
	var maxTex = scene.getEngine().getCaps().maxTextureSize || 4096;
	var gridLong = BAKE_AO_GRID, vs, Nx, Ny, Nz, tilesX, tilesY, texW, texH;
	while (true) {
		vs = longest / gridLong;
		Nx = Math.max(1, Math.ceil(ext.x / vs));
		Ny = Math.max(1, Math.ceil(ext.y / vs));
		Nz = Math.max(1, Math.ceil(ext.z / vs));
		tilesX = Math.ceil(Math.sqrt(Nz));
		tilesY = Math.ceil(Nz / tilesX);
		texW = tilesX * Nx;
		texH = tilesY * Ny;
		if ((texW <= maxTex && texH <= maxTex) || gridLong <= 16) break;
		gridLong = Math.floor(gridLong * 0.8);
	}

	var data = new Uint8Array(texW * texH);
	function mark(ix, iy, iz) {
		if (ix < 0 || iy < 0 || iz < 0 || ix >= Nx || iy >= Ny || iz >= Nz) return;
		var tx = iz % tilesX, ty = (iz - tx) / tilesX;
		data[(ty * Ny + iy) * texW + (tx * Nx + ix)] = 255;
	}

	var step = vs * 0.5;
	var tmp = new BABYLON.Vector3();
	casters.forEach(function (m) {
		var positions = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
		var indices = m.getIndices();
		if (!positions || !indices) return;
		m.computeWorldMatrix(true);
		var wm = m.getWorldMatrix();
		// Transform each unique vertex to world space ONCE into a flat scratch array,
		// instead of re-transforming (and allocating a Vector3 for) every shared vertex
		// once per incident triangle. The triangle loop below then reads plain scalars —
		// no per-triangle allocation, no redundant matrix math on the main thread.
		var W = new Float64Array(positions.length);
		for (var vp = 0; vp < positions.length; vp += 3) {
			BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(
				positions[vp], positions[vp + 1], positions[vp + 2], wm, tmp);
			W[vp] = tmp.x; W[vp + 1] = tmp.y; W[vp + 2] = tmp.z;
		}
		for (var t = 0; t < indices.length; t += 3) {
			var i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
			var v0x = W[i0], v0y = W[i0 + 1], v0z = W[i0 + 2];
			var ax = W[i1] - v0x, ay = W[i1 + 1] - v0y, az = W[i1 + 2] - v0z;
			var bx = W[i2] - v0x, by = W[i2 + 1] - v0y, bz = W[i2 + 2] - v0z;
			var la = Math.sqrt(ax * ax + ay * ay + az * az);
			var lb = Math.sqrt(bx * bx + by * by + bz * bz);
			var ns = Math.min(2048, Math.max(1, Math.ceil(Math.max(la, lb) / step)));
			var inv = 1.0 / ns;
			for (var ii = 0; ii <= ns; ii++) {
				for (var jj = 0; jj <= ns - ii; jj++) {
					var u = ii * inv, w2 = jj * inv;
					mark(
						Math.floor((v0x + ax * u + bx * w2 - min.x) / vs),
						Math.floor((v0y + ay * u + by * w2 - min.y) / vs),
						Math.floor((v0z + az * u + bz * w2 - min.z) / vs));
				}
			}
		}
	});

	var tex = new BABYLON.RawTexture(data, texW, texH,
		BABYLON.Constants.TEXTUREFORMAT_R, scene, false, false,
		BABYLON.Texture.NEAREST_SAMPLINGMODE);
	tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
	tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
	b.aoGridTex = tex;
	b.aoGrid = {
		min: min, vs: vs, Nx: Nx, Ny: Ny, Nz: Nz,
		tilesX: tilesX, tilesY: tilesY, texW: texW, texH: texH
	};
}

// Run the AO pass: one render per mesh, ray-marching the occupancy grid into its
// AO buffer (.r = ambient occlusion). Radius/offset are runtime params, so the AO
// sliders re-run this; the grid itself is geometry-only and never rebuilt here.
function _runAO() {
	var b = _ovgal_bake;
	var m = b.aoMat;
	if (!b.aoGrid || b.baked.length === 0) return;
	var g = b.aoGrid;

	var dirs = _bakeAODirs();
	var flat = [];
	for (var i = 0; i < dirs.length; i++) flat.push(dirs[i].x, dirs[i].y, dirs[i].z);
	m.setArray3("aoDirs", flat);
	m.setVector3("gridMin", new BABYLON.Vector3(g.min.x, g.min.y, g.min.z));
	m.setVector4("gridN", new BABYLON.Vector4(g.Nx, g.Ny, g.Nz, 0));
	m.setVector4("gridTile", new BABYLON.Vector4(g.tilesX, g.tilesY, g.texW, g.texH));
	m.setTexture("aoGrid", b.aoGridTex);
	// stepLen = one voxel per march step (radius caps how many actually run).
	m.setVector4("aoParams", new BABYLON.Vector4(b.aoRadius, b.aoBias, g.vs, g.vs));

	b.baked.forEach(function (it) { it.aoBuffer.render(); });
}

// One half-float ping-pong accumulation target for a mesh. Module level (rather
// than a closure in _bakeMesh) so _restoreBakeScratch can rebuild whichever half
// _freeBakeScratch dropped after the last bake committed.
function _makeBakeBuf(mesh, tag) {
	var b = _ovgal_bake;
	var rtt = new BABYLON.RenderTargetTexture(
		"bakeRTT_" + mesh.name + "_" + tag, b.size, b.scene,
		false,                                      // generateMipMaps
		true,                                       // doNotChangeAspectRatio
		BABYLON.Constants.TEXTURETYPE_HALF_FLOAT);  // float accumulation target
	rtt.coordinatesIndex = 1;                       // sample with UV2 when used on the material
	rtt.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
	rtt.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
	// UV2 texels not covered by this mesh's triangles (island seams, door cutout
	// edges) keep the clearColor. We clear to fully transparent (alpha 0) so the
	// bake's alpha=1 marks coverage; the display shader blends only covered texels,
	// dilating across seams. NEAREST so each manual tap reads a single exact texel
	// (no hardware bleed of black into the lit edge) — we do our own filtering.
	rtt.clearColor = new BABYLON.Color4(0, 0, 0, 0);
	rtt.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
	rtt.renderList = [mesh];
	rtt.setMaterialForRendering(mesh, b.material);  // draw this mesh with the bake shader
	return rtt;
}

// Allocate a mesh's two ping-pong half-float RTTs + its debug view material.
// Content is rendered later by _runBake (these are driven manually, NOT added to
// scene.customRenderTargets — we don't want per-frame auto-refresh).
function _bakeMesh(scene, mesh) {
	var b = _ovgal_bake;

	// Reuse this mesh's bake resources on room re-entry. Galleries are cached in an
	// AssetContainer; on return the mesh and its display material survive, but the
	// lightmap render-target *contents* are lost, so setupLightmapBake runs again to
	// refill them (via _runBake). Keep the original allocations — and the real
	// pre-bake material captured on first bake — rather than rebuilding: recreating
	// would leak render targets and re-read the display shader as the source albedo,
	// rendering the surface white.
	var res = mesh.metadata && mesh.metadata.ovgal_bake;
	if (res) {
		mesh.material = res.view;
		mesh.alwaysSelectAsActiveMesh = true;
		b.baked.push({ mesh: mesh, buffers: res.buffers, aoBuffer: res.aoBuffer, orig: res.orig,
			view: res.view, hasAlbedo: res.hasAlbedo });
		return;
	}

	var buffers = [_makeBakeBuf(mesh, "A"), _makeBakeBuf(mesh, "B")];

	// One AO buffer per mesh (.r = ambient occlusion). Lower res than the lightmap —
	// AO is low-frequency, and the main bake upsamples it via UV2 bilinear.
	var aoBuffer = new BABYLON.RenderTargetTexture(
		"bakeAORTT_" + mesh.name, BAKE_AO_BUF, scene,
		false, true, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT);
	aoBuffer.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
	aoBuffer.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
	aoBuffer.clearColor = new BABYLON.Color4(0, 0, 0, 1);
	aoBuffer.coordinatesIndex = 1;
	aoBuffer.renderList = [mesh];
	aoBuffer.setMaterialForRendering(mesh, b.aoMat);

	// The bake vertex shader ignores the camera, but the RTT still frustum-culls
	// its render list against the active camera — keep the mesh always-active so
	// it's guaranteed to draw regardless of where the camera is pointing.
	mesh.alwaysSelectAsActiveMesh = true;

	// Phase 5 view: the baked room as the camera sees it — albedo (UV1) * baked
	// lightmap (UV2), via the display shader. Albedo is read from the original
	// material (no NodeMaterial rewiring); meshes without a recognizable base
	// color fall back to lightmap-only. The lightmap sampler is pointed at the
	// final accumulation buffer by _runBake once the bake parity is known.
	var orig = mesh.material;
	var albedo = _findAlbedoTexture(orig);
	var view = b.displayMat.clone("bakeView_" + mesh.name);
	view.setFloat("hasAlbedo", albedo ? 1.0 : 0.0);
	// No base-color texture: fall back to the material's flat color factor so
	// solid-colored BSDF materials keep their color instead of rendering white.
	var albColor = albedo ? null : _findAlbedoColor(orig);
	view.setColor3("albedoColor", albColor || new BABYLON.Color3(1, 1, 1));
	// Carry the albedo's UV scale + offset (KHR_texture_transform) so tiled textures
	// repeat exactly as the original material draws them. Read as plain scalars (not
	// getTextureMatrix, whose shared cached-matrix reference doesn't bind reliably
	// through a cloned ShaderMaterial). Rotation (wAng) is ignored — no template
	// material uses it; revisit if one ever does.
	view.setVector4("uvScaleOffset", albedo
		? new BABYLON.Vector4(albedo.uScale, albedo.vScale, albedo.uOffset, albedo.vOffset)
		: new BABYLON.Vector4(1, 1, 0, 0));
	view.setTexture("albedoSampler", albedo || buffers[0]);  // dummy bind if no albedo
	view.setTexture("lightSampler", buffers[0]);
	view.setVector2("lmTexel", new BABYLON.Vector2(1.0 / b.size, 1.0 / b.size));
	view.backFaceCulling = (orig && typeof orig.backFaceCulling === "boolean")
		? orig.backFaceCulling : true;
	mesh.material = view;

	// Remember this mesh's bake resources so a room re-entry reuses them (see the
	// reuse guard at the top of this function) instead of leaking new ones.
	if (!mesh.metadata) mesh.metadata = {};
	mesh.metadata.ovgal_bake = { buffers: buffers, aoBuffer: aoBuffer, orig: orig, view: view,
		hasAlbedo: !!albedo };

	b.baked.push({ mesh: mesh, buffers: buffers, aoBuffer: aoBuffer, orig: orig, view: view,
		hasAlbedo: !!albedo });
}

// Bind the per-light-invariant uniforms shared by every mesh's bake. Returns
// false when there's nothing to bake (no lights / no passes), so callers can
// skip the mesh loop. Split out from _runBake so the startup path can pace the
// per-mesh work across frames (see setupLightmapBake) while slider re-bakes stay
// synchronous.
function _runBakeSetup() {
	var b = _ovgal_bake;
	var m = b.material;
	if (b.count === 0) return false;
	_restoreBakeScratch();

	// Shared (per-light-invariant) uniforms. bakeGlobals.z (intensity) is re-set
	// per light inside the loop so an authored _I<value> suffix can override it.
	m.setVector4("bakeColor", new BABYLON.Vector4(b.color.r, b.color.g, b.color.b, 0));
	var iUp = _ovgal_lights.ambientUp ? _ovgal_lights.ambientUp.intensity : 0;
	var iDown = _ovgal_lights.ambientDown ? _ovgal_lights.ambientDown.intensity : 0;
	m.setVector4("bakeAmbient", new BABYLON.Vector4(iUp * b.ambient, iDown * b.ambient, 0, 0));

	// Occupancy grid for the out-of-frustum voxel-shadow fallback (built by
	// _buildAOGrid before the first _runBake; aoParams.z gates the shader path).
	var g = b.aoGrid;
	var gridOK = (g && b.aoGridTex) ? 1 : 0;
	m.setVector4("aoParams", new BABYLON.Vector4(b.aoStrength, gridOK ? g.vs : 1, gridOK, 0));
	if (gridOK) {
		m.setVector3("gridMin", new BABYLON.Vector3(g.min.x, g.min.y, g.min.z));
		m.setVector4("gridN", new BABYLON.Vector4(g.Nx, g.Ny, g.Nz, 0));
		m.setVector4("gridTile", new BABYLON.Vector4(g.tilesX, g.tilesY, g.texW, g.texH));
		m.setTexture("aoGrid", b.aoGridTex);
	}

	return !!(b.passes && b.passes.length > 0);
}

// Bind pass k's per-light uniforms — all mesh-independent, so in the interleaved
// startup bake this is set once per pass and reused across every mesh.
function _bindBakePass(k) {
	var b = _ovgal_bake;
	var m = b.material;
	var ps = b.passes[k];
	var lk = b.lights[ps.light];
	var lp = lk.pos, ld = lk.dir;
	// Per-light cone from the GLB when authored, else the global sliders.
	// smoothstep(cosOuter, cosInner, ang) needs cosInner > cosOuter (inner
	// angle narrower than outer); clamp so a wide slider inner can't invert
	// a narrow GLB cone.
	var cosOuter = (typeof lk.cosOuter === 'number') ? lk.cosOuter : b.cosOuter;
	var cosInner = (typeof lk.cosInner === 'number') ? lk.cosInner : b.cosInner;
	if (cosInner <= cosOuter) cosInner = Math.min(1.0, cosOuter + 0.02);
	// Per-light intensity (_I<value>) and reach (_R<value>) from the GLB name
	// when authored, else the global sliders. A sun (name prefix sun_) ignores
	// reach + cone and lights with parallel rays; bakeGlobals.x carries the flag.
	// Rect sub-lights carry scale = 1/samples so the panel's samples sum to
	// one light; the multiply keeps the slider (b.intensity) live across rebakes.
	var inten = ((typeof lk.intensity === 'number') ? lk.intensity : b.intensity) * (lk.scale || 1.0);
	var reach = (typeof lk.reach === 'number') ? lk.reach : b.maxDist;
	m.setVector4("bakeGlobals", new BABYLON.Vector4(lk.sun ? 1.0 : 0.0, 0.0, inten, reach));
	m.setVector4("bakeLight", new BABYLON.Vector4(lp.x, lp.y, lp.z, cosInner));
	m.setVector4("bakeAxis0", new BABYLON.Vector4(ld.x, ld.y, ld.z, cosOuter));
	m.setMatrix("lightMatrix", ps.vp);
	m.setTexture("shadowSampler", _renderShadowPass(ps));
	m.setVector4("faceParams", new BABYLON.Vector4(ps.faceId, ps.normOff, 0, 0));
	m.setVector4("shadowParams",
		new BABYLON.Vector4(b.shadowDarkness, b.shadowBias, k === 0 ? 1 : 0, ps.texel));
}

// Render pass k into one mesh's ping-pong buffers. Assumes _bindBakePass(k) already
// bound the light uniforms. aoSampler + prevTex are the only mesh-dependent binds,
// so they're (re)set here — cheap, and required when passes interleave across meshes.
function _renderBakePassForMesh(it, k) {
	var m = _ovgal_bake.material;
	// This mesh's baked AO seeds the ambient on the first pass (k === 0).
	m.setTexture("aoSampler", it.aoBuffer);
	m.setTexture("prevTex", it.buffers[k % 2]);
	it.buffers[(k + 1) % 2].render();
}

// Point a mesh's display view at whichever buffer holds the final accumulation
// (ping-pong end depends on the pass count's parity). The buffer object is stable
// across rebakes — only its contents change — so freezing still shows live re-bakes.
function _commitBakeView(it) {
	var keep = it.buffers[_ovgal_bake.passes.length % 2];
	it.view.setTexture("lightSampler", keep);
	// buffers[0] doubles as the dummy albedo bind for meshes with no base-color
	// texture (see _bakeMesh). Re-point it at the survivor, or _freeBakeScratch
	// would leave that sampler on a disposed texture.
	if (!it.hasAlbedo) it.view.setTexture("albedoSampler", keep);
	it.view.freeze();
}

// Release the bake's scratch memory once every view is committed. Only the
// surviving ping-pong half is sampled from here on, and the pooled depth target is
// bake-only, so both are dead weight until a re-bake rebuilds them. Worth ~88 MB of
// half-float RTT on a large gallery — enough to decide whether iOS Safari keeps the
// tab. The AO buffers are deliberately KEPT: only setupLightmapBake runs _runAO, so
// a slider re-bake reuses their contents and freeing them would bake flat ambient.
function _freeBakeScratch() {
	var b = _ovgal_bake;
	if (!b || !b.baked || !b.baked.length) return;
	var drop = 1 - (b.passes.length % 2);
	b.baked.forEach(function (it) {
		if (!it.buffers[drop]) return;
		it.buffers[drop].dispose();
		it.buffers[drop] = null;
	});
	_disposeShadowPool();
}

// Rebuild whichever ping-pong half _freeBakeScratch dropped. Called before every
// bake, so a slider re-bake — or a room re-entry reusing the cached buffers off
// mesh.metadata — always starts with both halves live. The restored buffer is
// always written before it is read: pass 0 renders into buffers[1] and only reads
// buffers[0], which a restore leaves cleared exactly as a fresh allocation would.
function _restoreBakeScratch() {
	var b = _ovgal_bake;
	if (!b || !b.baked) return;
	b.baked.forEach(function (it) {
		if (!it.buffers[0]) it.buffers[0] = _makeBakeBuf(it.mesh, "A");
		if (!it.buffers[1]) it.buffers[1] = _makeBakeBuf(it.mesh, "B");
	});
}

// Imperative bake driver — synchronous, one shot over every mesh. The startup
// bake paces the same work across frames instead; see setupLightmapBake.
// Light-outer, mesh-inner, mirroring the paced loop: each pass binds once and is
// consumed by every mesh before the next overwrites the shared depth target.
function _runBake() {
	if (!_runBakeSetup()) return;
	var list = _ovgal_bake.baked;
	var P = _ovgal_bake.passes.length;
	// The display materials are frozen after each bake (static uniforms, zero
	// per-frame rebind). Unfreeze to re-point their lightmap samplers; _commitBakeView
	// refreezes each one below.
	list.forEach(function (it) { it.view.unfreeze(); });
	for (var k = 0; k < P; k++) {
		_bindBakePass(k);
		for (var j = 0; j < list.length; j++) _renderBakePassForMesh(list[j], k);
	}
	list.forEach(_commitBakeView);
	_freeBakeScratch();
}

/**
 * Bakes a startup UV2 lightmap from the scene's spot lights. Runs by default
 * for every template gallery (the v4 _B contract disables the runtime lights,
 * so the lightmap IS the lighting). Call after meshes + materials are loaded
 * (alongside the splash / shadow setup), before material freeze.
 * @param {BABYLON.Scene} scene
 */
function setupLightmapBake(scene, onComplete, onProgress) {
	// Fired once the bake has committed (or on any early abort), so the caller can
	// close its "Setting up lights" progress. Runs exactly once per invocation.
	var done = (function () {
		var called = false;
		return function () { if (!called && typeof onComplete === 'function') { called = true; onComplete(); } };
	})();
	// 0..100 progress for the "Setting up lights" bar. No-op when unwired (slider
	// re-bakes, tests). Callers set the bar, we yield a frame so it actually paints
	// before the next (main-thread-blocking) phase runs.
	function report(pct) { if (typeof onProgress === 'function') onProgress(pct); }

	if (!scene.getEngine().getCaps().textureHalfFloatRender) {
		console.warn("Lightmap bake: no half-float render target support — aborting");
		done();
		return;
	}

	// Authored sun_N / splash_N spots first, then F_ fixtures, then the template's
	// marker spot. The sun_/splash_ prefix per light selects its model in the bake.
	var cones = _collectConesFromSpotLights(scene, /^(?:sun|splash)_\d+/);
	var source = "sun_N / splash_N spots";
	if (cones.count === 0) { cones = _collectConesFromFixtures(scene); source = "F_ fixtures"; }
	if (cones.count === 0) { cones = _collectConesFromSpotLights(scene); source = "template spot light"; }
	if (cones.count === 0) {
		console.warn("Lightmap bake: no spot lights / F_ fixtures in scene — nothing to bake");
		done();
		return;
	}

	if (!_ovgal_bake) {
		// Tuning presets from BAKE_DEFAULTS (top of file); runtime state added here.
		// color is cloned so the shared constant is never mutated by a live edit.
		_ovgal_bake = Object.assign({}, BAKE_DEFAULTS, {
			color: Object.assign({}, BAKE_DEFAULTS.color),
			visible: true,
			baked: []
		});
		window._bake = _ovgal_bake;
		_refreshBakeAngles();
	}
	_ovgal_bake.lights = cones.lights;
	_ovgal_bake.count = cones.count;
	_ovgal_bake.scene = scene;

	// Rebuild the working bake list from scratch each run. On room re-entry the
	// previous room's entries would otherwise linger here; _bakeMesh repopulates it
	// from the current scene, reusing each mesh's own stored resources (no realloc,
	// no leak).
	_ovgal_bake.baked = [];

	_ensureBakeMaterial(scene);
	_ensureDepthMaterial(scene);
	_ensureAOMaterials(scene);
	_ensureDisplayMaterial(scene);

	// Bake the room surfaces that carry a UV2 channel (skip helpers + UV2-less meshes).
	// Skip self-illuminated emitters (BJS_glow / BJS_glow_masked, loaded as rBJS_glow*):
	// they're light SOURCES, not receivers. Relighting them with the display shader
	// would replace their glow with a dull albedo×lightmap surface — they'd stop
	// glowing under the baked view. Leaving them out keeps their original glow
	// material, so they stay decorative once the runtime lights are gone.
	var meshes = scene.meshes.filter(function (m) {
		if (!_isBakeableMesh(m)) return false;
		if (m.material && /glow/i.test(m.material.name || '')) return false;
		if (!m.isVerticesDataPresent || !m.isVerticesDataPresent(BABYLON.VertexBuffer.UV2Kind)) return false;
		return true;
	});

	meshes.forEach(function (m) { _bakeMesh(scene, m); });

	// Render the per-light depth maps, then commit the accumulation. Deferred one
	// frame so the engine/camera are fully ready, and the two shader effects are
	// force-compiled first — otherwise rtt.render() silently skips a mesh whose
	// material effect isn't ready yet, leaving the buffers empty. Slider-driven
	// re-bakes run later (effects already compiled), so they call _runBake direct.
	if (_ovgal_bake.baked.length > 0) {
		// Yield until the browser has painted, so a progress update issued just before
		// a main-thread-blocking phase is actually visible while that phase runs.
		// Double rAF straddles a paint; setTimeout is the fallback if rAF is missing.
		var paintYield = function () {
			return new Promise(function (res) {
				if (typeof requestAnimationFrame === 'function') {
					requestAnimationFrame(function () { requestAnimationFrame(res); });
				} else {
					setTimeout(res, 0);
				}
			});
		};

		scene.onAfterRenderObservable.addOnce(function () {
			var anyMesh = _ovgal_bake.baked[0].mesh;
			Promise.all([
				_ovgal_bake.depthMat.forceCompilationAsync(anyMesh),
				_ovgal_bake.aoMat.forceCompilationAsync(anyMesh),
				_ovgal_bake.material.forceCompilationAsync(anyMesh)
			]).then(async function () {
				// Paced mode (loader visible — both first load and revisit) spreads the
				// bake across frames so the "Setting up lights" bar animates. Each setup
				// phase blocks the main thread, so bump the bar and let it paint
				// (paintYield) BEFORE entering the phase. Unpaced mode (slider re-bakes)
				// runs synchronously.
				var paced = (typeof onProgress === 'function');

				if (paced) { report(45); await paintYield(); }
				_buildShadowMaps(scene);
				if (paced) { report(60); await paintYield(); }
				_buildAOGrid(scene);
				if (paced) { report(74); await paintYield(); }
				_runAO();
				if (paced) { report(82); await paintYield(); }

				if (paced && _runBakeSetup()) {
					// The bake cost is (meshes × light-passes), and a room can be heavy in
					// either — a few big meshes with many lights, or many small meshes.
					// Interleave passes across meshes and pace by ELAPSED TIME, so the bar
					// advances smoothly in both cases instead of freezing on one slow unit
					// (the earlier per-mesh chunking stalled at ~99% on many-light rooms).
					var list = _ovgal_bake.baked;
					var P = _ovgal_bake.passes.length;
					var total = P * list.length;
					var unit_ = 0;
					list.forEach(function (it) { it.view.unfreeze(); });
					var last_ = performance.now();
					for (var k = 0; k < P; k++) {
						_bindBakePass(k);
						for (var j = 0; j < list.length; j++) {
							_renderBakePassForMesh(list[j], k);
							unit_++;
							// ~120 ms of work per visible step: smooth bar, ~15% overhead.
							if (performance.now() - last_ > 120) {
								report(82 + Math.round(17 * unit_ / total));   // 82 -> 99
								await paintYield();
								last_ = performance.now();
							}
						}
					}
					list.forEach(_commitBakeView);
					_freeBakeScratch();
				} else {
					_runBake();
				}

				var g = _ovgal_bake.aoGrid;
				console.log("Lightmap bake: committed " + _ovgal_bake.passes.length
					+ " shadow map(s), AO grid " + g.Nx + "x" + g.Ny + "x" + g.Nz
					+ " (voxel " + g.vs.toFixed(3) + "m)");
				done();
			}).catch(function (e) {
				console.warn("Lightmap bake: shader compile failed", e);
				done();
			});
		});
	}

	console.log("Lightmap bake: " + _ovgal_bake.baked.length + " mesh(es) queued from "
		+ cones.count + " spot(s) (" + source + ")");
	if (_ovgal_bake.baked.length === 0) {
		console.warn("Lightmap bake: no meshes with a UV2 channel were found");
		done();
	}
}