async function  doDownload(filename, scene) {
	console.log('start download  ' + filename);
	
	await BABYLON.GLTF2Export.GLBAsync(scene, filename).then((glb) => {
	  glb.downloadFiles();
	  console.log('end download  ' + filename);
	});

}


async function read_styles (filename){


	await fetch(filename)
		.then(response => response.json())
		.then(data => {
			// create a placeholder for materials
			const materials = {};

			Object.keys(data.styles).forEach(key => {
				data.styles[key].forEach(style => {
					let material;

					if(style.materialType === "PBR") {
						material = new BABYLON.PBRMaterial(style.styleName, scene);
						material.maxSimultaneousLights = 5;
						//material.specularColor=new BABYLON.Color3(0,0,0);
						if (style.textureFiles) {
							if (style.textureFiles.bump) {
								material.bumpTexture = new BABYLON.Texture(materials_folder + style.textureFiles.bump, scene);
							}
							if (style.textureFiles.diffuse) {
								material.albedoTexture = new BABYLON.Texture(materials_folder +style.textureFiles.diffuse, scene);
							}
							if (style.textureFiles.roughness) {
								material.metallicTexture = new BABYLON.Texture(materials_folder +style.textureFiles.roughness, scene);
							}
						}
						if (style.color) {
							material.albedoColor = new BABYLON.Color3.FromHexString(style.color);
							material.reflectivityColor=new BABYLON.Color3(0,0,0);
						}
					} else {
						material = new BABYLON.StandardMaterial(style.styleName, scene);
						material.maxSimultaneousLights = 5;
						material.specularColor=new BABYLON.Color3(0,0,0);
						if (style.color) {
							material.diffuseColor = new BABYLON.Color3.FromHexString(style.color);
							material.reflectivityColor=new BABYLON.Color3(0,0,0);
						}
					}
					// if (style.uvScaling) {
						// material.uScale = style.uvScaling.uScale;
						// material.vScale = style.uvScaling.vScale;
					// }
					materials[style.styleName] = material;
				});
			});

			// Apply the chosen styles to global variables
			// I'm assuming that the chosen styles in the JSON file match the names of the global variables.
			door_material = materials[data.chosenStyles.chosenDoorStyle];
			wall_material = materials[data.chosenStyles.chosenWallStyle];
			floor_material = materials[data.chosenStyles.chosenFloorStyle];
			header_material = materials[data.chosenStyles.chosenHeaderStyle];

			// add checks to ensure materials were assigned correctly
			if (!door_material) {
				console.warn(`Style ${data.chosenStyles.chosenDoorStyle} not found in materials.`);
			}
			if (!wall_material) {
				console.warn(`Style ${data.chosenStyles.chosenWallStyle} not found in materials.`);
			}
			if (!floor_material) {
				console.warn(`Style ${data.chosenStyles.chosenFloorStyle} not found in materials.`);
			}
			if (!header_material) {
				console.warn(`Style ${data.chosenStyles.chosenHeaderStyle} not found in materials.`);
			}
			style_file_content=data;
		});

}

