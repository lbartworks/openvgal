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