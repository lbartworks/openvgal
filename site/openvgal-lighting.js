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
// A baked visibility volume (CPU raycast at load) multiplies the per-fragment
// cone term to supply low-frequency occlusion — the soft shadow.
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
			// priority 200: run after the core PBR blocks. ALL defines the plugin
			// toggles must be declared here — Babylon builds the plugin's
			// MaterialDefines from this list, and a define set in prepareDefines()
			// but missing here is never tracked for recompile (the bug that kept
			// CONEVIS occlusion from ever switching on after the bake).
			super(material, "ConeSplash", 200, { CONESPLASH: false, CONEVIS: false });
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
			// CONEVIS gates the baked-visibility (occlusion) sampling.
			defines["CONEVIS"] = this._enabled && !!(_ovgal_splash && _ovgal_splash.volReady);
		}

		getClassName() { return "ConeSplashPlugin"; }

		getSamplers(samplers) {
			samplers.push("coneVisVolume");
		}

		getUniforms() {
			return {
				ubo: [
					// Both size AND type are required, else the entry is skipped.
					{ name: "coneSplashGlobals", size: 4, type: "vec4" }, // (count, cosInner, cosOuter, strength)
					{ name: "coneSplashColor", size: 4, type: "vec4" },   // (r, g, b, maxDist)
					{ name: "coneVisMin", size: 4, type: "vec4" },        // xyz = volume world min
					{ name: "coneVisSize", size: 4, type: "vec4" },       // xyz = volume world size
					{ name: "coneSplashPos", size: 4, type: "vec4", arraySize: CONE_SPLASH_MAX },  // xyz=worldPos, w=weight
					{ name: "coneSplashAxis", size: 4, type: "vec4", arraySize: CONE_SPLASH_MAX }  // xyz=aim dir
				],
				fragment:
					"#ifdef CONESPLASH\n" +
					"uniform vec4 coneSplashGlobals;\n" +
					"uniform vec4 coneSplashColor;\n" +
					"uniform vec4 coneVisMin;\n" +
					"uniform vec4 coneVisSize;\n" +
					"uniform vec4 coneSplashPos[" + CONE_SPLASH_MAX + "];\n" +
					"uniform vec4 coneSplashAxis[" + CONE_SPLASH_MAX + "];\n" +
					"#endif\n"
					// NOTE: the coneVisVolume sampler is declared via getCustomCode's
					// CUSTOM_FRAGMENT_DEFINITIONS, not here. This `fragment` string is
					// parsed to fold `uniform` entries into the Material UBO, which
					// silently drops a sampler declaration (samplers can't live in a
					// UBO) → "undeclared identifier coneVisVolume".
			};
		}

		bindForSubMesh(uniformBuffer) {
			if (!this._enabled || !_ovgal_splash) return;
			var s = _ovgal_splash;
			uniformBuffer.updateFloat4("coneSplashGlobals", s.count, s.cosInner, s.cosOuter, s.strength);
			uniformBuffer.updateFloat4("coneSplashColor", s.color.r, s.color.g, s.color.b, s.maxDist);
			if (s.volReady) {
				uniformBuffer.updateFloat4("coneVisMin", s.volMin.x, s.volMin.y, s.volMin.z, 0.0);
				uniformBuffer.updateFloat4("coneVisSize", s.volSize.x, s.volSize.y, s.volSize.z, 0.0);
				uniformBuffer.setTexture("coneVisVolume", s.volTexture);
			} else {
				uniformBuffer.updateFloat4("coneVisMin", 0.0, 0.0, 0.0, 0.0);
				uniformBuffer.updateFloat4("coneVisSize", 1.0, 1.0, 1.0, 0.0);
			}
			uniformBuffer.updateFloatArray("coneSplashPos", s.posArray);
			uniformBuffer.updateFloatArray("coneSplashAxis", s.axisArray);
		}

		getCustomCode(shaderType) {
			if (shaderType !== "fragment") return null;
			return {
				"CUSTOM_FRAGMENT_DEFINITIONS":
					"#ifdef CONEVIS\n" +
					"uniform highp sampler3D coneVisVolume;\n" +
					"#endif\n",
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
					"#ifdef CONEVIS\n" +
					"  vec3 csUVW = (vPositionW - coneVisMin.xyz) / coneVisSize.xyz;\n" +
					"  if (csUVW.x >= 0.0 && csUVW.y >= 0.0 && csUVW.z >= 0.0 &&\n" +
					"      csUVW.x <= 1.0 && csUVW.y <= 1.0 && csUVW.z <= 1.0) {\n" +
					"    csAccum *= texture(coneVisVolume, csUVW).r;\n" +
					"  }\n" +
					"#endif\n" +
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
		count++;
	}

	return { posArray: posArray, axisArray: axisArray, count: count };
}

