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