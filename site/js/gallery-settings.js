/**
 * OpenVGAL Gallery Settings Panel
 * Shared module consumed by create/index.html (both standard and ?cdn=1 modes).
 */
var GallerySettings = (function() {
  var _mounted = false;
  var _state = {
    show_plaques: false
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
      '  color: #d4d4d8;',
      '  font-weight: 500;',
      '}',
      '.gs-toggle-hint {',
      '  font-size: 0.72rem;',
      '  color: #71717a;',
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
      '  background: rgba(255,255,255,0.08);',
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

    // show_plaques toggle
    var row = document.createElement('div');
    row.className = 'gs-toggle-row';

    var labelDiv = document.createElement('div');
    labelDiv.innerHTML = '<div class="gs-toggle-label">Show artwork plaques</div>' +
      '<div class="gs-toggle-hint">Display title and subtitle labels below each artwork</div>';

    var switchLabel = document.createElement('label');
    switchLabel.className = 'gs-switch';
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'gs-show-plaques';
    checkbox.checked = _state.show_plaques;
    checkbox.addEventListener('change', function() {
      _state.show_plaques = this.checked;
    });
    var slider = document.createElement('span');
    slider.className = 'gs-slider';
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(slider);

    row.appendChild(labelDiv);
    row.appendChild(switchLabel);

    section.appendChild(header);
    section.appendChild(row);
    containerEl.appendChild(section);
    _mounted = true;
  }

  function load(technicalObj) {
    if (!technicalObj) return;
    _state.show_plaques = technicalObj.show_plaques !== false;
    var cb = document.getElementById('gs-show-plaques');
    if (cb) cb.checked = _state.show_plaques;
  }

  function getValues() {
    return {
      show_plaques: _state.show_plaques
    };
  }

  return {
    mount: mount,
    load: load,
    getValues: getValues
  };
})();
