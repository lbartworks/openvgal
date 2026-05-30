// OpenVGAL Customize Editor — lazy-loaded module.
// Mounted by create/index.html on first Customize click. Operates on a deep copy
// of building_v2.json; returns the edited copy via getEdited(). File objects
// (thumbnails) are read but never mutated.

// Sizes are perceived cm of the artwork's longest edge. M is the default
// (typical landscape print). S is half, L is 50% larger. Slider hard-caps
// at 250 cm. The viewer converts cm → babylon scene meters internally.
const SIZE_BUCKETS = { S: 60, M: 120, L: 180 };
const SIZE_MIN_CM = 20;
const SIZE_MAX_CM = 250;
const BUCKET_THRESHOLD = 0.05; // ±5% of bucket midpoint
const CM_PER_INCH = 2.54;

function _isImage(entry) {
  return entry && typeof entry === 'object' && entry.resource_type === 'image';
}

function _isGalleryRoom(key, value) {
  if (key === 'Technical' || key === 'root') return false;
  return value && typeof value === 'object' && value.parent;
}

// Parse current metadata into { title, subtitle } preserving ID prefix logic.
// Format produced by gallery-generator.js: "ID #N <baseName>"
// Plaque builder splits on \n: line 1 = title, line 2 = subtitle.
function _parseMetadata(metadata) {
  if (!metadata) return { title: '', subtitle: '' };
  const stripped = String(metadata).replace(/^ID\s*#\d+\s*/, '');
  const lines = stripped.split('\n');
  return { title: lines[0] || '', subtitle: lines[1] || '' };
}

// Re-emit metadata string keeping the original ID prefix (if any) so existing
// downstream code (overlay, plaque) keeps working.
function _composeMetadata(originalMetadata, title, subtitle) {
  const idMatch = String(originalMetadata || '').match(/^(ID\s*#\d+\s*)/);
  const prefix = idMatch ? idMatch[1] : '';
  const t = (title || '').trim();
  const s = (subtitle || '').trim();
  if (!t && !s) return prefix.trim() || '';
  if (!s) return prefix + t;
  return prefix + t + '\n' + s;
}

function _bucketForSize(cm, buckets) {
  for (const key of Object.keys(buckets)) {
    const mid = buckets[key];
    if (Math.abs(cm - mid) <= mid * BUCKET_THRESHOLD) return key;
  }
  return null;
}

function _aspectDims(entry, longestCm) {
  // entry.width/entry.height are real cm; the ratio is what matters here.
  const w = parseFloat(entry.width) || 1;
  const h = parseFloat(entry.height) || 1;
  if (w >= h) {
    return { wCm: longestCm, hCm: longestCm * (h / w) };
  }
  return { wCm: longestCm * (w / h), hCm: longestCm };
}

function _currentLongestCm(entry) {
  const w = parseFloat(entry.width) || 0;
  const h = parseFloat(entry.height) || 0;
  return Math.max(w, h);
}

function _formatSize(wCm, hCm, unit) {
  if (unit === 'in') {
    const wIn = wCm / CM_PER_INCH;
    const hIn = hCm / CM_PER_INCH;
    return wIn.toFixed(1) + ' × ' + hIn.toFixed(1) + ' in';
  }
  return Math.round(wCm) + ' × ' + Math.round(hCm) + ' cm';
}

export function mountCustomize(hostEl, opts) {
  const fileMap = (opts && opts.fileMap) || {};
  const styleConfig = (opts && opts.styleConfig) || null;
  const cdnBase = (opts && opts.cdnBase != null) ? opts.cdnBase : (typeof window !== 'undefined' && window.openvgal_cdn_base) || '';
  // Deep clone the config so the editor has its own working copy.
  const working = JSON.parse(JSON.stringify((opts && opts.config) || {}));

  const DEFAULT_SIZE_CM = SIZE_BUCKETS.M;
  const SLIDER_MIN = SIZE_MIN_CM;
  const SLIDER_MAX = SIZE_MAX_CM;

  // Per-item view state; keyed by "<roomName>::<itemKey>".
  const rowState = {};
  // Track blob URLs for thumbnails so we can revoke on unmount.
  const blobUrls = [];
  // Track which DOM node represents which room name so we can decorate on relayout.
  const roomNodes = {};

  const accordion = hostEl.querySelector('[data-cz-accordion]');
  const roomTemplate = hostEl.querySelector('[data-cz-room-template]');
  const rowTemplate = hostEl.querySelector('[data-cz-row-template]');

  const galleryKeys = Object.keys(working).filter((k) => _isGalleryRoom(k, working[k]));

  // Build accordion entries.
  galleryKeys.forEach((roomName, roomIdx) => {
    const room = working[roomName];
    const itemKeys = Object.keys(room).filter((k) => _isImage(room[k]));
    if (itemKeys.length === 0) return;

    const roomNode = roomTemplate.content.firstElementChild.cloneNode(true);
    roomNode.querySelector('.cz-room-name').textContent = roomName;
    roomNode.querySelector('.cz-room-count').textContent = itemKeys.length + ' artwork' + (itemKeys.length === 1 ? '' : 's');

    const rowsContainer = roomNode.querySelector('.cz-rows');

    itemKeys.forEach((itemKey) => {
      const entry = room[itemKey];
      const stateKey = roomName + '::' + itemKey;
      const parsed = _parseMetadata(entry.metadata);
      const currentLongest = _currentLongestCm(entry);
      const initialSize = currentLongest > 0 ? currentLongest : DEFAULT_SIZE_CM;
      const state = {
        roomName,
        itemKey,
        title: parsed.title,
        subtitle: parsed.subtitle,
        sizeCm: initialSize,
        unit: 'cm',
        sizeDirty: false,
        textDirty: false
      };
      rowState[stateKey] = state;

      const rowNode = rowTemplate.content.firstElementChild.cloneNode(true);
      rowNode.dataset.stateKey = stateKey;

      const thumb = rowNode.querySelector('.cz-thumb');
      const file = fileMap[entry.resource];
      if (file) {
        const url = URL.createObjectURL(file);
        blobUrls.push(url);
        thumb.src = url;
      } else {
        thumb.style.background = 'color-mix(in oklab, var(--wood) 18%, transparent)';
      }
      thumb.alt = itemKey;

      rowNode.querySelector('.cz-filename').textContent = itemKey;

      const titleInput = rowNode.querySelector('.cz-title');
      const subtitleInput = rowNode.querySelector('.cz-subtitle');
      titleInput.value = state.title;
      subtitleInput.value = state.subtitle;

      titleInput.addEventListener('input', () => {
        state.title = titleInput.value;
        state.textDirty = true;
      });
      subtitleInput.addEventListener('input', () => {
        state.subtitle = subtitleInput.value;
        state.textDirty = true;
      });

      const slider = rowNode.querySelector('.cz-slider');
      slider.min = SLIDER_MIN;
      slider.max = SLIDER_MAX;
      slider.value = state.sizeCm;

      const readout = rowNode.querySelector('.cz-size-readout');
      const buckets = rowNode.querySelectorAll('.cz-bucket');
      const units = rowNode.querySelectorAll('.cz-unit');

      function refreshRow() {
        const dims = _aspectDims(entry, state.sizeCm);
        readout.textContent = _formatSize(dims.wCm, dims.hCm, state.unit);
        const bucket = _bucketForSize(state.sizeCm, SIZE_BUCKETS);
        buckets.forEach((b) => {
          b.classList.toggle('cz-active', b.dataset.size === bucket);
        });
        units.forEach((u) => {
          u.classList.toggle('cz-active', u.dataset.unit === state.unit);
        });
        if (Number(slider.value) !== Math.round(state.sizeCm)) {
          slider.value = Math.round(state.sizeCm);
        }
      }

      slider.addEventListener('input', () => {
        state.sizeCm = Number(slider.value);
        state.sizeDirty = true;
        refreshRow();
      });

      buckets.forEach((b) => {
        b.addEventListener('click', () => {
          const size = SIZE_BUCKETS[b.dataset.size];
          if (!size) return;
          state.sizeCm = size;
          state.sizeDirty = true;
          refreshRow();
        });
      });

      units.forEach((u) => {
        u.addEventListener('click', () => {
          state.unit = u.dataset.unit;
          refreshRow();
        });
      });

      refreshRow();
      rowsContainer.appendChild(rowNode);
    });

    // Accordion toggle: only one room open at a time.
    const toggle = roomNode.querySelector('.cz-room-toggle');
    toggle.addEventListener('click', () => {
      const wasOpen = roomNode.classList.contains('cz-open');
      accordion.querySelectorAll('.cz-room.cz-open').forEach((n) => {
        n.classList.remove('cz-open');
      });
      if (!wasOpen) roomNode.classList.add('cz-open');
    });

    // Default-open if there's only one room.
    if (galleryKeys.length === 1 || roomIdx === 0) {
      // Leave only the first one open by default; others closed.
      if (roomIdx === 0) roomNode.classList.add('cz-open');
    }

    // Batch operations for this room.
    const batchTitle = roomNode.querySelector('.cz-batch-title');
    const batchSubtitle = roomNode.querySelector('.cz-batch-subtitle');
    const allRowNodes = () => rowsContainer.querySelectorAll('.cz-row');

    roomNode.querySelector('[data-batch-apply-prefix]').addEventListener('click', () => {
      const prefix = batchTitle.value;
      if (!prefix) return;
      allRowNodes().forEach((rn) => {
        const s = rowState[rn.dataset.stateKey];
        const titleInput = rn.querySelector('.cz-title');
        s.title = (prefix + (s.title || '')).trim();
        s.textDirty = true;
        titleInput.value = s.title;
      });
    });

    roomNode.querySelector('[data-batch-apply-subtitle]').addEventListener('click', () => {
      const sub = batchSubtitle.value;
      allRowNodes().forEach((rn) => {
        const s = rowState[rn.dataset.stateKey];
        const subInput = rn.querySelector('.cz-subtitle');
        s.subtitle = sub;
        s.textDirty = true;
        subInput.value = sub;
      });
    });

    roomNode.querySelectorAll('[data-batch-size]').forEach((btn) => {
      const sizeKey = btn.dataset.batchSize;
      btn.addEventListener('click', () => {
        const cm = SIZE_BUCKETS[sizeKey];
        if (!cm) return;
        roomNode.querySelectorAll('[data-batch-size]').forEach((b) => {
          b.classList.toggle('cz-active', b === btn);
        });
        allRowNodes().forEach((rn) => {
          const s = rowState[rn.dataset.stateKey];
          s.sizeCm = cm;
          s.sizeDirty = true;
          const slider = rn.querySelector('.cz-slider');
          slider.value = cm;
          slider.dispatchEvent(new Event('input'));
        });
      });
    });

    roomNode.querySelectorAll('[data-batch-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const unit = btn.dataset.batchUnit;
        roomNode.querySelectorAll('[data-batch-unit]').forEach((b) => {
          b.classList.toggle('cz-active', b === btn);
        });
        allRowNodes().forEach((rn) => {
          const s = rowState[rn.dataset.stateKey];
          s.unit = unit;
          // Trigger refresh by clicking the matching unit button.
          const target = rn.querySelector('.cz-unit[data-unit="' + unit + '"]');
          if (target) target.click();
        });
      });
    });

    accordion.appendChild(roomNode);
    roomNodes[roomName] = roomNode;
  });

  let cancelled = false;
  let busy = false;

  // Commit text + size edits from row state into the working JSON.
  // Returns true if any size changed (callers use this to decide whether to relayout).
  function commitEditsToWorking() {
    let sizesChanged = false;
    galleryKeys.forEach((roomName) => {
      const room = working[roomName];
      if (!room) return;
      Object.keys(room).filter((k) => _isImage(room[k])).forEach((itemKey) => {
        const stateKey = roomName + '::' + itemKey;
        const s = rowState[stateKey];
        if (!s) return;
        const entry = room[itemKey];
        if (!entry) return;
        if (s.textDirty) {
          entry.metadata = _composeMetadata(entry.metadata, s.title, s.subtitle);
          s.textDirty = false;
        }
        if (s.sizeDirty) {
          const dims = _aspectDims(entry, s.sizeCm);
          entry.width = dims.wCm.toFixed(2);
          entry.height = dims.hCm.toFixed(2);
          s.sizeDirty = false;
          sizesChanged = true;
        }
      });
    });
    return sizesChanged;
  }

  function _decorateShape(roomName, shape) {
    const node = roomNodes[roomName];
    if (!node) return;
    const badge = node.querySelector('.cz-room-shape');
    if (!badge) return;
    badge.textContent = 'shape: ' + shape;
    node.classList.add('cz-shape-changed');
  }
  function _clearShapeBadges() {
    Object.values(roomNodes).forEach((n) => n.classList.remove('cz-shape-changed'));
  }

  function _setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'cz-status' + (kind ? ' cz-status-' + kind : '');
  }

  // Re-layout every gallery room in `working`. Mutates `working` in place.
  // Handles shape escalation + overflow split. Returns a summary string for status display.
  async function applyRelayout() {
    if (!styleConfig) {
      throw new Error('No style configured for re-layout');
    }
    // gallery-generator.js is loaded via a <script> tag from the host page, so its
    // top-level declarations are global — pull the helper off window.
    if (typeof window === 'undefined' || typeof window.relayoutRoom !== 'function') {
      throw new Error('relayoutRoom not available — gallery-generator.js must load before customize');
    }
    const relayoutRoom = window.relayoutRoom;

    // Snapshot existing parent/child structure once.
    const allKeys = Object.keys(working).filter((k) =>
      k !== 'Technical' && k !== 'root' && working[k] && working[k].parent
    );
    const childrenMap = {};
    allKeys.forEach((k) => {
      const p = working[k].parent;
      if (!childrenMap[p]) childrenMap[p] = [];
      childrenMap[p].push(k);
    });

    _clearShapeBadges();

    let updatedRooms = 0, escalated = 0, overflowed = 0;

    for (const roomName of allKeys) {
      const room = working[roomName];
      if (!room) continue;
      const itemKeys = Object.keys(room).filter((k) => _isImage(room[k]));
      if (itemKeys.length === 0) continue;

      // Snapshot entries before mutating, in case overflow needs the originals.
      const roomEntries = itemKeys.map((k) => ({ key: k, entry: room[k] }));
      const snapshotEntries = itemKeys.map((k) => ({ key: k, entry: Object.assign({}, room[k]) }));

      let result;
      try {
        result = await relayoutRoom(roomEntries, styleConfig, null, { cdnBase });
      } catch (e) {
        console.error('Relayout failed for room "' + roomName + '":', e);
        _setStatus('Relayout failed for "' + roomName + '": ' + e.message, 'error');
        continue;
      }

      const originalTemplate = room.template;

      if (result.length === 1) {
        const r = result[0];
        room.template = r.glbName;
        r.items.forEach((it) => {
          const e = room[it.key];
          if (e) { e.location = it.location; e.vector = it.vector; }
        });
        updatedRooms++;
        if (r.glbName !== originalTemplate) {
          _decorateShape(roomName, r.shape);
          escalated++;
        }
        continue;
      }

      // Overflow: split. First result keeps roomName; the rest become new rooms
      // chained between this room and its first existing child.
      const firstR = result[0];
      const newNames = [];
      for (let i = 1; i < result.length; i++) {
        let candidate = roomName + '#R' + i;
        let suffix = 0;
        while (working[candidate] || newNames.indexOf(candidate) !== -1) {
          suffix++;
          candidate = roomName + '#R' + i + '_' + suffix;
        }
        newNames.push(candidate);
      }

      // Mark items that move out so we can delete them from the original room.
      const keysMovingOut = new Set();
      for (let i = 1; i < result.length; i++) {
        result[i].items.forEach((it) => keysMovingOut.add(it.key));
      }

      // Update first room in place.
      room.template = firstR.glbName;
      firstR.items.forEach((it) => {
        const e = room[it.key];
        if (e) { e.location = it.location; e.vector = it.vector; }
      });
      keysMovingOut.forEach((k) => { delete room[k]; });

      // Re-wire to original first child via the new tail.
      const originalFirstChild = (childrenMap[roomName] || [])[0];

      let prevName = roomName;
      for (let i = 1; i < result.length; i++) {
        const r = result[i];
        const newName = newNames[i - 1];
        const newRoom = {
          parent: prevName,
          resource: newName + '.glb',
          template: r.glbName
        };
        r.items.forEach((it) => {
          const snap = snapshotEntries.find((se) => se.key === it.key);
          if (!snap) return;
          const cloned = Object.assign({}, snap.entry);
          cloned.location = it.location;
          cloned.vector = it.vector;
          newRoom[it.key] = cloned;
        });
        // Doors prev ↔ new
        working[prevName][newName] = { resource: newName + '.glb', resource_type: 'door' };
        newRoom[prevName] = { resource: prevName + '.glb', resource_type: 'door' };
        working[newName] = newRoom;
        prevName = newName;
      }

      // If original room had a downstream child, splice the chain in front of it.
      if (originalFirstChild && working[originalFirstChild] && originalFirstChild !== roomName) {
        delete room[originalFirstChild];
        delete working[originalFirstChild][roomName];
        working[prevName][originalFirstChild] = { resource: originalFirstChild + '.glb', resource_type: 'door' };
        working[originalFirstChild][prevName] = { resource: prevName + '.glb', resource_type: 'door' };
        working[originalFirstChild].parent = prevName;
      }

      _decorateShape(roomName, firstR.shape + ' (split into ' + result.length + ')');
      overflowed++;
      updatedRooms++;
    }

    const parts = [];
    parts.push('Re-laid out ' + updatedRooms + ' room' + (updatedRooms === 1 ? '' : 's'));
    if (escalated)  parts.push(escalated  + ' escalated');
    if (overflowed) parts.push(overflowed + ' split into overflow');
    return parts.join(' — ');
  }

  function getEdited() {
    if (cancelled) return JSON.parse(JSON.stringify((opts && opts.config) || {}));
    commitEditsToWorking();
    return working;
  }

  function unmount() {
    blobUrls.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.length = 0;
    hostEl.innerHTML = '';
  }

  // Wire toolbar buttons. Apply/Cancel appear in both the top header and the
  // footer; both copies share the same handlers via querySelectorAll. Apply
  // commits edits, optionally relayouts, then closes the editor (host wires
  // the close via onApply). Cancel discards and closes.
  const cancelBtns = hostEl.querySelectorAll('[data-cz-cancel]');
  const applyBtns  = hostEl.querySelectorAll('[data-cz-apply]');
  const statusEl   = hostEl.querySelector('[data-cz-status]');

  function _setApplyBtnsDisabled(disabled) {
    applyBtns.forEach((b) => { b.disabled = disabled; });
  }

  async function _doApply() {
    if (busy) return false;
    busy = true;
    _setApplyBtnsDisabled(true);
    _setStatus('Applying…', 'busy');
    try {
      const sizesChanged = commitEditsToWorking();
      if (sizesChanged && styleConfig) {
        const summary = await applyRelayout();
        _setStatus(summary, 'ok');
      } else if (sizesChanged) {
        _setStatus('Sizes committed (relayout skipped — no style configured).', 'ok');
      } else {
        _setStatus('Edits committed.', 'ok');
      }
      return true;
    } catch (e) {
      console.error(e);
      _setStatus('Apply failed: ' + e.message, 'error');
      return false;
    } finally {
      busy = false;
      _setApplyBtnsDisabled(false);
    }
  }

  function onApply(cb) {
    applyBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await _doApply();
        if (ok) cb();
      });
    });
  }
  function onCancel(cb) {
    cancelBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        cancelled = true;
        cb();
      });
    });
  }

  return { unmount, getEdited, onApply, onCancel };
}
