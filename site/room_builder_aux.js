async function  doDownload(filename, scene) {
	console.log('start download  ' + filename);
	
	await BABYLON.GLTF2Export.GLBAsync(scene, filename).then((glb) => {
	  glb.downloadFiles();
	  console.log('end download  ' + filename);
	});

}


// Horizontal width of a door plane across its opening, in its parent's space
// (the space the title is placed and scaled in). Returns 0 if it can't be measured.
var door_width=function(mesh, normal){
	var side = new BABYLON.Vector3(normal.z, 0, -normal.x);
	if (side.length() < 1e-6) return 0;
	side.normalize();
	mesh.computeWorldMatrix(true);
	var toParent = mesh.parent ? BABYLON.Matrix.Invert(mesh.parent.computeWorldMatrix(true)) : BABYLON.Matrix.Identity();
	var min = Infinity, max = -Infinity;
	mesh.getBoundingInfo().boundingBox.vectorsWorld.forEach(function(v){
		var d = BABYLON.Vector3.Dot(BABYLON.Vector3.TransformCoordinates(v, toParent), side);
		min = Math.min(min, d);
		max = Math.max(max, d);
	});
	return max - min;
}

var text3D_builder=function(name, item_position, vector, parent, scene, maxWidth){
	if (typeof fontContent === 'undefined' || !fontContent) return;	//font failed to load: skip the label
	const north_vector=new BABYLON.Vector3(0, 0, 1);
	var maxLength = maxWidth > 0 ? maxWidth * 0.9 : 1.3;

	var texto=name.replace("root", "Hall");
	texto=texto.replace(/d_(.+)_\d+/, "$1");

	//the label font lacks a glyph (e.g. CJK): draw it on a canvas plane instead
	if (Array.from(texto).some(function(c){ return !fontContent.glyphs[c]; })) {
		canvasLabel_builder(texto, maxLength, item_position, vector, parent, scene);
		return;
	}

	var makeLine = function(t){
		return BABYLON.MeshBuilder.CreateText("T_" + texto, t, fontContent, {
			size: 0.2,
			resolution: 5,
			depth: 0.075,
			sideOrientation:2 }, scene);
	};
	// text runs along local X
	var widthOf = function(m){
		var b = m.getBoundingInfo();
		return b.maximum.x - b.minimum.x;
	};

	var myText = makeLine(texto);

	//too wide: split at the space nearest the middle into two centered lines
	//(CreateText supports "\n" but left-aligns each line, so build them separately)
	if (widthOf(myText) > maxLength) {
		var mid = texto.length / 2, cut = -1;
		for (var i = 0; i < texto.length; i++) {
			if (texto[i] === " " && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
		}
		if (cut > 0) {
			var top = makeLine(texto.slice(0, cut));
			var bottom = makeLine(texto.slice(cut + 1));
			top.position.y = 0.13;
			bottom.position.y = -0.13;
			myText.dispose();
			myText = BABYLON.Mesh.MergeMeshes([top, bottom], true);
			myText.name = "T_" + texto;
		}
	}

	//still too wide: scale it to fit the door width
	var textWidth = widthOf(myText);
	if (textWidth > maxLength) {
		var scaleFactor = maxLength / textWidth;
		myText.scaling.x = scaleFactor;
		myText.scaling.y = scaleFactor;
	}
	
	//place it
	myText.parent=parent;
	myText.position=new BABYLON.Vector3(item_position.x, item_position.y, item_position.z);
	
	//rotate
	var crossProduct = BABYLON.Vector3.Cross(north_vector, vector);
	// Calculate the dot product and use it to find the angle between vectors
    let dotProduct = BABYLON.Vector3.Dot(north_vector, vector);
    let angle = Math.acos(dotProduct);
	
	// Adjust the angle based on the direction of the cross product
    if (crossProduct.y < 0) {
        angle = -angle;
    }
	//let angle=Math.acos(BABYLON.Vector3.Dot(north_vector, vector)) * Math.sign(crossProduct.y);
		
	myText.rotate(BABYLON.Axis.Y, angle  , BABYLON.Space.LOCAL);
	
	//assign material
	myText.material = BJS_materials["BJS_black_metal"];


}

// Door label drawn with the system fonts, for names the 3D label font can't render.
// Same rules as text3D_builder: 0.2 m letters, two centred lines 0.26 m apart when too
// wide (split at the space nearest the middle, or the middle character when there is
// no space), then scaled to fit. Unlit, so it stays readable once the bake turns the
// runtime lights off; the T_ name keeps it out of the bake occluders.
var canvasLabel_builder=function(texto, maxLength, item_position, vector, parent, scene){
	var EM_PX = 128, LINE_PX = Math.round(EM_PX * 0.26 / 0.2), PAD_PX = 8;
	var pxToWorld = 0.2 / EM_PX;
	var font = EM_PX + 'px system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", "Malgun Gothic", sans-serif';

	var measureCtx = document.createElement("canvas").getContext("2d");
	measureCtx.font = font;
	var widthOf = function(t){ return measureCtx.measureText(t).width; };

	var lines = [texto];
	if (widthOf(texto) * pxToWorld > maxLength) {
		var chars = Array.from(texto);
		var mid = chars.length / 2, cut = -1;
		for (var i = 0; i < chars.length; i++) {
			if (chars[i] === " " && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
		}
		if (cut > 0) lines = [chars.slice(0, cut).join(""), chars.slice(cut + 1).join("")];
		else if (chars.length > 1) {
			cut = Math.ceil(mid);
			lines = [chars.slice(0, cut).join(""), chars.slice(cut).join("")];
		}
	}

	var texW = Math.ceil(Math.max.apply(null, lines.map(widthOf))) + 2 * PAD_PX;
	var texH = lines.length * LINE_PX + 2 * PAD_PX;
	var dynTex = new BABYLON.DynamicTexture("T_tex_" + texto, {width: texW, height: texH}, scene, true);
	var ctx = dynTex.getContext();
	ctx.clearRect(0, 0, texW, texH);
	ctx.font = font;
	ctx.fillStyle = "#1a1a1a";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	lines.forEach(function(t, k){ ctx.fillText(t, texW / 2, PAD_PX + (k + 0.5) * LINE_PX); });
	dynTex.update();
	dynTex.hasAlpha = true;

	var mat = new BABYLON.StandardMaterial("T_mat_" + texto, scene);
	mat.diffuseTexture = dynTex;
	mat.emissiveTexture = dynTex;
	mat.specularColor = new BABYLON.Color3(0, 0, 0);
	mat.disableLighting = true;
	mat.useAlphaFromDiffuseTexture = true;
	mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

	//XY plane like CreateText: the room side is the back face (+Z), so it gets the
	//unmirrored UVs; the front face's are mirrored so both sides read left-to-right
	var plane = BABYLON.MeshBuilder.CreatePlane("T_" + texto, {
		width: texW * pxToWorld,
		height: texH * pxToWorld,
		sideOrientation: BABYLON.Mesh.DOUBLESIDE,
		frontUVs: new BABYLON.Vector4(1, 0, 0, 1),
		backUVs: new BABYLON.Vector4(0, 0, 1, 1)
	}, scene);
	plane.material = mat;
	plane.isPickable = false;

	//still too wide: scale it to fit the door width
	var textWidth = (texW - 2 * PAD_PX) * pxToWorld;
	if (textWidth > maxLength) {
		var scaleFactor = maxLength / textWidth;
		plane.scaling.x = scaleFactor;
		plane.scaling.y = scaleFactor;
	}

	//place and rotate exactly like the 3D text
	plane.parent = parent;
	plane.position = new BABYLON.Vector3(item_position.x, item_position.y, item_position.z);
	var angle = Math.acos(BABYLON.Vector3.Dot(new BABYLON.Vector3(0, 0, 1), vector));
	if (BABYLON.Vector3.Cross(new BABYLON.Vector3(0, 0, 1), vector).y < 0) angle = -angle;
	plane.rotate(BABYLON.Axis.Y, angle, BABYLON.Space.LOCAL);
}

// Artwork `metadata` is either "Title\nSubtitle" (legacy "ID #N " prefix stripped)
// or { title, subtitle, fields: { id: text } } (docs/gallery-json.md § Metadata).
// Returns { title, subtitle, fields: [{ label, text }] }: fields follow the order of
// infoFields (Technical.info_fields, first 5 only) and skip empty values. Output
// stops after 2,000 code points across title, subtitle and field texts.
var METADATA_MAX_FIELDS = 5;
var METADATA_MAX_CHARS = 2000;

function readArtworkMetadata(metadata, infoFields) {
	var title = '', subtitle = '', values = {};
	if (typeof metadata === 'string') {
		var lines = metadata.replace(/^ID\s*#\d+\s*/, '').split('\n');
		title = lines[0] || '';
		subtitle = lines[1] || '';
	} else if (metadata && typeof metadata === 'object') {
		if (typeof metadata.title === 'string') title = metadata.title;
		if (typeof metadata.subtitle === 'string') subtitle = metadata.subtitle;
		if (metadata.fields && typeof metadata.fields === 'object') values = metadata.fields;
	}

	var budget = METADATA_MAX_CHARS;
	function clamp(s) {
		var chars = Array.from(s).slice(0, budget);
		budget -= chars.length;
		return chars.join('');
	}

	var result = { title: clamp(title), subtitle: clamp(subtitle), fields: [] };
	var listed = Array.isArray(infoFields) ? infoFields.slice(0, METADATA_MAX_FIELDS) : [];
	listed.forEach(function(f) {
		if (!f || typeof f.id !== 'string' || typeof f.label !== 'string') return;
		var value = values[f.id];
		if (typeof value !== 'string' || !value.trim() || budget <= 0) return;
		result.fields.push({ label: f.label, text: clamp(value) });
	});
	return result;
}

var plaque_builder = function(name, item_position, item_size, vector, metadata, scene) {
	// Renders an optional museum-style plaque below artwork using DynamicTexture

	var meta = readArtworkMetadata(metadata);
	if (!(meta.title + meta.subtitle).trim()) return;

	var titleText = meta.title;
	var subtitleText = meta.subtitle;

	// Plaque height is a fixed physical size, matching what an M-bucket artwork
	// (120 cm longest edge = 2.5 babylon m) used to produce — the text is drawn
	// off texH, so it never grows with the image. The width follows the artwork,
	// up to its full span; a line that still doesn't fit is shrunk to fit.
	var baseW = 2.5 * 0.38;
	var plaqueH = baseW * 0.3;
	var texH = Math.round(512 * 0.3);
	// Clamp to what a 2048 px texture can cover at this height, so the texture
	// aspect always matches the plane and the text is never stretched.
	var plaqueW = Math.min(item_size.width, plaqueH * (2048 / texH));
	var texW = Math.round(texH * (plaqueW / plaqueH));
	var maxTextW = texW * 0.96;

	var dynTex = new BABYLON.DynamicTexture("plaqueTex_" + name, {width: texW, height: texH}, scene, false);
	var ctx = dynTex.getContext();

	// Transparent background — only the text is painted, the wall shows through
	ctx.clearRect(0, 0, texW, texH);

	// Sets the font at `size`, shrinking it if `text` is wider than the plaque
	var fitFont = function(text, size, weight) {
		ctx.font = weight + size + "px Inter, Arial, sans-serif";
		var w = ctx.measureText(text).width;
		if (w > maxTextW) {
			size = Math.floor(size * maxTextW / w);
			ctx.font = weight + size + "px Inter, Arial, sans-serif";
		}
	};

	// Title — soft dark-gray text, centered
	var titleSize = Math.round(texH * 0.32);
	fitFont(titleText, titleSize, "bold ");
	ctx.fillStyle = "#5a5a5a";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	var centerX = texW / 2;
	var centerY = subtitleText ? (texH * 0.38) : (texH / 2);
	ctx.fillText(titleText, centerX, centerY);

	// Subtitle — soft dark-gray text, centered
	if (subtitleText) {
		var subSize = Math.round(texH * 0.22);
		fitFont(subtitleText, subSize, "");
		ctx.fillStyle = "#5a5a5a";
		ctx.fillText(subtitleText, centerX, centerY + titleSize * 0.9);
	}

	dynTex.update();
	dynTex.hasAlpha = true;

	var plaqueMat = new BABYLON.StandardMaterial("plaqueMat_" + name, scene);
	plaqueMat.diffuseTexture = dynTex;
	plaqueMat.emissiveTexture = dynTex;
	plaqueMat.specularColor = new BABYLON.Color3(0, 0, 0);
	plaqueMat.disableLighting = true;
	plaqueMat.useAlphaFromDiffuseTexture = true;
	plaqueMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;

	var base_vector = new BABYLON.Vector3(0, 0, 0);
	var abstractPlane = BABYLON.Plane.FromPositionAndNormal(base_vector, vector);

	var plaquePlane = BABYLON.MeshBuilder.CreatePlane("lbl_plaque_" + name, {
		sourcePlane: abstractPlane,
		width: plaqueW,
		height: plaqueH,
		sideOrientation: BABYLON.Mesh.SINGLESIDE
	}, scene);

	// Position: centered below frame
	var plaqueOffsetDown = (item_size.height / 2 + margin / 2 + plaqueH / 2 + 0.03);

	plaquePlane.position = new BABYLON.Vector3(item_position.x, item_position.y, item_position.z)
		.add(vector.scale(3 * item_separation / 2))
		.subtract(new BABYLON.Vector3(0, plaqueOffsetDown, 0));

	plaquePlane.material = plaqueMat;
	plaquePlane.isPickable = false;

	// Each plaque keeps its own DynamicTexture, so merging them into one mesh saves
	// no draw calls (a MultiMaterial still draws one submesh per texture) — it only
	// risked cross-wiring the textures. Keep plaques as individual meshes (like the
	// artwork image planes) and parent them to a single node so visibility toggles
	// with one setEnabled() call.
	var plaquesRoot = scene.getTransformNodeByName('plaques_root');
	if (!plaquesRoot) plaquesRoot = new BABYLON.TransformNode('plaques_root', scene);
	plaquePlane.parent = plaquesRoot;
}

// The frame (or mount) box behind one artwork, at the position of the base vector with
// the plane's rotation. Shared by item_builder and the placement mode's frame rebuild.
var frame_box = function(name, item_position, item_size, vector, frame_margin, scene){
	let box = BABYLON.MeshBuilder.CreateBox(name, {
		size: 1,
		updatable: true
	}, scene);

	box.position = new BABYLON.Vector3(item_position.x, item_position.y, item_position.z).add(vector.scale(item_separation/2-0.001));
	// Full-circle yaw so frames orient correctly on walls at any angle, not only N/S/E/W.
	box.rotate(BABYLON.Axis.Y, Math.atan2(vector.x, vector.z), BABYLON.Space.LOCAL);
	box.scaling = new BABYLON.Vector3(item_size.width+frame_margin, item_size.height+frame_margin, item_separation);
	return box;
}

// A text panel (metadata.panel, docs/gallery-json.md § Text panels) hangs as bare
// lettering: no mount, frame, shadow or plaque, and its PNG's alpha shows the wall.
function isTextPanel(entry) {
	var m = entry && entry.metadata;
	return !!(m && typeof m === 'object' && m.panel);
}
var PANEL_WALL_OFFSET = 0.01;	// a bare panel plane's distance from the wall

var item_builder= function(name, item_position, item_size, vector, material,scene, item_shadow_material=null, frame_margin=margin, bare=false){
	//places artwork as an image texture
	//adds a frame and both elements have a customizable separation from the wall
	//the thickness of the frame is half the separation
	//bare: the plane alone, close to the wall (text panels)
	
	const shadow_scale=1.3;
	var base_vector=new BABYLON.Vector3(0, 0, 0);
	const north_vector=new BABYLON.Vector3(0, 0, 1);
	var abstractPlane = BABYLON.Plane.FromPositionAndNormal(base_vector,vector );
	var item = BABYLON.MeshBuilder.CreatePlane(name, {sourcePlane: abstractPlane, width:item_size.width, height: item_size.height, sideOrientation: BABYLON.Mesh.SINGLESIDE},scene);

	//create the item shadow
	if (item_shadow_material!=null) {
		var item_shadow = BABYLON.MeshBuilder.CreatePlane("shadow", {sourcePlane: abstractPlane, width:item_size.width*shadow_scale, height: item_size.height*shadow_scale, sideOrientation: BABYLON.Mesh.SINGLESIDE},scene);
		item_shadow.position=new BABYLON.Vector3(item_position.x, item_position.y, item_position.z).add(vector.scale(0.01));
		item_shadow.material=item_shadow_material;
		
		let existing_shadow_object=scene.getMeshByName('shadows');
		if (existing_shadow_object){
			var merged_mesh = BABYLON.Mesh.MergeMeshes([existing_shadow_object, item_shadow], true);
			merged_mesh.name="shadows";
		} else {
			item_shadow.name="shadows";
		}

	}
	
	
	//the position is shifted away from the wall in the direction of the item vector (normal)
	item.position=new BABYLON.Vector3(item_position.x, item_position.y, item_position.z).add(vector.scale(bare ? PANEL_WALL_OFFSET : 3*item_separation/2));
	item.checkCollisions= true;
	if (material!=  undefined){
		item.material=material;
		item.material.specularColor=new BABYLON.Color3(0,0,0);

	}
	if (bare) return item;



	let item2 = frame_box("box" + name, item_position, item_size, vector, frame_margin, scene);


	//check if the mesh that merges all the frames is already created
	let existing_frame_object=scene.getMeshByName('frames');
	if (existing_frame_object){
		var merged_mesh = BABYLON.Mesh.MergeMeshes([existing_frame_object, item2], true);
		merged_mesh.name="frames";
	} else {
		item2.name="frames";
	}





	return item
}

// Builds an artwork's diffuse texture and reports when it is ready.
//
// Artwork textures are the largest memory cost in a big gallery: each arrives at
// 1024 px on the long edge and costs ~5.6 MB of VRAM, so 88 pieces is ~310 MB -
// past the per-tab ceiling on iOS. On touch devices we draw the image into a
// smaller DynamicTexture as it lands, so the full-size bitmap never reaches the
// GPU. That makes the texture asynchronous, hence onLoaded instead of the caller
// hooking onLoadObservable itself.
// alpha: keep the image's transparency (text panels).
var artwork_texture = function(url, material, scene, onLoaded, alpha){
	// The material is frozen before it has a texture, so re-point it and refreeze.
	var apply = function(tex){
		material.unfreeze();
		material.diffuseTexture = tex;
		material.freeze();
	};

	var cap = (typeof isTouchDevice !== 'undefined' && isTouchDevice
		&& typeof max_artwork_px !== 'undefined') ? max_artwork_px : 0;

	// Count a failed image as done, or one bad URL leaves the loading bar short
	// and the hall never opens.
	var onFailed = function(){
		console.warn("Artwork image failed to load: " + url);
		onLoaded();
	};

	if (!cap){
		var full = new BABYLON.Texture(url, scene, false, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE, null, function(){
			// Drop the broken texture so the material stays ready: a blank white plane.
			apply(null);
			full.dispose();
			onFailed();
		});
		full.hasAlpha = !!alpha;
		apply(full);
		full.onLoadObservable.add(onLoaded);
		return;
	}

	// A frozen material that has already drawn never recompiles its shader, so one
	// rendered before its image arrives would stay untextured (black) for good. A 1x1
	// placeholder from the start keeps the diffuse texture in the shader; the real
	// image then only swaps the sampler, which Babylon re-binds every frame.
	var placeholder = new BABYLON.DynamicTexture("artPlaceholder", {width: 1, height: 1}, scene, false);
	if (alpha) placeholder.hasAlpha = true;	// transparent until the image lands
	else placeholder.getContext().fillRect(0, 0, 1, 1);
	placeholder.update();
	apply(placeholder);

	var img = new Image();
	// The asset host sends Access-Control-Allow-Origin, so this keeps the
	// DynamicTexture's canvas untainted and therefore uploadable to WebGL.
	img.crossOrigin = "anonymous";
	img.onerror = onFailed;
	img.onload = function(){
		var scale = Math.min(1, cap / Math.max(img.width, img.height));
		var w = Math.max(1, Math.round(img.width * scale));
		var h = Math.max(1, Math.round(img.height * scale));
		var tex = new BABYLON.DynamicTexture(url, {width: w, height: h}, scene, true);
		tex.hasAlpha = !!alpha;
		tex.getContext().drawImage(img, 0, 0, w, h);
		tex.update();
		apply(tex);
		placeholder.dispose();
		onLoaded();
	};
	img.src = url;
};

function populate_template(config_file, room_name,scene){

    var showPlaques = config_file["Technical"]["show_plaques"] === true;
    // show_frames off collapses the frame margin, leaving a mount the exact size of the artwork
    var frame_margin = config_file["Technical"]["show_frames"] === false ? 0 : margin;
    // width/height in the JSON are real cm. Babylon scene units don't read 1:1 to
    // real-world — a longest-edge of 2.5 babylon m reads as ~120 cm to the viewer.
    const SCENE_M_PER_CM = 2.5 / 120;
	
	const vector_n=new BABYLON.Vector3(0, 0, 1);
	const vector_s=new BABYLON.Vector3(0, 0, -1);
	const vector_e=new BABYLON.Vector3(1, 0, 0);
	const vector_w=new BABYLON.Vector3(-1, 0, 0);
	
	//position the items
	// get all the non image items
	var gallery=config_file[room_name];
	var dict_items=Object.keys(gallery).filter(key => gallery[key]["resource_type"]== "image");
	num_items=dict_items.length;

	//get frame shadow material
	var shadow_texture = new BABYLON.Texture(materials_folder +"/shadow.png", scene, false, BABYLON.Texture.LINEAR_LINEAR);
	shadow_texture.hasAlpha=true;
	
	var item_shadow_material = new BABYLON.StandardMaterial("shadow_mat", scene);
	item_shadow_material.specularColor=new BABYLON.Color3(0,0,0);
	item_shadow_material.diffuseTexture = shadow_texture;
	item_shadow_material.useAlphaFromDiffuseTexture = true;
	
	let i=3
	for (var item of dict_items){
		//get location
		let location=JSON.parse(gallery[item]["location"]);

		let panel = isTextPanel(gallery[item]);

		//get material
		let items_material=new BABYLON.StandardMaterial("item_mat_"+ item);
		items_material.useAlphaFromDiffuseTexture = panel;
		items_material.freeze();
		items_material.specularColor=new BABYLON.Color3(0,0,0);
		items_material.maxSimultaneousLights=max_lights;
		//texture + loading-bar tick, assigned to the material by artwork_texture
		artwork_texture(window.resolveImageUrl(gallery[item]["resource"]), items_material, scene, ((j) => {
			return() => {
				percentage_artwork=percentage_artwork + j;
				if (Math.round(percentage_artwork) >= 100){
					markArtworksDone();
				}
			};
		})(100/num_items), panel);
		items_material.emissiveColor=new BABYLON.Color3(1, 1, 1);
		items_material.disableLighting=true;

		//get orientation
		let orientation=JSON.parse(gallery[item]["vector"])
		orientation=new BABYLON.Vector3(orientation[0], 0, orientation[1])

		//width/height are real cm; convert to babylon scene meters
		scaled_width = Number(gallery[item]["width"]) * SCENE_M_PER_CM;
		scaled_height = Number(gallery[item]["height"]) * SCENE_M_PER_CM;

		//notice that y and z are flippped
		let artwork_plane = item_builder(item + "_" + i ,{x:location[0], y:location[2], z:location[1]}, {width:scaled_width, height:scaled_height}, orientation, items_material, scene, null, frame_margin, panel);

		// Tag the plane with its position among the gallery's image items. The viewer
		// uses this to drive click→navigate, so the index can never drift even when the
		// template GLB contains decorative meshes whose names also end in _<digits>
		// (Fixture_0, Col_*_1, …). i starts at 3, so i-3 is the 0-based dict_items index.
		// ovgal_text_panel keeps a panel out of the lightmap bake (see _isBakeOccluder).
		if (artwork_plane) artwork_plane.metadata = panel ? { ovgal_artwork_idx: i - 3, ovgal_text_panel: true } : { ovgal_artwork_idx: i - 3 };

		//plaque below artwork (only if metadata has content beyond the ID prefix)
		if (gallery[item]["metadata"] && !panel) {
			plaque_builder(item + "_" + i, {x:location[0], y:location[2], z:location[1]}, {width:scaled_width, height:scaled_height}, orientation, gallery[item]["metadata"], scene);
		}

		//update loading bar in sync loop so browser can paint
		const round_per=Math.round(((i - 2) / num_items) * 100);
		document.getElementById("percentLoaded_artwork").textContent = `${round_per}%`;
		document.getElementById("loadingBar_artwork").style.width =`${round_per}%`;


		i=i+1;
	}
	
	if (dict_items.length>0)	{
		let framesMesh=scene.getMeshByName("frames");	// absent when every item is a text panel
		if (framesMesh) {
			framesMesh.createNormals(true);
			framesMesh.material=BJS_materials["frames"];
			framesMesh.alwaysSelectAsActiveMesh=true;
		}
		let shadowMesh=scene.getMeshByName("shadows");
		if (shadowMesh) shadowMesh.alwaysSelectAsActiveMesh=true;
	} else {
		markArtworksDone();
	}

	// Set plaque visibility from toggle state (one node parents every plaque)
	var plaquesRoot = scene.getTransformNodeByName("plaques_root");
	if (plaquesRoot) plaquesRoot.setEnabled(showPlaques);
	

	
	//locate doors in the json file
	var renamed_doors=0;
	dict_items=Object.keys(gallery).filter(key => gallery[key]["resource_type"]== "door");
	max_doors=dict_items.length;
	
	//go through the mesh check for doors and replace materials
	scene.meshes.map((mesh) => {

		if ((mesh.material != null) && mesh.material.name.startsWith("BJS_")){
			console.log("updating material " + mesh.material.name);
			let temp_name=mesh.material.name;
			mesh.material=BJS_materials[temp_name];
			mesh.alwaysSelectAsActiveMesh=true;
		}
		
		if (regul_exp_door.test(mesh.name)){
			if (renamed_doors >= max_doors){ //delete the door from the mesh
				mesh.name="dummydoor" + renamed_doors;
								
			} else {
				mesh.name="d_" + dict_items[renamed_doors] + "_" + renamed_doors;
				normals = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
				normal = new BABYLON.Vector3(normals[0], normals[1], normals[2]);

				//put text
				text3D_builder(dict_items[renamed_doors].replace("#", " "), mesh.position, normal, mesh.parent, scene, door_width(mesh, normal));
				
			}
			renamed_doors++;
		}
	});
	
	if (renamed_doors < max_doors){
		console.log("ERROR: Some doors in the json are not present in the template");
	}

		

	
	//remove replaced materials
	scene.materials.forEach(material => {
		if (material.name.startsWith('BJS_'))
			material.dispose(); 
		
	});
	

}	


function reset_loadbar(){
	percentage_materials=0;
	percentage_template=0;
	percentage_artwork=0;
	document.getElementById("loader").style.display = "none";
	document.getElementById("loader").id= "loaded";
	document.getElementById("percentLoaded_template").textContent = `${percentage_template}%`;
	document.getElementById("loadingBar_template").style.width =`${percentage_template}%`;
	document.getElementById("percentLoaded_materials").textContent = `${percentage_materials}%`;
	document.getElementById("loadingBar_materials").style.width =`${percentage_materials}%`;
	document.getElementById("percentLoaded_artwork").textContent = `${percentage_artwork}%`;
	document.getElementById("loadingBar_artwork").style.width =`${percentage_artwork}%`;
	setLightsProgress(0);
}

// Load-phase coordinator for template galleries. Artworks and the lightmap bake
// finish asynchronously and independently, so the loader must stay up until BOTH
// are done — otherwise the "Setting up lights" bar is hidden before (or without)
// the bake completing. Non-template paths never call beginTemplateLoad, so
// markArtworksDone falls back to hiding the loader immediately, as before.
var _loadPhase = { artworks: false, lights: false, active: false };

function beginTemplateLoad(){
	_loadPhase = { artworks: false, lights: false, active: true };
	setLightsProgress(0);
}

function setLightsProgress(p){
	var bar = document.getElementById("loadingBar_lights");
	var txt = document.getElementById("percentLoaded_lights");
	if (bar) bar.style.width = `${p}%`;
	if (txt) txt.textContent = `${p}%`;
}

function markArtworksDone(){
	if (!_loadPhase.active){ reset_loadbar(); return; }
	_loadPhase.artworks = true;
	_maybeFinishLoad();
}

function markLightsDone(){
	setLightsProgress(100);
	_loadPhase.lights = true;
	_maybeFinishLoad();
}

function _maybeFinishLoad(){
	if (_loadPhase.active && _loadPhase.artworks && _loadPhase.lights){
		_loadPhase.active = false;
		// Bake committed and artworks hung: capture reflections for live materials.
		if (typeof setupLiveReflections === 'function') setupLiveReflections();
		reset_loadbar();
		if (typeof postRoomEntered === 'function') postRoomEntered();
	}
}