var item_builder= function(name, item_position, item_size, vector, material,scene){
	//every "item" is based on a plane as a base object
	//some objects have additional elements:
	// - doors (name start with d_) will have a 3D text in additional
	// - non architectural elements (artwork) will have a white frameElement
	
	var base_vector=new BABYLON.Vector3(0, 0, 0);
	const north_vector=new BABYLON.Vector3(0, 0, -1);
	var abstractPlane = BABYLON.Plane.FromPositionAndNormal(base_vector,vector );
	var item = BABYLON.MeshBuilder.CreatePlane(name, {sourcePlane: abstractPlane, width:item_size.width, height: item_size.height, sideOrientation: BABYLON.Mesh.SINGLESIDE},scene);
	item.position=new BABYLON.Vector3(item_position.x, item_position.y, item_position.z);
	item.checkCollisions= true;
	if (material!=  undefined){
		item.material=material;
		item.material.specularColor=new BABYLON.Color3(0,0,0);
	}
	if (name.startsWith("d_")){
		//create 3d text
		if (name.toLowerCase().startsWith("d_root")){
			texto='Entrance';
		} else {
			texto=name.replace(/d_(.+)_\d+/, "$1");;
		}
		myText = BABYLON.MeshBuilder.CreateText("T_" + texto, texto, fontContent, {
			size: 0.2,
			resolution: 5, 
			depth: 0.1,
			sideOrientation:2 }, scene);

		//place it
		myText.position=new BABYLON.Vector3(item_position.x, item_position.y, item_position.z);
		
		//rotate
		var crossProduct = BABYLON.Vector3.Cross(north_vector, vector);
		let angle=Math.acos(BABYLON.Vector3.Dot(north_vector, vector)) * Math.sign(crossProduct.y);;
		myText.rotate(BABYLON.Axis.Y, angle  , BABYLON.Space.LOCAL);
		
		//assign material
		myText.material = header_material;
		
		// myText.material.albedoColor=new BABYLON.Color3(0.3,0.3,0.3);
		// myText.material.reflectivityColor=new BABYLON.Color3(0,0,0);
	}
	else {
		let setOfStrings = ["wall_n", "wall_s", "wall_e", "wall_w", "floor", "ceiling"];

	if (!setOfStrings.includes(name)){

		// Create the box at the position of the base vector with the plane's rotation
		let item2 = BABYLON.MeshBuilder.CreateBox("box" +name, {
			size: 1, 
			updatable: true
		}, scene);

		// Set the position, rotation and scale of the box
		item2.position = new BABYLON.Vector3(item_position.x, item_position.y, item_position.z).add(vector.scale(-item_separation/2-0.001));
		item2.rotate(BABYLON.Axis.Y,  Math.acos(BABYLON.Vector3.Dot(vector, north_vector)), BABYLON.Space.LOCAL);
		item2.scaling = new BABYLON.Vector3(item_size.width+margin, item_size.height+margin, item_separation); // Set the box's scaling, replace `thickness` with your desired thickness
		
		//check if the mesh that merges all the frames is already created
		let existing_frame_object=scene.getMeshByName('frames');
		if (existing_frame_object){
			var merged_mesh = BABYLON.Mesh.MergeMeshes([existing_frame_object, item2], true);
			merged_mesh.name="frames";
		} else {
			item2.name="frames";
		}

	}


	}
	return item
}

