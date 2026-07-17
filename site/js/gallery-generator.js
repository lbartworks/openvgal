/**
 * OpenVGAL Gallery Generator
 * Builds building_v2.json from a folder of images using catalog.json:
 *   - shapes:        per-shape Occupancy strips (precomputed via site/tools/catalog-manager.html;
 *                    falls back to runtime GLB probe if missing)
 *   - selectionOrder: smallest → largest fitting order
 *   - styles:        visual variants (each provides a glb per shape)
 */

const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'];

// Viewer convention: 1 babylon m = 120/2.5 cm. Mirror of room_builder_aux.js SCENE_M_PER_CM.
const SCENE_M_PER_CM = 2.5 / 120;
// Default longest edge for new artworks; produces 2.5 babylon m at scale.
const DEFAULT_LONGEST_CM = 120;

const DEFAULTS = {
  minSpacing: 0.5, // babylon m, gap between consecutive items on a wall
  itemHeight: 2    // babylon m, eye-level Y for item centers
};

// Fallback door-slot count for the root hub template, used only when the
// catalog has no rootDoors for the style and the GLB probe fails. With more
// top-level galleries than slots, extra hubs (root#1, root#2, …) are chained:
// root keeps (doors-1) galleries plus a door to root#1; each extra hub holds
// (doors-2) plus doors to prev/next.
const DEFAULT_DOORS_ROOT = 10;

// === Catalog loader (cached per cdn base) ===
let _catalogPromise = null;
let _catalogPromiseBase = null;

async function loadCatalog(cdnBase = '') {
  if (_catalogPromise && _catalogPromiseBase === cdnBase) return _catalogPromise;
  _catalogPromiseBase = cdnBase;
  _catalogPromise = fetch(cdnBase + '/templates/catalog.json').then(function(r) {
    if (!r.ok) throw new Error('Failed to fetch catalog.json (' + r.status + ')');
    return r.json();
  });
  return _catalogPromise;
}

// Resolve occupancies for a (shape, style). Prefers precomputed catalog.shapes data;
// falls back to runtime GLB probe so we work even before the manager has been run.
async function getOccupanciesForShape(catalog, shape, styleKey, cdnBase = '', scriptBase = '../') {
  const cached = catalog.shapes && catalog.shapes[shape] && catalog.shapes[shape].occupancies;
  if (cached && cached.length > 0) return cached;
  const style = catalog.styles && catalog.styles[styleKey];
  const glbName = style && style.glbs && style.glbs[shape];
  if (!glbName) return [];
  const url = cdnBase + '/templates/' + glbName;
  return await extractOccupanciesFromGLB(url, scriptBase);
}

// === Width-aware fit assignment ===
// items: [{ widthM, ... }]; occupancies: [{ center, normal, width }]
// Density-balanced spread, capacity = sum(widths) + (n-1)*minSpacing ≤ wall.width.
function tryFitItems(occupancies, items, minSpacing) {
  const used = occupancies.map(function() { return []; });
  const assignments = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const w = items[i].widthM;
    let bestIdx = -1, bestDensity = Infinity;
    for (let j = 0; j < occupancies.length; j++) {
      const widths = used[j];
      const newCount = widths.length + 1;
      let sumW = w;
      for (let k = 0; k < widths.length; k++) sumW += widths[k];
      const totalSpan = sumW + (newCount - 1) * minSpacing;
      if (totalSpan > occupancies[j].width) continue;
      const density = widths.length / occupancies[j].width;
      if (density < bestDensity) { bestDensity = density; bestIdx = j; }
    }
    if (bestIdx === -1) return null;
    used[bestIdx].push(w);
    assignments[i] = bestIdx;
  }
  return { assignments };
}

// Largest in-order prefix of items that fits the given shape; used for overflow split.
function maxPrefixFit(occupancies, items, minSpacing) {
  const used = occupancies.map(function() { return []; });
  for (let i = 0; i < items.length; i++) {
    const w = items[i].widthM;
    let bestIdx = -1, bestDensity = Infinity;
    for (let j = 0; j < occupancies.length; j++) {
      const widths = used[j];
      const newCount = widths.length + 1;
      let sumW = w;
      for (let k = 0; k < widths.length; k++) sumW += widths[k];
      const totalSpan = sumW + (newCount - 1) * minSpacing;
      if (totalSpan > occupancies[j].width) continue;
      const density = widths.length / occupancies[j].width;
      if (density < bestDensity) { bestDensity = density; bestIdx = j; }
    }
    if (bestIdx === -1) return i;
    used[bestIdx].push(w);
  }
  return items.length;
}

