async function  doDownload(filename, scene) {
	console.log('start download  ' + filename);
	
	await BABYLON.GLTF2Export.GLBAsync(scene, filename).then((glb) => {
	  glb.downloadFiles();
	  console.log('end download  ' + filename);
	});

}


var text3D_builder=function(name, item_position, vector, parent, scene){
	const north_vector=new BABYLON.Vector3(0, 0, 1);
	maxLength=1.3;
	
	texto=name.replace("root", "Hall");
	texto=texto.replace(/d_(.+)_\d+/, "$1");
	
	myText = BABYLON.MeshBuilder.CreateText("T_" + texto, texto, fontContent, {
		size: 0.2,
		resolution: 5, 
		depth: 0.1,
		sideOrientation:2 }, scene);

	//scale it
	scene.executeWhenReady(function () {
		// Assuming the text is aligned along the X axis, measure its length
		myText.refreshBoundingInfo();
		var boundingInfo = myText.getBoundingInfo();
		var textWidth = boundingInfo.maximum.x - boundingInfo.minimum.x;

		// Check if the text exceeds the maximum length
		if (textWidth > maxLength) {
			// Calculate the required scaling factor
			var scaleFactor = maxLength / textWidth;

			// Apply the scaling factor to the text mesh
			myText.scaling.x = scaleFactor;
			myText.scaling.y = scaleFactor; // Optional: Scale uniformly in Y to maintain aspect ratio
			// Note: Adjust Z scaling as needed, or leave it if uniform scaling is desired
		}
	});
	
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

var plaque_builder = function(name, item_position, item_size, vector, metadata, scene) {
	// Renders an optional museum-style plaque below artwork using DynamicTexture
	// metadata format: "ID #N Title\nSubtitle" — ID prefix is stripped for display

	var plaqueText = metadata.replace(/^ID\s*#\d+\s*/, '');
	if (!plaqueText.trim()) return;

	var lines = plaqueText.split('\n');
	var titleText = lines[0] || '';
	var subtitleText = lines.length > 1 ? lines[1] : '';

	// Plaque height is a fixed physical size, matching what an M-bucket artwork
	// (120 cm longest edge = 2.5 babylon m) used to produce — the text is drawn
	// off texH, so it never grows or shrinks with the image. The width does
	// follow the artwork, up to half its span, so wide pieces get a plaque that
	// reads as part of the hang instead of a stub, and long titles stop clipping.
	var baseW = 2.5 * 0.38;
	var plaqueH = baseW * 0.3;
	var texH = Math.round(512 * 0.3);
	// Clamp to what a 2048 px texture can cover at this height, so the texture
	// aspect always matches the plane and the text is never stretched.
	var plaqueW = Math.min(Math.max(baseW, item_size.width * 0.5), plaqueH * (2048 / texH));
	var texW = Math.round(texH * (plaqueW / plaqueH));

	var dynTex = new BABYLON.DynamicTexture("plaqueTex_" + name, {width: texW, height: texH}, scene, false);
	var ctx = dynTex.getContext();

	// Transparent background — only the text is painted, the wall shows through
	ctx.clearRect(0, 0, texW, texH);

	// Title — soft dark-gray text, centered
	var titleSize = Math.round(texH * 0.32);
	ctx.font = "bold " + titleSize + "px Inter, Arial, sans-serif";
	ctx.fillStyle = "#5a5a5a";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	var centerX = texW / 2;
	var centerY = subtitleText ? (texH * 0.38) : (texH / 2);
	ctx.fillText(titleText, centerX, centerY);

	// Subtitle — soft dark-gray text, centered
	if (subtitleText) {
		var subSize = Math.round(texH * 0.22);
		ctx.font = subSize + "px Inter, Arial, sans-serif";
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

var item_builder= function(name, item_position, item_size, vector, material,scene, item_shadow_material=null){
	//places artwork as an image texture
	//adds a frame and both elements have a customizable separation from the wall
	//the thickness of the frame is half the separation
	
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
	item.position=new BABYLON.Vector3(item_position.x, item_position.y, item_position.z).add(vector.scale(3*item_separation/2));
	item.checkCollisions= true;
	if (material!=  undefined){
		item.material=material;
		item.material.specularColor=new BABYLON.Color3(0,0,0);

	}



	// Create the box at the position of the base vector with the plane's rotation
	let item2 = BABYLON.MeshBuilder.CreateBox("box" +name, {
		size: 1, 
		updatable: true
	}, scene);

	// Set the position, rotation and scale of the box/frame
	item2.position = new BABYLON.Vector3(item_position.x, item_position.y, item_position.z).add(vector.scale(item_separation/2-0.001));
	// Full-circle yaw so frames orient correctly on walls at any angle, not only N/S/E/W.
	item2.rotate(BABYLON.Axis.Y, Math.atan2(vector.x, vector.z), BABYLON.Space.LOCAL);
	item2.scaling = new BABYLON.Vector3(item_size.width+margin, item_size.height+margin, item_separation);
	
	
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
var artwork_texture = function(url, material, scene, onLoaded){
	// The material is frozen before it has a texture, so re-point it and refreeze.
	var apply = function(tex){
		material.unfreeze();
		material.diffuseTexture = tex;
		material.freeze();
	};

	var cap = (typeof isTouchDevice !== 'undefined' && isTouchDevice
		&& typeof max_artwork_px !== 'undefined') ? max_artwork_px : 0;

	if (!cap){
		var full = new BABYLON.Texture(url, scene);
		apply(full);
		full.onLoadObservable.add(onLoaded);
		return;
	}

	var img = new Image();
	// The asset host sends Access-Control-Allow-Origin, so this keeps the
	// DynamicTexture's canvas untainted and therefore uploadable to WebGL.
	img.crossOrigin = "anonymous";
	// Count a failed image as done, or one bad URL leaves the loading bar short.
	img.onerror = function(){ onLoaded(); };
	img.onload = function(){
		var scale = Math.min(1, cap / Math.max(img.width, img.height));
		var w = Math.max(1, Math.round(img.width * scale));
		var h = Math.max(1, Math.round(img.height * scale));
		var tex = new BABYLON.DynamicTexture(url, {width: w, height: h}, scene, true);
		tex.getContext().drawImage(img, 0, 0, w, h);
		tex.update();
		apply(tex);
		onLoaded();
	};
	img.src = url;
};

function populate_template(config_file, room_name,scene){

    var _pt = document.getElementById('plaquesToggle');
    var showPlaques = _pt ? _pt.checked : (config_file["Technical"]["show_plaques"] === true);
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

		//get material
		let items_material=new BABYLON.StandardMaterial("item_mat_"+ item);
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
		})(100/num_items));
		items_material.emissiveColor=new BABYLON.Color3(1, 1, 1);
		items_material.disableLighting=true;

		//get orientation
		let orientation=JSON.parse(gallery[item]["vector"])
		orientation=new BABYLON.Vector3(orientation[0], 0, orientation[1])

		//width/height are real cm; convert to babylon scene meters
		scaled_width = Number(gallery[item]["width"]) * SCENE_M_PER_CM;
		scaled_height = Number(gallery[item]["height"]) * SCENE_M_PER_CM;

		//notice that y and z are flippped
		let artwork_plane = item_builder(item + "_" + i ,{x:location[0], y:location[2], z:location[1]}, {width:scaled_width, height:scaled_height}, orientation, items_material, scene, null);

		// Tag the plane with its position among the gallery's image items. The viewer
		// uses this to drive click→navigate, so the index can never drift even when the
		// template GLB contains decorative meshes whose names also end in _<digits>
		// (Fixture_0, Col_*_1, …). i starts at 3, so i-3 is the 0-based dict_items index.
		if (artwork_plane) artwork_plane.metadata = { ovgal_artwork_idx: i - 3 };

		//plaque below artwork (only if metadata has content beyond the ID prefix)
		if (gallery[item]["metadata"]) {
			plaque_builder(item + "_" + i, {x:location[0], y:location[2], z:location[1]}, {width:scaled_width, height:scaled_height}, orientation, gallery[item]["metadata"], scene);
		}

		//update loading bar in sync loop so browser can paint
		const round_per=Math.round(((i - 2) / num_items) * 100);
		document.getElementById("percentLoaded_artwork").textContent = `${round_per}%`;
		document.getElementById("loadingBar_artwork").style.width =`${round_per}%`;


		i=i+1;
	}
	
	if (dict_items.length>0)	{
		scene.getMeshByName("frames").createNormals(true);
		scene.getMeshByName("frames").material=BJS_materials[frame_material];
		scene.getMeshByName("frames").alwaysSelectAsActiveMesh=true;
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
				text3D_builder(dict_items[renamed_doors].replace("#", " "), mesh.position, normal, mesh.parent, scene);
				
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
		reset_loadbar();
	}
}

