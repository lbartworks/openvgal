async function  doDownload(filename, scene) {
	console.log('start download  ' + filename);
	
	await BABYLON.GLTF2Export.GLBAsync(scene, filename).then((glb) => {
	  glb.downloadFiles();
	  console.log('end download  ' + filename);
	});

}



function rb(config_file, room_name, scene) {

        //customizable parameters of the construction
		let door_height=3;		// dimensions of the door to the parent gallery
        let door_width=2;
		let item_separation=0.1; //this prevents that items and walls are co-planar		
        let item_size=2;		 //parameter controlling the scale of the items
		
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

        with_door=true;
		var items_material=new Array(NN+NS+NW+NE);
		var item_names=new Array(NN+NS+NW+NE);
		var item_width=new Array(NN+NS+NW+NE);
		var item_height=new Array(NN+NS+NW+NE);
		
		//floor material
		var wood = new BABYLON.StandardMaterial("wood");
		var wood_tex=new BABYLON.Texture(materials_folder + "/wood_floor/WoodFloor051_2K_Color.jpg");
		wood_tex.uScale=5;
		wood_tex.vScale=5;
		wood.diffuseTexture = wood_tex;
		
		//wall material
		var concrete = new BABYLON.StandardMaterial("wall");
		const concrete_tex = new BABYLON.Texture(materials_folder + "/concrete/gravel_concrete_diff_1k.jpg");
		const concrete_tex2=new BABYLON.Texture(materials_folder + "/concrete/gravel_concrete_nor_gl_1k.jpg");
		concrete_tex.uScale=15;
		concrete_tex.vScale=5;
		concrete.diffuseTexture= concrete_tex;
		
		//door material
		var root_doorMaterial = new BABYLON.StandardMaterial("doorMaterial", scene);
		var font = "bold " + 48 + "px Arial";

		root_door_tex=new BABYLON.DynamicTexture("DynamicTexture", {width:500, height:300}, scene, false);
        root_doorMaterial.diffuseTexture = root_door_tex;
		root_door_tex.drawText("Entrance", null, null, font, "#000000", "#ffffff", true);


		const dict_items=Object.keys(config_file[room_name]);
		
		//the root gallery has some differences with any other gallery
		for (k=2; k<dict_items.length; k++){
			items_material[k-2]=new BABYLON.StandardMaterial("item_mat"+k);
			if (room_name=='root'){
				let tex=new BABYLON.DynamicTexture("DynamicTexture", {width:500, height:300}, scene, false);
				items_material[k-2].diffuseTexture=tex;
				tex.drawText(dict_items[k], null, null, font, "#000000", "#ffffff", true);
				item_vposition=door_height/2;
				item_names[k-2]="d_" + dict_items[k] + "_";
				with_door=false;
			} else {
				
				let tex=new BABYLON.Texture(hallspics_prefix + config_file[room_name][dict_items[k]]["resource"]);
				items_material[k-2].diffuseTexture=tex;
				item_names[k-2]=dict_items[k] + "_";
			}
			item_width[k-2]=config_file[room_name][dict_items[k]]["width"];
			item_height[k-2]=config_file[room_name][dict_items[k]]["height"];
			

		}
        
        var item_builder= function(name, item_position, item_size, vector, material){
            var abstractPlane = BABYLON.Plane.FromPositionAndNormal(new BABYLON.Vector3(0, 0, 0),vector );
            var item = BABYLON.MeshBuilder.CreatePlane(name, {sourcePlane: abstractPlane, width:item_size.width, height: item_size.height, sideOrientation: BABYLON.Mesh.SINGLESIDE},scene);
            item.position=new BABYLON.Vector3(item_position.x, item_position.y, item_position.z);
			item.checkCollisions= true;
			if (material!=  undefined){
				item.material=material;
			}
            return item
        }
        
		
		
        //create floor
        var floor= BABYLON.MeshBuilder.CreateGround("floor", {width: W, height:L}, scene);
		floor.material=wood;
		floor.checkCollisions=true;

        //create north wall
        let north_wall=item_builder("wall_n",{x:0, y:H/2, z:L/2}, {width:W, height:H}, vector_n, concrete);
        
        //crate south wall
        let south_wall=item_builder("wall_s",{x:0, y:H/2, z:-L/2}, {width:W, height:H}, vector_s, concrete);

        //crate east wall
        let east_wall=item_builder("wall_e",{x:-W/2, y:H/2, z:0}, {width:L, height:H}, vector_e, concrete);

        //crate west wall
        let west_wall=item_builder("wall_w",{x:W/2, y:H/2, z:0}, {width:L, height:H}, vector_w, concrete);
       
        if (with_door){
            door=item_builder("d_root",{x:0, y:door_height/2, z:L/2-item_separation}, {width:door_width, height:door_height}, vector_n, root_doorMaterial);
        }


        //place user items
        j=0;
        //north
        if (with_door){
                if (NN%2 ==0){
                    NR=NN/2;
                    NL=NN/2;
                } else {
                    NR=Math.floor(NN/2);
                    NL=Math.ceil(NN/2);
                }
                for (i=1; i<=NL; i++){
                    //place left
                    delta=(W/2-door_width/2)/(NL+1);
                    item=item_builder(item_names[j] + j,{x:-W/2+delta*i, y:item_vposition, z:L/2-item_separation}, {width:item_size*item_width[j], height:item_size*item_height[j]}, vector_n, items_material[j]);
                    j++;
                }

                for (i=1; i<=NR; i++){
                    //place right
                    delta=(W/2-door_width/2)/(NR+1);
                    item=item_builder(item_names[j] + j,{x:W/2-delta*i, y:item_vposition, z:L/2-item_separation}, {width:item_size*item_width[j], height:item_size*item_height[j]}, vector_n, items_material[j]);                    
                    j++;
                }

            } else {
                    for (i=1; i<=NN; i++){
                        //place north
                        delta=W/(NN+1);
                        item=item_builder(item_names[j] + j,{x:-W/2+delta*i, y:item_vposition, z:L/2-item_separation}, {width:item_size*item_width[j], height:item_size*item_height[j]}, vector_n, items_material[j]); 
                        j++;
                    }


            }


        //south
        for (i=1; i<=NS; i++){
            //place south
            delta=W/(NS+1);
            item=item_builder(item_names[j] + j,{x:-W/2+delta*i, y:item_vposition, z:-L/2+item_separation}, {width:item_size*item_width[j], height:item_size*item_height[j]}, vector_s, items_material[j]); 
            j++;
        }        

        //east
        for (i=1; i<=NE; i++){
            //place east
            delta=L/(NE+1);
            item=item_builder(item_names[j] + j,{x:-W/2+item_separation, y:item_vposition, z:-L/2+delta*i}, {width:item_size*item_width[j], height:item_size*item_height[j]}, vector_e, items_material[j]); 
            j++;
        }   
        //west
        for (i=1; i<=NW; i++){
            //place west
            delta=L/(NW+1);
            item=item_builder(item_names[j] + j,{x:W/2-item_separation, y:item_vposition, z:-L/2+delta*i}, {width:item_size*item_width[j], height:item_size*item_height[j]}, vector_w, items_material[j]); 
            j++;
        }   
		

    }
	