// Distribute items along each occupancy with equal gaps (edges + interior).
// Falls back to a centered tight pack at minSpacing when even-spread would dip below the floor.
// Returns positions (JSON convention: [worldX, worldZ, worldY]) and vectors ([Nx, Nz]).
function placeItems(occupancies, items, assignments, minSpacing, itemHeight) {
  const positions = new Array(items.length).fill(null);
  const vectors = new Array(items.length).fill(null);
  const UP_Y = [0, 1, 0];

  for (let occIdx = 0; occIdx < occupancies.length; occIdx++) {
    const occ = occupancies[occIdx];
    const itemList = [];
    for (let i = 0; i < assignments.length; i++) if (assignments[i] === occIdx) itemList.push(i);
    if (itemList.length === 0) continue;

    const widths = itemList.map(function(i) { return items[i].widthM; });
    const n = widths.length;
    let sumW = 0;
    for (let k = 0; k < n; k++) sumW += widths[k];

    // Equal margins and interior gaps: n+1 equal spaces share the free room.
    // If that gap would fall below minSpacing, lock at minSpacing and center the pack.
    let gap = (occ.width - sumW) / (n + 1);
    let edgeMargin = gap;
    if (gap < minSpacing) {
      gap = minSpacing;
      const compactSpan = sumW + (n - 1) * minSpacing;
      edgeMargin = (occ.width - compactSpan) / 2;
    }

    // along-wall axis = normalize(cross(N, up_y))
    const N = occ.normal;
    const ax = N[1] * UP_Y[2] - N[2] * UP_Y[1];
    const ay = N[2] * UP_Y[0] - N[0] * UP_Y[2];
    const az = N[0] * UP_Y[1] - N[1] * UP_Y[0];
    const aLen = Math.hypot(ax, ay, az) || 1;
    const a = [ax / aLen, ay / aLen, az / aLen];

    let cursor = -occ.width / 2 + edgeMargin;
    for (let k = 0; k < n; k++) {
      const itemIdx = itemList[k];
      const w = widths[k];
      const t = cursor + w / 2;
      const wx = occ.center[0] + a[0] * t;
      const wz = occ.center[2] + a[2] * t;
      positions[itemIdx] = [wx, wz, itemHeight];
      vectors[itemIdx] = [N[0], N[2]];
      cursor += w + gap;
    }
  }
  return { positions, vectors };
}

/**
 * Pack items into one or more rooms using selectionOrder.
 * @param {Array}  items     – [{ widthM, ... }] in display order. Original ordering is preserved.
 * @param {Object} catalog
 * @param {string} styleKey
 * @param {Object} settings  – { minSpacing, itemHeight }
 * @param {string} cdnBase
 * @param {string} scriptBase – babylon.js script base for fallback probe
 * @returns {Promise<Array<{ shape, glbName, occupancies, positions, vectors, indices }>>}
 *   indices are positions back into the input `items` array.
 */
