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
  // root#N are overflow hub rooms (no artwork), not editable galleries.
  if (key === 'Technical' || /^root(#\d+)?$/.test(key)) return false;
  return value && typeof value === 'object' && value.parent;
}

// Info field limits (docs/gallery-json.md § Metadata). Same values as
// METADATA_MAX_FIELDS / METADATA_MAX_CHARS in room_builder_aux.js.
const MAX_INFO_FIELDS = 5;
const MAX_LABEL_CHARS = 24;
const MAX_ARTWORK_CHARS = 2000;
const DEFAULT_INFO_FIELDS = [{ id: 'f1', label: 'Description' }];

// Code points, as the docs count them.
function _cp(s) {
  return Array.from(s || '').length;
}
function _truncateCp(s, max) {
  const chars = Array.from(s || '');
  return chars.length > max ? chars.slice(0, Math.max(0, max)).join('') : s;
}

// Parse current metadata into { title, subtitle, fields }, using the same
// rules as readArtworkMetadata in room_builder_aux.js but without its display
// clamping, so the editor sees the stored text.
// Format produced by gallery-generator.js: "ID #N <baseName>"
// Plaque builder splits on \n: line 1 = title, line 2 = subtitle.
function _parseMetadata(metadata) {
  if (!metadata) return { title: '', subtitle: '', fields: {} };
  if (typeof metadata === 'object') {
    const fields = {};
    if (metadata.fields && typeof metadata.fields === 'object') {
      Object.keys(metadata.fields).forEach((id) => {
        if (typeof metadata.fields[id] === 'string') fields[id] = metadata.fields[id];
      });
    }
    return {
      title: typeof metadata.title === 'string' ? metadata.title : '',
      subtitle: typeof metadata.subtitle === 'string' ? metadata.subtitle : '',
      fields,
    };
  }
  const stripped = String(metadata).replace(/^ID\s*#\d+\s*/, '');
  const lines = stripped.split('\n');
  return { title: lines[0] || '', subtitle: lines[1] || '', fields: {} };
}

// Writes the string form when no field has a value, the object form otherwise.
// `values` maps listed field ids to their edited text; `removedIds` are fields
// deleted from the gallery. Unknown object keys and unlisted ids are kept.
function _composeMetadata(originalMetadata, title, subtitle, values, removedIds) {
  const isObject = originalMetadata && typeof originalMetadata === 'object';
  const fields = {};
  if (isObject && originalMetadata.fields && typeof originalMetadata.fields === 'object') {
    Object.assign(fields, originalMetadata.fields);
  }
  (removedIds || []).forEach((id) => { delete fields[id]; });
  Object.keys(values || {}).forEach((id) => {
    const v = (values[id] || '').trim();
    if (v) fields[id] = v;
    else delete fields[id];
  });
  const hasValue = Object.keys(fields).some((id) => typeof fields[id] === 'string' && fields[id].trim());
  const hasUnknownKeys = isObject &&
    Object.keys(originalMetadata).some((k) => k !== 'title' && k !== 'subtitle' && k !== 'fields');

  if (hasValue || hasUnknownKeys) {
    const out = Object.assign({}, isObject ? originalMetadata : {}, {
      title: (title || '').trim(),
      subtitle: (subtitle || '').trim(),
    });
    if (Object.keys(fields).length) out.fields = fields;
    else delete out.fields;
    return out;
  }
  if (isObject) {
    const t = (title || '').trim();
    const s = (subtitle || '').trim();
    return s ? t + '\n' + s : t;
  }
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

  // Gallery-level info fields. Technical.info_fields is only written back when
  // the gallery already had it, the list was edited, or some artwork has a value,
  // so a gallery that never uses info fields exports exactly as before.
  const technical = working.Technical && typeof working.Technical === 'object' ? working.Technical : null;
  const hadInfoFields = !!(technical && Array.isArray(technical.info_fields));
  const infoFields = (hadInfoFields ? technical.info_fields : DEFAULT_INFO_FIELDS)
    .filter((f) => f && typeof f.id === 'string' && typeof f.label === 'string')
    .slice(0, MAX_INFO_FIELDS)
    .map((f) => ({ id: f.id, label: f.label }));
  let infoFieldsDirty = false;
  const removedFieldIds = [];
  // Highest fN seen in the list or in any artwork's values; new ids go above it.
  let lastFieldNum = 0;
  function _noteFieldId(id) {
    const m = /^f(\d+)$/.exec(id);
    if (m) lastFieldNum = Math.max(lastFieldNum, Number(m[1]));
  }
  infoFields.forEach((f) => _noteFieldId(f.id));
  galleryKeys.forEach((roomName) => {
    const room = working[roomName];
    Object.keys(room).filter((k) => _isImage(room[k])).forEach((k) => {
      Object.keys(_parseMetadata(room[k].metadata).fields).forEach(_noteFieldId);
    });
  });

  // Row/room renderers that depend on the field list; re-run after list edits.
  const fieldListeners = [];
  function _fieldsChanged() {
    infoFieldsDirty = true;
    renderFieldList();
    fieldListeners.forEach((fn) => fn());
  }

  function _filledText(s) {
    return typeof s === 'string' && s.trim() !== '';
  }
  function _artworkChars(state) {
    let n = _cp(state.title) + _cp(state.subtitle);
    infoFields.forEach((f) => { n += _cp(state.values[f.id]); });
    return n;
  }

  const fieldsList = hostEl.querySelector('[data-cz-fields-list]');
  const fieldTemplate = hostEl.querySelector('[data-cz-field-template]');
  const addFieldBtn = hostEl.querySelector('[data-cz-add-field]');

  function renderFieldList() {
    fieldsList.innerHTML = '';
    infoFields.forEach((field, idx) => {
      const node = fieldTemplate.content.firstElementChild.cloneNode(true);
      const labelInput = node.querySelector('.cz-field-label');
      labelInput.maxLength = MAX_LABEL_CHARS;
      labelInput.value = field.label;
      labelInput.addEventListener('input', () => {
        field.label = labelInput.value;
        infoFieldsDirty = true;
        fieldListeners.forEach((fn) => fn());
      });
      labelInput.addEventListener('change', () => {
        if (!labelInput.value.trim()) {
          field.label = 'Field';
          labelInput.value = field.label;
        } else {
          field.label = labelInput.value.trim();
        }
        fieldListeners.forEach((fn) => fn());
      });

      const up = node.querySelector('[data-field-up]');
      const down = node.querySelector('[data-field-down]');
      up.disabled = idx === 0;
      down.disabled = idx === infoFields.length - 1;
      up.addEventListener('click', () => {
        infoFields.splice(idx - 1, 0, infoFields.splice(idx, 1)[0]);
        _fieldsChanged();
      });
      down.addEventListener('click', () => {
        infoFields.splice(idx + 1, 0, infoFields.splice(idx, 1)[0]);
        _fieldsChanged();
      });

      const confirmEl = node.querySelector('[data-field-confirm]');
      const removeField = () => {
        Object.values(rowState).forEach((s) => {
          if (s.values[field.id] !== undefined) {
            delete s.values[field.id];
            s.textDirty = true;
          }
        });
        removedFieldIds.push(field.id);
        infoFields.splice(infoFields.indexOf(field), 1);
        _fieldsChanged();
      };
      node.querySelector('[data-field-delete]').addEventListener('click', () => {
        const withValue = Object.values(rowState).filter((s) => _filledText(s.values[field.id])).length;
        if (!withValue) { removeField(); return; }
        node.querySelector('[data-field-confirm-text]').textContent =
          'Delete "' + field.label + '" and its ' + withValue + ' value' + (withValue === 1 ? '' : 's') + '?';
        confirmEl.hidden = false;
      });
      node.querySelector('[data-field-confirm-yes]').addEventListener('click', removeField);
      node.querySelector('[data-field-confirm-no]').addEventListener('click', () => { confirmEl.hidden = true; });

      fieldsList.appendChild(node);
    });
    addFieldBtn.disabled = infoFields.length >= MAX_INFO_FIELDS;
  }

  addFieldBtn.addEventListener('click', () => {
    if (infoFields.length >= MAX_INFO_FIELDS) return;
    lastFieldNum++;
    infoFields.push({ id: 'f' + lastFieldNum, label: 'Field ' + (infoFields.length + 1) });
    _fieldsChanged();
    const inputs = fieldsList.querySelectorAll('.cz-field-label');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });

  function _autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  renderFieldList();

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
        values: parsed.fields,
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

      // Info disclosure: summary counts filled fields and the shared budget.
      const info = rowNode.querySelector('.cz-info');
      const infoCount = rowNode.querySelector('.cz-info-count');
      const infoBudget = rowNode.querySelector('.cz-info-budget');
      const infoBody = rowNode.querySelector('.cz-info-body');

      function refreshInfoSummary() {
        const filled = infoFields.filter((f) => _filledText(state.values[f.id])).length;
        infoCount.textContent = filled + ' of ' + infoFields.length + ' filled';
        infoBudget.textContent = _artworkChars(state).toLocaleString('en-US') + ' / ' +
          MAX_ARTWORK_CHARS.toLocaleString('en-US');
      }
      // Caps an edit at what the rest of this artwork's text leaves free.
      function capToBudget(el, current) {
        const room = MAX_ARTWORK_CHARS - (_artworkChars(state) - _cp(current));
        const capped = _truncateCp(el.value, room);
        if (capped !== el.value) el.value = capped;
        return capped;
      }

      function renderInfoFields() {
        infoBody.innerHTML = '';
        infoFields.forEach((field) => {
          const wrap = document.createElement('div');
          wrap.className = 'cz-info-field';
          const label = document.createElement('label');
          label.textContent = field.label;
          const ta = document.createElement('textarea');
          ta.rows = 1;
          ta.value = state.values[field.id] || '';
          ta.addEventListener('input', () => {
            state.values[field.id] = capToBudget(ta, state.values[field.id]);
            state.textDirty = true;
            _autoGrow(ta);
            refreshInfoSummary();
          });
          wrap.appendChild(label);
          wrap.appendChild(ta);
          infoBody.appendChild(wrap);
        });
        if (info.open) infoBody.querySelectorAll('textarea').forEach(_autoGrow);
        refreshInfoSummary();
      }
      info.addEventListener('toggle', () => {
        if (info.open) infoBody.querySelectorAll('textarea').forEach(_autoGrow);
      });
      renderInfoFields();
      fieldListeners.push(renderInfoFields);
      state.renderInfo = renderInfoFields;

      titleInput.addEventListener('input', () => {
        state.title = capToBudget(titleInput, state.title);
        state.textDirty = true;
        refreshInfoSummary();
      });
      subtitleInput.addEventListener('input', () => {
        state.subtitle = capToBudget(subtitleInput, state.subtitle);
        state.textDirty = true;
        refreshInfoSummary();
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
        const room = MAX_ARTWORK_CHARS - (_artworkChars(s) - _cp(s.title));
        s.title = _truncateCp((prefix + (s.title || '')).trim(), room);
        s.textDirty = true;
        titleInput.value = s.title;
        s.renderInfo();
      });
    });

    roomNode.querySelector('[data-batch-apply-subtitle]').addEventListener('click', () => {
      const sub = batchSubtitle.value;
      allRowNodes().forEach((rn) => {
        const s = rowState[rn.dataset.stateKey];
        const subInput = rn.querySelector('.cz-subtitle');
        const room = MAX_ARTWORK_CHARS - (_artworkChars(s) - _cp(s.subtitle));
        s.subtitle = _truncateCp(sub, room);
        s.textDirty = true;
        subInput.value = s.subtitle;
        s.renderInfo();
      });
    });

    // Batch info field: copy one value into every artwork of this room.
    const batchField = roomNode.querySelector('.cz-batch-field');
    const batchFieldValue = roomNode.querySelector('.cz-batch-field-value');
    const batchFieldApply = roomNode.querySelector('[data-batch-apply-field]');
    const batchFieldResult = roomNode.querySelector('[data-batch-field-result]');
    const batchFieldConfirm = roomNode.querySelector('[data-batch-field-confirm]');

    function renderBatchField() {
      const selected = batchField.value;
      batchField.innerHTML = '';
      infoFields.forEach((f) => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.label;
        batchField.appendChild(opt);
      });
      if (infoFields.some((f) => f.id === selected)) batchField.value = selected;
      refreshBatchFieldButton();
    }
    function refreshBatchFieldButton() {
      const field = infoFields.find((f) => f.id === batchField.value);
      batchFieldApply.textContent = field ? 'Apply ' + field.label : 'Apply';
      batchFieldApply.disabled = !field || !batchFieldValue.value.trim();
      batchFieldConfirm.hidden = true;
    }
    batchField.addEventListener('change', refreshBatchFieldButton);
    batchFieldValue.addEventListener('input', () => {
      _autoGrow(batchFieldValue);
      refreshBatchFieldButton();
    });
    renderBatchField();
    fieldListeners.push(renderBatchField);

    function applyBatchField() {
      const id = batchField.value;
      const value = batchFieldValue.value;
      let copied = 0, skipped = 0;
      allRowNodes().forEach((rn) => {
        const s = rowState[rn.dataset.stateKey];
        if (_artworkChars(s) - _cp(s.values[id]) + _cp(value) > MAX_ARTWORK_CHARS) {
          skipped++;
          return;
        }
        s.values[id] = value;
        s.textDirty = true;
        s.renderInfo();
        copied++;
      });
      batchFieldConfirm.hidden = true;
      batchFieldResult.textContent = 'Copied to ' + copied + ' artwork' + (copied === 1 ? '' : 's') +
        (skipped ? ', skipped ' + skipped + ' over 2,000 characters' : '') + '.';
    }
    batchFieldApply.addEventListener('click', () => {
      const id = batchField.value;
      const value = batchFieldValue.value;
      if (!id || !value.trim()) return;
      batchFieldResult.textContent = '';
      const different = Array.from(allRowNodes()).filter((rn) => {
        const v = rowState[rn.dataset.stateKey].values[id];
        return _filledText(v) && v !== value;
      }).length;
      if (!different) { applyBatchField(); return; }
      roomNode.querySelector('[data-batch-field-confirm-text]').textContent =
        'Replace ' + different + ' different value' + (different === 1 ? '' : 's') + '?';
      batchFieldConfirm.hidden = false;
    });
    roomNode.querySelector('[data-batch-field-confirm-yes]').addEventListener('click', applyBatchField);
    roomNode.querySelector('[data-batch-field-confirm-no]').addEventListener('click', () => {
      batchFieldConfirm.hidden = true;
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
    const anyValue = Object.values(rowState).some((s) =>
      infoFields.some((f) => _filledText(s.values[f.id])));
    if (technical && (hadInfoFields || infoFieldsDirty || anyValue)) {
      technical.info_fields = infoFields.map((f) => ({ id: f.id, label: f.label.trim() || 'Field' }));
    }
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
          const listed = {};
          infoFields.forEach((f) => {
            if (s.values[f.id] !== undefined) listed[f.id] = s.values[f.id];
          });
          entry.metadata = _composeMetadata(entry.metadata, s.title, s.subtitle, listed, removedFieldIds);
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
