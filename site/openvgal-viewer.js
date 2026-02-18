	//user custom variables that are not modified in general
	const debug_scene=false;
	const margin=0.2; 			//frame margin
	const item_separation=0.05; 	//separation from the wall
	const max_lights=7;



//declarations
	var canvas = document.getElementById("renderCanvas");
	var sceneToRender = null;
	var percentage_template=0;
	var percentage_materials=0;
	var percentage_artwork=0;
	let config_file_content;
	let style_file_content;
	let fontContent;
	var galleries=new Object();
	var scene=null;
	var current_gallery;
	var door_material, wall_material, floor_material, header_material;
	var BJS_materials={};
	var manual_navigation_idx = null;


	//new materials
	var floor_mat, walls_mat, ceiling_mat, board_mat;

	//device detections
	var isTouchDevice = false;


	var deviceAgent = navigator.userAgent.toLowerCase();
	isTouchDevice = (deviceAgent.match(/(iphone|ipod|ipad)/) || deviceAgent.match(/(android)/) || deviceAgent.match(/(iemobile)/) || deviceAgent.match(/iphone/i) || deviceAgent.match(/ipad/i) || deviceAgent.match(/ipod/i) || deviceAgent.match(/blackberry/i) || deviceAgent.match(/bada/i));

	//loads the gallery file and updates the loading bar
	var loadAsset = async(file, scene)=>{
		return new Promise((res,rej)=>{



			if (document.getElementById("loaded")!=undefined) {
				document.getElementById("loaded").id= "loader";
				document.getElementById("loader").style.display = "flex";
				document.getElementById("loadingBar_template").style.width="0%";
			};
			BABYLON.SceneLoader.LoadAssetContainer(glb_location, file, scene, function (container) {
				if (container.cameras){
					container.cameras.pop();
				}
				res(container)
			},
			function (evt) {
			// onProgress

				if (evt.lengthComputable) {
					let total=evt.total;
					//if (evt.srcElement.getResponseHeader('content-encoding')){
					//compressed content assume 25% compression
					//	total=total*0.75;
					//}
					percentage_template = (evt.loaded * 100 / total).toFixed();
				} else {
					//assume a 20MB file
					percentage_template = (evt.loaded * 100 / 20000000).toFixed();
					};


				document.getElementById("percentLoaded_template").textContent = `${percentage_template}%`;
				document.getElementById("loadingBar_template").style.width =`${percentage_template}%`;

		});
	})


	}


	// Load a NodeMaterial JSON, rewriting hardcoded texture URLs to use materials_folder
	async function loadNodeMaterial(name, jsonUrl, scene) {
		const response = await fetch(jsonUrl);
		let text = await response.text();
		text = text.replaceAll('http://localhost/materials/', '');

		// Try local logo first, fall back to CDN (same pattern as overlay.html)
		if (text.includes('"logo.png"')) {
			const localLogoPath = openvgal_location + '/materials/logo.png';
			if (doesFileExist(localLogoPath)) {
				const logoAbsUrl = new URL(localLogoPath, window.location.href).href;
				text = text.replaceAll('"logo.png"', '"' + logoAbsUrl + '"');
			}
		}

		const json = JSON.parse(text);
		const mat = BABYLON.NodeMaterial.Parse(json, scene, materials_folder + '/');
		mat.name = name;
		return mat;
	}

	function doesFileExist(urlToFile) {
		var xhr = new XMLHttpRequest();
		xhr.open('HEAD', urlToFile, false);
		xhr.send();
		return xhr.status >= 200 && xhr.status < 300;
	}

	window.initFunction = async function() {
		var createDefaultEngine = function() {
			return new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true,  disableWebGL2Support: false});
		};

		var asyncEngineCreation = async function() {
			try {
				return createDefaultEngine();
			} catch(e) {
				console.log("the available createEngine function failed. Creating the default engine instead");
			return createDefaultEngine();
			}
		}




	    var startRenderLoop = function (engine, canvas) {
            engine.runRenderLoop(function () {
                if (sceneToRender && sceneToRender.activeCamera) {
                    sceneToRender.render();
                }
            });
        }
        var createScene =  function () {
            var scene = new BABYLON.Scene(engine);

			//add default camera
			const camera = new BABYLON.UniversalCamera("camera", new BABYLON.Vector3(0, 1.5, -5), scene);
			camera.attachControl();

			camera.applyGravity = true;
			camera.checkCollisions = true;

			camera.ellipsoid = new BABYLON.Vector3(1, 0.9, 1);

			if (isTouchDevice) {
				camera.minZ = 0.045;
				camera.speed = 0.25;
				//camera.angularSensibility = 4000;

				camera.touchAngularSensibility=15000; //higher is slower
				camera.touchMoveSensibility=600;


			} else {
				camera.minZ = 0.45;
				camera.speed = 0.25;
				camera.angularSensibility = 4000;

				camera.keysUp.push(87);
				camera.keysLeft.push(65);
				camera.keysDown.push(83);
				camera.keysRight.push(68);
			}


			var light0 = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
			var light00 = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, -1, 0), scene);

			light0.intensity=config_file_content["Technical"]["ambientLight"];
			light00.intensity=config_file_content["Technical"]["ambientLight"]/2;


			scene.clearColor = new BABYLON.Color3(0.2, 0.3, 0.4);
			if (debug_scene) {
				scene.debugLayer.show();
				}
            return scene;
        }

		//receives the events to switch galleries
		let galleryManager=async function (evt){
				console.log(evt);

				// Revoke previous blob URLs to free memory (preview mode)
				if (window._previewBlobUrls && window._previewBlobUrls.length > 0) {
					window._previewBlobUrls.forEach(url => URL.revokeObjectURL(url));
					window._previewBlobUrls = [];
				}

				//only in the first run
				if ('first' in evt){
					console.log('First gallery booting');
				} else {
					//move elements away from scene unless previously cached

					var keepAssets = new BABYLON.KeepAssets();
					keepAssets.cameras.push(scene.cameras[0]);
					keepAssets.lights.push(scene.lights[0]);
					keepAssets.lights.push(scene.lights[1]);


					for (const material in BJS_materials){
						keepAssets.materials.push(BJS_materials[material]);
					}


					if (galleries[current_gallery]==undefined) {
						galleries[current_gallery]=new BABYLON.AssetContainer(scene);
						galleries[current_gallery].moveAllFromScene(keepAssets);
					} else {
						//if cached simply drop them
						//let temp_assetcontainer=new BABYLON.AssetContainer(scene);
						//temp_assetcontainer.moveAllFromScene(keepAssets);
						galleries[current_gallery].removeFromScene();
					}
				}


				//the current gallery is updated with the user choice
				current_gallery=evt.source.name;
				current_gallery=current_gallery.replace(regul_exp_tail,"");
				current_gallery=current_gallery.replace(regul_exp_door, "");

				//hide info box
				if (typeof hideInfoBox === 'function') hideInfoBox();

				//the new gallery assets are loaded unless they are already in memory
				if (galleries[current_gallery]==undefined){
					//check if it is template glb or not
					glb_file=config_file_content[current_gallery]["resource"];
					if (doesFileExist(glb_location + glb_file)){
						//full glb
						console.log("loading full glb for gallery " + current_gallery);
						let temp_assetcontainer=await loadAsset(glb_file, scene);
						temp_assetcontainer.addAllToScene();
					} else {
							glb_file=config_file_content[current_gallery]["template"];
							//template
							console.log("Loading template glb for gallery " + current_gallery);
							let temp_assetcontainer=await loadAsset(glb_file, scene);
							temp_assetcontainer.addAllToScene();

							//set light intensities
							scene.lights.forEach(light => {
								if (light.name.startsWith("pointLight")) {

									light.intensity=config_file_content["Technical"]["pointLight"];
								}
							});


							// check BJS materials
							const n_meshes=scene.meshes.length-1;
							for (var i in scene.meshes) {

								if ((scene.meshes[i].material != null) && scene.meshes[i].material.name.startsWith("BJS_")){
									let name=scene.meshes[i].material.name;

									if (BJS_materials[name]== undefined){
										BJS_materials[name] = await loadNodeMaterial('r' + name, materials_folder + '/' + name + '.json', scene);
										console.log("material " + name + " loaded");
										BJS_materials[name].freeze();
									}
								}
								percentLoaded_materials=Math.round((i/n_meshes)*100);
								document.getElementById("percentLoaded_materials").textContent = `${percentLoaded_materials}%`;
								document.getElementById("loadingBar_materials").style.width =`${percentLoaded_materials}%`;

							}

							if (BJS_materials[frame_material]==undefined){
								BJS_materials[frame_material] = await loadNodeMaterial('r' + frame_material, materials_folder + '/' + frame_material + '.json', scene);
								console.log("material " + frame_material + " loaded");
							}
							populate_template(config_file_content, current_gallery, scene);
							console.log("template populated");
					}



				} else {
					galleries[current_gallery]._wasAddedToScene=false;
					galleries[current_gallery].addAllToScene();
				}



				//reset camera position
				scene.cameras[0].position=new BABYLON.Vector3(0, 1.5, -8);

				//locate doors and artwork to setup the action manager
				gallery_doors=[];
				gallery_artworks=[];
				scene.meshes.map((mesh) => {
					mesh.checkCollisions = true;
					if (regul_exp_door.test(mesh.name)){
						gallery_doors.push(mesh.name);
					} else if (regul_exp_artworks.test(mesh.name))
						gallery_artworks.push(mesh.name);
					});

				for (const door of gallery_doors){
					console.log('action manager de '+ door);

					scene.getMeshByName(door).actionManager = new BABYLON.ActionManager();
					scene.getMeshByName(door).actionManager.registerAction(new BABYLON.ExecuteCodeAction(
									BABYLON.ActionManager.OnPickTrigger, galleryManager	));
				}



				let indice=0;
				for (const artwork of gallery_artworks){
					scene.getMeshByName(artwork).actionManager= new BABYLON.ActionManager();
					scene.getMeshByName(artwork).actionManager.registerAction(
						new BABYLON.ExecuteCodeAction(
							{ trigger: BABYLON.ActionManager.OnPickTrigger },
							CB_artwork_picked(indice)
						));
					indice++;
				}

		}

		// MAIN CODE /////////////////////////////////////
		//read font
		let fontfile=await fetch("https://assets.babylonjs.com/fonts/Droid Sans_Regular.json");
		fontContent=await fontfile.json();

		//read json files - check for preview mode first
		const previewParam = new URLSearchParams(window.location.search).get('preview');
		if (previewParam === 'iframe' && window.parent && window.parent.openvgal_config) {
			// Iframe preview mode - access parent's blob URLs directly
			config_file_content = window.parent.openvgal_config;
			const blobUrls = window.parent.openvgal_blobUrls || {};
			console.log('Preview mode: loaded', Object.keys(blobUrls).length, 'images from parent');

			window.resolveImageUrl = function(resourcePath) {
				if (blobUrls[resourcePath]) {
					return blobUrls[resourcePath];
				}
				console.warn('Preview: no blob URL for', resourcePath);
				return hallspics_prefix + resourcePath;
			};
		} else {
			let response = await fetch (config_file_name);
			config_file_content = await response.json();
		}


		window.engine = await asyncEngineCreation();
		if (!engine) throw 'engine should not be null.';
		startRenderLoop(engine, canvas);

		//crete the scene
		window.current_gallery="root"
		scene=createScene();
		const framesPerSecond = 60;
		const gravity = -9.81;
		scene.gravity = new BABYLON.Vector3(0, gravity / framesPerSecond, 0);
		scene.collisionsEnabled = true;



		//trigger a dummy event to render the first gallery
		const urlParams = new URLSearchParams(window.location.search);
		const directGallery = urlParams.get('gallery');

		// Validate gallery exists, fallback to root if not
		if (directGallery && !config_file_content[directGallery]) {
			console.warn(`Gallery "${directGallery}" not found, loading root`);
			window.current_gallery = "root";
		} else {
			window.current_gallery = directGallery || "root";
		}

		// Create synthetic event
		let evt = {source: {name: `d_${window.current_gallery}_1`}};
		evt.first = 1;
		await galleryManager(evt);

	}

	initFunction().then(() => {sceneToRender = scene });
