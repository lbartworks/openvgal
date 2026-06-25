// OpenVGAL Lighting System
// Manages all scene illumination: ambient and RectAreaLights from F_ fixtures

var _ovgal_lights = {
	ambientUp: null,
	ambientDown: null,
	rectAreaLights: []
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

	// Cone-splash plugin must be registered before any material is created,
	// otherwise its UBO uniforms can't be added to an already-built buffer.
	_registerConeSplashPlugin();
}

/**
 * Sets up lighting for a newly loaded gallery room.
 * Call after template + artworks are loaded into the scene.
 * @param {BABYLON.Scene} scene
 * @param {Object} config - config_file_content
 */
function setupRoomLighting(scene, config) {
	_disposeRectAreaLights(scene);

	// Set pointLight intensities: parse _I{value} from name, fall back to Technical.pointLight
	scene.lights.forEach(function(light) {
		if (light.name.startsWith("pointLight")) {
			var match = light.name.match(/_I(\d+(?:\.\d+)?)/);
			if (match) {
				light.intensity = parseFloat(match[1]);
			} else {
				light.intensity = config["Technical"]["pointLight"];
			}
		} else if (light.name.match(/^splash_\d+/)) {
			// Owned by the cone-splash system: its pose drives the analytic splash,
			// the runtime light itself stays off (zero-runtime-light design).
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

	// Detect F_ fixture meshes: F_N_dx_dy_dz (direction in Blender coords, 'n' = negative)
	var fixtures = scene.meshes.filter(function(m) {
		return m.name.match(/^F_\d+/);
	});

	// Hide helper meshes from templates
	scene.meshes.forEach(function(m) {
		if (m.name.match(/^Occupancy_/) || m.name === 'door_title') m.isVisible = false;
	});

	if (fixtures.length === 0) return;

	for (var i = 0; i < fixtures.length; i++) {
		var fixture = fixtures[i];
		var parts = fixture.name.split("_");

		// Parse direction and intensity from name: F_N_dx_dy_dz_IXX (Blender coords, 'n' = negative)
		if (parts.length < 5) {
			console.error("Lighting: " + fixture.name + " missing direction — expected F_N_dx_dy_dz[_IXX]");
			continue;
		}
		var lightIntensity = 0;
		for (var p = 5; p < parts.length; p++) {
			if (parts[p].charAt(0) === 'I') {
				lightIntensity = parseFloat(parts[p].substring(1));
			}
		}
		function parseCoord(s) {
			if (s.charAt(0) === 'n') return -parseFloat(s.substring(1));
			return parseFloat(s);
		}
		var bx = parseCoord(parts[2]);
		var by = parseCoord(parts[3]);
		var bz = parseCoord(parts[4]);
		// Blender (x, y, z) → Babylon (x, z, y)
		var lightDir = new BABYLON.Vector3(bx, bz, by);
		if (lightDir.length() < 0.01) {
			console.error("Lighting: " + fixture.name + " has zero direction vector");
			continue;
		}
		lightDir.normalize();

		fixture.computeWorldMatrix(true);
		fixture.refreshBoundingInfo();

		// --- Fixture dimensions ---
		var fixturePos = fixture.getAbsolutePosition();
		var fixtureBB = fixture.getBoundingInfo().boundingBox;
		var xExtent = fixtureBB.maximumWorld.x - fixtureBB.minimumWorld.x;
		var zExtent = fixtureBB.maximumWorld.z - fixtureBB.minimumWorld.z;
		var lightWidth = Math.max(xExtent, zExtent);
		var lightDepth = Math.min(xExtent, zExtent);

		// --- Light position ---
		var lightPos = new BABYLON.Vector3(fixturePos.x, fixturePos.y - 0.2, fixturePos.z);

		console.log("Lighting: " + fixture.name +
			" | pos=" + lightPos.toString() +
			" dir=" + lightDir.toString() +
			" width=" + lightWidth.toFixed(2) + " depth=" + lightDepth.toFixed(2));

		// --- Create RectAreaLight ---
		var light = new BABYLON.RectAreaLight(
			"rectLight_" + fixture.name,
			BABYLON.Vector3.Zero(),
			lightWidth,
			lightDepth,
			scene
		);
		light.intensity = lightIntensity;

		// Orient light using direction vector (yaw + pitch)
		var transformNode = new BABYLON.TransformNode("rectLightNode_" + fixture.name, scene);
		transformNode.position = lightPos;
		var horizLen = Math.sqrt(lightDir.x * lightDir.x + lightDir.z * lightDir.z);
		if (horizLen < 0.01) {
			transformNode.rotation.y = (zExtent > xExtent) ? Math.PI / 2 : 0;
		} else {
			transformNode.rotation.y = Math.atan2(lightDir.x, lightDir.z);
		}
		transformNode.rotation.x = -Math.atan2(-lightDir.y, horizLen);

		light.parent = transformNode;
		light.position = BABYLON.Vector3.Zero();

		_ovgal_lights.rectAreaLights.push({
			light: light,
			transformNode: transformNode,
			fixture: fixture
		});
	}

	console.log("Lighting: " + fixtures.length + " fixtures, " + _ovgal_lights.rectAreaLights.length + " RectAreaLights created");
}

/**
 * Freezes all BJS_materials — call after lights AND materials are assigned to meshes.
 */
function freezeGalleryMaterials() {
	// Cone-splash live tuning (?splash) needs material binds to keep running.
	if (new URLSearchParams(window.location.search).has('splash')) {
		console.log("Lighting: skipping material freeze (?splash active)");
		return;
	}
	if (typeof BJS_materials !== 'undefined') {
		for (var matName in BJS_materials) {
			BJS_materials[matName].freeze();
		}
		console.log("Lighting: froze BJS_materials");
	}
}

function _disposeRectAreaLights(scene) {
	for (var i = 0; i < _ovgal_lights.rectAreaLights.length; i++) {
		var entry = _ovgal_lights.rectAreaLights[i];
		entry.light.dispose();
		entry.transformNode.dispose();
	}
	_ovgal_lights.rectAreaLights = [];
}

// =====================================================================
// Baked (frozen) shadow map — EXPERIMENTAL. Enable with ?shadow=1.
// Casts from the room's actual dominant point/spot light (not a fake
// light), so shadow direction matches the real illumination. The map is
// rendered once then frozen (zero per-frame bake cost). G toggles;
// live panel tunes darkness/blur.
// =====================================================================
var _ovgal_shadow = null;

function _rebakeShadow() {
	if (_ovgal_shadow) {
		_ovgal_shadow.sg.getShadowMap().refreshRate =
			BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
	}
}

/**
 * Sets up (or re-bakes) a frozen shadow map cast from the room's real
 * dominant point/spot light. No-op unless ?shadow=1. Call after meshes
 * are loaded, before material freeze.
 * @param {BABYLON.Scene} scene
 */
function setupBakedShadows(scene) {
	if (!new URLSearchParams(window.location.search).has('shadow')) return;

	// Diagnostic: dump every light so we can see what's actually in the scene.
	console.log("Baked shadows — scene lights:");
	scene.lights.forEach(function (l) {
		console.log("   " + l.getClassName() + " '" + l.name + "' enabled=" +
			l.isEnabled() + " intensity=" + l.intensity);
	});

	// Pick the brightest enabled point/spot light — the one whose shadows
	// will actually read against the hemispheric ambient.
	var src = scene.lights
		.filter(function (l) {
			var c = l.getClassName();
			return l.isEnabled() && (c === "PointLight" || c === "SpotLight");
		})
		.sort(function (a, b) { return b.intensity - a.intensity; })[0];

	if (!src) {
		console.warn("Baked shadows: no point/spot light in scene to cast from");
		return;
	}

	if (!_ovgal_shadow) {
		_ovgal_shadow = { mapSize: 2048, darkness: 0.4 };
		window._shadow = _ovgal_shadow;
	}
	_ovgal_shadow.scene = scene;

	// (Re)build the generator on first run or if the dominant light changed.
	if (_ovgal_shadow.src !== src) {
		_ovgal_shadow.src = src;
		_buildShadowGenerator();
		if (!_ovgal_shadow.uiBuilt) {
			_bindShadowToggle();
			_buildShadowPanel();
			_ovgal_shadow.uiBuilt = true;
		}
		console.log("Baked shadows: casting from '" + src.name + "' (intensity " + src.intensity + ")");
	}

	_registerCastersAndBake();
}

// Build (or rebuild) the generator from current params. Recreating is the only
// reliable way to apply a new blur kernel, so blur/depthScale changes call this.
function _buildShadowGenerator() {
	var s = _ovgal_shadow;
	if (s.sg) s.sg.dispose();
	var src = s.src;
	src.shadowMinZ = 0.5;
	src.shadowMaxZ = 30;            // tight range = better depth precision
	var sg = new BABYLON.ShadowGenerator(s.mapSize, src);
	sg.usePoissonSampling = true;  // clean on point-light cube maps; no ESM bleed/banding
	sg.bias = 0.001;
	sg.forceBackFacesOnly = true;  // back faces into the map -> kills self-shadow acne
	sg.setDarkness(s.darkness);
	s.sg = sg;
}

function _registerCastersAndBake() {
	var s = _ovgal_shadow;
	var map = s.sg.getShadowMap();
	map.renderList = [];
	s.scene.meshes.forEach(function (m) {
		if (!m.isVisible) return;
		if (m.name.match(/^Occupancy_/) || m.name === 'door_title') return;
		m.receiveShadows = true;
		map.renderList.push(m);
	});
	map.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
}

function _bindShadowToggle() {
	var on = true, saved = 0.4;
	window.addEventListener("keydown", function (e) {
		if ((e.key === "g" || e.key === "G") && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			on = !on;
			// Toggle via darkness so the real light keeps illuminating the room.
			if (on) {
				_ovgal_shadow.sg.setDarkness(saved);
			} else {
				saved = _ovgal_shadow.sg.getDarkness();
				_ovgal_shadow.sg.setDarkness(1);
			}
			console.log("Shadows " + (on ? "on" : "off"));
		}
	});
}

function _buildShadowPanel() {
	var s = _ovgal_shadow;
	var panel = document.createElement("div");
	panel.style.cssText = "position:fixed;bottom:10px;right:10px;z-index:99999;"
		+ "background:rgba(0,0,0,0.75);color:#fafafa;font:12px Inter,sans-serif;"
		+ "padding:10px 12px;border-radius:8px;width:200px;user-select:none;";
	panel.innerHTML = "<div style='margin-bottom:6px;font-weight:600;'>Shadow &nbsp;<span style='color:#a1a1aa;font-weight:400;'>G=on/off</span></div>";

	function addSlider(label, min, max, step, get, set, rebake) {
		var row = document.createElement("label");
		row.style.cssText = "display:block;margin:6px 0;";
		var val = document.createElement("span");
		val.textContent = get().toFixed(2);
		val.style.cssText = "float:right;color:#a5b4fc;";
		var name = document.createElement("span");
		name.textContent = label;
		var slider = document.createElement("input");
		slider.type = "range";
		slider.min = min; slider.max = max; slider.step = step;
		slider.value = get();
		slider.style.cssText = "width:100%;margin-top:2px;";
		slider.addEventListener("input", function () {
			var v = parseFloat(slider.value);
			set(v);
			val.textContent = v.toFixed(2);
			if (rebake) _rebakeShadow();
		});
		row.appendChild(name); row.appendChild(val); row.appendChild(slider);
		panel.appendChild(row);
	}

	// Rebalance key vs ambient — the shadow only reads when the key light is
	// strong enough relative to the flat hemispheric fill.
	addSlider("key intensity", 0, 30, 0.1,
		function () { return s.src.intensity; },
		function (v) { s.src.intensity = v; }, false);

	var baseUp = _ovgal_lights.ambientUp ? _ovgal_lights.ambientUp.intensity : 0;
	var baseDown = _ovgal_lights.ambientDown ? _ovgal_lights.ambientDown.intensity : 0;
	s.ambientMult = 1;
	addSlider("ambient", 0, 1.5, 0.02,
		function () { return s.ambientMult; },
		function (v) {
			s.ambientMult = v;
			if (_ovgal_lights.ambientUp) _ovgal_lights.ambientUp.intensity = baseUp * v;
			if (_ovgal_lights.ambientDown) _ovgal_lights.ambientDown.intensity = baseDown * v;
		}, false);

	addSlider("darkness", 0, 1, 0.02,
		function () { return s.darkness; },
		function (v) { s.darkness = v; s.sg.setDarkness(v); }, false);
	addSlider("resolution", 256, 4096, 128,
		function () { return s.mapSize; },
		function (v) { s.mapSize = v; _buildShadowGenerator(); _registerCastersAndBake(); }, false);

	document.body.appendChild(panel);
}

// =====================================================================
// Cone-splash lighting (Lightmap V2) — EXPERIMENTAL. Enable with ?splash=1.
// Replaces the visible effect of RectAreaLight fixtures with analytic,
// world-space cone splashes injected into the wall PBR materials via a
// MaterialPlugin. Per-fragment in world space, so it is seam-free across
// wall mesh chunks and needs no UV2/bake.
//
// Cone source: F_N_dx_dy_dz_IXX fixtures (origin = fixture position, axis =
// its direction); falls back to the template's marker SpotLight(s) when a
// room has no F_ fixtures.
//
// L toggles; the live panel tunes strength / reach / cone angles.
// =====================================================================
var _ovgal_splash = null;
var _ConeSplashPluginClass = null;
var CONE_SPLASH_MAX = 32;

// Lazily define the plugin class (BABYLON must be loaded first).
function _ensureConeSplashClass() {
	if (_ConeSplashPluginClass) return;

	_ConeSplashPluginClass = class ConeSplashPlugin extends BABYLON.MaterialPluginBase {
		constructor(material) {
			// priority 200: run after the core PBR blocks. Every define the plugin
			// toggles must be declared here — Babylon builds the plugin's
			// MaterialDefines from this list, and a define set in prepareDefines()
			// but missing here is never tracked for recompile.
			super(material, "ConeSplash", 200, { CONESPLASH: false });
			this._enabled = false;
			this._enable(true); // keep in pipeline; the CONESPLASH define gates the actual code
		}

		get isEnabled() { return this._enabled; }
		set isEnabled(v) {
			if (this._enabled === v) return;
			this._enabled = v;
			this.markAllDefinesAsDirty();
		}

		prepareDefines(defines) {
			defines["CONESPLASH"] = this._enabled;
		}

		getClassName() { return "ConeSplashPlugin"; }

		getUniforms() {
			return {
				ubo: [
					// Both size AND type are required, else the entry is skipped.
					{ name: "coneSplashGlobals", size: 4, type: "vec4" }, // (count, cosInner, cosOuter, strength)
					{ name: "coneSplashColor", size: 4, type: "vec4" },   // (r, g, b, maxDist)
					{ name: "coneSplashPos", size: 4, type: "vec4", arraySize: CONE_SPLASH_MAX },  // xyz=worldPos, w=weight
					{ name: "coneSplashAxis", size: 4, type: "vec4", arraySize: CONE_SPLASH_MAX }  // xyz=aim dir
				],
				fragment:
					"#ifdef CONESPLASH\n" +
					"uniform vec4 coneSplashGlobals;\n" +
					"uniform vec4 coneSplashColor;\n" +
					"uniform vec4 coneSplashPos[" + CONE_SPLASH_MAX + "];\n" +
					"uniform vec4 coneSplashAxis[" + CONE_SPLASH_MAX + "];\n" +
					"#endif\n"
			};
		}

		bindForSubMesh(uniformBuffer) {
			if (!this._enabled || !_ovgal_splash) return;
			var s = _ovgal_splash;
			uniformBuffer.updateFloat4("coneSplashGlobals", s.count, s.cosInner, s.cosOuter, s.strength);
			uniformBuffer.updateFloat4("coneSplashColor", s.color.r, s.color.g, s.color.b, s.maxDist);
			uniformBuffer.updateFloatArray("coneSplashPos", s.posArray);
			uniformBuffer.updateFloatArray("coneSplashAxis", s.axisArray);
		}

		getCustomCode(shaderType) {
			if (shaderType !== "fragment") return null;
			return {
				"CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR":
					"#ifdef CONESPLASH\n" +
					"{\n" +
					"  float csCount = coneSplashGlobals.x;\n" +
					"  vec3 csAccum = vec3(0.0);\n" +
					"  vec3 csN = normalize(vNormalW);\n" +
					"  for (int ci = 0; ci < " + CONE_SPLASH_MAX + "; ci++) {\n" +
					"    if (float(ci) >= csCount) break;\n" +
					"    vec3 csL = vPositionW - coneSplashPos[ci].xyz;\n" +
					"    float csDist = length(csL);\n" +
					"    vec3 csDir = csL / max(csDist, 1e-4);\n" +
					"    float csAng = dot(csDir, coneSplashAxis[ci].xyz);\n" +
					"    float csCone = smoothstep(coneSplashGlobals.z, coneSplashGlobals.y, csAng);\n" +
					"    float csRadial = 1.0 - smoothstep(0.0, coneSplashColor.w, csDist);\n" +
					"    float csNdl = max(0.0, dot(csN, -csDir));\n" +
					"    csAccum += coneSplashPos[ci].w * csCone * csRadial * csNdl;\n" +
					"  }\n" +
					"  finalColor.rgb += csAccum * coneSplashColor.rgb * coneSplashGlobals.w;\n" +
					"}\n" +
					"#endif\n"
			};
		}
	};
}

// Parse cone origins + aim directions from the F_ fixtures (same convention
// as setupRoomLighting). Returns { posArray, axisArray, count }.
function _collectConesFromFixtures(scene) {
	var posArray = new Float32Array(CONE_SPLASH_MAX * 4);
	var axisArray = new Float32Array(CONE_SPLASH_MAX * 4);
	var lights = [];   // per-cone { pos, dir } for the shadow bake
	var count = 0;

	function parseCoord(s) {
		if (s.charAt(0) === 'n') return -parseFloat(s.substring(1));
		return parseFloat(s);
	}

	var fixtures = scene.meshes.filter(function (m) { return m.name.match(/^F_\d+/); });
	for (var i = 0; i < fixtures.length && count < CONE_SPLASH_MAX; i++) {
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

		fixture.computeWorldMatrix(true);
		var pos = fixture.getAbsolutePosition();

		var b = count * 4;
		posArray[b] = pos.x; posArray[b + 1] = pos.y - 0.2; posArray[b + 2] = pos.z; posArray[b + 3] = 1.0;
		axisArray[b] = axis.x; axisArray[b + 1] = axis.y; axisArray[b + 2] = axis.z; axisArray[b + 3] = 0.0;
		lights.push({ pos: new BABYLON.Vector3(pos.x, pos.y - 0.2, pos.z), dir: axis.clone() });
		count++;
	}

	return { posArray: posArray, axisArray: axisArray, lights: lights, count: count };
}

// Cone source from glTF SpotLights. With nameFilter (e.g. /^splash_\d+/) it
// selects only the explicitly-authored splash spots; without it, any spot (the
// template's marker). Cone origin = spot world position, axis = spot world
// direction — both resolved by Babylon's glTF loader, so no manual handedness
// math. Static, so the visibility volume bakes once at load.
function _collectConesFromSpotLights(scene, nameFilter) {
	var posArray = new Float32Array(CONE_SPLASH_MAX * 4);
	var axisArray = new Float32Array(CONE_SPLASH_MAX * 4);
	var lights = [];   // per-cone { pos, dir } for the shadow bake
	var count = 0;

	var spots = scene.lights.filter(function (l) {
		return l.getClassName && l.getClassName() === "SpotLight"
			&& (!nameFilter || nameFilter.test(l.name));
	});
	for (var i = 0; i < spots.length && count < CONE_SPLASH_MAX; i++) {
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

		var b = count * 4;
		posArray[b] = pos.x; posArray[b + 1] = pos.y; posArray[b + 2] = pos.z; posArray[b + 3] = 1.0;
		axisArray[b] = dir.x; axisArray[b + 1] = dir.y; axisArray[b + 2] = dir.z; axisArray[b + 3] = 0.0;
		lights.push({ pos: pos.clone(), dir: dir.clone() });
		count++;
	}

	return { posArray: posArray, axisArray: axisArray, lights: lights, count: count };
}

// Which materials get a cone-splash plugin: wall-ish PBR surfaces only.
function _shouldSplash(material) {
	if (!material || !material.getClassName) return false;
	if (material.getClassName().indexOf("PBR") === -1) return false; // only PBR exposes the hooks
	if (material.name && material.name.match(/glow|frame|plaque|metal|chrome/i)) return false;
	return true;
}

var _ovgal_splash_registered = false;

// Register the plugin globally so every matching material includes it AT
// CREATION (its UBO uniforms can't be added after the buffer is built). Gated
// on ?splash; called from initGalleryLighting before any gallery loads.
function _registerConeSplashPlugin() {
	if (_ovgal_splash_registered) return;
	if (!new URLSearchParams(window.location.search).has('splash')) return;
	if (typeof BABYLON.MaterialPluginBase === 'undefined' || typeof BABYLON.RegisterMaterialPlugin === 'undefined') {
		console.warn("Cone splash: this Babylon build lacks MaterialPlugin support");
		return;
	}
	_ensureConeSplashClass();
	BABYLON.RegisterMaterialPlugin("ConeSplash", function (material) {
		return _shouldSplash(material) ? new _ConeSplashPluginClass(material) : null;
	});
	_ovgal_splash_registered = true;
	console.log("Cone splash: plugin registered (materials include it at creation)");
}

/**
 * Sets up cone-splash lighting. No-op unless ?splash=1. Call after meshes +
 * materials are loaded (alongside setupBakedShadows), before material freeze.
 * @param {BABYLON.Scene} scene
 */
function setupConeSplashes(scene) {
	if (!_ovgal_splash_registered) return; // flag off, or no plugin support

	// Primary: explicitly-authored `splash_N` glTF SpotLights (the GLB authoring
	// convention — position + direction from the node, cone params still global).
	var cones = _collectConesFromSpotLights(scene, /^splash_\d+/);
	var coneSource = "splash_N spots";

	// Else legacy F_ fixtures (direction packed in the mesh name).
	if (cones.count === 0) {
		cones = _collectConesFromFixtures(scene);
		if (cones.count > 0) coneSource = "F_ fixtures";
	}

	// Else the template's marker SpotLight (e.g. the root gallery).
	if (cones.count === 0) {
		cones = _collectConesFromSpotLights(scene);
		if (cones.count > 0) coneSource = "template spot light";
	}

	if (!_ovgal_splash) {
		_ovgal_splash = {
			enabled: true,
			strength: 1.5,
			maxDist: 12.0,
			innerDeg: 12.0,
			outerDeg: 28.0,
			color: { r: 1.0, g: 0.96, b: 0.88 },
			plugins: []
		};
		window._splash = _ovgal_splash;
		_refreshSplashAngles();
	}
	_ovgal_splash.posArray = cones.posArray;
	_ovgal_splash.axisArray = cones.axisArray;
	_ovgal_splash.count = cones.count;

	// No cone source (no F_ fixtures, no template spot) → nothing to render.
	if (cones.count === 0) {
		console.warn("Cone splash: no F_ fixtures or spot lights in scene — nothing to render");
		return;
	}
	console.log("Cone splash: " + cones.count + " cone(s) from " + coneSource);

	// Gather the plugins that were attached at material creation and enable
	// them. Cones are shared globally, so each reads the same _ovgal_splash data.
	_ovgal_splash.plugins = [];
	scene.materials.forEach(function (mat) {
		if (!mat.pluginManager) return;
		var plugin = mat.pluginManager.getPlugin("ConeSplash");
		if (plugin) {
			plugin.isEnabled = _ovgal_splash.enabled;
			_ovgal_splash.plugins.push(plugin);
		}
	});

	_ovgal_splash.scene = scene;
	console.log("Cone splash: " + cones.count + " cones, " + _ovgal_splash.plugins.length + " materials");

	if (!_ovgal_splash.uiBuilt) {
		_bindSplashToggle();
		_buildSplashPanel();
		_ovgal_splash.uiBuilt = true;
	}
}

function _refreshSplashAngles() {
	var s = _ovgal_splash;
	s.cosInner = Math.cos(s.innerDeg * Math.PI / 180);
	s.cosOuter = Math.cos(s.outerDeg * Math.PI / 180);
}

function _setSplashEnabled(on) {
	_ovgal_splash.enabled = on;
	_ovgal_splash.plugins.forEach(function (p) { p.isEnabled = on; });
}

function _bindSplashToggle() {
	window.addEventListener("keydown", function (e) {
		if ((e.key === "l" || e.key === "L") && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			_setSplashEnabled(!_ovgal_splash.enabled);
			console.log("Cone splash " + (_ovgal_splash.enabled ? "on" : "off"));
		}
	});
}

function _buildSplashPanel() {
	var s = _ovgal_splash;
	var panel = document.createElement("div");
	panel.style.cssText = "position:fixed;bottom:10px;left:10px;z-index:99999;"
		+ "background:rgba(0,0,0,0.75);color:#fafafa;font:12px Inter,sans-serif;"
		+ "padding:10px 12px;border-radius:8px;width:200px;user-select:none;";
	panel.innerHTML = "<div style='margin-bottom:6px;font-weight:600;'>Cone splash &nbsp;<span style='color:#a1a1aa;font-weight:400;'>L=on/off</span></div>";

	// All sliders are live: the cone splash is fully analytic, no bake to commit.
	function addSlider(label, min, max, step, get, set) {
		var row = document.createElement("label");
		row.style.cssText = "display:block;margin:6px 0;";
		var val = document.createElement("span");
		val.textContent = get().toFixed(2);
		val.style.cssText = "float:right;color:#a5b4fc;";
		var name = document.createElement("span");
		name.textContent = label;
		var slider = document.createElement("input");
		slider.type = "range";
		slider.min = min; slider.max = max; slider.step = step;
		slider.value = get();
		slider.style.cssText = "width:100%;margin-top:2px;";
		slider.addEventListener("input", function () {
			set(parseFloat(slider.value));
			val.textContent = parseFloat(slider.value).toFixed(2);
		});
		row.appendChild(name); row.appendChild(val); row.appendChild(slider);
		panel.appendChild(row);
	}

	addSlider("strength", 0, 5, 0.05,
		function () { return s.strength; },
		function (v) { s.strength = v; });
	addSlider("reach (m)", 1, 30, 0.5,
		function () { return s.maxDist; },
		function (v) { s.maxDist = v; });
	addSlider("inner angle", 1, 45, 0.5,
		function () { return s.innerDeg; },
		function (v) { s.innerDeg = v; _refreshSplashAngles(); });
	addSlider("outer angle", 2, 90, 0.5,
		function () { return s.outerDeg; },
		function (v) { s.outerDeg = v; _refreshSplashAngles(); });

	document.body.appendChild(panel);
}

// =====================================================================
// Startup lightmap bake (Lightmap V3) — EXPERIMENTAL. Enable with ?bake=1.
// Bakes the contribution of every spot light into a per-mesh UV2 lightmap
// at load time, then displays it. Same spot sources as the cone-splash
// (splash_N spots → F_ fixtures → template spot), same analytic cone math,
// so the look is consistent — but baked into texels instead of evaluated
// per-fragment, which is what lets us later fold in shadows + many lights
// for ~zero per-frame cost.
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

// Fixed shadow frustum: wide enough to cover any tuned cone angle, so the angle
// sliders never force a depth-map re-render. Only the resolution slider rebuilds.
var BAKE_SHADOW_FOV = 110 * Math.PI / 180;
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
		"uniform vec4 bakeGlobals;\n" +    // x=cosInner, y=cosOuter, z=intensity, w=maxDist (reach)
		"uniform vec4 bakeColor;\n" +      // rgb=light color
		"uniform vec4 bakeAmbient;\n" +    // x=hemi intensity up, y=hemi intensity down (white, ground=black)
		"uniform vec4 bakeLight;\n" +      // xyz=this light world pos
		"uniform vec4 bakeAxis0;\n" +      // xyz=this light aim dir
		"uniform vec4 shadowParams;\n" +   // x=darkness, y=bias(m), z=isFirstPass, w=texelSize
		"uniform mat4 lightMatrix;\n" +    // this light view-projection (for the shadow UV)
		"uniform vec4 aoParams;\n" +       // x = AO strength (0=off, 1=full)
		"uniform sampler2D prevTex;\n" +   // previous accumulation (ping-pong)
		"uniform sampler2D shadowSampler;\n" + // this light's depth map (linear meters in .r)
		"uniform sampler2D aoSampler;\n" + // this mesh's baked AO (.r = AO, .g = 1)
		"float sampleShadow(vec3 P, float ndl){\n" +
		"  vec4 sc = lightMatrix * vec4(P, 1.0);\n" +
		"  if (sc.w <= 0.0) return 1.0;\n" +
		"  vec2 uv = (sc.xy / sc.w) * 0.5 + 0.5;\n" +
		"  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;\n" +
		"  float cur = length(P - bakeLight.xyz);\n" +
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
		"  vec3 L = vPositionW - bakeLight.xyz;\n" +
		"  float dist = length(L);\n" +
		"  vec3 dir = L / max(dist, 1e-4);\n" +
		"  float ang = dot(dir, bakeAxis0.xyz);\n" +
		"  float cone = smoothstep(bakeGlobals.y, bakeGlobals.x, ang);\n" +
		"  float radial = 1.0 - smoothstep(0.0, bakeGlobals.w, dist);\n" +
		"  float ndl = max(dot(N, -dir), 0.0);\n" +
		"  float occ = sampleShadow(vPositionW, ndl);\n" +
		"  vec3 lit = vec3(cone * radial * ndl) * bakeColor.rgb * bakeGlobals.z * occ;\n" +
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
				"bakeAxis0", "shadowParams", "lightMatrix", "aoParams"],
			samplers: ["prevTex", "shadowSampler", "aoSampler"]
		});
	// Texture-space winding is arbitrary, so never cull or we drop texels.
	mat.backFaceCulling = false;
	_ovgal_bake.material = mat;
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

