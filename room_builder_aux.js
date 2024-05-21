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

var item_builder= function(name, item_position, item_size, vector, material,scene){
	//places artwork as an image texture
	//adds a frame and both elements have a customizable separation from the wall
	//the thickness of the frame is half the separation
	
	var base_vector=new BABYLON.Vector3(0, 0, 0);
	const north_vector=new BABYLON.Vector3(0, 0, 1);
	var abstractPlane = BABYLON.Plane.FromPositionAndNormal(base_vector,vector );
	var item = BABYLON.MeshBuilder.CreatePlane(name, {sourcePlane: abstractPlane, width:item_size.width, height: item_size.height, sideOrientation: BABYLON.Mesh.SINGLESIDE},scene);
	
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
	item2.rotate(BABYLON.Axis.Y,  Math.acos(BABYLON.Vector3.Dot(vector, north_vector)), BABYLON.Space.LOCAL);
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

function populate_template(config_file, room_name,scene){

    let item_size=config_file["Technical"]["scaleFactor"];		 //parameter controlling the scale of the items
	
	const vector_n=new BABYLON.Vector3(0, 0, 1);
	const vector_s=new BABYLON.Vector3(0, 0, -1);
	const vector_e=new BABYLON.Vector3(1, 0, 0);
	const vector_w=new BABYLON.Vector3(-1, 0, 0);
	
	//position the items
	// get all the non image items
	var gallery=config_file[room_name];
	var dict_items=Object.keys(gallery).filter(key => gallery[key]["resource_type"]== "image");
	num_items=dict_items.length;
	
	let i=3
	for (var item of dict_items){
		//get location
		let location=JSON.parse(gallery[item]["location"])
		
		//get material
		let items_material=new BABYLON.StandardMaterial("item_mat_"+ item);
		items_material.freeze();
		items_material.specularColor=new BABYLON.Color3(0,0,0);
		items_material.maxSimultaneousLights=max_lights;
		let tex=new BABYLON.Texture(hallspics_prefix + gallery[item]["resource"]);
		items_material.diffuseTexture=tex;
		
		//get orientation
		let orientation=JSON.parse(gallery[item]["vector"])
		orientation=new BABYLON.Vector3(orientation[0], 0, orientation[1])
		
		//get sizse
		scaled_width=item_size*gallery[item]["width"];
		scaled_height=item_size*gallery[item]["height"];
		
		//notice that y and z are flippped
		item_builder(item + "_" + i ,{x:location[0], y:location[2], z:location[1]}, {width:scaled_width, height:scaled_height}, orientation, items_material, scene); 
		
		//update loading bar
		tex.onLoadObservable.add(((j) => {
			return() => {
				percentage_artwork=percentage_artwork + j;
				const round_per=Math.round(percentage_artwork);
				document.getElementById("percentLoaded_artwork").innerHTML = `${round_per}%`;
				document.getElementById("loadingBar_artwork").style.width =`${round_per}%`;
				if (round_per==100){
					//finish load bar
					reset_loadbar();
				}
		
			};
		})(100/num_items));

		
		i=i+1;
	}
	
	if (dict_items.length>0)	{
		scene.getMeshByName("frames").createNormals(true);
		scene.getMeshByName("frames").material=BJS_materials[frame_material];
	} else {
		reset_loadbar();
	}
	

	
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
			mesh.material.maxSimultaneousLights =max_lights;
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
	document.getElementById("percentLoaded_template").innerHTML = `${percentage_template}%`;
	document.getElementById("loadingBar_template").style.width =`${percentage_template}%`;
	document.getElementById("percentLoaded_materials").innerHTML = `${percentage_materials}%`;
	document.getElementById("loadingBar_materials").style.width =`${percentage_materials}%`;
	document.getElementById("percentLoaded_artwork").innerHTML = `${percentage_artwork}%`;
	document.getElementById("loadingBar_artwork").style.width =`${percentage_artwork}%`;
}


	
