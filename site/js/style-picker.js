/**
 * OpenVGAL Style Picker
 * Horizontal carousel for selecting gallery styles.
 * Fetches catalog.json from CDN, renders cards from catalog.styles.
 */
var StylePicker = (function() {
  var _styles = null;
  var _catalog = null;
  var _selectedKey = 'classic';
  var _container = null;
  var _carousel = null;

  function _injectStyles() {
    if (document.getElementById('style-picker-css')) return;
    var style = document.createElement('style');
    style.id = 'style-picker-css';
    style.textContent = [
      '.sp-wrapper { position: relative; width: 100%; }',

      '.sp-carousel {',
      '  display: flex; gap: 14px; overflow-x: auto;',
      '  scroll-snap-type: x mandatory; scroll-behavior: smooth;',
      '  padding: 4px 4px 12px 4px;',
      '  -webkit-overflow-scrolling: touch;',
      '  scrollbar-width: none;',
      '}',
      '.sp-carousel::-webkit-scrollbar { display: none; }',

      /* Fade edges */
      '.sp-wrapper::before, .sp-wrapper::after {',
      '  content: ""; position: absolute; top: 0; bottom: 12px;',
      '  width: 40px; z-index: 3; pointer-events: none;',
      '  transition: opacity 0.3s;',
      '}',
      '.sp-wrapper::before { left: 0; background: linear-gradient(to right, #000, transparent); opacity: 0; }',
      '.sp-wrapper::after { right: 0; background: linear-gradient(to left, #000, transparent); opacity: 0; }',
      '.sp-wrapper.can-scroll-left::before { opacity: 1; }',
      '.sp-wrapper.can-scroll-right::after { opacity: 1; }',

      /* Arrow buttons */
      '.sp-arrow {',
      '  position: absolute; top: 50%; transform: translateY(calc(-50% - 6px));',
      '  z-index: 4; width: 36px; height: 36px; border-radius: 50%;',
      '  border: 1.5px solid rgba(255,255,255,0.1); background: rgba(10,10,10,0.9);',
      '  color: #fafafa; cursor: pointer; display: flex; align-items: center;',
      '  justify-content: center; transition: opacity 0.3s;',
      '  opacity: 0; pointer-events: none;',
      '}',
      '.sp-arrow:hover { background: rgba(30,30,30,0.95); border-color: #3f3f46; }',
      '.sp-arrow svg { width: 16px; height: 16px; }',
      '.sp-arrow.left { left: -6px; }',
      '.sp-arrow.right { right: -6px; }',
      '.sp-wrapper.can-scroll-left .sp-arrow.left,',
      '.sp-wrapper.can-scroll-right .sp-arrow.right { opacity: 1; pointer-events: auto; }',

      /* Cards */
      '.sp-card {',
      '  flex: 0 0 220px; scroll-snap-align: start;',
      '  border: 1.5px solid rgba(255,255,255,0.08); border-radius: 14px;',
      '  background: rgba(255,255,255,0.02); overflow: hidden; cursor: pointer;',
      '  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;',
      '  outline: none;',
      '}',
      '.sp-card:hover {',
      '  border-color: #3f3f46; background: rgba(255,255,255,0.04);',
      '  transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.4);',
      '}',
      '.sp-card.selected {',
      '  border-color: oklch(0.66 0.075 64);',
      '  box-shadow: 0 0 0 1px oklch(0.66 0.075 64), 0 0 20px color-mix(in oklab, oklch(0.78 0.065 68) 22%, transparent);',
      '}',

      /* Preview */
      '.sp-preview {',
      '  position: relative; width: 100%; aspect-ratio: 16/10;',
      '  overflow: hidden; background: #111;',
      '}',
      '.sp-preview img {',
      '  width: 100%; height: 100%; object-fit: cover; display: block;',
      '}',
      '.sp-placeholder {',
      '  width: 100%; height: 100%; display: flex;',
      '  align-items: center; justify-content: center;',
      '  font-size: 0.7rem; color: #52525b; font-weight: 500;',
      '  letter-spacing: 0.05em; text-transform: uppercase;',
      '}',

      /* Badge */
      '.sp-badge {',
      '  position: absolute; top: 10px; right: 10px;',
      '  width: 22px; height: 22px; border-radius: 50%;',
      '  background: oklch(0.66 0.075 64); display: flex; align-items: center;',
      '  justify-content: center; opacity: 0; transform: scale(0.5);',
      '  transition: opacity 0.2s, transform 0.2s; z-index: 2;',
      '}',
      '.sp-badge svg { width: 12px; height: 12px; }',
      '.sp-card.selected .sp-badge { opacity: 1; transform: scale(1); }',

      '.sp-ring {',
      '  position: absolute; top: 10px; right: 10px;',
      '  width: 22px; height: 22px; border-radius: 50%;',
      '  border: 2px solid #52525b; z-index: 2;',
      '  transition: opacity 0.2s;',
      '}',
      '.sp-card.selected .sp-ring { opacity: 0; }',

      /* Info */
      '.sp-info { padding: 12px 14px 14px; }',
      '.sp-name { font-size: 0.85rem; font-weight: 600; color: #fafafa; margin-bottom: 2px; }',
      '.sp-desc { font-size: 0.75rem; color: #a1a1aa; line-height: 1.4; }',
      '.sp-tags { display: flex; gap: 6px; margin-top: 8px; }',
      '.sp-tag {',
      '  font-size: 0.65rem; font-weight: 500; color: #71717a;',
      '  background: rgba(255,255,255,0.05); padding: 2px 7px; border-radius: 5px;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function _buildCard(key, data) {
    var card = document.createElement('div');
    card.className = 'sp-card' + (key === _selectedKey ? ' selected' : '');
    card.tabIndex = 0;
    card.dataset.style = key;

    // Preview
    var preview = document.createElement('div');
    preview.className = 'sp-preview';
    if (data.thumbnail) {
      var img = document.createElement('img');
      var cdnBase = window.openvgal_cdn_base || '';
      img.src = cdnBase + '/templates/' + data.thumbnail;
      img.alt = data.name;
      img.onerror = function() {
        preview.innerHTML = '<div class="sp-placeholder">' + data.name + '</div>';
      };
      preview.appendChild(img);
    } else {
      preview.innerHTML = '<div class="sp-placeholder">' + data.name + '</div>';
    }

    // Ring (unselected) + Badge (selected)
    var ring = document.createElement('div');
    ring.className = 'sp-ring';

    var badge = document.createElement('div');
    badge.className = 'sp-badge';
    badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    // Info
    var info = document.createElement('div');
    info.className = 'sp-info';

    var name = document.createElement('div');
    name.className = 'sp-name';
    name.textContent = data.name;

    var desc = document.createElement('div');
    desc.className = 'sp-desc';
    desc.textContent = data.description;

    var tags = document.createElement('div');
    tags.className = 'sp-tags';
    var roomCount = data.glbs ? Object.keys(data.glbs).length : 0;
    tags.innerHTML =
      '<span class="sp-tag">' + roomCount + ' room type' + (roomCount !== 1 ? 's' : '') + '</span>';

    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(tags);

    card.appendChild(preview);
    card.appendChild(ring);
    card.appendChild(badge);
    card.appendChild(info);

    return card;
  }

  function _updateScrollState() {
    if (!_carousel) return;
    var wrapper = _carousel.parentElement;
    var sl = _carousel.scrollLeft;
    var maxScroll = _carousel.scrollWidth - _carousel.clientWidth;
    wrapper.classList.toggle('can-scroll-left', sl > 10);
    wrapper.classList.toggle('can-scroll-right', sl < maxScroll - 10);
  }

  function _scrollIntoView(card) {
    if (!_carousel) return;
    var cardRect = card.getBoundingClientRect();
    var carouselRect = _carousel.getBoundingClientRect();
    if (cardRect.left < carouselRect.left) {
      _carousel.scrollBy({ left: cardRect.left - carouselRect.left - 14, behavior: 'smooth' });
    } else if (cardRect.right > carouselRect.right) {
      _carousel.scrollBy({ left: cardRect.right - carouselRect.right + 14, behavior: 'smooth' });
    }
  }

  function _selectCard(card) {
    _carousel.querySelectorAll('.sp-card').forEach(function(c) {
      c.classList.remove('selected');
    });
    card.classList.add('selected');
    _selectedKey = card.dataset.style;
    _scrollIntoView(card);
  }

  function _render() {
    if (!_container || !_styles) return;
    _injectStyles();
    _container.innerHTML = '';

    var wrapper = document.createElement('div');
    wrapper.className = 'sp-wrapper';

    // Arrow buttons
    var arrowL = document.createElement('button');
    arrowL.className = 'sp-arrow left';
    arrowL.setAttribute('aria-label', 'Scroll left');
    arrowL.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';

    var arrowR = document.createElement('button');
    arrowR.className = 'sp-arrow right';
    arrowR.setAttribute('aria-label', 'Scroll right');
    arrowR.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

    // Carousel
    _carousel = document.createElement('div');
    _carousel.className = 'sp-carousel';

    var keys = Object.keys(_styles);
    for (var i = 0; i < keys.length; i++) {
      _carousel.appendChild(_buildCard(keys[i], _styles[keys[i]]));
    }

    // Events
    _carousel.addEventListener('click', function(e) {
      var card = e.target.closest('.sp-card');
      if (card) _selectCard(card);
    });
    _carousel.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (e.target.classList.contains('sp-card')) _selectCard(e.target);
      }
    });
    _carousel.addEventListener('scroll', _updateScrollState, { passive: true });
    _carousel.addEventListener('wheel', function(e) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        _carousel.scrollLeft += e.deltaY * 3;
      }
    }, { passive: false });

    arrowL.addEventListener('click', function() {
      _carousel.scrollBy({ left: -234 * 2, behavior: 'smooth' });
    });
    arrowR.addEventListener('click', function() {
      _carousel.scrollBy({ left: 234 * 2, behavior: 'smooth' });
    });

    wrapper.appendChild(arrowL);
    wrapper.appendChild(arrowR);
    wrapper.appendChild(_carousel);
    _container.appendChild(wrapper);

    // Initial scroll state
    setTimeout(_updateScrollState, 50);
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
    if (_carousel) {
      var cards = _carousel.querySelectorAll('.sp-card');
      cards.forEach(function(c) {
        c.classList.toggle('selected', c.dataset.style === key);
      });
    }
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
