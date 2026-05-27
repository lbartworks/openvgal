/**
 * OpenVGAL Gallery Page Helpers
 *
 * Shared page-level logic for site/create/index.html, which runs in two
 * output modes (standard self-contained ZIP and ?cdn=1 thin client). The
 * drop-zone, gallery list, preview overlay, and stats logic stay in this
 * module so both modes share one implementation.
 *
 * Depends on filterImageFiles / groupFilesByFolder from gallery-generator.js.
 */
var GalleryPage = (function() {

  var SVG_ICONS = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
    lock:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  };

  // Recursively read all files from a dropped directory entry.
  async function _readAllFiles(dirEntry, basePath) {
    var results = [];
    var reader = dirEntry.createReader();
    var readBatch = function() {
      return new Promise(function(resolve, reject) {
        reader.readEntries(resolve, reject);
      });
    };
    var entries;
    do {
      entries = await readBatch();
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.isFile) {
          var file = await new Promise(function(resolve, reject) { entry.file(resolve, reject); });
          results.push({ file: file, folderPath: basePath, folderName: basePath.split('/').pop() });
        } else if (entry.isDirectory) {
          var subResults = await _readAllFiles(entry, basePath + '/' + entry.name);
          results.push.apply(results, subResults);
        }
      }
    } while (entries.length > 0);
    return results;
  }

  async function _addDroppedFolder(dirEntry, galleries) {
    var allFiles = await _readAllFiles(dirEntry, dirEntry.name);
    var groups = {};
    for (var i = 0; i < allFiles.length; i++) {
      var item = allFiles[i];
      if (!groups[item.folderPath]) {
        groups[item.folderPath] = { name: item.folderName, path: item.folderPath, files: [] };
      }
      groups[item.folderPath].files.push(item.file);
    }
    var keys = Object.keys(groups);
    for (var k = 0; k < keys.length; k++) {
      var group = groups[keys[k]];
      var imageFiles = filterImageFiles(group.files);
      if (imageFiles.length > 0) {
        var exists = galleries.some(function(g) { return g.path === group.path; });
        if (!exists) {
          galleries.push({
            name: group.name,
            folderName: group.name,
            path: group.path,
            files: imageFiles
          });
        }
      }
    }
  }

  // Wire drag-and-drop on dropZone, browse-button click, and folderInput change.
  // `galleries` is mutated in place. `onChange` runs once per batch.
  function setupDropZone(opts) {
    var dropZone   = opts.dropZone;
    var folderInput = opts.folderInput;
    var addFolderBtn = opts.addFolderBtn;
    var galleries  = opts.galleries;
    var onChange   = opts.onChange || function() {};

    dropZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function() {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', async function(e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      // DataTransfer.items is invalidated after the first await — collect entries first.
      var items = Array.from(e.dataTransfer.items);
      var entries = [];
      for (var i = 0; i < items.length; i++) {
        var entry = items[i].webkitGetAsEntry();
        if (entry && entry.isDirectory) entries.push(entry);
      }
      for (var i = 0; i < entries.length; i++) {
        await _addDroppedFolder(entries[i], galleries);
      }
      onChange();
    });
    dropZone.addEventListener('click', function() { folderInput.click(); });

    if (addFolderBtn) {
      addFolderBtn.addEventListener('click', function() { folderInput.click(); });
    }

    folderInput.addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      if (files.length === 0) return;
      var grouped = groupFilesByFolder(files);
      grouped.forEach(function(group) {
        var imageFiles = filterImageFiles(group.files);
        if (imageFiles.length > 0) {
          var exists = galleries.some(function(g) { return g.path === group.path; });
          if (!exists) {
            galleries.push({
              name: group.name,
              folderName: group.name,
              path: group.path,
              files: imageFiles
            });
          }
        }
      });
      onChange();
      folderInput.value = '';
    });
  }

  // Append editable rows for each gallery to `container`. Caller is responsible
  // for clearing the container before calling, and for rendering any read-only
  // rows (e.g. imported rooms in ?cdn=1 mode) separately.
  // `onChange` runs after a row is renamed or removed.
  function renderGalleryItems(container, galleries, opts) {
    var onChange = (opts && opts.onChange) || function() {};

    galleries.forEach(function(gallery, index) {
      var item = document.createElement('div');
      item.className = 'gallery-item';

      var iconDiv = document.createElement('div');
      iconDiv.className = 'gallery-icon';
      iconDiv.innerHTML = SVG_ICONS.folder;

      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'gallery-name-input';
      nameInput.value = gallery.name;
      nameInput.dataset.index = index;
      nameInput.placeholder = 'Room name';

      var folderDiv = document.createElement('div');
      folderDiv.className = 'gallery-folder';
      folderDiv.textContent = gallery.folderName;

      var detailsDiv = document.createElement('div');
      detailsDiv.className = 'gallery-details';
      detailsDiv.appendChild(nameInput);
      detailsDiv.appendChild(folderDiv);

      var countSpan = document.createElement('span');
      countSpan.className = 'gallery-count';
      countSpan.textContent = gallery.files.length + ' images';

      var removeBtn = document.createElement('button');
      removeBtn.className = 'gallery-remove';
      removeBtn.dataset.index = index;
      removeBtn.title = 'Remove';
      removeBtn.innerHTML = SVG_ICONS.remove;

      nameInput.addEventListener('change', function(e) {
        galleries[index].name = e.target.value.trim() || galleries[index].folderName;
        onChange();
      });
      removeBtn.addEventListener('click', function() {
        galleries.splice(index, 1);
        onChange();
      });

      item.appendChild(iconDiv);
      item.appendChild(detailsDiv);
      item.appendChild(countSpan);
      item.appendChild(removeBtn);
      container.appendChild(item);
    });
  }

  function computeStats(json) {
    var galleryCount = Object.keys(json).filter(function(k) {
      return k !== 'Technical' && k !== 'root';
    }).length;
    var imageCount = 0;
    for (var key in json) {
      if (key === 'Technical') continue;
      for (var item in json[key]) {
        if (json[key][item] && json[key][item].resource_type === 'image') {
          imageCount++;
        }
      }
    }
    return { galleryCount: galleryCount, imageCount: imageCount };
  }

  // Open the post-save "ready" page. Must run inside the click handler call
  // stack to survive mobile popup blockers — callers should not defer behind await.
  function openReadyPage(json) {
    var firstRoom = json ? Object.keys(json).filter(function(k) {
      return k !== 'Technical' && k !== 'root';
    })[0] : '';
    window.open('../ready.html?name=' + encodeURIComponent(firstRoom || ''), '_blank');
  }

  // Wire the preview button: build blob URLs for the file map, mount a
  // fullscreen iframe pointed at the viewer in preview mode, revoke URLs on close.
  function setupPreview(opts) {
    var previewBtn = opts.previewBtn;
    var getJSON    = opts.getJSON;
    var getFileMap = opts.getFileMap;
    var viewerSrc  = opts.viewerSrc || '../viewer.html?preview=iframe';

    previewBtn.addEventListener('click', function() {
      var json = getJSON();
      var fileMap = getFileMap();
      if (!json || !fileMap) return;

      window.openvgal_blobUrls = {};
      var entries = Object.entries(fileMap);
      for (var i = 0; i < entries.length; i++) {
        window.openvgal_blobUrls[entries[i][0]] = URL.createObjectURL(entries[i][1]);
      }
      window.openvgal_config = json;

      var overlay = document.createElement('div');
      overlay.id = 'previewOverlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#000;z-index:9999;';

      var closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close Preview';
      closeBtn.style.cssText = 'position:absolute;top:12px;right:12px;z-index:10000;padding:8px 20px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:6px;cursor:pointer;font-size:14px;font-family:Inter,sans-serif;transition:background 0.2s;';
      closeBtn.onmouseover = function() { closeBtn.style.background = 'rgba(255,255,255,0.2)'; };
      closeBtn.onmouseout = function() { closeBtn.style.background = 'rgba(255,255,255,0.1)'; };
      closeBtn.onclick = function() {
        overlay.remove();
        if (window.openvgal_blobUrls) {
          Object.values(window.openvgal_blobUrls).forEach(function(url) {
            try { URL.revokeObjectURL(url); } catch (e) {}
          });
          window.openvgal_blobUrls = null;
        }
      };

      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:100%;height:100%;border:none;';
      iframe.src = viewerSrc;

      overlay.appendChild(closeBtn);
      overlay.appendChild(iframe);
      document.body.appendChild(overlay);
    });
  }

  // Hide the result section and revoke any preview blob URLs. Caller must
  // also clear its own generatedJSON variable (state stays page-local).
  function clearStaleResultUI(resultSection) {
    if (resultSection) resultSection.style.display = 'none';
    if (window.openvgal_blobUrls) {
      Object.values(window.openvgal_blobUrls).forEach(function(url) {
        try { URL.revokeObjectURL(url); } catch (e) {}
      });
      window.openvgal_blobUrls = null;
    }
  }

  return {
    SVG_ICONS: SVG_ICONS,
    setupDropZone: setupDropZone,
    renderGalleryItems: renderGalleryItems,
    computeStats: computeStats,
    openReadyPage: openReadyPage,
    setupPreview: setupPreview,
    clearStaleResultUI: clearStaleResultUI
  };
})();