// Fallback cone source when a room has no F_ fixtures: the template's marker
// SpotLight(s). Cone origin = spot world position, cone axis = spot world
// direction. Static, so the visibility volume bakes once at load.
function _collectConesFromSpotLights(scene) {
	var posArray = new Float32Array(CONE_SPLASH_MAX * 4);
	var axisArray = new Float32Array(CONE_SPLASH_MAX * 4);
	var count = 0;

	var spots = scene.lights.filter(function (l) {
		return l.getClassName && l.getClassName() === "SpotLight";
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
		count++;
	}

	return { posArray: posArray, axisArray: axisArray, count: count };
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

	var cones = _collectConesFromFixtures(scene);
	var coneSource = "F_ fixtures";

	// No authored fixtures (e.g. the root gallery) → use the template's marker
	// SpotLight as the cone reference. Static cone = bakeable occlusion.
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
			// Visibility volume (occlusion)
			volReady: false,
			volTexture: null,
			volMin: null,
			volSize: null,
			volRes: { x: 24, y: 12, z: 24 },
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

	// Cone sources are static (fixtures / template spot) → bake the visibility
	// volume once now; the wall shader samples it for low-frequency occlusion.
	_bakeVisibilityVolume();
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

function _markSplashDefinesDirty() {
	_ovgal_splash.plugins.forEach(function (p) { p.markAllDefinesAsDirty(); });
}

// Bake the visibility (occlusion) volume: for each grid cell, raycast toward
// the cone origins; a cell is "lit" if ANY cone reaches it unobstructed. The
// wall fragment later samples this by world position, so an occluder between
// a bulb and the wall darkens the splash there — the soft shadow. CPU pass,
// run once at load (cone sources are static).
function _bakeVisibilityVolume() {
	var s = _ovgal_splash;
	var scene = s.scene;
	if (!scene || s.count === 0) { console.warn("Cone splash: nothing to bake"); return; }
	var t0 = (window.performance && performance.now) ? performance.now() : Date.now();

	// 1) Room AABB from structural meshes (also the occluder set).
	var minX = Infinity, minY = Infinity, minZ = Infinity;
	var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
	var occluders = [];
	scene.meshes.forEach(function (m) {
		if (!m.isVisible || !m.getTotalVertices || m.getTotalVertices() === 0) return;
		if (m.name.match(/^Occupancy_/) || m.name === 'door_title' || m.name.match(/^F_\d/)) return;
		m.computeWorldMatrix(true);
		var bb = m.getBoundingInfo().boundingBox;
		minX = Math.min(minX, bb.minimumWorld.x); minY = Math.min(minY, bb.minimumWorld.y); minZ = Math.min(minZ, bb.minimumWorld.z);
		maxX = Math.max(maxX, bb.maximumWorld.x); maxY = Math.max(maxY, bb.maximumWorld.y); maxZ = Math.max(maxZ, bb.maximumWorld.z);
		occluders.push(m);
	});
	if (!isFinite(minX)) { console.warn("Cone splash: no geometry to bound the volume"); return; }
	var pad = 0.5;
	minX -= pad; minY -= pad; minZ -= pad; maxX += pad; maxY += pad; maxZ += pad;
	var sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;

	// 2) Cone origins + per-cell raycast occlusion.
	var origins = [];
	for (var c = 0; c < s.count; c++) {
		origins.push(new BABYLON.Vector3(s.posArray[c * 4], s.posArray[c * 4 + 1], s.posArray[c * 4 + 2]));
	}
	var R = s.volRes;
	var data = new Uint8Array(R.x * R.y * R.z);
	var bias = 0.05;
	var predicate = function (m) { return occluders.indexOf(m) !== -1; };
	var ray = new BABYLON.Ray(BABYLON.Vector3.Zero(), new BABYLON.Vector3(0, 0, 1), 1);
	var picks = 0;

	for (var z = 0; z < R.z; z++) {
		for (var y = 0; y < R.y; y++) {
			for (var x = 0; x < R.x; x++) {
				var px = minX + (x + 0.5) / R.x * sizeX;
				var py = minY + (y + 0.5) / R.y * sizeY;
				var pz = minZ + (z + 0.5) / R.z * sizeZ;
				var vis = 0;
				for (var oi = 0; oi < origins.length; oi++) {
					var dx = origins[oi].x - px, dy = origins[oi].y - py, dz = origins[oi].z - pz;
					var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
					if (dist < 1e-3) { vis = 1; break; }
					ray.origin.copyFromFloats(px, py, pz);
					ray.direction.copyFromFloats(dx / dist, dy / dist, dz / dist);
					ray.length = dist - bias;
					picks++;
					var hit = scene.pickWithRay(ray, predicate, true);
					if (!(hit && hit.hit)) { vis = 1; break; } // unobstructed → lit
				}
				data[x + y * R.x + z * R.x * R.y] = vis ? 255 : 0;
			}
		}
	}

	// How much of the volume is in shadow. 0 occluded = nothing can cast a
	// shadow (cone aimed into open space / no occluder in the beam), so any
	// "no shadow" symptom is the scene/aim, not the sampling path.
	var occluded = 0;
	for (var di = 0; di < data.length; di++) { if (data[di] === 0) occluded++; }

	// 3) R8 trilinear 3D texture (clamped).
	var fmt = (BABYLON.Constants && BABYLON.Constants.TEXTUREFORMAT_R != null) ? BABYLON.Constants.TEXTUREFORMAT_R : BABYLON.Engine.TEXTUREFORMAT_R;
	var typ = (BABYLON.Constants && BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE != null) ? BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE : BABYLON.Engine.TEXTURETYPE_UNSIGNED_BYTE;
	if (s.volTexture) s.volTexture.dispose();
	var tex = new BABYLON.RawTexture3D(data, R.x, R.y, R.z, fmt, scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, typ);
	tex.wrapU = tex.wrapV = tex.wrapR = BABYLON.Texture.CLAMP_ADDRESSMODE;
	s.volTexture = tex;
	s.volMin = { x: minX, y: minY, z: minZ };
	s.volSize = { x: sizeX, y: sizeY, z: sizeZ };
	s.volReady = true;

	// 4) Recompile wall shaders to switch CONEVIS on.
	_markSplashDefinesDirty();

	var dt = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
	console.log("Cone splash: baked visibility volume " + R.x + "x" + R.y + "x" + R.z +
		" (" + (R.x * R.y * R.z) + " cells, " + occluded + " occluded, " + origins.length +
		" cones, " + picks + " picks) in " + dt.toFixed(0) + " ms");
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
	addSlider("outer angle", 2, 60, 0.5,
		function () { return s.outerDeg; },
		function (v) { s.outerDeg = v; _refreshSplashAngles(); });

	document.body.appendChild(panel);
}