function populate_template(config_file, room_name,scene){

    let item_size=config_file["Technical"]["scaleFactor"];		 //parameter controlling the scale of the items
	
	const vector_n=new BABYLON.Vector3(0, 0, -1);
	const vector_s=new BABYLON.Vector3(0, 0, 1);
	const vector_e=new BABYLON.Vector3(1, 0, 0);
	const vector_w=new BABYLON.Vector3(-1, 0, 0);
	
	let W=config_file[room_name]["geometry"][0];
	let L=config_file[room_name]["geometry"][1];
	let H=config_file[room_name]["geometry"][2];


	let item_vposition= 1+item_size/2; // vertical position

	let NN=config_file[room_name]["geometry"][3];
	let NS=config_file[room_name]["geometry"][4];
	let NW=config_file[room_name]["geometry"][5];
	let NE=config_file[room_name]["geometry"][6];

	var items_material=new Array(NN+NS+NW+NE);
	var item_names=new Array(NN+NS+NW+NE);
	var item_width=new Array(NN+NS+NW+NE);
	var item_height=new Array(NN+NS+NW+NE);
	
	const dict_items=Object.keys(config_file[room_name]);
	
	//the root gallery has some differences with any other gallery
	for (k=2; k<dict_items.length; k++){

		items_material[k-2]=new BABYLON.StandardMaterial("item_mat"+k);
		items_material[k-2].specularColor=new BABYLON.Color3(0,0,0);
		if ( config_file[room_name][dict_items[k]]["resource_type"]=='image'){
			
			let tex=new BABYLON.Texture(hallspics_prefix + config_file[room_name][dict_items[k]]["resource"]);
			items_material[k-2].diffuseTexture=tex;
			item_names[k-2]=dict_items[k] + "_" + (k-2);
			item_mesh=scene.getMeshByName(item_names[k-2]);
			item_mesh.material=items_material[k-2];
		}
		item_width[k-2]=config_file[room_name][dict_items[k]]["width"];
		item_height[k-2]=config_file[room_name][dict_items[k]]["height"];
		

	}
		

	const regex = /_\d{1,2}$/;

	// console.log(scene.meshes);
	// console.log(item_names);
	for (var i in scene.meshes) {
		scene.meshes[i].checkCollisions = true;
			 if (regex.test(scene.meshes[i].name)) {
				scene.meshes[i].material=items_material[i];
			 }
	}
	
	//door
	//door material
	var root_doorMaterial = new BABYLON.StandardMaterial("doorMaterial", scene);
	var font = "bold " + 48 + "px Arial";

	root_door_tex=new BABYLON.DynamicTexture("DynamicTexture", {width:500, height:300}, scene, false);
	root_doorMaterial.diffuseTexture = root_door_tex;
	root_door_tex.drawText("Entrance", null, null, font, "#000000", "#ffffff", true);
	door=item_builder("d_root",{x:0, y:door_height/2, z:L/2-item_separation}, {width:door_width, height:door_height}, vector_n, root_doorMaterial, scene);
}	


