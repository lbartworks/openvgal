/**
 * OpenVGAL Style Picker
 * One-slide carousel for selecting gallery styles: the visible slide is the
 * selected style. Swipe, arrows, name pills or arrow keys move between them.
 * Fetches catalog.json from CDN, renders slides from catalog.styles.
 */
var StylePicker = (function() {
  var _styles = null;
  var _catalog = null;
  var _selectedKey = 'classic';
  var _container = null;
  var _track = null;
  var _keys = [];
  var _index = 0;
  var _pills = [];
  var _prev = null;
  var _next = null;
  var _count = null;
  var _target = null; // slide a programmatic smooth scroll is heading to

  function _injectStyles() {
    if (document.getElementById('style-picker-css')) return;
    var style = document.createElement('style');
    style.id = 'style-picker-css';
    style.textContent = [
      '.sp-wrapper { width: 100%; margin-bottom: 1.5rem; }',

      '.sp-row { display: flex; align-items: center; justify-content: center; gap: 16px; }',
      '.sp-stage {',
      '  flex: 1 1 auto; min-width: 0; max-width: 500px;',
      '  position: relative; border-radius: var(--radius-card, 12px); overflow: hidden;',
      '  border: 1px solid var(--rule, #e5e5e5); background: var(--paper-2, #f4f4f5);',
      '}',
      '.sp-track {',
      '  display: flex; overflow-x: auto; scroll-snap-type: x mandatory;',
      '  scrollbar-width: none; outline: none;',
      '  -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain;',
      '}',
      '.sp-track::-webkit-scrollbar { display: none; }',
      '.sp-track:focus-visible + .sp-focus { opacity: 1; }',
      '.sp-focus {',
      '  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;',
      '  box-shadow: inset 0 0 0 2px var(--wood-deep, #a1887f); opacity: 0;',
      '}',

      /* Slides */
      '.sp-slide {',
      '  position: relative; flex: 0 0 100%; scroll-snap-align: center;',
      '  scroll-snap-stop: always; aspect-ratio: 16/9; background: var(--paper-2, #f4f4f5);',
      '}',
      '.sp-slide img {',
      '  width: 100%; height: 100%; object-fit: cover; display: block;',
      '  user-select: none; -webkit-user-drag: none;',
      '}',
      '.sp-placeholder {',
      '  width: 100%; height: 100%; display: flex;',
      '  align-items: center; justify-content: center;',
      '  font-size: 0.7rem; color: var(--ink-3, #71717a); font-weight: 500;',
      '  letter-spacing: 0.05em; text-transform: uppercase;',
      '}',
      '.sp-caption {',
      '  position: absolute; left: 0; right: 0; bottom: 0;',
      '  padding: 48px 22px 18px; pointer-events: none;',
      '  background: linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0.45) 55%, transparent);',
      '}',
      '.sp-name { font-size: 1.15rem; font-weight: 600; color: #fafafa; letter-spacing: -0.01em; }',
      '.sp-desc { font-size: 0.8rem; color: #d4d4d8; line-height: 1.4; margin-top: 2px; }',
      '.sp-tag {',
      '  display: inline-block; margin-top: 8px;',
      '  font-size: 0.65rem; font-weight: 500; color: #d4d4d8;',
      '  background: rgba(255,255,255,0.12); padding: 2px 8px; border-radius: 999px;',
      '  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);',
      '}',
      '.sp-count {',
      '  position: absolute; top: 12px; right: 12px; z-index: 2;',
      '  font-size: 0.7rem; font-weight: 500; color: #d4d4d8;',
      '  font-variant-numeric: tabular-nums; padding: 3px 9px; border-radius: 999px;',
      '  background: rgba(0,0,0,0.5); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);',
      '}',

      /* Arrows */
      '.sp-arrow {',
      '  flex: 0 0 auto; width: 44px; height: 44px; border-radius: 50%;',
      '  border: 1px solid var(--rule, #e5e5e5); background: var(--room, #fff);',
      '  color: var(--ink-2, #3f3f46); cursor: pointer; display: flex; align-items: center;',
      '  justify-content: center; box-shadow: 0 2px 8px -4px oklch(0.16 0.01 270 / 0.25);',
      '  transition: color 0.2s, border-color 0.2s, opacity 0.2s, transform 0.2s;',
      '}',
      '.sp-arrow:hover { color: var(--ink, #111); border-color: var(--wood-deep, #a1887f); transform: scale(1.06); }',
      '.sp-arrow:focus-visible { outline: 2px solid var(--wood, #d6b48a); outline-offset: 2px; }',
      '.sp-arrow:disabled { opacity: 0; pointer-events: none; }',
      '.sp-arrow svg { width: 18px; height: 18px; }',

      /* Name pills */
      '.sp-pills {',
      '  display: flex; flex-wrap: wrap; justify-content: center; gap: 6px;',
      '  margin-top: 12px;',
      '}',
      '.sp-pill {',
      '  font: inherit; font-size: 0.75rem; font-weight: 500; color: var(--ink-3, #71717a);',
      '  background: transparent; border: 1px solid var(--rule-soft, #eee);',
      '  padding: 5px 12px; border-radius: 999px; cursor: pointer;',
      '  transition: color 0.2s, border-color 0.2s, background 0.2s;',
      '}',
      '.sp-pill:hover { color: var(--ink, #111); border-color: var(--rule, #e5e5e5); }',
      '.sp-pill:focus-visible { outline: 2px solid var(--wood-deep, #a1887f); outline-offset: 2px; }',
      '.sp-pill[aria-current="true"] {',
      '  color: var(--ink, #111); border-color: var(--wood-deep, #a1887f);',
      '  background: color-mix(in oklab, var(--wood, #d6b48a) 22%, transparent);',
      '}',

      '@media (max-width: 600px) {',
      '  .sp-caption { padding: 40px 16px 14px; }',
      '  .sp-row { gap: 8px; }',
      '  .sp-arrow { width: 32px; height: 32px; }',
      '  .sp-arrow svg { width: 15px; height: 15px; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function _placeholder(name) {
    var ph = document.createElement('div');
    ph.className = 'sp-placeholder';
    ph.textContent = name;
    return ph;
  }

  function _buildSlide(key, data, i, total) {
    var slide = document.createElement('div');
    slide.className = 'sp-slide';
    slide.dataset.style = key;
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', (i + 1) + ' of ' + total + ': ' + data.name);

    if (data.thumbnail) {
      var img = document.createElement('img');
      var cdnBase = window.openvgal_cdn_base || '';
      img.src = cdnBase + '/templates/' + data.thumbnail;
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.onerror = function() {
        slide.replaceChild(_placeholder(data.name), img);
      };
      slide.appendChild(img);
    } else {
      slide.appendChild(_placeholder(data.name));
    }

    var caption = document.createElement('div');
    caption.className = 'sp-caption';

    var name = document.createElement('div');
    name.className = 'sp-name';
    name.textContent = data.name;
    caption.appendChild(name);

    if (data.description) {
      var desc = document.createElement('div');
      desc.className = 'sp-desc';
      desc.textContent = data.description;
      caption.appendChild(desc);
    }

    var roomCount = data.glbs ? Object.keys(data.glbs).length : 0;
    var tag = document.createElement('span');
    tag.className = 'sp-tag';
    tag.textContent = roomCount + ' room type' + (roomCount !== 1 ? 's' : '');
    caption.appendChild(tag);

    slide.appendChild(caption);
    return slide;
  }

  function _arrow(side, label, points) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sp-arrow ' + side;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="' + points + '"/></svg>';
    return b;
  }

  // Reflect _index in the selection, pills, arrows and counter.
  function _setActive(i) {
    _index = i;
    _selectedKey = _keys[i];
    for (var p = 0; p < _pills.length; p++) {
      _pills[p].setAttribute('aria-current', p === i ? 'true' : 'false');
    }
    _prev.disabled = i === 0;
    _next.disabled = i === _keys.length - 1;
    _count.textContent = (i + 1) + ' / ' + _keys.length;
  }

  function _goTo(i, smooth) {
    i = Math.max(0, Math.min(_keys.length - 1, i));
    _setActive(i);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    smooth = smooth && !reduce;
    _target = smooth ? i : null;
    // Width is 0 while the container is hidden; the ResizeObserver realigns later.
    _track.scrollTo({ left: i * _track.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  }

  function _render() {
    if (!_container || !_styles) return;
    _injectStyles();
    _container.innerHTML = '';

    _keys = Object.keys(_styles);
    _index = Math.max(0, _keys.indexOf(_selectedKey));

    var wrapper = document.createElement('div');
    wrapper.className = 'sp-wrapper';
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-roledescription', 'carousel');
    wrapper.setAttribute('aria-label', 'Gallery style');

    var stage = document.createElement('div');
    stage.className = 'sp-stage';

    _track = document.createElement('div');
    _track.className = 'sp-track';
    _track.tabIndex = 0;
    for (var i = 0; i < _keys.length; i++) {
      _track.appendChild(_buildSlide(_keys[i], _styles[_keys[i]], i, _keys.length));
    }

    var focusRing = document.createElement('div');
    focusRing.className = 'sp-focus';

    _prev = _arrow('left', 'Previous style', '15 18 9 12 15 6');
    _next = _arrow('right', 'Next style', '9 18 15 12 9 6');
    _count = document.createElement('div');
    _count.className = 'sp-count';
    _count.setAttribute('aria-hidden', 'true');

    stage.appendChild(_track);
    stage.appendChild(focusRing);
    stage.appendChild(_count);

    var pills = document.createElement('div');
    pills.className = 'sp-pills';
    _pills = _keys.map(function(key, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sp-pill';
      b.textContent = _styles[key].name;
      b.addEventListener('click', function() { _goTo(idx, true); });
      pills.appendChild(b);
      return b;
    });

    var row = document.createElement('div');
    row.className = 'sp-row';
    row.appendChild(_prev);
    row.appendChild(stage);
    row.appendChild(_next);

    wrapper.appendChild(row);
    wrapper.appendChild(pills);
    _container.appendChild(wrapper);

    // Events
    _prev.addEventListener('click', function() { _goTo(_index - 1, true); });
    _next.addEventListener('click', function() { _goTo(_index + 1, true); });
    _track.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); _goTo(_index - 1, true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); _goTo(_index + 1, true); }
    });
    // Swipes and trackpad scrolls settle on a snapped slide; follow it.
    var pending = false;
    _track.addEventListener('scroll', function() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function() {
        pending = false;
        var w = _track.clientWidth;
        if (!w) return;
        var i = Math.round(_track.scrollLeft / w);
        // Don't flick through the slides a smooth jump passes over.
        if (_target !== null) {
          if (i === _target) _target = null;
          return;
        }
        if (i !== _index && i >= 0 && i < _keys.length) _setActive(i);
      });
    }, { passive: true });
    // A user gesture takes over from any jump still in flight.
    ['pointerdown', 'wheel', 'touchstart'].forEach(function(t) {
      _track.addEventListener(t, function() { _target = null; }, { passive: true });
    });
    // Keep the selected slide aligned when the width changes (resize, or the
    // container being shown again after the customize editor hid it).
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function() {
        _track.scrollTo({ left: _index * _track.clientWidth, behavior: 'auto' });
      }).observe(_track);
    }

    _goTo(_index, false);
  }

  function mount(containerEl, cdnBase) {
    if (!containerEl) return;
    _container = containerEl;

    var base = cdnBase || window.openvgal_cdn_base || '';
    var url = base + '/templates/catalog.json';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          _catalog = JSON.parse(xhr.responseText);
          _styles = _catalog.styles || {};
          // Fall back to first key if 'classic' isn't in the catalog.
          if (!_styles[_selectedKey]) {
            var firstKey = Object.keys(_styles)[0];
            if (firstKey) _selectedKey = firstKey;
          }
          _render();
        } catch (e) {
          console.warn('StylePicker: failed to parse catalog.json', e);
        }
      } else {
        console.warn('StylePicker: failed to fetch catalog.json (' + xhr.status + ')');
      }
    };
    xhr.onerror = function() {
      console.warn('StylePicker: network error fetching catalog.json');
    };
    xhr.send();
  }

  function getSelected() {
    if (!_styles || !_styles[_selectedKey]) return null;
    return { key: _selectedKey, config: _styles[_selectedKey] };
  }

  function getCatalog() {
    return _catalog;
  }

  function selectStyle(key) {
    if (!_styles || !_styles[key]) return;
    _selectedKey = key;
    if (_track) _goTo(_keys.indexOf(key), false);
  }

  // Thin wrapper over the pack definition's derivation, which is the single
  // implementation (it must also run headlessly, with no picker mounted).
  // Returns null when the template matches no style — a wrong-but-plausible
  // 'classic' would silently give the gallery another style's rooms.
  function inferStyleFromTemplate(templateName) {
    if (typeof OpenVGALPack === 'undefined') return null;
    return OpenVGALPack.styleKeyFromTemplate(_catalog, templateName);
  }

  return {
    mount: mount,
    getSelected: getSelected,
    getCatalog: getCatalog,
    selectStyle: selectStyle,
    inferStyleFromTemplate: inferStyleFromTemplate
  };
})();
