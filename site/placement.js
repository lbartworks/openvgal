// Placement mode (viewer.html?placement=1, OIP-0013 phase 1).
//
// Lets a person drag, resize and swap the artworks of the room they stand in. The
// viewer never saves: Done posts the changed entries to a same-origin parent page
// (docs/viewer-runtime.md § Placement mode is the contract), Cancel restores the
// layout. Edits live in an in-memory copy of the manifest, so a hall that is left
// and revisited rebuilds with them.
//
// Each artwork stays inside the Occupancy_* plane it hangs on, frame margin
// included. After every change the room's frames and plaques are rebuilt from the
// edited entries; the template and the textures are reused as they are. The viewer
// skips the lightmap bake in this mode (openvgal-viewer.js), so no baked shadow
// stays behind where a frame used to hang.
(function () {
	'use strict';

	var SCENE_M_PER_CM = 2.5 / 120;	// mirror of populate_template
	var MIN_CM = 20, MAX_CM = 250;	// longest-edge clamp
	var ART_OFFSET = 3 * item_separation / 2;	// artwork plane distance from its location

	var original = null;	// manifest as it was when the mode started
	var room = null;	// { name, arts, framesMesh, frameMargin }
	var selected = null;
	var gesture = null;	// active drag/resize
	var ui = {};
	var timer = null, renderObserver = null, tapObserver = null;
	var thumbs = {};	// artwork key -> canvas, per room

	var V3 = BABYLON.Vector3;
	var UP = new V3(0, 1, 0);

	function clone(o) { return JSON.parse(JSON.stringify(o)); }

	function sameOriginParent() {
		if (window.parent === window) return null;
		try {
			if (window.parent.location.origin === window.location.origin) return window.parent;
		} catch (e) { /* cross-origin parent */ }
		return null;
	}

	// ---- manifest <-> scene values -------------------------------------------

	// location "[x,z,y]" (Z up) -> babylon {x, y, z}; vector "[x,z]" -> unit normal
	function readEntry(a, entry) {
		var l = JSON.parse(entry.location), v = JSON.parse(entry.vector);
		a.loc = new V3(l[0], l[2], l[1]);
		a.normal = new V3(v[0], 0, v[1]).normalize();
		a.wCm = Number(entry.width);
		a.hCm = Number(entry.height);
	}

	function writeEntry(a, entry, fields) {
		if (fields.location) entry.location = '[' + a.loc.x.toFixed(3) + ',' + a.loc.z.toFixed(3) + ',' + a.loc.y.toFixed(3) + ']';
		if (fields.size) {
			entry.width = a.wCm.toFixed(2);
			entry.height = a.hCm.toFixed(2);
		}
	}

	function sceneW(a) { return a.wCm * SCENE_M_PER_CM; }
	function sceneH(a) { return a.hCm * SCENE_M_PER_CM; }

	// ---- occupancy planes -----------------------------------------------------

	function readOccupancies() {
		var out = [];
		scene.meshes.forEach(function (m) {
			if (!/^Occupancy_/.test(m.name)) return;
			var normals = m.getVerticesData(BABYLON.VertexBuffer.NormalKind);
			var positions = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
			if (!normals || !positions) return;
			var world = m.computeWorldMatrix(true);
			var n = V3.TransformNormal(new V3(normals[0], normals[1], normals[2]), world).normalize();
			var along = V3.Cross(n, UP);
			if (along.length() < 1e-6) return;
			along.normalize();
			var o = { name: m.name, normal: n, along: along, minU: Infinity, maxU: -Infinity, minY: Infinity, maxY: -Infinity, d: 0 };
			for (var i = 0; i < positions.length; i += 3) {
				var p = V3.TransformCoordinates(new V3(positions[i], positions[i + 1], positions[i + 2]), world);
				var u = V3.Dot(p, along);
				o.minU = Math.min(o.minU, u); o.maxU = Math.max(o.maxU, u);
				o.minY = Math.min(o.minY, p.y); o.maxY = Math.max(o.maxY, p.y);
				o.d += V3.Dot(p, n);
			}
			o.d /= positions.length / 3;
			out.push(o);
		});
		return out;
	}

	// The plane an artwork hangs on: same facing, nearest in depth, then along the wall.
	function matchOccupancy(a, occs) {
		var best = null, bestScore = Infinity;
		occs.forEach(function (o) {
			if (V3.Dot(o.normal, a.normal) < 0.9) return;
			var depth = Math.abs(V3.Dot(a.loc, o.normal) - o.d);
			if (depth > 0.3) return;
			var u = V3.Dot(a.loc, o.along);
			var uGap = Math.max(0, o.minU - u, u - o.maxU);
			var yGap = Math.max(0, o.minY - a.loc.y, a.loc.y - o.maxY);
			var score = depth * 10 + uGap + yGap;
			if (score < bestScore) { bestScore = score; best = o; }
		});
		return best;
	}

	function alongOf(a) { return a.occ ? a.occ.along : V3.Cross(a.normal, UP).normalize(); }

	// Room the frame leaves in its plane, along the wall (u) and vertically (y).
	// None (<= SLACK_MIN) means the artwork can't move in that direction.
	var SLACK_MIN = 0.001;
	function slack(a) {
		var o = a.occ;
		return { u: (o.maxU - o.minU) - (sceneW(a) + room.frameMargin), y: (o.maxY - o.minY) - (sceneH(a) + room.frameMargin) };
	}

	// Keeps the whole frame inside the plane; an artwork bigger than the plane centres on it.
	function clampToPlane(a, u, y) {
		var o = a.occ, s = slack(a);
		var hw = (sceneW(a) + room.frameMargin) / 2, hh = (sceneH(a) + room.frameMargin) / 2;
		u = (s.u <= SLACK_MIN) ? (o.minU + o.maxU) / 2 : Math.min(Math.max(u, o.minU + hw), o.maxU - hw);
		y = (s.y <= SLACK_MIN) ? (o.minY + o.maxY) / 2 : Math.min(Math.max(y, o.minY + hh), o.maxY - hh);
		return { u: u, y: y };
	}

	// Largest scale factor (relative to w0 x h0) the plane allows. In each direction the
	// frame may fill the plane, or stay as large as the manifest had it when the mode
	// started: the packer ignores the plane's height, so many artworks start taller than
	// their plane, and capping them to it would shrink them on the first resize move.
	function planeScaleCap(a, w0, h0) {
		var o = a.occ;
		var fitW = (o.maxU - o.minU - room.frameMargin) / SCENE_M_PER_CM;
		var fitH = (o.maxY - o.minY - room.frameMargin) / SCENE_M_PER_CM;
		return Math.min(Math.max(fitW, a.origW) / w0, Math.max(fitH, a.origH) / h0);
	}

	function moveTo(a, u, y) {
		var c = clampToPlane(a, u, y);
		var along = alongOf(a);
		a.loc = a.loc.add(along.scale(c.u - V3.Dot(a.loc, along)));
		a.loc.y = c.y;
	}

	// ---- scene rebuild --------------------------------------------------------

	function applyArtMesh(a) {
		a.mesh.position = a.loc.add(a.normal.scale(ART_OFFSET));
		a.mesh.setDirection(a.normal.scale(-1));
		a.mesh.scaling.x = sceneW(a) / a.baseW;
		a.mesh.scaling.y = sceneH(a) / a.baseH;
	}

	// Rebuilds the merged frames mesh in place (same mesh, material and draw call).
	function rebuildFrames() {
		if (!room.framesMesh || room.framesMesh.isDisposed()) return;
		var boxes = room.arts.map(function (a) {
			return frame_box('placement_box', a.loc, { width: sceneW(a), height: sceneH(a) }, a.normal.clone(), room.frameMargin, scene);
		});
		var merged = BABYLON.Mesh.MergeMeshes(boxes, true);
		BABYLON.VertexData.ExtractFromMesh(merged).applyToMesh(room.framesMesh);
		merged.dispose();
		room.framesMesh.createNormals(true);
		room.framesMesh.refreshBoundingInfo();
	}

	function rebuildPlaques() {
		var root = scene.getTransformNodeByName('plaques_root');
		if (root) root.getChildMeshes().forEach(function (m) { m.dispose(false, true); });
		var gallery = config_file_content[room.name];
		room.arts.forEach(function (a) {
			if (!gallery[a.key].metadata) return;
			plaque_builder(a.key + '_' + (a.idx + 3), { x: a.loc.x, y: a.loc.y, z: a.loc.z },
				{ width: sceneW(a), height: sceneH(a) }, a.normal.clone(), gallery[a.key].metadata, scene);
		});
	}

	// Writes the artwork back to the manifest, re-reads it (so the scene shows the
	// stored, rounded values) and rebuilds frames and plaques.
	function commit(arts, fields) {
		var gallery = config_file_content[room.name];
		arts.forEach(function (a) {
			writeEntry(a, gallery[a.key], fields);
			readEntry(a, gallery[a.key]);
			applyArtMesh(a);
		});
		rebuildFrames();
		rebuildPlaques();
		updateOverlaps();
	}

	// ---- overlaps -------------------------------------------------------------

	function frameRect(a) {
		var along = V3.Cross(a.normal, UP).normalize();
		return { u: V3.Dot(a.loc, along), y: a.loc.y,
			hw: (sceneW(a) + room.frameMargin) / 2, hh: (sceneH(a) + room.frameMargin) / 2 };
	}

	function sameWall(a, b) {
		return V3.Dot(a.normal, b.normal) > 0.99 && Math.abs(V3.Dot(a.loc, a.normal) - V3.Dot(b.loc, a.normal)) < 0.1;
	}

	function updateOverlaps() {
		room.arts.forEach(function (a) { a.overlap = false; });
		for (var i = 0; i < room.arts.length; i++) {
			for (var j = i + 1; j < room.arts.length; j++) {
				var a = room.arts[i], b = room.arts[j];
				if (!sameWall(a, b)) continue;
				var ra = frameRect(a), rb = frameRect(b);
				if (Math.abs(ra.u - rb.u) < ra.hw + rb.hw - 1e-4 && Math.abs(ra.y - rb.y) < ra.hh + rb.hh - 1e-4) {
					a.overlap = b.overlap = true;
				}
			}
		}
	}

	// ---- room attach / detach -------------------------------------------------

	function imageKeys(gallery) {
		return Object.keys(gallery).filter(function (k) { return gallery[k].resource_type === 'image'; });
	}

	function taggedMeshes() {
		var byIdx = {};
		scene.meshes.forEach(function (m) {
			if (m.metadata && typeof m.metadata.ovgal_artwork_idx === 'number' && !m.isDisposed()) byIdx[m.metadata.ovgal_artwork_idx] = m;
		});
		return byIdx;
	}

	function tryAttachRoom() {
		var name = current_gallery;
		var gallery = config_file_content && config_file_content[name];
		if (!gallery || (typeof _loadPhase !== 'undefined' && _loadPhase.active)) return;
		var keys = imageKeys(gallery);
		var byIdx = taggedMeshes();
		var ready = keys.every(function (k, idx) { return byIdx[idx]; });
		if (!ready || !keys.length) {
			setHint(keys.length ? 'No arrangeable artworks in this hall' : 'This hall has no artworks');
			return;
		}

		var technical = config_file_content.Technical || {};
		room = { name: name, arts: [], framesMesh: scene.getMeshByName('frames'),
			frameMargin: technical.show_frames === false ? 0 : margin };
		var occs = readOccupancies();
		keys.forEach(function (key, idx) {
			var a = { key: key, idx: idx, mesh: byIdx[idx] };
			readEntry(a, gallery[key]);
			var before = original[name] && original[name][key];
			a.origW = before ? Number(before.width) : a.wCm;
			a.origH = before ? Number(before.height) : a.hCm;
			a.baseW = sceneW(a) / (a.mesh.scaling.x || 1);
			a.baseH = sceneH(a) / (a.mesh.scaling.y || 1);
			a.occ = matchOccupancy(a, occs);
			// Taps select instead of flying to the artwork; restored on exit.
			a.savedActionManager = a.mesh.actionManager;
			a.mesh.actionManager = null;
			room.arts.push(a);
		});
		room.occs = occs;
		thumbs = {};
		updateOverlaps();
		setHint('Select an artwork to move, resize or swap it');
	}

	function detachRoom(restoreActions) {
		if (!room) return;
		if (restoreActions) room.arts.forEach(function (a) {
			if (!a.mesh.isDisposed()) a.mesh.actionManager = a.savedActionManager;
		});
		select(null);
		closePicker();
		gesture = null;
		room = null;
	}

	function watch() {
		if (typeof scene === 'undefined' || !scene || typeof config_file_content === 'undefined' || !config_file_content) return;
		if (room && (room.name !== current_gallery || room.arts.some(function (a) { return a.mesh.isDisposed(); }))) detachRoom(false);
		if (!room) tryAttachRoom();
	}

	// ---- selection and gestures -----------------------------------------------

	function select(a) {
		selected = a;
		if (ui.selection) ui.selection.style.display = a ? '' : 'none';
		if (a) {
			ui.size.textContent = Math.round(a.wCm) + ' × ' + Math.round(a.hCm) + ' cm';
			ui.drag.style.display = ui.resize.style.display = a.occ ? '' : 'none';
		}
		setHint(selectionHint(a));
	}

	// Says when the frame fills its plane in a direction, so a drag that can't
	// move it that way doesn't look broken.
	function selectionHint(a) {
		if (!a) return 'Select an artwork to move, resize or swap it';
		if (!a.occ) return 'Not on a wall space: swap only';
		var s = slack(a);
		var noU = s.u <= SLACK_MIN, noY = s.y <= SLACK_MIN;
		if (noU && noY) return 'Fills its wall space: shrink it to move it';
		if (noY) return 'Fills the wall space’s height: moves sideways only';
		if (noU) return 'Fills the wall space’s width: moves up and down only';
		return 'Drag the centre to move, the corner to resize';
	}

	// ---- camera ---------------------------------------------------------------

	var FLY_FPS = 60, FLY_FRAMES = 36;	// 0.6 s
	var flight = [], savedPhysics = null;

	function stopFlight() {
		var running = flight;
		flight = [];
		running.forEach(function (anim) { anim.stop(); });
		var cam = scene.activeCamera;
		if (savedPhysics && cam) {
			cam.checkCollisions = savedPhysics.collisions;
			cam.applyGravity = savedPhysics.gravity;
		}
		savedPhysics = null;
	}

	// Eases the camera to face the artwork from close range, framing the whole frame
	// when the room allows it.
	function flyTo(a) {
		var cam = scene.activeCamera;
		if (!cam || !cam.rotation) return;
		stopFlight();
		var centre = a.loc.add(a.normal.scale(ART_OFFSET));
		var t = Math.tan(cam.fov / 2);
		var hw = (sceneW(a) + room.frameMargin) / 2, hh = (sceneH(a) + room.frameMargin) / 2;
		var dist = 1.15 * Math.max(hh / t, hw / (t * engine.getAspectRatio(cam)), 1.2);
		// Stop short of whatever faces the artwork (opposite wall, a panel), keeping
		// the camera's collision radius clear of it.
		var hit = scene.pickWithRay(new BABYLON.Ray(centre, a.normal, dist + 2), function (m) {
			return m.checkCollisions && m.isVisible && m.isEnabled() && m !== room.framesMesh &&
				!room.arts.some(function (x) { return x.mesh === m; });
		});
		var radius = cam.ellipsoid ? cam.ellipsoid.x : 1;
		if (hit && hit.hit) dist = Math.min(dist, Math.max(hit.distance - radius - 0.1, 1.2));
		var to = centre.add(a.normal.scale(dist));

		// setTarget writes the rotation from the current position: read it at the
		// destination, then put the camera back and animate there.
		var startPos = cam.position.clone(), startRot = cam.rotation.clone();
		cam.position.copyFrom(to);
		cam.setTarget(centre);
		var endRot = cam.rotation.clone();
		cam.position.copyFrom(startPos);
		cam.rotation.copyFrom(startRot);
		var yaw = endRot.y - startRot.y;
		yaw = ((yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;	// short way round
		endRot.y = startRot.y + yaw;

		// Walls would block the path and gravity would fight the easing; both come back
		// on arrival, so the person walks away normally.
		savedPhysics = { collisions: cam.checkCollisions, gravity: cam.applyGravity };
		cam.checkCollisions = false;
		cam.applyGravity = false;
		var ease = new BABYLON.CubicEase();
		ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
		var A = BABYLON.Animation, mode = A.ANIMATIONLOOPMODE_CONSTANT;
		var pos = A.CreateAndStartAnimation('ovp_fly_pos', cam, 'position', FLY_FPS, FLY_FRAMES, startPos, to, mode, ease,
			function () { if (flight[0] === pos) stopFlight(); });
		var rot = A.CreateAndStartAnimation('ovp_fly_rot', cam, 'rotation', FLY_FPS, FLY_FRAMES, startRot, endRot, mode, ease);
		flight = [pos, rot].filter(Boolean);
	}

	function onTap(pi) {
		if (!room || pi.type !== BABYLON.PointerEventTypes.POINTERTAP) return;
		var pick = scene.pick(scene.pointerX, scene.pointerY);
		var hit = pick && pick.hit ? room.arts.find(function (a) { return a.mesh === pick.pickedMesh; }) : null;
		select(hit || null);
		if (hit) flyTo(hit);
	}

	// Pointer (client coords) -> point on the selected artwork's wall plane.
	function wallPoint(evt, a) {
		var rect = canvas.getBoundingClientRect();
		var ray = scene.createPickingRay(evt.clientX - rect.left, evt.clientY - rect.top, BABYLON.Matrix.Identity(), scene.activeCamera);
		var dist = ray.intersectsPlane(BABYLON.Plane.FromPositionAndNormal(a.loc, a.normal.clone()));
		return dist == null ? null : ray.origin.add(ray.direction.scale(dist));
	}

	function startGesture(kind, evt) {
		var a = selected;
		var p = a && a.occ && wallPoint(evt, a);
		if (!p) return;
		evt.preventDefault();
		evt.stopPropagation();
		evt.target.setPointerCapture(evt.pointerId);
		var along = alongOf(a);
		var u0 = V3.Dot(a.loc, along);
		gesture = { kind: kind, art: a, moved: false, u0: u0, y0: a.loc.y,
			du: V3.Dot(p, along) - u0, dy: p.y - a.loc.y,
			w0: a.wCm, h0: a.hCm };
		gesture.len0 = Math.hypot(gesture.du, gesture.dy) || 1e-3;
	}

	function moveGesture(evt) {
		if (!gesture) return;
		var a = gesture.art, p = wallPoint(evt, a);
		if (!p) return;
		var along = alongOf(a);
		gesture.moved = true;
		if (gesture.kind === 'drag') {
			moveTo(a, V3.Dot(p, along) - gesture.du, p.y - gesture.dy);
		} else {
			// Scale by how far the pointer is from the centre the gesture started at, along
			// the grab direction. Measured against the start centre, not the live one: the
			// plane clamp below moves the centre, and the scale must not chase it.
			var du = V3.Dot(p, along) - gesture.u0, dy = p.y - gesture.y0;
			var s = (du * gesture.du + dy * gesture.dy) / (gesture.len0 * gesture.len0);
			var longest = Math.max(gesture.w0, gesture.h0);
			var k = Math.min(s, MAX_CM / longest, planeScaleCap(a, gesture.w0, gesture.h0));
			k = Math.max(k, MIN_CM / longest);
			a.wCm = gesture.w0 * k;
			a.hCm = gesture.h0 * k;
			moveTo(a, gesture.u0, gesture.y0);
			ui.size.textContent = Math.round(a.wCm) + ' × ' + Math.round(a.hCm) + ' cm';
		}
		applyArtMesh(a);
		rebuildFrames();
		updateOverlaps();
	}

	function endGesture() {
		if (!gesture) return;
		var g = gesture;
		gesture = null;
		if (g.moved) commit([g.art], { location: true, size: g.kind === 'resize' });
		select(g.art);
	}

	// ---- swap -----------------------------------------------------------------

	function swapWith(b) {
		var a = selected;
		var gallery = config_file_content[room.name];
		var ea = gallery[a.key], eb = gallery[b.key];
		var loc = ea.location, vec = ea.vector;
		ea.location = eb.location; ea.vector = eb.vector;
		eb.location = loc; eb.vector = vec;
		[a, b].forEach(function (x) {
			readEntry(x, gallery[x.key]);
			x.occ = matchOccupancy(x, room.occs);
		});
		commit([a, b], {});
		closePicker();
		select(a);
	}

	// Thumbnail from the texture the room already loaded (no new download).
	function thumbFor(a) {
		if (thumbs[a.key]) return thumbs[a.key];
		var c = document.createElement('canvas');
		var ratio = a.wCm / a.hCm;
		c.width = ratio >= 1 ? 160 : Math.round(160 * ratio);
		c.height = ratio >= 1 ? Math.round(160 / ratio) : 160;
		thumbs[a.key] = c;
		var tex = a.mesh.material && a.mesh.material.diffuseTexture;
		var ctx = c.getContext('2d');
		if (!tex) return c;
		if (tex.getContext) {	// DynamicTexture (touch devices): draw its canvas
			ctx.drawImage(tex.getContext().canvas, 0, 0, c.width, c.height);
			return c;
		}
		var size = tex.getSize();
		var pending = tex.readPixels();
		if (pending && pending.then) pending.then(function (px) {
			var full = document.createElement('canvas');
			full.width = size.width; full.height = size.height;
			full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), size.width, size.height), 0, 0);
			// GL rows come back bottom-up for a texture uploaded with invertY
			if (tex.invertY) { ctx.translate(0, c.height); ctx.scale(1, -1); }
			ctx.drawImage(full, 0, 0, c.width, c.height);
		}).catch(function () { /* leave the tile blank */ });
		return c;
	}

	function openPicker() {
		if (!selected) return;
		ui.grid.textContent = '';
		var gallery = config_file_content[room.name];
		room.arts.forEach(function (b) {
			if (b === selected) return;
			var tile = document.createElement('button');
			tile.className = 'ovp-tile';
			tile.title = b.key;
			tile.appendChild(thumbFor(b));
			var label = document.createElement('span');
			label.textContent = readArtworkMetadata(gallery[b.key].metadata).title || b.key;
			tile.appendChild(label);
			tile.addEventListener('click', function () { swapWith(b); });
			ui.grid.appendChild(tile);
		});
		ui.picker.style.display = '';
	}

	function closePicker() { if (ui.picker) ui.picker.style.display = 'none'; }

	// ---- screen overlay -------------------------------------------------------

	// Screen-space corners of an artwork's frame, or null when any is behind the camera.
	function screenQuad(a) {
		var cam = scene.activeCamera;
		var along = V3.Cross(a.normal, UP).normalize();
		var hw = (sceneW(a) + room.frameMargin) / 2, hh = (sceneH(a) + room.frameMargin) / 2;
		var c = a.loc.add(a.normal.scale(ART_OFFSET));
		var view = cam.getViewMatrix();
		var w = engine.getRenderWidth(), h = engine.getRenderHeight();
		var vp = cam.viewport.toGlobal(w, h);
		var rect = canvas.getBoundingClientRect();
		var pts = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(function (s) {
			return c.add(along.scale(s[0] * hw)).add(UP.scale(s[1] * hh));
		});
		for (var i = 0; i < 4; i++) if (V3.TransformCoordinates(pts[i], view).z < cam.minZ) return null;
		return pts.map(function (p) {
			var s = V3.Project(p, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), vp);
			return { x: s.x * rect.width / w + rect.left, y: s.y * rect.height / h + rect.top };
		});
	}

	function polygon(pts) { return pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' '); }

	function renderOverlay() {
		if (!room) { ui.svg.innerHTML = ''; return; }
		var svg = '';
		room.arts.forEach(function (a) {
			if (!a.overlap && a !== selected) return;
			var q = screenQuad(a);
			if (!q) return;
			if (a.overlap) svg += '<polygon class="ovp-overlap" points="' + polygon(q) + '"/>';
			if (a === selected) svg += '<polygon class="ovp-selected" points="' + polygon(q) + '"/>';
		});
		ui.svg.innerHTML = svg;

		var q = selected && screenQuad(selected);
		ui.selection.style.visibility = q ? 'visible' : 'hidden';
		if (!q) return;
		var cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
		var bottomRight = q[2].x > q[3].x ? q[2] : q[3];
		var top = Math.min(q[0].y, q[1].y);
		place(ui.drag, cx, cy);
		place(ui.resize, bottomRight.x, bottomRight.y);
		// keep the bar on screen when the artwork runs past an edge (phone width)
		var half = ui.bar.offsetWidth / 2 + 8;
		place(ui.bar, Math.min(Math.max((q[0].x + q[1].x) / 2, half), window.innerWidth - half), Math.max(top - 28, 72));
	}

	function place(el, x, y) { el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) translate(-50%,-50%)'; }

	function setHint(t) { if (ui.hint) ui.hint.textContent = t; }

	var ICON_MOVE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg>';
	var ICON_RESIZE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 11v10H11M21 21L5 5"/></svg>';
	var ICON_SWAP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>';

	var CSS = '' +
		'#ovp-root{position:fixed;inset:0;pointer-events:none;z-index:60;font-family:Inter,Arial,sans-serif;}' +
		'#ovp-root>svg{position:absolute;inset:0;width:100%;height:100%;}' +	// the outline layer only, not the icons
		'.ovp-btn svg,.ovp-handle svg{flex-shrink:0;}' +
		'.ovp-selected{fill:rgba(99,102,241,0.08);stroke:#818cf8;stroke-width:2;}' +
		'.ovp-overlap{fill:rgba(248,113,113,0.15);stroke:#f87171;stroke-width:2;stroke-dasharray:6 4;}' +
		'.ovp-topbar{position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;' +
			'padding:8px 10px 8px 14px;background:rgba(0,0,0,0.85);border:1px solid #3f3f46;border-radius:10px;pointer-events:auto;max-width:calc(100% - 32px);}' +
		'.ovp-title{color:#fafafa;font-size:13px;font-weight:600;white-space:nowrap;}' +
		'.ovp-hint{color:#a1a1aa;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
		'.ovp-btn{font:inherit;font-size:12px;font-weight:600;border-radius:7px;padding:6px 12px;cursor:pointer;border:1px solid #3f3f46;background:#18181b;color:#d4d4d8;display:inline-flex;align-items:center;gap:6px;}' +
		'.ovp-btn:hover{border-color:#52525b;color:#fafafa;}' +
		'.ovp-primary{background:#6366f1;border-color:#6366f1;color:#fff;}' +
		'.ovp-primary:hover{background:#818cf8;border-color:#818cf8;}' +
		'.ovp-handle{position:absolute;left:0;top:0;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;' +
			'background:#6366f1;color:#fff;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5);}' +
		'.ovp-drag{width:40px;height:40px;border-radius:50%;cursor:move;}' +
		'.ovp-resize{width:26px;height:26px;border-radius:6px;cursor:nwse-resize;}' +
		'.ovp-bar{position:absolute;left:0;top:0;pointer-events:auto;display:flex;align-items:center;gap:8px;padding:4px 4px 4px 10px;' +
			'background:rgba(0,0,0,0.85);border:1px solid #3f3f46;border-radius:8px;white-space:nowrap;}' +
		'.ovp-size{color:#d4d4d8;font-size:12px;font-variant-numeric:tabular-nums;}' +
		'.ovp-picker{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);pointer-events:auto;padding:16px;}' +
		'.ovp-panel{background:#000;border:1px solid #3f3f46;border-radius:12px;width:min(640px,100%);max-height:80vh;display:flex;flex-direction:column;}' +
		'.ovp-panel-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #27272a;color:#fafafa;font-size:14px;font-weight:600;}' +
		'.ovp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;padding:14px;overflow-y:auto;}' +
		'.ovp-tile{font:inherit;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px;background:#18181b;border:1px solid #27272a;border-radius:8px;cursor:pointer;color:#a1a1aa;font-size:11px;}' +
		'.ovp-tile:hover{border-color:#818cf8;color:#fafafa;}' +
		'.ovp-tile canvas{max-width:100%;height:auto;max-height:110px;background:#27272a;}' +
		'.ovp-tile span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';

	function el(tag, cls, html) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (html) e.innerHTML = html;
		return e;
	}

	function buildUi() {
		var style = el('style');
		style.textContent = CSS;
		document.head.appendChild(style);
		ui.style = style;

		var root = el('div');
		root.id = 'ovp-root';
		ui.root = root;
		ui.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		root.appendChild(ui.svg);

		var top = el('div', 'ovp-topbar');
		top.appendChild(el('span', 'ovp-title', 'Placement'));
		ui.hint = el('span', 'ovp-hint', 'Loading the room…');
		top.appendChild(ui.hint);
		var cancel = el('button', 'ovp-btn', 'Cancel');
		var done = el('button', 'ovp-btn ovp-primary', 'Done');
		cancel.addEventListener('click', cancelMode);
		done.addEventListener('click', finishMode);
		top.appendChild(cancel);
		top.appendChild(done);
		root.appendChild(top);

		ui.selection = el('div');
		ui.selection.style.display = 'none';
		ui.drag = el('div', 'ovp-handle ovp-drag', ICON_MOVE);
		ui.drag.title = 'Drag to move';
		ui.resize = el('div', 'ovp-handle ovp-resize', ICON_RESIZE);
		ui.resize.title = 'Drag to resize';
		ui.bar = el('div', 'ovp-bar');
		ui.size = el('span', 'ovp-size');
		var swap = el('button', 'ovp-btn', ICON_SWAP + 'Swap');
		swap.addEventListener('click', openPicker);
		ui.bar.appendChild(ui.size);
		ui.bar.appendChild(swap);
		[ui.drag, ui.resize, ui.bar].forEach(function (e) { ui.selection.appendChild(e); });
		root.appendChild(ui.selection);

		[[ui.drag, 'drag'], [ui.resize, 'resize']].forEach(function (pair) {
			pair[0].addEventListener('pointerdown', function (e) { startGesture(pair[1], e); });
			pair[0].addEventListener('pointermove', moveGesture);
			pair[0].addEventListener('pointerup', endGesture);
			pair[0].addEventListener('pointercancel', endGesture);
		});

		ui.picker = el('div', 'ovp-picker');
		ui.picker.style.display = 'none';
		var panel = el('div', 'ovp-panel');
		var head = el('div', 'ovp-panel-head');
		head.appendChild(el('span', '', 'Swap with'));
		var close = el('button', 'ovp-btn', 'Close');
		close.addEventListener('click', closePicker);
		head.appendChild(close);
		panel.appendChild(head);
		ui.grid = el('div', 'ovp-grid');
		panel.appendChild(ui.grid);
		ui.picker.appendChild(panel);
		ui.picker.addEventListener('click', function (e) { if (e.target === ui.picker) closePicker(); });
		root.appendChild(ui.picker);

		document.body.appendChild(root);
	}

	// ---- mode lifecycle -------------------------------------------------------

	function start() {
		if (typeof scene === 'undefined' || !scene || typeof config_file_content === 'undefined' || !config_file_content) {
			setTimeout(start, 200);
			return;
		}
		// Work on a private copy: in preview mode the manifest object belongs to the parent page.
		config_file_content = clone(config_file_content);
		original = clone(config_file_content);
		buildUi();
		timer = setInterval(watch, 250);
		renderObserver = scene.onAfterRenderObservable.add(renderOverlay);
		tapObserver = scene.onPointerObservable.add(onTap);
		watch();
	}

	function changedRooms() {
		var rooms = {};
		Object.keys(config_file_content).forEach(function (name) {
			if (name === 'Technical' || !original[name]) return;
			var now = config_file_content[name], before = original[name];
			imageKeys(now).forEach(function (key) {
				var e = now[key], o = before[key] || {};
				if (e.location === o.location && e.vector === o.vector && e.width === o.width && e.height === o.height) return;
				(rooms[name] = rooms[name] || {})[key] = { location: e.location, vector: e.vector, width: e.width, height: e.height };
			});
		});
		return rooms;
	}

	function exitMode() {
		stopFlight();
		detachRoom(true);
		clearInterval(timer);
		scene.onAfterRenderObservable.remove(renderObserver);
		scene.onPointerObservable.remove(tapObserver);
		ui.root.remove();
		ui.style.remove();
	}

	function finishMode() {
		var parent = sameOriginParent();
		if (parent) parent.postMessage({ type: 'openvgal:placement', rooms: changedRooms() }, window.location.origin);
		exitMode();
	}

	function cancelMode() {
		var parent = sameOriginParent();
		config_file_content = clone(original);
		if (room) {
			var gallery = config_file_content[room.name];
			room.arts.forEach(function (a) {
				readEntry(a, gallery[a.key]);
				a.occ = matchOccupancy(a, room.occs);
			});
			commit(room.arts, {});
		}
		if (parent) parent.postMessage({ type: 'openvgal:placement-cancel' }, window.location.origin);
		exitMode();
	}

	start();
})();
