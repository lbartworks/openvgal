// Overlay functionality
// New overlay layout (experimental). Enable with ?ui=2
const NEW_UI = new URLSearchParams(window.location.search).get('ui') === '2';

// callbacks
function CB_artwork_picked(index) {
	return function() {
		manual_navigation_idx = index;
		manual_move();
		if (NEW_UI) openArtworkSheet(manual_navigation_idx);
	};
}


//rest of utility functions

// Compute the camera pose for artwork `idx` in the current gallery.
// Returns { position, target, title, idx, count } or null when unavailable.
// Single source of truth shared by manual_move() and the cinematic tour, so the
// two navigation paths can never drift apart. Keeps the Z/Y axis swap ([0],[2],[1]).
function getArtworkPose(idx){
	if (typeof scene === 'undefined' || !scene) return null;
	if (typeof config_file_content === 'undefined' || !config_file_content) return null;

	var gallery=config_file_content[current_gallery];
	if (!gallery) return null;
	var dict_items=Object.keys(gallery).filter(key => gallery[key]["resource_type"]== "image");
	if (dict_items.length ==0) return null;
	var n_items=dict_items.length;

	//wrap index into range
	if (idx<0){
		idx= n_items-1;
	} else if (idx>=n_items){
		idx=0;
	}

	//get position and vector. Assuming they are JSON strings of 3-element arrays [x, y, z]
	let item_position_array = JSON.parse(gallery[dict_items[idx]]['location']);
	let item_vector_array = JSON.parse(gallery[dict_items[idx]]['vector']);

	// Create Babylon.js Vector3 objects
	const target_position = new BABYLON.Vector3(item_position_array[0], item_position_array[2], item_position_array[1]);
	const target_vector = new BABYLON.Vector3(item_vector_array[0], item_vector_array[2], item_vector_array[1]).normalize();

	// Calculate the camera's position to be in front of the item (closer on desktop)
	const camera_distance = window.innerWidth>600 ? 4 : 6;
	const camera_position = target_position.add(target_vector.scale(camera_distance));
	const item = gallery[dict_items[idx]];

	return {
		position: camera_position,
		target: target_position,
		title: "Title:  " + String(item["metadata"]).replace(/^ID\s*#\d+\s*/, ""),
		item: item,
		idx: idx,
		count: n_items
	};
}

function manual_move(){
	const pose = getArtworkPose(manual_navigation_idx);
	if (!pose) return;

	manual_navigation_idx = pose.idx;

	//get active camera and snap into place
	const camera = scene.activeCamera;
	camera.position = pose.position;
	camera.setTarget(pose.target);

	showInfoBox(pose.title);
}

function manual_move_backward(){
	manual_navigation_idx--;
	manual_move();
}

function manual_move_forward(){
	manual_navigation_idx++;
	manual_move();
}


// ==========================================================================
//  Cinematic visit: self-running, eased camera tour of the current gallery
// ==========================================================================

const CINEMATIC_DWELL_MS = 4000;   // pause at each artwork
const CINEMATIC_FPS = 60;

let cinematic_active = false;
let cinematic_queue = [];          // shuffled artwork indices, drained per leg
let cinematic_last_idx = -1;       // to avoid an immediate repeat on reshuffle
let cinematic_timer = null;        // dwell setTimeout handle
let cinematic_anims = [];          // running Animatable refs (position + rotation)
let cinematic_saved_collisions = null;
let cinematic_saved_gravity = null;

function cinematicCanvas(){
	return document.getElementById('renderCanvas');
}

// Number of images in the current gallery (0 when no scene/gallery yet).
function cinematicArtworkCount(){
	if (typeof config_file_content === 'undefined' || !config_file_content) return 0;
	if (typeof current_gallery === 'undefined') return 0;
	var gallery = config_file_content[current_gallery];
	if (!gallery) return 0;
	return Object.keys(gallery).filter(key => gallery[key]["resource_type"] == "image").length;
}

// Pick the next artwork index, reshuffling (Fisher-Yates) when the queue empties
// and avoiding an immediate repeat of the last visited artwork.
function nextCinematicIndex(){
	const n = cinematicArtworkCount();
	if (n === 0) return -1;
	if (n === 1) return 0;

	if (cinematic_queue.length === 0){
		cinematic_queue = Array.from({length: n}, (_, i) => i);
		for (let i = cinematic_queue.length - 1; i > 0; i--){
			const j = Math.floor(Math.random() * (i + 1));
			const tmp = cinematic_queue[i];
			cinematic_queue[i] = cinematic_queue[j];
			cinematic_queue[j] = tmp;
		}
		// don't start the fresh queue on the artwork we just left
		if (cinematic_queue[0] === cinematic_last_idx){
			cinematic_queue.push(cinematic_queue.shift());
		}
	}
	return cinematic_queue.shift();
}

// Fly to one artwork, then schedule the next leg after the dwell.
function cinematicLeg(){
	if (!cinematic_active) return;

	const idx = nextCinematicIndex();
	if (idx < 0){ stopCinematicVisit(); return; }
	const pose = getArtworkPose(idx);
	if (!pose){ stopCinematicVisit(); return; }

	const camera = scene.activeCamera;

	// Duration scaled by distance so short hops don't whip, long hops don't crawl.
	const dist = BABYLON.Vector3.Distance(camera.position, pose.position);
	const seconds = Math.min(5, Math.max(2, dist / 3));
	const frames = Math.round(seconds * CINEMATIC_FPS);

	const ease = new BABYLON.CubicEase();
	ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);

	// Destination rotation via save/restore: setTarget writes camera.rotation from
	// the camera's CURRENT position, so we must momentarily place the camera at the
	// destination before reading the look-at rotation — otherwise the camera aims at
	// the artwork from where it started, landing slightly (then increasingly) off to
	// the side. Restore both position and rotation before animating.
	const startRot = camera.rotation.clone();
	const startPos = camera.position.clone();
	camera.position.copyFrom(pose.position);
	camera.setTarget(pose.target);
	const endRot = camera.rotation.clone();
	camera.position.copyFrom(startPos);
	camera.rotation.copyFrom(startRot);

	// Turn the short way: normalize the yaw delta into (-PI, PI].
	const twoPi = Math.PI * 2;
	let yawDelta = endRot.y - startRot.y;
	yawDelta = ((yawDelta + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
	const targetRot = new BABYLON.Vector3(endRot.x, startRot.y + yawDelta, endRot.z);

	cinematic_anims = [];
	const posAnim = BABYLON.Animation.CreateAndStartAnimation(
		'cinematic_pos', camera, 'position', CINEMATIC_FPS, frames,
		camera.position.clone(), pose.position,
		BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, ease,
		function(){
			// onAnimationEnd — also fires on .stop(), so guard on active state
			if (!cinematic_active) return;
			showInfoBox(pose.title);
			manual_navigation_idx = idx;   // ◀/▶ continue from here after the tour
			cinematic_last_idx = idx;
			if (cinematicArtworkCount() <= 1){
				// single artwork: arrive, dwell, then hand control back (no loop)
				cinematic_timer = setTimeout(stopCinematicVisit, CINEMATIC_DWELL_MS);
			} else {
				cinematic_timer = setTimeout(cinematicLeg, CINEMATIC_DWELL_MS);
			}
		}
	);
	const rotAnim = BABYLON.Animation.CreateAndStartAnimation(
		'cinematic_rot', camera, 'rotation', CINEMATIC_FPS, frames,
		startRot, targetRot,
		BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT, ease
	);
	cinematic_anims.push(posAnim, rotAnim);
}

// Cancel signals: grabbing the controls (movement key or canvas tap/click) stops the tour.
function cinematicCancelKey(e){
	const movementKeys = [37, 38, 39, 40, 87, 65, 83, 68]; // arrows + WASD
	if (movementKeys.indexOf(e.keyCode) !== -1) stopCinematicVisit();
}
function cinematicCancelPointer(){
	stopCinematicVisit();
}

function setCinematicButtonState(active){
	// Icon-only buttons (old bar + ?ui=2 row): toggle the active glow and update
	// the tooltip/label, but never touch textContent (that would wipe the inline SVG).
	document.querySelectorAll('.cinematic-button').forEach(btn => {
		btn.classList.toggle('active', active);
		btn.title = active ? 'Stop cinematic visit' : 'Cinematic visit';
		btn.setAttribute('aria-label', btn.title);
	});
}

function startCinematicVisit(){
	if (cinematic_active) return;
	if (typeof scene === 'undefined' || !scene || !scene.activeCamera) return;
	if (cinematicArtworkCount() === 0) return;

	cinematic_active = true;
	cinematic_queue = [];

	const camera = scene.activeCamera;

	// Disable physics during flight: walls/furniture would block the path and
	// gravity fights the vertical easing. Restored on stop.
	cinematic_saved_collisions = camera.checkCollisions;
	cinematic_saved_gravity = camera.applyGravity;
	camera.checkCollisions = false;
	camera.applyGravity = false;

	// Input is the cancel signal, not detachControl().
	window.addEventListener('keydown', cinematicCancelKey);
	const cv = cinematicCanvas();
	if (cv) cv.addEventListener('pointerdown', cinematicCancelPointer);

	setCinematicButtonState(true);
	cinematicLeg();
}

function stopCinematicVisit(){
	if (!cinematic_active) return;
	cinematic_active = false;

	if (cinematic_timer){ clearTimeout(cinematic_timer); cinematic_timer = null; }
	cinematic_anims.forEach(a => { if (a && typeof a.stop === 'function') a.stop(); });
	cinematic_anims = [];

	if (typeof scene !== 'undefined' && scene && scene.activeCamera){
		const camera = scene.activeCamera;
		if (cinematic_saved_collisions !== null) camera.checkCollisions = cinematic_saved_collisions;
		if (cinematic_saved_gravity !== null) camera.applyGravity = cinematic_saved_gravity;
	}
	cinematic_saved_collisions = null;
	cinematic_saved_gravity = null;

	window.removeEventListener('keydown', cinematicCancelKey);
	const cv = cinematicCanvas();
	if (cv) cv.removeEventListener('pointerdown', cinematicCancelPointer);

	setCinematicButtonState(false);
}

// Toggle handler wired from the overlay button.
function CB_cinematic_visit(){
	if (cinematic_active) stopCinematicVisit();
	else startCinematicVisit();
}

// show metadata or other info
function showInfoBox(title) {
    const el = document.getElementById("artwork-info");
    if (el) el.innerText = title;
}

function hideInfoBox() {
    // Stop any running cinematic tour before the room swaps, so artwork indices
    // from the old gallery can't leak into the new one.
    if (typeof stopCinematicVisit === 'function') stopCinematicVisit();
    const el = document.getElementById("artwork-info");
    if (el) el.innerText = "";
    closeArtworkSheet();
}


// ==========================================================================
//  New overlay layout (?ui=2): top badge, bottom-right button row, artwork sheet.
//  Built here rather than in overlay.html: older standard ZIPs fetch overlay.html
//  from the CDN but keep their bundled overlay.css, so its markup must not change.
// ==========================================================================

const ICON_ATTRS = 'viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" '
	+ 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const SPEAKER_ICON = '<svg ' + ICON_ATTRS + '><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>'
	+ '<g class="vol-on"><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></g>'
	+ '<g class="vol-off"><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></g></svg>';

// Help text for the ?ui=2 layout (joystick, new buttons). Swapped in at runtime so
// the classic overlay keeps its own help; move into overlay.html once ?ui=2 is default.
const HELP_KB = '<img src="icons/keyboard_move.png" alt="Keyboard Movement" class="help-image"><img src="icons/keyboard_pan.png" alt="Keyboard Pan" class="help-image">';
const HELP_JOYSTICK = '<svg class="help-image" width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" '
	+ 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Joystick">'
	+ '<circle cx="32" cy="32" r="28"/><circle cx="32" cy="32" r="10" fill="currentColor" stroke="none"/>'
	+ '<polyline points="28 13 32 9 36 13"/><polyline points="28 51 32 55 36 51"/>'
	+ '<polyline points="13 28 9 32 13 36"/><polyline points="51 28 55 32 51 36"/></svg>';
const HELP_TOUCH = '<img src="icons/touch_move.png" alt="Touch Movement" class="help-image"><img src="icons/touch_pan.png" alt="Touch Pan" class="help-image">';
const helpIcons = imgs => '<div style="text-align:center;margin:10px 0 14px;">' + imgs + HELP_JOYSTICK + '</div>';
const UI2_HELP = {
	eng: 'You can move around the gallery in several ways:'
		+ '<br><br>1) On a computer, use the arrow keys to move and drag the mouse to look around. You can also drag the joystick at the bottom: up/down to walk, left/right to turn;' + helpIcons(HELP_KB)
		+ '2) On a phone or tablet, drag one finger to move and two fingers to turn, or use the joystick the same way: up/down to walk, left/right to turn. The further you push it, the faster you go;' + helpIcons(HELP_TOUCH)
		+ '3) Use the arrow buttons to jump to the previous or next artwork, or the cinematic button for an automatic visit. Click an artwork to fly to it and see its details.'
		+ '<br><br>To go to a gallery click on the corresponding door.',
	spa: 'Puedes moverte por la galería de varias formas:'
		+ '<br><br>1) En un ordenador, usa las teclas de flecha para moverte y arrastra el ratón para mirar alrededor. También puedes arrastrar el joystick de abajo: arriba/abajo para caminar, izquierda/derecha para girar;' + helpIcons(HELP_KB)
		+ '2) En un móvil o tablet, arrastra un dedo para avanzar y dos dedos para girar, o usa el joystick de la misma forma: arriba/abajo para caminar, izquierda/derecha para girar. Cuanto más lo empujes, más rápido irás;' + helpIcons(HELP_TOUCH)
		+ '3) Usa los botones de flecha para ir a la obra anterior o siguiente, o el botón cinemático para una visita automática. Haz clic en una obra para acercarte y ver sus detalles.'
		+ '<br><br>Para ir a una galería, haz clic en la puerta correspondiente.',
	jap: 'ギャラリー内はいくつかの方法で移動できます：'
		+ '<br><br>1) パソコンでは矢印キーで移動し、マウスをドラッグして周りを見渡せます。画面下のジョイスティックも使えます：上下で歩き、左右で回転します；' + helpIcons(HELP_KB)
		+ '2) スマートフォンやタブレットでは、1本の指でドラッグして移動、2本の指で回転できます。ジョイスティックも同様に使えます：上下で歩き、左右で回転します。強く倒すほど速く進みます；' + helpIcons(HELP_TOUCH)
		+ '3) 矢印ボタンで前後の作品へ移動し、シネマティックボタンで自動見学ができます。作品をクリックするとその作品へ移動し、詳細が表示されます。'
		+ '<br><br>ギャラリーに行くには、対応するドアをクリックしてください。',
	cn: '您可以通过几种方式在画廊中移动：'
		+ '<br><br>1) 在电脑上，使用方向键移动，拖动鼠标环顾四周。也可以拖动底部的摇杆：上下行走，左右转向；' + helpIcons(HELP_KB)
		+ '2) 在手机或平板上，用一根手指拖动前进，用两根手指拖动旋转，或以同样方式使用摇杆：上下行走，左右转向。推得越远，移动越快；' + helpIcons(HELP_TOUCH)
		+ '3) 使用箭头按钮跳转到上一件或下一件作品，或使用电影模式按钮进行自动参观。点击作品即可飞到其面前并查看详情。'
		+ '<br><br>要进入画廊，请点击相应的门。'
};

function buildNewUi() {
	document.body.classList.add('ovg-ui2');
	for (const lang in UI2_HELP) {
		const el = document.querySelector('#help-popup .help-text.' + lang);
		if (el) el.innerHTML = UI2_HELP[lang];
	}

	// Top centre: "Made with OpenVGal", reusing the mark inlined in overlay.html.
	const badge = document.createElement('a');
	badge.id = 'ovg-made-with';
	badge.href = 'https://openvgal.com';
	badge.target = '_blank';
	badge.rel = 'noopener';
	const mark = document.querySelector('#overlay-attribution svg');
	if (mark) badge.appendChild(mark.cloneNode(true));
	badge.insertAdjacentHTML('beforeend', '<span>Made with OpenVGal</span>');
	document.body.appendChild(badge);

	// Bottom right: help, prev/next, cinematic, volume.
	const cinematicIcon = document.querySelector('#permanent-overlay .cinematic-button svg');
	const controls = document.createElement('div');
	controls.id = 'ovg-controls';
	controls.innerHTML =
		'<button type="button" class="ovg-btn" title="Help" aria-label="Help" onclick="toggleHelp()">'
		+ '<svg ' + ICON_ATTRS.replace('stroke-width="2"', 'stroke-width="2.75"') + '><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>'
		+ '<button type="button" class="ovg-btn" title="Previous artwork" aria-label="Previous artwork" onclick="manual_move_backward()">'
		+ '<svg ' + ICON_ATTRS + '><polygon points="16 5 7 12 16 19" fill="currentColor"/></svg></button>'
		+ '<button type="button" class="ovg-btn" title="Next artwork" aria-label="Next artwork" onclick="manual_move_forward()">'
		+ '<svg ' + ICON_ATTRS + '><polygon points="8 5 17 12 8 19" fill="currentColor"/></svg></button>'
		+ '<button type="button" class="ovg-btn cinematic-button" title="Cinematic visit" aria-label="Cinematic visit" onclick="CB_cinematic_visit()"></button>'
		+ '<div id="ovg-volume">'
		+ '<div id="ovg-volume-pop"><input id="ovg-volume-range" type="range" min="0" max="1" step="0.05" value="1" aria-label="Music volume"></div>'
		+ '<button type="button" id="ovg-volume-btn" class="ovg-btn" title="Music volume" aria-label="Music volume" aria-expanded="false">' + SPEAKER_ICON + '</button>'
		+ '</div>';
	if (cinematicIcon) controls.querySelector('.cinematic-button').appendChild(cinematicIcon.cloneNode(true));
	document.body.appendChild(controls);

	const volume = controls.querySelector('#ovg-volume');
	const volumeBtn = controls.querySelector('#ovg-volume-btn');
	const range = controls.querySelector('#ovg-volume-range');
	const setVolumeOpen = open => {
		volume.classList.toggle('open', open);
		volumeBtn.setAttribute('aria-expanded', String(open));
	};
	volumeBtn.addEventListener('click', () => setVolumeOpen(!volume.classList.contains('open')));
	// Bottom end of the range is mute.
	range.addEventListener('input', () => {
		const v = parseFloat(range.value);
		volumeBtn.classList.toggle('off', v === 0);
		if (typeof setMusicVolume === 'function') setMusicVolume(v);
	});
	document.addEventListener('pointerdown', e => {
		if (!volume.contains(e.target)) setVolumeOpen(false);
	}, true);

	// Artwork sheet: modal, so the backdrop swallows clicks on other artworks.
	// Backdrop closes on pointerdown, not click: a tap's trailing click can land on
	// the backdrop that the same tap's pick just opened.
	document.body.insertAdjacentHTML('beforeend',
		'<div id="ovg-sheet-backdrop"></div>'
		+ '<section id="ovg-sheet" role="dialog" aria-modal="true" aria-labelledby="ovg-sheet-title">'
		+ '<button type="button" id="ovg-sheet-close" class="ovg-btn" aria-label="Close">'
		+ '<svg ' + ICON_ATTRS + '><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
		+ '<div id="ovg-sheet-body"><h2 id="ovg-sheet-title"></h2><p id="ovg-sheet-subtitle"></p><p id="ovg-sheet-dims"></p></div>'
		+ '</section>');
	document.getElementById('ovg-sheet-backdrop').addEventListener('pointerdown', closeArtworkSheet);
	document.getElementById('ovg-sheet-close').addEventListener('click', closeArtworkSheet);
	document.addEventListener('keydown', e => { if (e.key === 'Escape') closeArtworkSheet(); });
}

function openArtworkSheet(idx) {
	const pose = getArtworkPose(idx);
	if (!pose || !document.getElementById('ovg-sheet')) return;
	document.getElementById('ovg-sheet-title').innerText = pose.title.replace(/^Title:\s*/, '');
	const sub = document.getElementById('ovg-sheet-subtitle');
	sub.innerText = typeof pose.item.subtitle === 'string' ? pose.item.subtitle : '';
	sub.hidden = !sub.innerText;
	// width/height are the artwork's real size in cm.
	const w = Number(pose.item.width), h = Number(pose.item.height);
	const dims = document.getElementById('ovg-sheet-dims');
	dims.innerText = w > 0 && h > 0 ? w + ' × ' + h + ' cm' : '';
	dims.hidden = !dims.innerText;
	document.getElementById('ovg-sheet-body').scrollTop = 0;
	document.body.classList.add('ovg-sheet-open');
}

function closeArtworkSheet() {
	document.body.classList.remove('ovg-sheet-open');
}



// Help popup functionality
function toggleHelp() {
    const helpPopup = document.getElementById('help-popup');
    helpPopup.style.display = helpPopup.style.display === 'none' ? 'block' : 'none';
}

// Minimize/restore the overlay; the choice persists across rooms and visits.
const OVERLAY_COLLAPSED_KEY = 'openvgal_overlay_collapsed';

function setOverlayCollapsed(collapsed) {
    const overlay = document.getElementById('permanent-overlay');
    const button = document.getElementById('overlay-collapse');
    if (!overlay) return;
    overlay.classList.toggle('collapsed', collapsed);
    if (button) {
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', collapsed ? 'Show controls' : 'Minimize controls');
    }
}

function toggleOverlayCollapsed() {
    const overlay = document.getElementById('permanent-overlay');
    if (!overlay) return;
    const collapsed = !overlay.classList.contains('collapsed');
    setOverlayCollapsed(collapsed);
    try { localStorage.setItem(OVERLAY_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) {}
}

function changeLanguage(lang) {
    // Remove active class from all language buttons and texts
    document.querySelectorAll('.lang-button').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.help-text').forEach(text => text.classList.remove('active'));
    
    // Add active class to selected language button and text
    document.querySelector(`.lang-button[onclick="changeLanguage('${lang}')"]`).classList.add('active');
    document.querySelector(`.help-text.${lang}`).classList.add('active');
}

// Load overlay content: CDN first, fall back to local
function loadOverlay() {
    // iconBase rewrites overlay.html's relative `icons/` paths to an absolute
    // base. Needed when the overlay is fetched from the CDN but injected into a
    // gallery page that doesn't bundle the icons (CDN/thin-client ZIP).
    const initOverlay = (html, iconBase) => {
        if (iconBase) {
            html = html.replace(/(src=["'])icons\//g, '$1' + iconBase + 'icons/');
        }
        document.body.insertAdjacentHTML('beforeend', html);
        const helpPopup = document.getElementById('help-popup');
        if (helpPopup) helpPopup.style.display = 'none';
        if (NEW_UI) buildNewUi();
        hideInfoBox();
        if (NEW_UI) return;
        try {
            if (localStorage.getItem(OVERLAY_COLLAPSED_KEY) === '1') setOverlayCollapsed(true);
        } catch (e) {}
    };

    const fetchText = (url) => fetch(url).then(r => {
        if (!r.ok) throw new Error('not found');
        return r.text();
    });

    const cdnBase = (typeof cdn_base !== 'undefined' && cdn_base) ? cdn_base : null;
    const cdnUrl = cdnBase ? cdnBase + '/core/overlay.html' : null;

    const promise = cdnUrl
        ? fetchText(cdnUrl).then(html => initOverlay(html, cdnBase + '/core/'))
            .catch(() => fetchText('overlay.html').then(html => initOverlay(html)))
        : fetchText('overlay.html').then(html => initOverlay(html));

    promise.catch(e => console.warn('Failed to load overlay:', e));
}

// If loaded dynamically (e.g. CDN ZIP), DOMContentLoaded has already fired — run immediately
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadOverlay);
} else {
    loadOverlay();
}