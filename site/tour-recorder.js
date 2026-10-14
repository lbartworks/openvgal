// Tour recorder (PoC). Loaded by viewer.html only with ?record=1.
// Flies the camera to 3 random artworks in the current room and records the
// canvas as a 1080x1920 vertical clip with the gallery title and a watermark,
// then shares it (Web Share API) or downloads it.
(function () {
	const OUT_W = 1080, OUT_H = 1920, FPS = 30, BITRATE = 8e6;
	const TOUR_FOV = 1.0;          // vertical fov (rad) while recording; 9:16 needs it wider than 0.8
	const NUM_SHOTS = 3;
	const HOLD_S = 2.5;            // seconds parked in front of each artwork
	const TRAVEL_SPEED = 2.6;      // m/s between artworks
	const MIN_TRAVEL_S = 1.2, MAX_TRAVEL_S = 3.0;
	const TURN_LEAD = 0.8;         // rotation completes at this fraction of the move

	let recording = null;          // active session state, null when idle
	let pendingShare = null;       // finished clip waiting for a click to share

	function getScene() { return BABYLON.EngineStore.LastCreatedScene; }

	function artworkMeshes(scene) {
		let tagged = scene.meshes.filter(m => m.metadata && typeof m.metadata.ovgal_artwork_idx === 'number');
		if (tagged.length) return tagged;
		// full-GLB galleries: reuse the viewer's regex-detected list
		if (typeof gallery_artworks !== 'undefined') {
			return gallery_artworks.map(n => scene.getMeshByName(n)).filter(Boolean);
		}
		return [];
	}

	function pickRandom(list, n) {
		const a = list.slice();
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a.slice(0, n);
	}

	// Visit order: greedy nearest-neighbour from the camera, so the path doesn't zig-zag.
	function orderByProximity(shots, fromPos) {
		const out = [], left = shots.slice();
		let p = fromPos;
		while (left.length) {
			let best = 0;
			for (let i = 1; i < left.length; i++) {
				if (BABYLON.Vector3.DistanceSquared(left[i].pos, p) < BABYLON.Vector3.DistanceSquared(left[best].pos, p)) best = i;
			}
			p = left[best].pos;
			out.push(left.splice(best, 1)[0]);
		}
		return out;
	}

	function isBlocker(m, exclude) {
		return m !== exclude && m.isVisible && m.isEnabled() && !m.name.startsWith('Occupancy_');
	}

	// A wall blocks a straight path along its whole width and height; a lamp, plaque,
	// label or bench only clips part of it. Cut only when centre and both side rays
	// hit something wall-sized.
	const PATH_HALF_WIDTH = 0.35;
	const WALL_MIN_HEIGHT = 1.8;
	function isWallMesh(m) {
		return 2 * m.getBoundingInfo().boundingBox.extendSizeWorld.y >= WALL_MIN_HEIGHT;
	}
	function isWallBetween(from, to, scene) {
		const gap = to.subtract(from);
		const len = gap.length();
		if (len < 0.01) return false;
		const dir = gap.scale(1 / len);
		const side = BABYLON.Vector3.Cross(dir, BABYLON.Vector3.Up());
		if (side.lengthSquared() < 1e-6) return false;
		side.normalize().scaleInPlace(PATH_HALF_WIDTH);
		const walls = [];
		for (const off of [BABYLON.Vector3.Zero(), side, side.scale(-1)]) {
			const hit = scene.pickWithRay(new BABYLON.Ray(from.add(off), dir, len), m => isBlocker(m, null) && isWallMesh(m));
			if (!hit || !hit.hit) return false;
			walls.push(hit.pickedMesh.name);
		}
		console.info('[tour] wall between shots, cutting:', walls.join(', '));
		return true;
	}

	// Camera pose that frames an artwork head-on, pulled back to fit the vertical frame
	// and clamped so it never lands behind the opposite wall.
	function shotFor(mesh, scene) {
		mesh.computeWorldMatrix(true);
		const bb = mesh.getBoundingInfo().boundingBox;
		const center = bb.centerWorld.clone();
		const ext = bb.extendSizeWorld;
		const width = 2 * Math.sqrt(ext.x * ext.x + ext.z * ext.z);
		const height = 2 * ext.y;

		// Plane normal points into the room (item_builder offsets the plane along it).
		let normal = null;
		const normals = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
		if (normals) {
			normal = BABYLON.Vector3.TransformNormal(new BABYLON.Vector3(normals[0], normals[1], normals[2]), mesh.getWorldMatrix());
		}
		if (!normal || normal.lengthSquared() < 1e-6) normal = mesh.forward.scale(-1);
		normal.y = 0;
		normal.normalize();

		const tanV = Math.tan(TOUR_FOV / 2), tanH = tanV * OUT_W / OUT_H;
		let dist = Math.max((width / 2) / (tanH * 0.8), (height / 2) / (tanV * 0.55));
		dist = Math.min(Math.max(dist, 1.0), 7.0);

		const hit = scene.pickWithRay(new BABYLON.Ray(center.add(normal.scale(0.05)), normal, dist + 0.6), m => isBlocker(m, mesh));
		if (hit && hit.hit) dist = Math.max(0.6, Math.min(dist, hit.distance - 0.6));

		const pos = center.add(normal.scale(dist));
		pos.y = Math.min(Math.max(center.y, 1.2), 2.2);
		return { mesh, center, normal, dist, pos };
	}

	function anglesTo(from, target) {
		const d = target.subtract(from);
		return { yaw: Math.atan2(d.x, d.z), pitch: Math.atan2(-d.y, Math.sqrt(d.x * d.x + d.z * d.z)) };
	}

	function lerpAngle(a, b, t) {
		let diff = (b - a) % (2 * Math.PI);
		if (diff > Math.PI) diff -= 2 * Math.PI;
		if (diff < -Math.PI) diff += 2 * Math.PI;
		return a + diff * t;
	}

	// Sine in-out: gentler peak speed than smootherstep, so moves read as one glide.
	const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * t);

	// Quadratic Bezier: the control point sits out along the artwork normal, so the
	// camera swings round and arrives head-on instead of strafing sideways into place.
	function bezier(p0, c, p1, t) {
		const u = 1 - t;
		return p0.scale(u * u).add(c.scale(2 * u * t)).add(p1.scale(t * t));
	}

	// Timeline of segments: travel (or hard cut when a wall is in the way) then hold.
	function buildTimeline(cam, shots, scene) {
		const segs = [];
		let fromPos = cam.position.clone();
		let fromAng = { yaw: cam.rotation.y, pitch: cam.rotation.x };
		for (const s of shots) {
			const toAng = anglesTo(s.pos, s.center);
			const len = s.pos.subtract(fromPos).length();
			if (isWallBetween(fromPos, s.pos, scene)) {
				segs.push({ kind: 'cut', pos: s.pos, ang: toAng });
			} else {
				const dur = Math.min(Math.max(len / TRAVEL_SPEED, MIN_TRAVEL_S), MAX_TRAVEL_S);
				const ctrl = s.pos.add(s.normal.scale(Math.min(len * 0.35, 1.5)));
				segs.push({ kind: 'move', dur, from: fromPos, ctrl, to: s.pos, a0: fromAng, a1: toAng });
			}
			segs.push({ kind: 'hold', dur: HOLD_S, pos: s.pos, ang: toAng });
			fromPos = s.pos;
			fromAng = toAng;
		}
		return segs;
	}

	function applyPose(cam, pos, yaw, pitch) {
		cam.position.copyFrom(pos);
		cam.rotation.set(pitch, yaw, 0);
	}

	// Exhibition title from the manifest; falls back to the room name.
	function galleryTitle() {
		const technical = (typeof config_file_content !== 'undefined' && config_file_content.Technical) || {};
		if (technical.title) return technical.title;
		const room = window.current_gallery || '';
		return room && room !== 'root' ? room.replace(/_/g, ' ') : '';
	}

	// Greedy word wrap, capped at maxLines with an ellipsis on the last line.
	function wrapLines(ctx, text, maxWidth, maxLines) {
		const words = text.split(/\s+/), lines = [];
		let line = '';
		for (const w of words) {
			const test = line ? line + ' ' + w : w;
			if (ctx.measureText(test).width <= maxWidth || !line) { line = test; continue; }
			lines.push(line);
			line = w;
		}
		if (line) lines.push(line);
		if (lines.length > maxLines) {
			lines.length = maxLines;
			let last = lines[maxLines - 1];
			while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
			lines[maxLines - 1] = last.trimEnd() + '…';
		}
		return lines;
	}

	function makeWatermark(scene, title) {
		const dt = new BABYLON.DynamicTexture('tour_wm_tex', { width: OUT_W, height: OUT_H }, scene, false);
		dt.hasAlpha = true;
		const ctx = dt.getContext();
		ctx.clearRect(0, 0, OUT_W, OUT_H);

		if (title) {
			const shade = ctx.createLinearGradient(0, 0, 0, 420);
			shade.addColorStop(0, 'rgba(0,0,0,0.55)');
			shade.addColorStop(1, 'rgba(0,0,0,0)');
			ctx.fillStyle = shade;
			ctx.fillRect(0, 0, OUT_W, 420);
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			ctx.shadowColor = 'rgba(0,0,0,0.6)';
			ctx.shadowBlur = 16;
			ctx.fillStyle = '#fafafa';
			ctx.font = '600 68px Inter, sans-serif';
			wrapLines(ctx, title, OUT_W - 160, 2).forEach((l, i) => ctx.fillText(l, OUT_W / 2, 140 + i * 84));
		}

		// Bottom-centre lockup: brand mark + wordmark, URL beneath, over a soft shade.
		const foot = ctx.createLinearGradient(0, OUT_H - 380, 0, OUT_H);
		foot.addColorStop(0, 'rgba(0,0,0,0)');
		foot.addColorStop(1, 'rgba(0,0,0,0.55)');
		ctx.shadowColor = 'transparent';
		ctx.fillStyle = foot;
		ctx.fillRect(0, OUT_H - 380, OUT_W, 380);

		const MARK = 64, GAP = 18, baseY = OUT_H - 150;
		ctx.font = '600 52px Inter, sans-serif';
		ctx.letterSpacing = '1px';
		const wordW = ctx.measureText('OpenVGAL').width;
		const x0 = (OUT_W - (MARK + GAP + wordW)) / 2;
		ctx.shadowColor = 'rgba(0,0,0,0.6)';
		ctx.shadowBlur = 14;
		drawMark(ctx, x0, baseY - MARK / 2, MARK);
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#fafafa';
		ctx.fillText('OpenVGAL', x0 + MARK + GAP, baseY + 2);

		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		ctx.font = '500 28px Inter, sans-serif';
		ctx.letterSpacing = '6px';
		ctx.fillStyle = '#a5b4fc';
		ctx.fillText('OPENVGAL.COM', OUT_W / 2, baseY + MARK / 2 + 26);
		ctx.letterSpacing = '0px';
		dt.update();
		const layer = new BABYLON.Layer('tour_wm', null, scene, false);
		layer.texture = dt;
		return layer;
	}

	// Canonical "open threshold" mark (see site/index.html #ovg-mark), drawn on a 256 grid.
	function drawMark(ctx, x, y, size) {
		const poly = (pts, fill) => {
			ctx.beginPath();
			for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
			ctx.closePath();
			ctx.fillStyle = fill;
			ctx.fill();
		};
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(size / 256, size / 256);
		poly([35.84, 35.84, 220.16, 35.84, 220.16, 220.16, 35.84, 220.16], '#fbfaf7');
		ctx.shadowColor = 'transparent';
		poly([35.84, 220.16, 220.16, 220.16, 161.18, 153.5, 94.82, 153.5], '#d1ad84');
		ctx.strokeStyle = '#0f1016';
		ctx.lineWidth = 4.84;
		ctx.beginPath();
		ctx.moveTo(35.84, 35.84); ctx.lineTo(94.82, 87.14);
		ctx.moveTo(220.16, 35.84); ctx.lineTo(161.18, 87.14);
		ctx.moveTo(35.84, 220.16); ctx.lineTo(94.82, 153.5);
		ctx.moveTo(220.16, 220.16); ctx.lineTo(161.18, 153.5);
		ctx.stroke();
		ctx.lineWidth = 5.76;
		ctx.strokeRect(94.82, 87.14, 66.36, 66.36);
		ctx.lineWidth = 6.91;
		ctx.strokeRect(35.84, 35.84, 184.32, 184.32);
		ctx.restore();
	}

	function pickMimeType() {
		const candidates = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
		return candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
	}

	function start() {
		const scene = getScene();
		const engine = scene && scene.getEngine();
		const cam = scene && scene.activeCamera;
		if (!cam || !window.MediaRecorder) { alert('Recording is not supported here.'); return; }

		const meshes = artworkMeshes(scene);
		if (!meshes.length) { alert('No artworks in this room.'); return; }

		const canvas = engine.getRenderingCanvas();
		const saved = {
			fov: cam.fov, gravity: cam.applyGravity, collisions: cam.checkCollisions,
			canvasStyle: canvas.getAttribute('style') || '',
		};

		// Vertical frame: fixed render size, canvas shown letterboxed so the user sees the shot.
		// Pinned to the viewport centre so page flow/margins can't shift the preview.
		canvas.style.position = 'fixed';
		canvas.style.top = '0';
		canvas.style.left = '50%';
		canvas.style.transform = 'translateX(-50%)';
		canvas.style.width = 'auto';
		canvas.style.height = '100%';
		canvas.style.aspectRatio = OUT_W + ' / ' + OUT_H;
		engine.setSize(OUT_W, OUT_H);

		cam.detachControl();
		cam.applyGravity = false;
		cam.checkCollisions = false;
		cam.cameraDirection.setAll(0);
		cam.cameraRotation.set(0, 0);
		cam.fov = TOUR_FOV;

		const shots = orderByProximity(pickRandom(meshes, NUM_SHOTS).map(m => shotFor(m, scene)), cam.position);
		const segs = buildTimeline(cam, shots, scene);
		const title = galleryTitle();
		const watermark = makeWatermark(scene, title);

		const mimeType = pickMimeType();
		const stream = canvas.captureStream(FPS);
		const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: BITRATE } : { videoBitsPerSecond: BITRATE });
		const chunks = [];
		recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

		let segIdx = 0, segT0 = performance.now();
		const observer = scene.onBeforeRenderObservable.add(() => {
			let seg = segs[segIdx];
			while (seg && seg.kind === 'cut') {
				applyPose(cam, seg.pos, seg.ang.yaw, seg.ang.pitch);
				seg = segs[++segIdx];
				segT0 = performance.now();
			}
			if (!seg) { stop(); return; }
			const t = Math.min((performance.now() - segT0) / 1000 / seg.dur, 1);
			if (seg.kind === 'move') {
				const r = ease(Math.min(t / TURN_LEAD, 1));
				applyPose(cam, bezier(seg.from, seg.ctrl, seg.to, ease(t)),
					lerpAngle(seg.a0.yaw, seg.a1.yaw, r), seg.a0.pitch + (seg.a1.pitch - seg.a0.pitch) * r);
			} else {
				applyPose(cam, seg.pos, seg.ang.yaw, seg.ang.pitch);
			}
			if (t >= 1) { segIdx++; segT0 = performance.now(); }
		});

		recording = { scene, engine, cam, canvas, saved, watermark, recorder, observer, chunks, mimeType, title };
		recorder.onstop = finish;
		recorder.start(250);
		setButton('recording');
	}

	function stop() {
		if (!recording) return;
		recording.scene.onBeforeRenderObservable.remove(recording.observer);
		if (recording.recorder.state !== 'inactive') recording.recorder.stop();
	}

	function finish() {
		const r = recording;
		recording = null;
		r.watermark.texture.dispose();
		r.watermark.dispose();

		r.canvas.setAttribute('style', r.saved.canvasStyle);
		r.engine.resize();
		r.cam.fov = r.saved.fov;
		r.cam.applyGravity = r.saved.gravity;
		r.cam.checkCollisions = r.saved.collisions;
		r.cam.attachControl();
		setButton('idle');

		const type = (r.mimeType || 'video/webm').split(';')[0];
		const slug = (r.title || 'tour').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tour';
		const file = new File(r.chunks, 'openvgal-' + slug + (type === 'video/mp4' ? '.mp4' : '.webm'), { type });

		// Phones: open the share sheet straight away. Browsers may refuse because the
		// tap that started the recording is too old; then the button becomes
		// "Share video" and the next tap shares. Desktops: save the file.
		if (IS_MOBILE && navigator.canShare && navigator.canShare({ files: [file] })) {
			navigator.share({ files: [file], title: r.title || 'OpenVGAL', text: r.title || '' })
				.catch(err => {
					if (err.name === 'NotAllowedError') { pendingShare = { file, title: r.title }; setButton('share'); }
					else if (err.name !== 'AbortError') download(file);
				});
		} else {
			download(file);
		}
	}

	function download(file) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(file);
		a.download = file.name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 10000);
	}

	function share() {
		const p = pendingShare;
		pendingShare = null;
		setButton('idle');
		navigator.share({ files: [p.file], title: p.title || 'OpenVGAL', text: p.title || '' })
			.catch(err => { if (err.name !== 'AbortError') download(p.file); });
	}

	// Desktop Chrome/Edge can share files too, but that opens the OS sheet, not the social apps.
	const IS_MOBILE = navigator.userAgentData ? navigator.userAgentData.mobile
		: window.matchMedia('(pointer: coarse)').matches;

	let button = null;
	const BUTTON_STATES = {
		idle:      { label: IS_MOBILE ? 'Record & share' : 'Record video', dot: '#818cf8' },
		recording: { label: 'Stop',           dot: '#ef4444' },
		share:     { label: 'Share video',    dot: '#a78bfa' },
	};
	function setButton(state) {
		button.querySelector('span').textContent = BUTTON_STATES[state].label;
		button.querySelector('i').style.background = BUTTON_STATES[state].dot;
	}

	function mountButton() {
		button = document.createElement('button');
		button.type = 'button';
		button.title = 'Record a vertical tour of 3 artworks';
		// Top-right, mirroring the map button (top-left); the overlay owns the bottom edge.
		const inset = window.matchMedia('(max-width: 600px)').matches ? 12 : 20;
		button.style.cssText = 'position:fixed;top:' + inset + 'px;right:' + inset + 'px;z-index:25;'
			+ 'display:flex;align-items:center;gap:8px;height:44px;padding:0 18px;border-radius:999px;cursor:pointer;'
			+ 'background:rgba(0,0,0,0.75);color:#fafafa;border:1px solid rgba(255,255,255,0.15);font:500 14px Inter,sans-serif;';
		button.innerHTML = '<i style="width:10px;height:10px;border-radius:50%;display:inline-block;"></i><span></span>';
		button.addEventListener('click', () => {
			if (recording) stop();
			else if (pendingShare) share();
			else start();
		});
		document.body.appendChild(button);
		setButton('idle');
	}

	mountButton();
})();