async function packIntoRooms(items, catalog, styleKey, settings, cdnBase, scriptBase) {
  const minSpacing = (settings && settings.minSpacing) || catalog.minSpacing || DEFAULTS.minSpacing;
  const itemHeight = (settings && settings.itemHeight) || DEFAULTS.itemHeight;
  const style = catalog.styles && catalog.styles[styleKey];
  if (!style) throw new Error('Unknown style: ' + styleKey);

  const order = (catalog.selectionOrder || []).filter(function(s) {
    return style.glbs && style.glbs[s];
  });
  if (order.length === 0) throw new Error('Style "' + styleKey + '" has no glbs matching selectionOrder');

  // Pre-resolve occupancies for each shape (parallel).
  const shapeOccs = {};
  await Promise.all(order.map(async function(shape) {
    shapeOccs[shape] = await getOccupanciesForShape(catalog, shape, styleKey, cdnBase, scriptBase);
  }));
  // Drop shapes without occupancies (e.g., no Occupancy_* meshes in the GLB).
  const usableOrder = order.filter(function(s) { return shapeOccs[s] && shapeOccs[s].length > 0; });
  if (usableOrder.length === 0) throw new Error('No usable occupancies for style ' + styleKey);

  const rooms = [];
  // Tag with original indices so we can report them back even after slicing.
  let remaining = items.map(function(it, idx) { return Object.assign({}, it, { _origIdx: idx }); });

  while (remaining.length > 0) {
    let placed = false;
    for (let s = 0; s < usableOrder.length; s++) {
      const shape = usableOrder[s];
      const occs = shapeOccs[shape];
      const fit = tryFitItems(occs, remaining, minSpacing);
      if (fit) {
        const { positions, vectors } = placeItems(occs, remaining, fit.assignments, minSpacing, itemHeight);
        rooms.push({
          shape: shape,
          glbName: style.glbs[shape],
          occupancies: occs,
          positions: positions,
          vectors: vectors,
          indices: remaining.map(function(r) { return r._origIdx; })
        });
        remaining = [];
        placed = true;
        break;
      }
    }
    if (placed) continue;

    // Even the largest didn't fit — split off the largest prefix that does.
    const largest = usableOrder[usableOrder.length - 1];
    const occs = shapeOccs[largest];
    const cut = maxPrefixFit(occs, remaining, minSpacing);
    if (cut === 0) {
      throw new Error('A single item exceeds capacity in shape "' + largest + '" (item width too large)');
    }
    const prefix = remaining.slice(0, cut);
    const fit = tryFitItems(occs, prefix, minSpacing);
    if (!fit) throw new Error('Internal: maxPrefixFit reported ' + cut + ' but tryFitItems failed');
    const { positions, vectors } = placeItems(occs, prefix, fit.assignments, minSpacing, itemHeight);
    rooms.push({
      shape: largest,
      glbName: style.glbs[largest],
      occupancies: occs,
      positions: positions,
      vectors: vectors,
      indices: prefix.map(function(r) { return r._origIdx; })
    });
    remaining = remaining.slice(cut);
  }

  return rooms;
}

// === GLB probe (fallback path; results cached by URL) ===

const _occupancyCache = {};
let _babylonLoadPromise = null;

