/**
 * OpenVGAL Gallery Settings Panel
 * Shared module consumed by create/index.html (both standard and ?cdn=1 modes).
 */
var GallerySettings = (function() {
  var _mounted = false;
  var _rows = {};
  var _state = {
    show_plaques: false,
    show_frames: true,
    skip_hub: false
  };

  function _injectStyles() {
    if (document.getElementById('gallery-settings-css')) return;
    var style = document.createElement('style');
    style.id = 'gallery-settings-css';
    style.textContent = [
      '.gs-toggle-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  padding: 0.5rem 0;',
      '}',
      '.gs-toggle-label {',
      '  font-size: 0.82rem;',
      '  color: var(--ink, #18181b);',
      '  font-weight: 500;',
      '}',
      '.gs-toggle-row.gs-disabled {',
      '  opacity: 0.45;',
      '}',
      '.gs-toggle-row.gs-disabled .gs-slider {',
      '  cursor: not-allowed;',
      '}',
      '.gs-toggle-hint {',
      '  font-size: 0.72rem;',
      '  color: var(--ink-3, #71717a);',
      '  margin-top: 0.15rem;',
      '}',
      '.gs-switch {',
      '  position: relative;',
      '  width: 36px;',
      '  height: 20px;',
      '  flex-shrink: 0;',
      '}',
      '.gs-switch input {',
      '  opacity: 0;',
      '  width: 0;',
      '  height: 0;',
      '}',
      '.gs-switch .gs-slider {',
      '  position: absolute;',
      '  cursor: pointer;',
      '  top: 0; left: 0; right: 0; bottom: 0;',
      '  background: var(--rule, #d4d4d8);',
      '  border-radius: 20px;',
      '  transition: background 0.2s;',
      '}',
      '.gs-switch .gs-slider::before {',
      '  content: "";',
      '  position: absolute;',
      '  height: 14px;',
      '  width: 14px;',
      '  left: 3px;',
      '  bottom: 3px;',
      '  background: #71717a;',
      '  border-radius: 50%;',
      '  transition: transform 0.2s, background 0.2s;',
      '}',
      '.gs-switch input:checked + .gs-slider {',
      '  background: color-mix(in oklab, oklch(0.78 0.065 68) 38%, transparent);',
      '}',
      '.gs-switch input:checked + .gs-slider::before {',
      '  transform: translateX(16px);',
      '  background: oklch(0.78 0.065 68);',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function mount(containerEl) {
    if (!containerEl) return;
    _injectStyles();

    containerEl.innerHTML = '';
    _rows = {};

    var section = document.createElement('div');
    section.className = 'section';

    var header = document.createElement('div');
    header.className = 'section-header';
    header.innerHTML = '<span class="step-badge">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">' +
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>' +
      '</svg></span>' +
      '<span class="section-title">Gallery settings</span>';

    section.appendChild(header);
    section.appendChild(_toggleRow('gs-show-plaques', 'show_plaques',
      'Show artwork plaques',
      'Display title and subtitle labels below each artwork'));
    section.appendChild(_toggleRow('gs-show-frames', 'show_frames',
      'Show artwork frames',
      'Add a frame around each artwork; off mounts the image flush at its own size'));
    section.appendChild(_toggleRow('gs-skip-hub', 'skip_hub',
      'Skip the entrance hall',
      'Open straight into the gallery. Single folder only, and the brand sign in the hall goes with it'));
    containerEl.appendChild(section);
    _mounted = true;
  }

  function _toggleRow(id, key, label, hint) {
    var row = document.createElement('div');
    row.className = 'gs-toggle-row';

    var labelDiv = document.createElement('div');
    labelDiv.innerHTML = '<div class="gs-toggle-label">' + label + '</div>' +
      '<div class="gs-toggle-hint">' + hint + '</div>';

    var switchLabel = document.createElement('label');
    switchLabel.className = 'gs-switch';
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.checked = _state[key];
    checkbox.addEventListener('change', function() {
      _state[key] = this.checked;
    });
    var slider = document.createElement('span');
    slider.className = 'gs-slider';
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(slider);

    row.appendChild(labelDiv);
    row.appendChild(switchLabel);
    _rows[key] = { row: row, checkbox: checkbox };
    return row;
  }

  // The hub-less layout only has a meaning for a single folder, so the host page
  // greys the switch out the rest of the time. The generator gates on the folder
  // count too — this is the visible half of that rule, not the enforcing one.
  function setAvailable(key, available) {
    var entry = _rows[key];
    if (!entry) return;
    entry.row.classList.toggle('gs-disabled', !available);
    entry.checkbox.disabled = !available;
  }

  function load(technicalObj) {
    if (!technicalObj) return;
    _state.show_plaques = technicalObj.show_plaques !== false;
    _state.show_frames = technicalObj.show_frames !== false;
    _state.skip_hub = technicalObj.skip_hub === true;
    var cbP = document.getElementById('gs-show-plaques');
    if (cbP) cbP.checked = _state.show_plaques;
    var cbF = document.getElementById('gs-show-frames');
    if (cbF) cbF.checked = _state.show_frames;
    var cbH = document.getElementById('gs-skip-hub');
    if (cbH) cbH.checked = _state.skip_hub;
  }

  function getValues() {
    return {
      show_plaques: _state.show_plaques,
      show_frames: _state.show_frames,
      skip_hub: _state.skip_hub
    };
  }

  return {
    mount: mount,
    load: load,
    getValues: getValues,
    setAvailable: setAvailable
  };
})();
