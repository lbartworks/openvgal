	//user custom variables that are not modified in general
	const debug_scene=false;
	const margin=0.2; 			//frame margin
	const item_separation=0.05; 	//separation from the wall
	const max_lights=14;
	const max_artwork_px=768;	//touch-device cap on artwork texture long edge (0 = uncapped)



//declarations
	var canvas = document.getElementById("renderCanvas");
	var sceneToRender = null;
	var percentage_template=0;
	var percentage_materials=0;
	var percentage_artwork=0;
	let config_file_content;
	let style_file_content;
	let fontContent;
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
	isTouchDevice = /iphone|ipod|ipad|android|iemobile|blackberry|bada/.test(deviceAgent)
		// iPadOS 13+ asks for desktop sites by default, so its UA says Macintosh and
		// the sniff above misses it - and the iPad is exactly the device whose per-tab
		// memory ceiling the mobile texture budget exists for.
		|| (/mac/.test(deviceAgent) && navigator.maxTouchPoints > 1)
		// Primary pointer is coarse: a real touch device. A laptop with a touchscreen
		// still reports "fine" because of its trackpad, so this does not catch desktops.
		|| (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

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

		// Mobile texture budget: the 2K floor albedo decodes to ~21 MB on its own.
		// The 1K variant is a quarter of that and is indistinguishable at gallery
		// viewing distance. Both sizes ship in the pack (see pack-definition.js).
		if (isTouchDevice) text = text.replaceAll('WoodFloor051_2K_', 'WoodFloor051_1K_');

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
		// A blocked request (CORS, offline, mixed content) throws instead of
		// answering. Treat that as "not there" so callers fall back to the default.
		try {
			xhr.send();
		} catch (e) {
			return false;
		}
		return xhr.status >= 200 && xhr.status < 300;
	}

	// v4 template contract, Check B. Returns null if the just-loaded template
	// AssetContainer satisfies the bake contract, otherwise a short detail string
	// naming the failing check (logged to the console). Two checks:
	//   1. Every lightmap receiver carries UV2. A receiver mirrors the baker's own
	//      filter (setupLightmapBake): a visible non-helper (not Occupancy_/door_title),
	//      non-glow surface with real geometry. Doors (d_) and other UV2-less meshes are
	//      not receivers, so they're not flagged — but a receiver missing UV2 means a
	//      stale/corrupt _B export and is rejected.
	//   2. Every scene light must be a recognized OpenVGAL light (a sun_/splash_ spot
	//      or an ambient hemi). Presence is NOT required — a template may light purely
	//      via F_ fixtures + runtime ambient — but any foreign/unrecognized light left
	//      in by the author is rejected.
	function validateBakedTemplate(container) {
		var bakeable = (typeof _isBakeableMesh === 'function')
			? _isBakeableMesh
			: function () { return false; };

		// Doors (d_) are bakeable geometry (occluders) but never lightmap receivers —
		// they ship without UV2 by design, so exempt them from the UV2 requirement.
		var doorRe = (typeof regul_exp_door !== 'undefined') ? regul_exp_door : /^d_/;

		var missingUV2 = [];
		container.meshes.forEach(function (m) {
			if (!bakeable(m)) return;
			if (doorRe.test(m.name)) return;
			if (m.material && /glow/i.test(m.material.name || '')) return;
			// Only real surfaces are receivers; geometry-less nodes (glTF __root__,
			// empties) pass the name predicate but never get lightmapped.
			if (!m.isVerticesDataPresent || !m.isVerticesDataPresent(BABYLON.VertexBuffer.PositionKind)) return;
			if (!m.isVerticesDataPresent(BABYLON.VertexBuffer.UV2Kind)) {
				missingUV2.push(m.name);
			}
		});
		if (missingUV2.length > 0) {
			return 'missing UV2 on lightmap receiver(s): ' + missingUV2.join(', ');
		}

		// Fixtures (F_) are meshes and ambient hemis are runtime-created, so the
		// realistic content here is sun_/splash_ spots — but reject any light that
		// isn't one of the recognized kinds (a stray light the author left in).
		// Name resolves from the parent NODE (the Blender object) — the single
		// source of truth, same as the bake collector — because the glTF loader
		// names the runtime light after the KHR light DATA-BLOCK (obj.data.name),
		// which authors rarely rename in lockstep with the object.
		var foreignLights = container.lights.filter(function (l) {
			var name = (l.parent && l.parent.name) ? l.parent.name : l.name;
			return !/^(?:sun|splash)_\d+/.test(name) &&
				name !== 'hemiLight_up' && name !== 'hemiLight_down';
		}).map(function (l) { return (l.parent && l.parent.name) ? l.parent.name : l.name; });
		if (foreignLights.length > 0) {
			return 'unrecognized (non-OpenVGAL) light(s): ' + foreignLights.join(', ');
		}

		return null;
	}

	// Full-screen error overlay for a failed template load. kind is 'LEGACY'
	// (gallery predates v4 — regenerate) or 'BAD_TEMPLATE' (stale/corrupt _B file
	// — re-download / CDN). Detail already went to console.error; creators rarely
	// have devtools open, so the overlay carries the short fix plus a console hint.
	// Design system: #000 bg, Inter, zinc text, indigo accent, SVG icon (no emoji).
	function showTemplateError(kind, glb_file) {
		// Hide the loading spinner if it's up.
		var loader = document.getElementById('loader') || document.getElementById('loaded');
		if (loader) loader.style.display = 'none';

		var copy = (kind === 'LEGACY')
			? {
				title: 'This gallery needs to be regenerated',
				body: 'It was built with an older version of OpenVGAL that is no longer supported. Recreate it with the current generator at openvgal.com/create.'
			}
			: {
				title: 'The gallery template could not be loaded',
				body: 'The template file is stale or corrupt. Try re-downloading the gallery; if the problem persists it may be a temporary content-delivery issue.'
			};

		var existing = document.getElementById('ovgal-error-overlay');
		if (existing) existing.remove();

		var overlay = document.createElement('div');
		overlay.id = 'ovgal-error-overlay';
		overlay.setAttribute('style',
			'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;' +
			'display:flex;align-items:center;justify-content:center;padding:24px;' +
			'background:#000;font-family:Inter,system-ui,sans-serif;');
		overlay.innerHTML =
			'<div style="max-width:440px;text-align:center;">' +
				'<svg width="40" height="40" viewBox="0 0 24 24" fill="none" ' +
					'stroke="#6366f1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
					'style="margin-bottom:20px;">' +
					'<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
					'<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' +
				'</svg>' +
				'<h1 style="color:#d4d4d8;font-size:20px;font-weight:600;line-height:1.4;margin:0 0 12px;">' +
					copy.title + '</h1>' +
				'<p style="color:#a1a1aa;font-size:14px;line-height:1.6;margin:0 0 20px;">' +
					copy.body + '</p>' +
				'<p style="color:#52525b;font-size:12px;line-height:1.5;margin:0;">' +
					'Open the browser console (F12) for details.</p>' +
			'</div>';
		document.body.appendChild(overlay);
	}

	// Toggle plaque visibility at runtime (called from overlay.html switch)
	window.togglePlaques = function(checkbox) {
		if (!scene) return;
		var plaquesRoot = scene.getTransformNodeByName('plaques_root');
		if (plaquesRoot) plaquesRoot.setEnabled(checkbox.checked);
	};

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
			const camera = new BABYLON.UniversalCamera("camera", new BABYLON.Vector3(0, 1.5, 0), scene);
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


			// Lighting managed by openvgal-lighting.js
			initGalleryLighting(scene, config_file_content);

			scene.clearColor = new BABYLON.Color3(0.2, 0.3, 0.4);
			if (debug_scene) {
				scene.debugLayer.show();
				}

			// --- SSAO2 (experimental). Enable with ?ssao=1; press K toggles live ---
			if (new URLSearchParams(window.location.search).has('ssao')
				&& BABYLON.SSAO2RenderingPipeline.IsSupported) {
				const ssao = new BABYLON.SSAO2RenderingPipeline(
					"ssao", scene, { ssaoRatio: 0.75, blurRatio: 1 }, [camera]);
				ssao.radius = 5;            // world-space sample radius (meters)
				ssao.totalStrength = 0.25;  // darkness of the occlusion
				ssao.base = 0.02;           // floor so nothing goes fully black
				ssao.maxZ = 60;             // depth range to consider
				ssao.samples = 8;           // fewer samples; blur hides the noise
				ssao.expensiveBlur = true;  // edge-aware blur keeps it smooth, not blocky
				window._ssao = ssao;
				let ssaoOn = true;
				window.addEventListener("keydown", function (e) {
					if ((e.key === "k" || e.key === "K") && !e.ctrlKey && !e.altKey && !e.metaKey) {
						e.preventDefault();
						ssaoOn = !ssaoOn;
						const mgr = scene.postProcessRenderPipelineManager;
						if (ssaoOn) mgr.attachCamerasToRenderPipeline("ssao", camera);
						else mgr.detachCamerasFromRenderPipeline("ssao", camera);
						console.log("SSAO2 " + (ssaoOn ? "on" : "off"));
					}
				});
				console.log("SSAO2 enabled");

				// Live tuning panel (only with ?ssao=1)
				(function () {
					const panel = document.createElement("div");
					panel.style.cssText = "position:fixed;top:10px;left:10px;z-index:99999;"
						+ "background:rgba(0,0,0,0.75);color:#fafafa;font:12px Inter,sans-serif;"
						+ "padding:10px 12px;border-radius:8px;width:200px;user-select:none;";
					panel.innerHTML = "<div style='margin-bottom:6px;font-weight:600;'>SSAO &nbsp;<span style='color:#a1a1aa;font-weight:400;'>K=on/off</span></div>";
					const knobs = [
						{ prop: "radius",        min: 0.2, max: 8,   step: 0.1 },
						{ prop: "totalStrength", min: 0,   max: 2,   step: 0.05 },
						{ prop: "base",          min: 0,   max: 0.6, step: 0.01 },
					];
					knobs.forEach(function (k) {
						const row = document.createElement("label");
						row.style.cssText = "display:block;margin:6px 0;";
						const val = document.createElement("span");
						val.textContent = ssao[k.prop].toFixed(2);
						val.style.cssText = "float:right;color:#a5b4fc;";
						const name = document.createElement("span");
						name.textContent = k.prop;
						const slider = document.createElement("input");
						slider.type = "range";
						slider.min = k.min; slider.max = k.max; slider.step = k.step;
						slider.value = ssao[k.prop];
						slider.style.cssText = "width:100%;margin-top:2px;";
						slider.addEventListener("input", function () {
							ssao[k.prop] = parseFloat(slider.value);
							val.textContent = ssao[k.prop].toFixed(2);
						});
						row.appendChild(name); row.appendChild(val); row.appendChild(slider);
						panel.appendChild(row);
					});
					document.body.appendChild(panel);
				})();
			}

			// Ctrl+Shift+D toggles the Babylon.js Inspector
			window.addEventListener("keydown", function (e) {
				if (e.ctrlKey && e.shiftKey && e.key === "D") {
					e.preventDefault();
					if (scene.debugLayer.isVisible()) {
						scene.debugLayer.hide();
					} else {
						scene.debugLayer.show();
					}
				}
			});

            return scene;
        }

		//receives the events to switch galleries
		let galleryManager=async function (evt){
				console.log(evt);
				if (typeof ovgMark === 'function') ovgMark('galleryManager', evt && evt.source && evt.source.name);

				//only in the first run
				if ('first' in evt){
					console.log('First gallery booting');
					if (typeof ovgMark === 'function') ovgMark('first gallery boot');
				} else {
					//dispose the outgoing gallery — rooms are not cached in memory;
					//a revisit reloads from the (browser-cached) files and re-bakes

					var keepAssets = new BABYLON.KeepAssets();
					keepAssets.cameras.push(scene.cameras[0]);
					// Keep ambient lights (managed by openvgal-lighting.js)
					scene.lights.forEach(function(l) {
						if (l.name === 'hemiLight_up' || l.name === 'hemiLight_down') {
							keepAssets.lights.push(l);
						}
					});
					//Babylon auto-registers its shared BRDF lookup texture in
					//scene.textures; disposing it leaves a dangling ref that makes
					//every PBR-based node material wait forever (invisible, no error)
					if (scene.environmentBRDFTexture) keepAssets.textures.push(scene.environmentBRDFTexture);


					let outgoing=new BABYLON.AssetContainer(scene);
					outgoing.moveAllFromScene(keepAssets);
					outgoing.dispose();
					if (typeof ovgMark === 'function') ovgMark('outgoing gallery disposed');

					//the dispose destroyed the BJS node materials (frozen materials with
					//disposed lights/effects silently stop rendering) and the bake's
					//cached ShaderMaterials (their _ensure* guards would reuse disposed
					//refs and hang the next bake). Clear both caches so the next room
					//reloads and rebuilds them from scratch.
					BJS_materials = {};
					if (typeof resetLightmapBakeCache === 'function') resetLightmapBakeCache();
				}


				//the current gallery is updated with the user choice
				current_gallery=evt.source.name;
				current_gallery=current_gallery.replace(regul_exp_tail,"");
				current_gallery=current_gallery.replace(regul_exp_door, "");

				//hide info box
				if (typeof hideInfoBox === 'function') hideInfoBox();

				//the new gallery is always loaded fresh — the previous one was disposed
					//check if it is template glb or not
					glb_file=config_file_content[current_gallery]["resource"];
					if (doesFileExist(glb_location + glb_file)){
						//full glb — self-contained gallery, loaded exactly as authored.
						//No _B/UV2/light validation and no baking: a self-contained GLB is
						//expected to ship its lighting pre-baked into its own textures.
						console.log("loading full glb for gallery " + current_gallery);
						if (typeof ovgMark === 'function') ovgMark('loading full glb', glb_file);
						let temp_assetcontainer=await loadAsset(glb_file, scene);
						temp_assetcontainer.addAllToScene();
						if (typeof ovgMark === 'function') ovgMark('full glb added to scene');
					} else {
							glb_file=config_file_content[current_gallery]["template"];
							//template — v4 contract. Check A: templates must be baked (_B).
							//A legacy (non-_B) name means the gallery predates v4; fail hard
							//with the LEGACY message (fix = regenerate the gallery).
							if (!/_B\.glb$/.test(glb_file)){
								console.error('[openvgal] LEGACY template rejected: "' + glb_file +
									'" for gallery "' + current_gallery + '". v4 requires a baked (_B) template.');
								showTemplateError('LEGACY', glb_file);
								return;
							}
							console.log("Loading template glb for gallery " + current_gallery);
							if (typeof ovgMark === 'function') ovgMark('loading template glb', glb_file);
							let temp_assetcontainer=await loadAsset(glb_file, scene);

							//Check B: the loaded _B template must satisfy the bake contract
							//(it's actually baked — has lightmap receivers — and carries no
							//foreign lights) before we touch the scene. On failure, drop the
							//loaded assets and abort with the BAD_TEMPLATE message (fix =
							//re-download or CDN issue) — no populate, no bake, no half-rendered scene.
							var contractDetail=validateBakedTemplate(temp_assetcontainer);
							if (contractDetail){
								console.error('[openvgal] BAD_TEMPLATE "' + glb_file + '" for gallery "' +
									current_gallery + '": ' + contractDetail);
								temp_assetcontainer.dispose();
								showTemplateError('BAD_TEMPLATE', glb_file);
								return;
							}

							temp_assetcontainer.addAllToScene();
							if (typeof ovgMark === 'function') ovgMark('template added to scene');

							// check BJS materials
							const n_meshes=scene.meshes.length-1;
							for (var i in scene.meshes) {

								if ((scene.meshes[i].material != null) && scene.meshes[i].material.name.startsWith("BJS_")){
									let name=scene.meshes[i].material.name;

									if (BJS_materials[name]== undefined){
										BJS_materials[name] = await loadNodeMaterial('r' + name, materials_folder + '/' + name + '.json', scene);
										console.log("material " + name + " loaded");
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
							if (BJS_materials["BJS_black_metal"]==undefined){
								BJS_materials["BJS_black_metal"] = await loadNodeMaterial('rBJS_black_metal', materials_folder + '/BJS_black_metal.json', scene);
								console.log("material BJS_black_metal loaded");
								if (typeof ovgMark === 'function') ovgMark('node materials loaded');
							}
							// Room lighting setup first (disables stray lights, reads ambient) before
							// materials are assigned to meshes.
							setupRoomLighting(scene, config_file_content);
							if (typeof ovgMark === 'function') ovgMark('room lighting set up');
							// Loader stays up until BOTH artworks and the lightmap bake finish
							// (both async); markArtworksDone / markLightsDone coordinate the close.
							if (typeof beginTemplateLoad === 'function') beginTemplateLoad();
							populate_template(config_file_content, current_gallery, scene);
							if (typeof ovgMark === 'function') ovgMark('artworks populated');
							console.log("template populated");
							if (typeof setLightsProgress === 'function') setLightsProgress(30);
							setupLightmapBake(scene,
								function () {
									if (typeof ovgMark === 'function') ovgMark('lightmap bake done');
									if (typeof markLightsDone === 'function') markLightsDone();
								},
								(typeof setLightsProgress === 'function') ? setLightsProgress : undefined);
							freezeGalleryMaterials();
							if (typeof ovgMark === 'function') ovgMark('materials frozen, bake running');
					}



				//reset camera position — honor a "Start" empty baked into the GLB if
				//present, otherwise fall back to the default spawn point. The empty is
				//imported as a (mesh-less) TransformNode parented under glTF's __root__,
				//so getAbsolutePosition/getDirection give the correct left-handed values.
				const cam = scene.cameras[0];
				const startNode = scene.getNodeByName('Start');
				if (startNode) {
					startNode.computeWorldMatrix(true);
					cam.position.copyFrom(startNode.getAbsolutePosition());
					// Face the empty's local +X axis (its red arrow in Blender). X is the
					// one axis Blender's glTF export leaves un-swapped (Y/Z get shuffled),
					// so aiming the empty's X at a target in Blender aims the camera there
					// with no handedness guesswork. getDirection resolves it through the
					// node's world matrix, so the loader's frame conversion is applied to
					// the axis and the scene alike. Flatten to keep the look level; unlike
					// +Y this stays non-zero after flattening, so the aim always applies.
					const forward = startNode.getDirection(BABYLON.Axis.X);
					forward.y = 0;
					if (forward.lengthSquared() > 1e-6) {
						cam.setTarget(cam.position.add(forward));
					}
				} else {
					cam.position = new BABYLON.Vector3(0, 1.5, 0);
				}

				//locate doors and artwork to setup the action manager
				gallery_doors=[];
				gallery_artworks=[];
				// Template-populated galleries tag each artwork plane with its config index
				// (ovgal_artwork_idx). Prefer those: the name-regex below also matches
				// decorative template meshes that end in _<digits> (Fixture_0, Col_*_1,
				// Door_F_0, …), and since the template loads before the planes, those would
				// be prepended and shift every artwork's click index. Regex is the fallback
				// for full-GLB galleries, which aren't populated by populate_template.
				let tagged_artworks=[];
				let regex_artworks=[];
				scene.meshes.map((mesh) => {
					// Occupancy_* meshes are placement scaffolding for the packer.
					// They're hidden at runtime (isVisible=false) but — since that
					// doesn't disable collisions — the blanket loop below would turn
					// them into invisible walls right where the panels are, trapping
					// the camera. They play no role once artworks are placed, so skip.
					if (mesh.name.startsWith('Occupancy_')) { mesh.checkCollisions = false; return; }
					mesh.checkCollisions = true;
					if (regul_exp_door.test(mesh.name)){
						gallery_doors.push(mesh.name);
					} else if (mesh.metadata && typeof mesh.metadata.ovgal_artwork_idx === 'number') {
						tagged_artworks.push(mesh.name);
					} else if (regul_exp_artworks.test(mesh.name) && !mesh.name.startsWith('F_') && mesh.name !== 'door_title') {
						regex_artworks.push(mesh.name);
					}
					});
				gallery_artworks = tagged_artworks.length ? tagged_artworks : regex_artworks;

				for (const door of gallery_doors){
					console.log('action manager de '+ door);

					scene.getMeshByName(door).actionManager = new BABYLON.ActionManager();
					scene.getMeshByName(door).actionManager.registerAction(new BABYLON.ExecuteCodeAction(
									BABYLON.ActionManager.OnPickTrigger, galleryManager	));
				}



				let indice=0;
				for (const artwork of gallery_artworks){
					const artwork_mesh = scene.getMeshByName(artwork);
					// Use the plane's tagged config index when present so the camera always
					// lands on the clicked artwork; fall back to scan position for full-GLB.
					const art_idx = (artwork_mesh.metadata && typeof artwork_mesh.metadata.ovgal_artwork_idx === 'number')
						? artwork_mesh.metadata.ovgal_artwork_idx
						: indice;
					artwork_mesh.actionManager= new BABYLON.ActionManager();
					artwork_mesh.actionManager.registerAction(
						new BABYLON.ExecuteCodeAction(
							{ trigger: BABYLON.ActionManager.OnPickTrigger },
							CB_artwork_picked(art_idx)
						));
					indice++;
				}

		}

		// Expose the in-scene gallery swap so the navigation map can reuse it
		// instead of doing a full page reload (a reload spins up a second
		// Babylon engine/WebGL context and peaks memory while the old document
		// is still resident). The map builds a door-style synthetic event.
		window.galleryManager = galleryManager;

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
		if (typeof ovgMark === 'function') ovgMark('engine created', JSON.stringify(engine.getGlInfo()) + ' webgl' + engine.webGLVersion + ' maxTex' + engine.getCaps().maxTextureSize);

		//crete the scene
		window.current_gallery="root"
		scene=createScene();
		if (typeof ovgMark === 'function') ovgMark('scene created');
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