function rb(config_file, room_name, scene) {

        //customizable parameters of the construction
        let item_size=config_file["Technical"]["scaleFactor"];		 //parameter controlling the scale of the items
		
		const vector_n=new BABYLON.Vector3(0, 0, -1);
        const vector_s=new BABYLON.Vector3(0, 0, 1);
        const vector_e=new BABYLON.Vector3(1, 0, 0);
        const vector_w=new BABYLON.Vector3(-1, 0, 0);
		const vector_d=new BABYLON.Vector3(0,-1,0);
        
		let W=config_file[room_name]["geometry"][0];
		let L=config_file[room_name]["geometry"][1];
		let H=config_file[room_name]["geometry"][2];
  

		//let item_vposition= 1+item_size/2; // vertical position

        let NN=config_file[room_name]["geometry"][3];
        let NS=config_file[room_name]["geometry"][4];
        let NW=config_file[room_name]["geometry"][5];
		let NE=config_file[room_name]["geometry"][6];

        with_door=true;
		var items_material=new Array(NN+NS+NW+NE);
		var item_names=new Array(NN+NS+NW+NE);
		var item_width=new Array(NN+NS+NW+NE);
		var item_height=new Array(NN+NS+NW+NE);
		
		//floor material
		var wood = floor_material;
		console.log(floor_material);

		
		//wall material
		var concrete = wall_material;

			//door material
		var root_doorMaterial = door_material;


		const dict_items=Object.keys(config_file[room_name]);
		
		//the root gallery has some differences with any other gallery
		//k=0 and 1 are the geometry and parent.
		for (k=2; k<dict_items.length; k++){
			resource_type=config_file[room_name][dict_items[k]]["resource_type"]
			if (resource_type=='door'){
				items_material[k-2]=root_doorMaterial;
				item_names[k-2]="d_" + dict_items[k] + "_";
				
			} else {
				items_material[k-2]=new BABYLON.StandardMaterial("item_mat"+k);
				let tex=new BABYLON.Texture(hallspics_prefix + config_file[room_name][dict_items[k]]["resource"]);
				items_material[k-2].diffuseTexture=tex;
				item_names[k-2]=dict_items[k] + "_";
			}
			item_width[k-2]=config_file[room_name][dict_items[k]]["width"];
			item_height[k-2]=config_file[room_name][dict_items[k]]["height"];
			

		}
        
	
        //create floor
        var floor= BABYLON.MeshBuilder.CreateGround("floor", {width: W, height:L}, scene);
		floor.material=wood;
		floor.checkCollisions=true;
		
		//create ceiling
		if (with_ceiling) {
			let ceiling=item_builder("ceiling",{x:0, y:H, z:0}, {width:L, height:W}, vector_d, concrete,scene);
		}

        //create north wall
        let north_wall=item_builder("wall_n",{x:0, y:H/2, z:L/2}, {width:W, height:H}, vector_n, concrete,scene);
        
        //crate south wall
        let south_wall=item_builder("wall_s",{x:0, y:H/2, z:-L/2}, {width:W, height:H}, vector_s, concrete,scene);

        //crate east wall
        let east_wall=item_builder("wall_e",{x:-W/2, y:H/2, z:0}, {width:L, height:H}, vector_e, concrete,scene);

        //crate west wall
        let west_wall=item_builder("wall_w",{x:W/2, y:H/2, z:0}, {width:L, height:H}, vector_w, concrete,scene);
       

        //place user items
        j=0;

		


		//north
		for (i=1; i<=NN; i++){
			//place left
			delta=W/(NN+1);
			if (item_names[j].startsWith("d_")){
				item_vposition=door_height/2;
				scaled_width=door_width;
				scaled_height=door_height;
			} else {
				item_vposition=H*config_file["Technical"]["verticalPosition"];
				scaled_width=item_size*item_width[j];
				scaled_height=item_size*item_height[j];
			}
			item=item_builder(item_names[j] + j,{x:-W/2+delta*i, y:item_vposition, z:L/2-item_separation}, {width:scaled_width, height:scaled_height}, vector_n, items_material[j], scene);
			j++;
		}
			
        //south
        for (i=1; i<=NS; i++){
            //place south
            delta=W/(NS+1);
			if (item_names[j].startsWith("d_")){
				item_vposition=door_height/2;
				scaled_width=door_width;
				scaled_height=door_height;
			} else {
				item_vposition=H*config_file["Technical"]["verticalPosition"];
				scaled_width=item_size*item_width[j];
				scaled_height=item_size*item_height[j];
			}
            item=item_builder(item_names[j] + j,{x:-W/2+delta*i, y:item_vposition, z:-L/2+item_separation}, {width:scaled_width, height:scaled_height}, vector_s, items_material[j], scene); 
            j++;
        }        

        //east
        for (i=1; i<=NE; i++){
            //place east
            delta=L/(NE+1);
			if (item_names[j].startsWith("d_")){
				item_vposition=door_height/2;
				scaled_width=door_width;
				scaled_height=door_height;
			} else {
				item_vposition=H*config_file["Technical"]["verticalPosition"];
				scaled_width=item_size*item_width[j];
				scaled_height=item_size*item_height[j];
			}
            item=item_builder(item_names[j] + j,{x:-W/2+item_separation, y:item_vposition, z:-L/2+delta*i}, {width:scaled_width, height:scaled_height}, vector_e, items_material[j], scene); 
            j++;
        }   
        //west
        for (i=1; i<=NW; i++){
            //place west
            delta=L/(NW+1);
			if (item_names[j].startsWith("d_")){
				item_vposition=door_height/2;
				scaled_width=door_width;
				scaled_height=door_height;
			} else {
				item_vposition=H*config_file["Technical"]["verticalPosition"];
				scaled_width=item_size*item_width[j];
				scaled_height=item_size*item_height[j];
			}
            item=item_builder(item_names[j] + j,{x:W/2-item_separation, y:item_vposition, z:-L/2+delta*i}, {width:scaled_width, height:scaled_height}, vector_w, items_material[j], scene); 
            j++;
        }   
		
		//adjust uvscale
		auto_uv_scale(room_name);
    }
	