// Build (or rebuild) one depth map per light. Each is rendered once from the
// light's POV with the depth material, then sampled in the bake. Independent of
// the tuning sliders, so this only runs on first bake + resolution change.
function _buildShadowMaps(scene) {
	var b = _ovgal_bake;

	// Dispose any previous maps (resolution change).
	if (b.shadowMaps) b.shadowMaps.forEach(function (m) { m.dispose(); });
	b.shadowMaps = [];
	b.lightVP = [];

	// Casters = the same room surfaces the bake covers (skip helpers). Keep them
	// always-active so the light-POV render isn't culled by the user camera.
	var casters = scene.meshes.filter(function (m) {
		if (!m.isVisible) return false;
		if (m.name.match(/^Occupancy_/) || m.name === 'door_title') return false;
		return true;
	});
	casters.forEach(function (m) { m.alwaysSelectAsActiveMesh = true; });

	var lh = !scene.useRightHandedSystem;

	for (var k = 0; k < b.lights.length; k++) {
		var pos = b.lights[k].pos;
		var dir = b.lights[k].dir;
		// Up vector must not be parallel to a near-vertical aim (gallery spots
		// often point straight down) or LookAt degenerates.
		var up = (Math.abs(dir.y) > 0.99) ? new BABYLON.Vector3(0, 0, 1)
			: new BABYLON.Vector3(0, 1, 0);
		var target = pos.add(dir);
		var view = lh ? BABYLON.Matrix.LookAtLH(pos, target, up)
			: BABYLON.Matrix.LookAtRH(pos, target, up);
		var proj = lh ? BABYLON.Matrix.PerspectiveFovLH(BAKE_SHADOW_FOV, 1, BAKE_SHADOW_NEAR, BAKE_SHADOW_FAR)
			: BABYLON.Matrix.PerspectiveFovRH(BAKE_SHADOW_FOV, 1, BAKE_SHADOW_NEAR, BAKE_SHADOW_FAR);
		var vp = view.multiply(proj);
		b.lightVP.push(vp);

		var dm = new BABYLON.RenderTargetTexture("bakeDepth_" + k, b.shadowRes, scene,
			false, true, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT);
		dm.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
		dm.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
		dm.renderList = casters;
		casters.forEach(function (m) { dm.setMaterialForRendering(m, b.depthMat); });

		// Bind this light's matrices, then render the map exactly once.
		b.depthMat.setMatrix("lightVP", vp);
		b.depthMat.setVector4("lightInfo", new BABYLON.Vector4(pos.x, pos.y, pos.z, BAKE_SHADOW_FAR));
		dm.render();
		b.shadowMaps.push(dm);
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

	var casters = scene.meshes.filter(function (m) {
		if (!m.isVisible) return false;
		if (m.name.match(/^Occupancy_/) || m.name === 'door_title') return false;
		return true;
	});

	// Padded world AABB -> cubic voxel size from the longest axis.
	var min = new BABYLON.Vector3(1e9, 1e9, 1e9);
	var max = new BABYLON.Vector3(-1e9, -1e9, -1e9);
	casters.forEach(function (m) {
		var bb = m.getBoundingInfo().boundingBox;
		min = BABYLON.Vector3.Minimize(min, bb.minimumWorld);
		max = BABYLON.Vector3.Maximize(max, bb.maximumWorld);
	});
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
	casters.forEach(function (m) {
		var positions = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
		var indices = m.getIndices();
		if (!positions || !indices) return;
		m.computeWorldMatrix(true);
		var wm = m.getWorldMatrix();
		for (var t = 0; t < indices.length; t += 3) {
			var i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
			var v0 = BABYLON.Vector3.TransformCoordinates(
				new BABYLON.Vector3(positions[i0], positions[i0 + 1], positions[i0 + 2]), wm);
			var v1 = BABYLON.Vector3.TransformCoordinates(
				new BABYLON.Vector3(positions[i1], positions[i1 + 1], positions[i1 + 2]), wm);
			var v2 = BABYLON.Vector3.TransformCoordinates(
				new BABYLON.Vector3(positions[i2], positions[i2 + 1], positions[i2 + 2]), wm);
			var ax = v1.x - v0.x, ay = v1.y - v0.y, az = v1.z - v0.z;
			var bx = v2.x - v0.x, by = v2.y - v0.y, bz = v2.z - v0.z;
			var la = Math.sqrt(ax * ax + ay * ay + az * az);
			var lb = Math.sqrt(bx * bx + by * by + bz * bz);
			var ns = Math.min(2048, Math.max(1, Math.ceil(Math.max(la, lb) / step)));
			var inv = 1.0 / ns;
			for (var ii = 0; ii <= ns; ii++) {
				for (var jj = 0; jj <= ns - ii; jj++) {
					var u = ii * inv, w2 = jj * inv;
					mark(
						Math.floor((v0.x + ax * u + bx * w2 - min.x) / vs),
						Math.floor((v0.y + ay * u + by * w2 - min.y) / vs),
						Math.floor((v0.z + az * u + bz * w2 - min.z) / vs));
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

// Allocate a mesh's two ping-pong half-float RTTs + its debug view material.
// Content is rendered later by _runBake (these are driven manually, NOT added to
// scene.customRenderTargets — we don't want per-frame auto-refresh).
function _bakeMesh(scene, mesh) {
	var b = _ovgal_bake;

	function makeBuf(tag) {
		var rtt = new BABYLON.RenderTargetTexture(
			"bakeRTT_" + mesh.name + "_" + tag, b.size, scene,
			false,                                      // generateMipMaps
			true,                                       // doNotChangeAspectRatio
			BABYLON.Constants.TEXTURETYPE_HALF_FLOAT);  // float accumulation target
		rtt.coordinatesIndex = 1;                       // sample with UV2 when used on the material
		rtt.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
		rtt.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
		rtt.renderList = [mesh];
		rtt.setMaterialForRendering(mesh, b.material);  // draw this mesh with the bake shader
		return rtt;
	}
	var buffers = [makeBuf("A"), makeBuf("B")];

	// One AO buffer per mesh (.r = ambient occlusion). Lower res than the lightmap —
	// AO is low-frequency, and the main bake upsamples it via UV2 bilinear.
	var aoBuffer = new BABYLON.RenderTargetTexture(
		"bakeAORTT_" + mesh.name, BAKE_AO_BUF, scene,
		false, true, BABYLON.Constants.TEXTURETYPE_HALF_FLOAT);
	aoBuffer.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
	aoBuffer.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
	aoBuffer.coordinatesIndex = 1;
	aoBuffer.renderList = [mesh];
	aoBuffer.setMaterialForRendering(mesh, b.aoMat);

	// The bake vertex shader ignores the camera, but the RTT still frustum-culls
	// its render list against the active camera — keep the mesh always-active so
	// it's guaranteed to draw regardless of where the camera is pointing.
	mesh.alwaysSelectAsActiveMesh = true;

	// Debug view: an unlit material showing ONLY the baked lightmap (per-mesh
	// UV2). Material-agnostic on purpose — room surfaces are NodeMaterials (BJS_*)
	// with no emissiveTexture, so we don't clone the original here; that's the
	// Phase 5 job. B toggles back to `orig`. emissiveTexture is pointed at the
	// final accumulation buffer by _runBake once the parity is known.
	var orig = mesh.material;
	var view = new BABYLON.StandardMaterial("bakeView_" + mesh.name, scene);
	view.disableLighting = true;            // show the lightmap raw, no runtime lights
	view.emissiveTexture = buffers[0];
	view.emissiveTexture.coordinatesIndex = 1;
	mesh.material = view;

	b.baked.push({ mesh: mesh, buffers: buffers, aoBuffer: aoBuffer, orig: orig, view: view });
}

// Imperative bake driver: for each mesh, accumulate the lights via ping-pong.
// Pass k reads buffer k%2, writes buffer (k+1)%2 = previous + cone(light k) *
// shadow(light k); the first pass seeds with the hemi ambient instead of a read.
// Re-running is cheap (no depth re-render), so the tuning sliders call this.
function _runBake() {
	var b = _ovgal_bake;
	var m = b.material;
	if (b.count === 0) return;

	// Shared (per-light-invariant) uniforms.
	m.setVector4("bakeGlobals", new BABYLON.Vector4(b.cosInner, b.cosOuter, b.intensity, b.maxDist));
	m.setVector4("bakeColor", new BABYLON.Vector4(b.color.r, b.color.g, b.color.b, 0));
	var iUp = _ovgal_lights.ambientUp ? _ovgal_lights.ambientUp.intensity : 0;
	var iDown = _ovgal_lights.ambientDown ? _ovgal_lights.ambientDown.intensity : 0;
	m.setVector4("bakeAmbient", new BABYLON.Vector4(iUp * b.ambient, iDown * b.ambient, 0, 0));
	m.setVector4("aoParams", new BABYLON.Vector4(b.aoStrength, 0, 0, 0));

	var texel = 1.0 / b.shadowRes;
	var finalIndex = b.count % 2;

	b.baked.forEach(function (it) {
		// This mesh's baked AO seeds the ambient on the first pass (k === 0).
		m.setTexture("aoSampler", it.aoBuffer);
		for (var k = 0; k < b.count; k++) {
			var src = it.buffers[k % 2];
			var dst = it.buffers[(k + 1) % 2];
			var lp = b.lights[k].pos, ld = b.lights[k].dir;
			m.setVector4("bakeLight", new BABYLON.Vector4(lp.x, lp.y, lp.z, 0));
			m.setVector4("bakeAxis0", new BABYLON.Vector4(ld.x, ld.y, ld.z, 0));
			m.setMatrix("lightMatrix", b.lightVP[k]);
			m.setTexture("shadowSampler", b.shadowMaps[k]);
			m.setTexture("prevTex", src);
			m.setVector4("shadowParams",
				new BABYLON.Vector4(b.shadowDarkness, b.shadowBias, k === 0 ? 1 : 0, texel));
			dst.render();
		}
		// Point the debug view at whichever buffer holds the final accumulation.
		if (it.view.emissiveTexture !== it.buffers[finalIndex]) {
			it.view.emissiveTexture = it.buffers[finalIndex];
			it.view.emissiveTexture.coordinatesIndex = 1;
		}
	});
}

/**
 * Bakes a startup UV2 lightmap from the scene's spot lights. No-op unless
 * ?bake=1. Call after meshes + materials are loaded (alongside the splash /
 * shadow setup), before material freeze.
 * @param {BABYLON.Scene} scene
 */
function setupLightmapBake(scene) {
	if (!new URLSearchParams(window.location.search).has('bake')) return;

	if (!scene.getEngine().getCaps().textureHalfFloatRender) {
		console.warn("Lightmap bake: no half-float render target support — aborting");
		return;
	}

	// Same spot source priority as the cone-splash: authored splash_N spots,
	// then F_ fixtures, then the template's marker spot.
	var cones = _collectConesFromSpotLights(scene, /^splash_\d+/);
	var source = "splash_N spots";
	if (cones.count === 0) { cones = _collectConesFromFixtures(scene); source = "F_ fixtures"; }
	if (cones.count === 0) { cones = _collectConesFromSpotLights(scene); source = "template spot light"; }
	if (cones.count === 0) {
		console.warn("Lightmap bake: no spot lights / F_ fixtures in scene — nothing to bake");
		return;
	}

	if (!_ovgal_bake) {
		// One global setting shared by every light (defaults match the splash).
		_ovgal_bake = {
			intensity: 1.5,
			maxDist: 12.0,
			innerDeg: 12.0,
			outerDeg: 28.0,
			color: { r: 1.0, g: 0.96, b: 0.88 },
			ambient: 1.0,        // multiplier on the baked-in hemispheric ambient (1 = match runtime)
			shadowRes: 1024,     // per-light depth map resolution
			shadowDarkness: 0.5, // 0 = black shadow, 1 = no shadow
			shadowBias: 0.04,    // depth-compare bias in meters (acne vs peter-panning)
			aoStrength: 1.0,     // 0 = no AO, 1 = full AO darkening of the ambient
			aoRadius: 0.5,       // meters — only blockers within this reach darken
			aoBias: 0.08,        // normal offset (meters) lifting the march off the surface
			size: 512,
			visible: true,
			baked: []
		};
		window._bake = _ovgal_bake;
		_refreshBakeAngles();
	}
	_ovgal_bake.posArray = cones.posArray;
	_ovgal_bake.axisArray = cones.axisArray;
	_ovgal_bake.lights = cones.lights;
	_ovgal_bake.count = cones.count;
	_ovgal_bake.scene = scene;

	_ensureBakeMaterial(scene);
	_ensureDepthMaterial(scene);
	_ensureAOMaterials(scene);

	// Bake the room surfaces that carry a UV2 channel (skip helpers + UV2-less meshes).
	var meshes = scene.meshes.filter(function (m) {
		if (!m.isVisible) return false;
		if (m.name.match(/^Occupancy_/) || m.name === 'door_title') return false;
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
		scene.onAfterRenderObservable.addOnce(function () {
			var anyMesh = _ovgal_bake.baked[0].mesh;
			Promise.all([
				_ovgal_bake.depthMat.forceCompilationAsync(anyMesh),
				_ovgal_bake.aoMat.forceCompilationAsync(anyMesh),
				_ovgal_bake.material.forceCompilationAsync(anyMesh)
			]).then(function () {
				_buildShadowMaps(scene);
				_buildAOGrid(scene);
				_runAO();
				_runBake();
				var g = _ovgal_bake.aoGrid;
				console.log("Lightmap bake: committed " + _ovgal_bake.shadowMaps.length
					+ " shadow map(s), AO grid " + g.Nx + "x" + g.Ny + "x" + g.Nz
					+ " (voxel " + g.vs.toFixed(3) + "m)");
			}).catch(function (e) {
				console.warn("Lightmap bake: shader compile failed", e);
			});
		});
	}

	console.log("Lightmap bake: " + _ovgal_bake.baked.length + " mesh(es) queued from "
		+ cones.count + " spot(s) (" + source + ")");
	if (_ovgal_bake.baked.length === 0) {
		console.warn("Lightmap bake: no meshes with a UV2 channel were found");
	}

	if (!_ovgal_bake.uiBuilt) {
		_bindBakeToggle();
		_buildBakePanel();
		_ovgal_bake.uiBuilt = true;
	}
}

// Re-commit the bake after a tuning change. Cheap path (default): just re-run the
// accumulation passes. With rebuildShadows=true (resolution change) re-render the
// depth maps first.
function _rebake(rebuildShadows) {
	if (!_ovgal_bake) return;
	if (rebuildShadows) _buildShadowMaps(_ovgal_bake.scene);
	_runBake();
}

// Re-commit AO. Radius/offset are runtime march params (not baked into the grid),
// so an AO-slider change only re-runs the march + the bake — never the voxel grid.
function _rebakeAO() {
	if (!_ovgal_bake) return;
	_runAO();
	_runBake();
}

function _buildBakePanel() {
	var b = _ovgal_bake;
	var panel = document.createElement("div");
	panel.style.cssText = "position:fixed;top:10px;right:10px;z-index:99999;"
		+ "background:rgba(0,0,0,0.75);color:#fafafa;font:12px Inter,sans-serif;"
		+ "padding:10px 12px;border-radius:8px;width:200px;user-select:none;";
	panel.innerHTML = "<div style='margin-bottom:6px;font-weight:600;'>Lightmap bake &nbsp;<span style='color:#a1a1aa;font-weight:400;'>B=show/hide</span></div>";

	// Each slider re-bakes on input (the bake is a committed render-once, not live).
	function addSlider(label, min, max, step, get, set) {
		var row = document.createElement("label");
		row.style.cssText = "display:block;margin:6px 0;";
		var val = document.createElement("span");
		val.textContent = get().toFixed(2);
		val.style.cssText = "float:right;color:#a5b4fc;";
		var name = document.createElement("span");
		name.textContent = label;
		var slider = document.createElement("input");
		slider.type = "range";
		slider.min = min; slider.max = max; slider.step = step;
		slider.value = get();
		slider.style.cssText = "width:100%;margin-top:2px;";
		slider.addEventListener("input", function () {
			set(parseFloat(slider.value));
			val.textContent = parseFloat(slider.value).toFixed(2);
		});
		row.appendChild(name); row.appendChild(val); row.appendChild(slider);
		panel.appendChild(row);
	}

	addSlider("intensity", 0, 5, 0.05,
		function () { return b.intensity; },
		function (v) { b.intensity = v; _rebake(); });
	addSlider("reach (m)", 1, 30, 0.5,
		function () { return b.maxDist; },
		function (v) { b.maxDist = v; _rebake(); });
	addSlider("inner angle", 1, 45, 0.5,
		function () { return b.innerDeg; },
		function (v) { b.innerDeg = v; _refreshBakeAngles(); _rebake(); });
	addSlider("outer angle", 2, 90, 0.5,
		function () { return b.outerDeg; },
		function (v) { b.outerDeg = v; _refreshBakeAngles(); _rebake(); });
	addSlider("ambient", 0, 3, 0.05,
		function () { return b.ambient; },
		function (v) { b.ambient = v; _rebake(); });
	addSlider("shadow darkness", 0, 1, 0.02,
		function () { return b.shadowDarkness; },
		function (v) { b.shadowDarkness = v; _rebake(); });
	addSlider("shadow bias (m)", 0, 0.1, 0.005,
		function () { return b.shadowBias; },
		function (v) { b.shadowBias = v; _rebake(); });
	addSlider("AO strength", 0, 1, 0.02,
		function () { return b.aoStrength; },
		function (v) { b.aoStrength = v; _rebake(); });          // strength: cheap, bake only
	addSlider("AO radius (m)", 0.1, 3, 0.05,
		function () { return b.aoRadius; },
		function (v) { b.aoRadius = v; _rebakeAO(); });          // radius: re-accumulate AO
	addSlider("AO offset (m)", 0, 0.3, 0.01,
		function () { return b.aoBias; },
		function (v) { b.aoBias = v; _rebakeAO(); });            // offset: re-run AO march

	// Resolution rebuilds the depth maps (heavy), so it commits on release only.
	var resRow = document.createElement("label");
	resRow.style.cssText = "display:block;margin:6px 0;";
	var resVal = document.createElement("span");
	resVal.textContent = b.shadowRes.toFixed(0);
	resVal.style.cssText = "float:right;color:#a5b4fc;";
	var resName = document.createElement("span");
	resName.textContent = "shadow res";
	var resSlider = document.createElement("input");
	resSlider.type = "range";
	resSlider.min = 512; resSlider.max = 2048; resSlider.step = 256;
	resSlider.value = b.shadowRes;
	resSlider.style.cssText = "width:100%;margin-top:2px;";
	resSlider.addEventListener("input", function () {
		resVal.textContent = parseFloat(resSlider.value).toFixed(0);
	});
	resSlider.addEventListener("change", function () {
		b.shadowRes = parseInt(resSlider.value, 10);
		_rebake(true);   // rebuild depth maps at the new resolution
	});
	resRow.appendChild(resName); resRow.appendChild(resVal); resRow.appendChild(resSlider);
	panel.appendChild(resRow);

	document.body.appendChild(panel);
}

function _bindBakeToggle() {
	window.addEventListener("keydown", function (e) {
		if ((e.key === "b" || e.key === "B") && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			_ovgal_bake.visible = !_ovgal_bake.visible;
			_ovgal_bake.baked.forEach(function (it) {
				it.mesh.material = _ovgal_bake.visible ? it.view : it.orig;
			});
			console.log("Lightmap bake " + (_ovgal_bake.visible ? "shown" : "hidden"));
		}
	});
}