function _loadScript(src) {
  return new Promise(function(resolve, reject) {
    const s = document.createElement('script');
    s.src = src;
    s.onload = function() { resolve(); };
    s.onerror = function() { reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

async function _ensureBabylonLoaded(scriptBase) {
  scriptBase = scriptBase || '../';
  if (typeof BABYLON !== 'undefined' && typeof BABYLON.GLTFFileLoader !== 'undefined') return;
  if (_babylonLoadPromise) return _babylonLoadPromise;
  _babylonLoadPromise = (async function() {
    if (typeof BABYLON === 'undefined') {
      await _loadScript(scriptBase + 'babylon.js');
    }
    if (typeof BABYLON.GLTFFileLoader === 'undefined') {
      await _loadScript(scriptBase + 'babylonjs.loaders.min.js');
    }
  })();
  return _babylonLoadPromise;
}

// Count door meshes (viewer convention: names starting with d_, see
// declarations.js regul_exp_door) in a template GLB. Cached by URL.
const _doorCountCache = {};

async function countDoorsInGLB(templateUrl, scriptBase) {
  if (_doorCountCache[templateUrl] != null) return _doorCountCache[templateUrl];
  await _ensureBabylonLoaded(scriptBase);

  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  try {
    const lastSlash = templateUrl.lastIndexOf('/');
    await BABYLON.SceneLoader.AppendAsync(templateUrl.slice(0, lastSlash + 1), templateUrl.slice(lastSlash + 1), scene);
    const count = scene.meshes.filter(function(m) { return /^d_/.test(m.name); }).length;
    _doorCountCache[templateUrl] = count;
    return count;
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

async function extractOccupanciesFromGLB(templateUrl, scriptBase) {
  if (_occupancyCache[templateUrl]) return _occupancyCache[templateUrl];
  await _ensureBabylonLoaded(scriptBase);

  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  try {
    const lastSlash = templateUrl.lastIndexOf('/');
    const rootUrl = templateUrl.slice(0, lastSlash + 1);
    const fileName = templateUrl.slice(lastSlash + 1);
    await BABYLON.SceneLoader.AppendAsync(rootUrl, fileName, scene);

    const meshes = scene.meshes.filter(function(m) { return /^Occupancy_\d+/i.test(m.name); });
    meshes.sort(function(a, b) {
      const na = parseInt(a.name.replace(/^Occupancy_/i, ''), 10) || 0;
      const nb = parseInt(b.name.replace(/^Occupancy_/i, ''), 10) || 0;
      return na - nb;
    });

    const result = [];
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo();
      const worldMatrix = mesh.getWorldMatrix();
      const bb = mesh.getBoundingInfo().boundingBox;
      const center = bb.centerWorld;

      const normalsData = mesh.getVerticesData(BABYLON.VertexBuffer.NormalKind);
      if (!normalsData || normalsData.length < 3) continue;
      const localN = new BABYLON.Vector3(normalsData[0], normalsData[1], normalsData[2]);
      const worldN = BABYLON.Vector3.TransformNormal(localN, worldMatrix);
      worldN.normalize();

      const alongAxis = BABYLON.Vector3.Cross(worldN, BABYLON.Axis.Y);
      if (alongAxis.length() < 1e-6) continue;
      alongAxis.normalize();

      const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      let minProj = Infinity, maxProj = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        const v = BABYLON.Vector3.TransformCoordinates(
          new BABYLON.Vector3(positions[i], positions[i + 1], positions[i + 2]),
          worldMatrix
        );
        const p = BABYLON.Vector3.Dot(v, alongAxis);
        if (p < minProj) minProj = p;
        if (p > maxProj) maxProj = p;
      }
      result.push({
        name: mesh.name,
        center: [center.x, center.y, center.z],
        normal: [worldN.x, worldN.y, worldN.z],
        width: maxProj - minProj
      });
    }
    _occupancyCache[templateUrl] = result;
    return result;
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

// === Image helpers ===

async function getImageDimensions(file) {
  return new Promise(function(resolve, reject) {
    const img = new Image();
    img.onload = function() {
      resolve({ width: img.naturalWidth, height: img.naturalHeight, name: file.name });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function() {
      reject(new Error('Failed to load image: ' + file.name));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

function filterImageFiles(files) {
  return Array.from(files).filter(function(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    return IMAGE_TYPES.indexOf(ext) !== -1;
  });
}

function getGalleryName(file) {
  const parts = file.webkitRelativePath.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : 'gallery';
}

function groupFilesByFolder(files) {
  const groups = {};
  files.forEach(function(file) {
    const parts = file.webkitRelativePath.split('/');
    const folderPath = parts.slice(0, -1).join('/');
    const folderName = parts.length > 1 ? parts[parts.length - 2] : 'root';
    if (!groups[folderPath]) {
      groups[folderPath] = { name: folderName, path: folderPath, files: [] };
    }
    groups[folderPath].files.push(file);
  });
  return Object.values(groups);
}

// Compute default cm dimensions for a fresh image (longest edge = 120 cm).
function defaultCmDims(natWidth, natHeight) {
  const aspectRatio = natHeight / natWidth;
  if (aspectRatio <= 1) {
    return { wCm: DEFAULT_LONGEST_CM, hCm: DEFAULT_LONGEST_CM * aspectRatio };
  }
  return { wCm: DEFAULT_LONGEST_CM / aspectRatio, hCm: DEFAULT_LONGEST_CM };
}

function cmToBabylon(cm) { return parseFloat(cm) * SCENE_M_PER_CM; }

// === Main builder ===

/**
 * @param {Array}    galleries    – [{ name, folderName, files }]
 * @param {Function} onProgress   – (current, total, message) → void
 * @param {Object}   styleConfig  – the catalog style entry { name, root, glbs, ... }
 * @param {Object}   options      – { cdnBase, scriptBase }
 */
async function buildGalleryJSON(galleries, onProgress, styleConfig, options) {
  options = options || {};
  const cdnBase = options.cdnBase != null ? options.cdnBase : (typeof window !== 'undefined' && window.openvgal_cdn_base) || '';
  const scriptBase = options.scriptBase || '../';

  const catalog = await loadCatalog(cdnBase);
  const styleKey = _resolveStyleKey(catalog, styleConfig);

  const building = {};
  let uniqueId = 0;

  building['root'] = {
    parent: 'none',
    resource: 'root.glb',
    template: catalog.styles[styleKey].root
  };

  const topLevelCount = galleries.filter(function(g) {
    return filterImageFiles(g.files).length > 0;
  }).length;

  // Resolve the root template's door-slot count: catalog first, GLB probe as
  // fallback. Only needed when overflow chaining could trigger.
  let doorsRoot = DEFAULT_DOORS_ROOT;
  if (topLevelCount > 2) {
    const styleEntry = catalog.styles[styleKey];
    if (styleEntry.rootDoors > 0) {
      doorsRoot = styleEntry.rootDoors;
    } else {
      try {
        const probed = await countDoorsInGLB(cdnBase + '/templates/' + styleEntry.root, scriptBase);
        if (probed > 0) doorsRoot = probed;
      } catch (e) {
        console.warn('Root door probe failed, assuming ' + DEFAULT_DOORS_ROOT + ' doors: ' + e.message);
      }
    }
    if (doorsRoot < 3 && topLevelCount > doorsRoot) {
      // Chaining needs parent + next + at least one gallery per hub.
      console.warn('Root template has only ' + doorsRoot + ' doors; hub chaining needs 3. Assuming 3.');
      doorsRoot = 3;
    }
  }
  let topIdx = 0;

  // Hub for the next top-level gallery; creates overflow hub entries on demand.
  function nextHubParent() {
    topIdx++;
    if (topLevelCount <= doorsRoot || topIdx <= doorsRoot - 1) return 'root';
    const j = Math.ceil((topIdx - (doorsRoot - 1)) / (doorsRoot - 2));
    const hubName = 'root#' + j;
    if (!building[hubName]) {
      building[hubName] = {
        parent: j === 1 ? 'root' : 'root#' + (j - 1),
        resource: 'root.glb',
        template: catalog.styles[styleKey].root
      };
    }
    return hubName;
  }

  const totalImages = galleries.reduce(function(sum, g) { return sum + g.files.length; }, 0);
  let processedImages = 0;

  for (const gallery of galleries) {
    const imageFiles = filterImageFiles(gallery.files);
    if (imageFiles.length === 0) continue;

    const galleryDisplayName = gallery.name;
    const folderName = gallery.folderName || gallery.name;

    if (onProgress) onProgress(processedImages, totalImages, 'Processing ' + galleryDisplayName + '...');

    const items = [];
    for (const file of imageFiles) {
      try {
        const dims = await getImageDimensions(file);
        const cm = defaultCmDims(dims.width, dims.height);
        items.push({
          file: file,
          name: dims.name,
          cmWidth: cm.wCm,
          cmHeight: cm.hCm,
          widthM: cmToBabylon(cm.wCm)
        });
        processedImages++;
        if (onProgress) onProgress(processedImages, totalImages, 'Loading ' + file.name + '...');
      } catch (e) {
        console.warn('Skipping ' + file.name + ': ' + e.message);
        processedImages++;
      }
    }
    if (items.length === 0) continue;

    const rooms = await packIntoRooms(items, catalog, styleKey, null, cdnBase, scriptBase);

    let lastParent = nextHubParent();
    rooms.forEach(function(room, subIdx) {
      const galleryName = subIdx === 0 ? galleryDisplayName : galleryDisplayName + '#' + subIdx;
      building[galleryName] = {
        parent: lastParent,
        resource: galleryName + '.glb',
        template: room.glbName
      };

      room.indices.forEach(function(itemIdx, k) {
        const item = items[itemIdx];
        const baseName = item.name.replace(/\.[^/.]+$/, '');
        const resourcePath = '/' + folderName + '/' + item.name;
        const pos = room.positions[k];
        const vec = room.vectors[k];
        building[galleryName][baseName] = {
          resource: resourcePath,
          resource_type: 'image',
          width: item.cmWidth.toFixed(2),
          height: item.cmHeight.toFixed(2),
          location: '[' + pos[0].toFixed(3) + ',' + pos[1].toFixed(3) + ',' + pos[2].toFixed(3) + ']',
          vector: '[' + vec[0].toFixed(1) + ',' + vec[1].toFixed(1) + ']',
          metadata: 'ID #' + uniqueId + ' ' + baseName
        };
        uniqueId++;
      });

      lastParent = galleryName;
    });
  }

  // Doors between rooms (parent ↔ child)
  for (const galleryName of Object.keys(building)) {
    const parent = building[galleryName].parent;
    if (parent && parent !== 'none') {
      building[parent][galleryName] = { resource: galleryName + '.glb', resource_type: 'door' };
      building[galleryName][parent]  = { resource: parent + '.glb',      resource_type: 'door' };
    }
  }

  building['Technical'] = { ambientLight: 0.5, pointLight: 50 };
  if (typeof GallerySettings !== 'undefined') {
    Object.assign(building['Technical'], GallerySettings.getValues());
  }

  if (onProgress) onProgress(totalImages, totalImages, 'Done!');
  return building;
}

function _resolveStyleKey(catalog, styleConfig) {
  if (!styleConfig) return Object.keys(catalog.styles)[0];
  // Caller passed a style entry directly — reverse-look the key.
  const keys = Object.keys(catalog.styles);
  for (const k of keys) {
    if (catalog.styles[k] === styleConfig) return k;
    if (styleConfig.root && catalog.styles[k].root === styleConfig.root) return k;
  }
  return keys[0];
}

/**
 * Re-fit the items in an existing room. Returns one or more room descriptors.
 *   roomEntries: array of { key, entry } pairs (entry has cm width/height + metadata)
 *   styleConfig: the style entry from catalog.styles[*]
 * Returns: [{ shape, glbName, items: [{ key, entry, location, vector }] }, ...]
 */
async function relayoutRoom(roomEntries, styleConfig, settings, options) {
  options = options || {};
  const cdnBase = options.cdnBase != null ? options.cdnBase : (typeof window !== 'undefined' && window.openvgal_cdn_base) || '';
  const scriptBase = options.scriptBase || '../';
  const catalog = await loadCatalog(cdnBase);
  const styleKey = _resolveStyleKey(catalog, styleConfig);

  const items = roomEntries.map(function(re) {
    return {
      key: re.key,
      entry: re.entry,
      cmWidth: parseFloat(re.entry.width),
      widthM: parseFloat(re.entry.width) * SCENE_M_PER_CM
    };
  });

  const rooms = await packIntoRooms(items, catalog, styleKey, settings, cdnBase, scriptBase);
  return rooms.map(function(room) {
    return {
      shape: room.shape,
      glbName: room.glbName,
      items: room.indices.map(function(origIdx, k) {
        const it = items[origIdx];
        const pos = room.positions[k];
        const vec = room.vectors[k];
        return {
          key: it.key,
          entry: it.entry,
          location: '[' + pos[0].toFixed(3) + ',' + pos[1].toFixed(3) + ',' + pos[2].toFixed(3) + ']',
          vector: '[' + vec[0].toFixed(1) + ',' + vec[1].toFixed(1) + ']'
        };
      })
    };
  });
}

function buildFileMap(galleries) {
  const fileMap = {};
  for (const gallery of galleries) {
    const folderName = gallery.folderName || gallery.name;
    const imageFiles = filterImageFiles(gallery.files);
    for (const file of imageFiles) {
      fileMap['/' + folderName + '/' + file.name] = file;
    }
  }
  return fileMap;
}

function downloadJSON(data, filename) {
  filename = filename || 'building_v2.json';
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildGalleryJSON,
    relayoutRoom,
    loadCatalog,
    packIntoRooms,
    buildFileMap,
    filterImageFiles,
    groupFilesByFolder,
    getImageDimensions,
    extractOccupanciesFromGLB,
    countDoorsInGLB,
    downloadJSON,
    SCENE_M_PER_CM,
    DEFAULT_LONGEST_CM,
    IMAGE_TYPES
  };
}
