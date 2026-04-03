/**
 * OpenVGAL Gallery Generator
 * Ported from Python VR_gallery.py to vanilla JavaScript
 * No dependencies required
 */

// Supported image types
const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'];

// Direction vectors for wall orientations
const VECTORS = {
  N: [0, 1],
  S: [0, -1],
  W: [-1, 0],
  E: [1, 0]
};

/**
 * Gallery placement algorithm
 * Distributes artwork across walls and optional center panels
 */
class GalleryWithOptionalPanels {
  constructor(W = 30, L = 60, panelLength = 15) {
    this.geometry = {
      W: W,
      L: L,
      panelPositionX: W / 5,
      panelPositionY: L / 4,
      panelLength: panelLength,
      panelThickness: 0.5,
      itemHeight: 2,
      freeSpace: 0.75,
      itemMaxSize: 2.5,
      minSpacing: 3,
      door: 1
    };

    this.densitySaturation = 1 / this.geometry.minSpacing;

    // Calculate available lengths for each wall segment
    const longWall = L - this.geometry.freeSpace * 2;
    const shortWall = W / 2 - this.geometry.door / 2 - this.geometry.freeSpace * 2;
    const panel = Math.max(0.1, panelLength - this.geometry.freeSpace * 2);

    // 14 placement areas: 6 walls + 8 panel sides
    this.lengths = [
      longWall, shortWall, shortWall,  // walls 1-3
      longWall, shortWall, shortWall,  // walls 4-6
      panel, panel, panel, panel,       // panels 7-10
      panel, panel, panel, panel        // panels 11-14
    ];

    this.occupancy = null;
    this.assignments = null;
    this.panelsOff = true;
  }

  /**
   * Distribute N items across available wall segments
   * Returns 1 on success, -1 if items don't fit
   */
  assignOccupancy(n, silent = true) {
    const occupancyMax = this.lengths.map(len =>
      Math.floor((len - this.geometry.itemMaxSize) / this.geometry.minSpacing + 1)
    );

    this.occupancy = new Array(this.lengths.length).fill(0);
    this.panelsOff = true;

    // Initialize panels as "full" (we'll open them if needed)
    for (let i = 6; i < this.occupancy.length; i++) {
      this.occupancy[i] = occupancyMax[i];
    }

    this.density = this.occupancy.map((occ, i) =>
      occupancyMax[i] === 0 ? 999 : occ / this.lengths[i]
    );

    this.assignments = new Array(n).fill(0);

    for (let i = 0; i < n; i++) {
      // Case 1: Find first empty segment
      const emptyIdx = this.density.findIndex(d => d === 0);
      if (emptyIdx !== -1) {
        this.assignments[i] = emptyIdx;
        this.occupancy[emptyIdx] = 1;
        this.density[emptyIdx] = this.occupancy[emptyIdx] / this.lengths[emptyIdx];
        continue;
      }

      // Case 2: Find segment with most remaining capacity
      const remaining = occupancyMax.map((max, idx) => max - this.occupancy[idx]);
      const maxRemaining = Math.max(...remaining);

      if (maxRemaining > 0) {
        const chosen = remaining.indexOf(maxRemaining);
        this.assignments[i] = chosen;
        this.occupancy[chosen]++;
        this.density[chosen] = this.occupancy[chosen] / this.lengths[chosen];
        continue;
      }

      // Case 3: Open the panels if they're still closed
      if (this.panelsOff && this.geometry.panelLength !== 0) {
        this.panelsOff = false;
        for (let j = 6; j < this.occupancy.length; j++) {
          this.occupancy[j] = 0;
        }
        this.density = this.occupancy.map((occ, idx) => occ / this.lengths[idx]);

        const newRemaining = occupancyMax.map((max, idx) => max - this.occupancy[idx]);
        const chosen = newRemaining.indexOf(Math.max(...newRemaining));
        this.assignments[i] = chosen;
        this.occupancy[chosen] = 1;
        this.density[chosen] = this.occupancy[chosen] / this.lengths[chosen];
        continue;
      }

      // Failed to place item
      if (!silent) {
        console.error(`Item ${i} could not be assigned with the constraints given`);
      }
      return -1;
    }

    return 1;
  }

  /**
   * Calculate maximum capacity of this gallery configuration
   */
  maxCapacity() {
    let i = 1;
    while (this.assignOccupancy(i) === 1) {
      i++;
    }
    return i - 1;
  }

  /**
   * Solve gallery layout for N items
   * Returns { positions: [[x,y,z],...], vectors: [[x,y],...], template: string }
   */
  solveGallery(n) {
    const result = this.assignOccupancy(n, false);
    if (result === -1) {
      return { positions: [], vectors: [], template: null };
    }

    const positions = new Array(n).fill(null).map(() => [0, 0, 0]);
    const vectors = new Array(n).fill(null).map(() => [0, 0]);
    const g = this.geometry;

    // Wall segment configurations: [getPosition(initial, j, spacing), vector]
    const wallConfigs = {
      1: (init, j, sp) => [[g.W / 2, init + j * sp, g.itemHeight], VECTORS.W],
      2: (init, j, sp) => [[init - j * sp, -g.L / 2, g.itemHeight], VECTORS.N],
      3: (init, j, sp) => [[init + j * sp, -g.L / 2, g.itemHeight], VECTORS.N],
      4: (init, j, sp) => [[-g.W / 2, init + j * sp, g.itemHeight], VECTORS.E],
      5: (init, j, sp) => [[init - j * sp, g.L / 2, g.itemHeight], VECTORS.S],
      6: (init, j, sp) => [[init + j * sp, g.L / 2, g.itemHeight], VECTORS.S],
      7: (init, j, sp) => [[-g.panelPositionX + g.panelThickness / 2, init + j * sp, g.itemHeight], VECTORS.E],
      8: (init, j, sp) => [[g.panelPositionX - g.panelThickness / 2, init + j * sp, g.itemHeight], VECTORS.W],
      9: (init, j, sp) => [[-g.panelPositionX + g.panelThickness / 2, init + j * sp, g.itemHeight], VECTORS.E],
      10: (init, j, sp) => [[g.panelPositionX - g.panelThickness / 2, init + j * sp, g.itemHeight], VECTORS.W],
      11: (init, j, sp) => [[-g.panelPositionX - g.panelThickness / 2, init + j * sp, g.itemHeight], VECTORS.W],
      12: (init, j, sp) => [[-g.panelPositionX - g.panelThickness / 2, init + j * sp, g.itemHeight], VECTORS.W],
      13: (init, j, sp) => [[g.panelPositionX + g.panelThickness / 2, init + j * sp, g.itemHeight], VECTORS.E],
      14: (init, j, sp) => [[g.panelPositionX + g.panelThickness / 2, init + j * sp, g.itemHeight], VECTORS.E]
    };

    // Initial position offsets for each wall segment
    const getInitial = (wallNum, length, spacing) => {
      switch (wallNum) {
        case 1: return -length / 2 + spacing / 2;
        case 2: return g.W / 2 - g.freeSpace - spacing / 2;
        case 3: return -g.W / 2 + g.freeSpace + spacing / 2;
        case 4: return -length / 2 + spacing / 2;
        case 5: return g.W / 2 - g.freeSpace - spacing / 2;
        case 6: return -g.W / 2 + g.freeSpace + spacing / 2;
        case 7: return g.panelPositionY - length / 2 + spacing / 2;
        case 8: return g.panelPositionY - length / 2 + spacing / 2;
        case 9: return -g.panelPositionY - length / 2 + spacing / 2;
        case 10: return -g.panelPositionY - length / 2 + spacing / 2;
        case 11: return g.panelPositionY - length / 2 + spacing / 2;
        case 12: return -g.panelPositionY - length / 2 + spacing / 2;
        case 13: return -g.panelPositionY - length / 2 + spacing / 2;
        case 14: return g.panelPositionY - length / 2 + spacing / 2;
        default: return 0;
      }
    };

    // Process each wall segment
    for (let i = 0; i < this.lengths.length; i++) {
      const wallNum = i + 1;
      const length = this.lengths[i];
      const wallAssigns = this.assignments
        .map((a, idx) => a === i ? idx : -1)
        .filter(idx => idx !== -1);

      if (wallAssigns.length === 0) continue;

      const spacing = length / (this.occupancy[i] + 0.0001);
      const initial = getInitial(wallNum, length, spacing);

      wallAssigns.forEach((assignIdx, j) => {
        const [pos, vec] = wallConfigs[wallNum](initial, j, spacing);
        positions[assignIdx] = pos;
        vectors[assignIdx] = vec;
      });
    }

    // Determine template based on configuration
    let template;
    if (this.geometry.panelLength === 0) {
      template = this._templateSmall || 'T_small.glb';
    } else if (this.panelsOff) {
      template = this._templateNopannels || 'T_nopannels.glb';
    } else {
      template = this._templatePannels || 'T_pannels.glb';
    }

    return { positions, vectors, template };
  }
}

/**
 * Factory function to create appropriate gallery based on item count
 */
function createGalleryManager(itemCount, smallThreshold = 25, templates = null) {
  const manager = itemCount > smallThreshold
    ? new GalleryWithOptionalPanels(30, 60, 15)
    : new GalleryWithOptionalPanels(30, 30, 0);

  // Override template names from style
  if (templates) {
    if (templates.small) manager._templateSmall = templates.small;
    if (templates.nopannels) manager._templateNopannels = templates.nopannels;
    if (templates.pannels) manager._templatePannels = templates.pannels;
  }

  return manager;
}

/**
 * Get image dimensions from a File object
 * Modern browsers auto-apply EXIF rotation
 */
async function getImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        name: file.name
      });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      reject(new Error(`Failed to load image: ${file.name}`));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Filter files to only include supported image types
 */
function filterImageFiles(files) {
  return Array.from(files).filter(file => {
    const ext = file.name.split('.').pop().toLowerCase();
    return IMAGE_TYPES.includes(ext);
  });
}

/**
 * Extract gallery name from folder path
 */
function getGalleryName(file) {
  // webkitRelativePath gives us "folderName/subfolder/file.jpg"
  const parts = file.webkitRelativePath.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : 'gallery';
}

/**
 * Group files by their parent folder
 */
function groupFilesByFolder(files) {
  const groups = {};

  files.forEach(file => {
    const parts = file.webkitRelativePath.split('/');
    // Get the immediate parent folder name
    const folderPath = parts.slice(0, -1).join('/');
    const folderName = parts.length > 1 ? parts[parts.length - 2] : 'root';

    if (!groups[folderPath]) {
      groups[folderPath] = {
        name: folderName,
        path: folderPath,
        files: []
      };
    }
    groups[folderPath].files.push(file);
  });

  return Object.values(groups);
}

/**
 * Build the complete gallery JSON structure
 * @param {Array} galleries - Array of {name, folderName, files} objects
 * @param {Function} onProgress - Progress callback (current, total, message)
 * @returns {Object} The building_v2.json structure
 */
async function buildGalleryJSON(galleries, onProgress = null, styleConfig = null) {
  const building = {};
  let uniqueId = 0;

  // Create root gallery
  const rootTemplate = styleConfig ? styleConfig.root : 'T_root.glb';
  building['root'] = {
    parent: 'none',
    resource: 'root.glb',
    template: rootTemplate
  };

  const templates = styleConfig ? styleConfig.templates : null;

  const totalImages = galleries.reduce((sum, g) => sum + g.files.length, 0);
  let processedImages = 0;

  // Get max capacity for overflow handling
  const galleryDist = new GalleryWithOptionalPanels();
  const maxItems = galleryDist.maxCapacity();

  for (const gallery of galleries) {
    const imageFiles = filterImageFiles(gallery.files);
    if (imageFiles.length === 0) continue;

    // Use custom name for gallery, but folderName for image paths
    const galleryDisplayName = gallery.name;
    const folderName = gallery.folderName || gallery.name;

    if (onProgress) {
      onProgress(processedImages, totalImages, `Processing ${galleryDisplayName}...`);
    }

    // Get dimensions for all images in this gallery
    const imageDimensions = [];
    for (const file of imageFiles) {
      try {
        const dims = await getImageDimensions(file);
        dims.file = file;
        imageDimensions.push(dims);
        processedImages++;
        if (onProgress) {
          onProgress(processedImages, totalImages, `Loading ${file.name}...`);
        }
      } catch (e) {
        console.warn(`Skipping ${file.name}: ${e.message}`);
        processedImages++;
      }
    }

    if (imageDimensions.length === 0) continue;

    // Handle overflow into multiple sub-galleries
    let itemsLeft = imageDimensions.length;
    let itemIndex = 0;
    let subGalleryIndex = 0;
    let lastParent = 'root';

    while (itemsLeft > 0) {
      const itemsForThisGallery = Math.min(itemsLeft, maxItems);
      const galleryManager = createGalleryManager(itemsForThisGallery, 25, templates);
      const { positions, vectors, template } = galleryManager.solveGallery(itemsForThisGallery);

      // Gallery naming: "gallery" or "gallery#1", "gallery#2" for overflow
      const galleryName = subGalleryIndex === 0
        ? galleryDisplayName
        : `${galleryDisplayName}#${subGalleryIndex}`;

      building[galleryName] = {
        parent: lastParent,
        resource: `${galleryName}.glb`,
        template: template
      };

      // Add images to this gallery
      for (let k = 0; k < itemsForThisGallery; k++) {
        const imgData = imageDimensions[itemIndex + k];
        const { width, height, name, file } = imgData;

        // Calculate aspect ratio (normalized to max dimension = 1)
        let normWidth, normHeight;
        const aspectRatio = height / width;
        if (aspectRatio <= 1) {
          normWidth = 1;
          normHeight = aspectRatio;
        } else {
          normWidth = 1 / aspectRatio;
          normHeight = 1;
        }

        // Get filename without extension for the key
        const baseName = name.replace(/\.[^/.]+$/, '');

        // Construct the resource path - use FOLDER name, not gallery display name
        const resourcePath = `/${folderName}/${name}`;

        building[galleryName][baseName] = {
          resource: resourcePath,
          resource_type: 'image',
          width: normWidth.toFixed(2),
          height: normHeight.toFixed(2),
          location: `[${positions[k][0].toFixed(3)},${positions[k][1].toFixed(3)},${positions[k][2].toFixed(3)}]`,
          vector: `[${vectors[k][0].toFixed(1)},${vectors[k][1].toFixed(1)}]`,
          metadata: `ID #${uniqueId} ${baseName}`
        };
        uniqueId++;
      }

      lastParent = galleryName;
      itemIndex += itemsForThisGallery;
      itemsLeft -= itemsForThisGallery;
      subGalleryIndex++;
    }
  }

  // Add doors between galleries
  for (const galleryName of Object.keys(building)) {
    const parent = building[galleryName].parent;
    if (parent && parent !== 'none') {
      // Door in parent pointing to this gallery
      building[parent][galleryName] = {
        resource: `${galleryName}.glb`,
        resource_type: 'door'
      };
      // Door in this gallery pointing to parent
      building[galleryName][parent] = {
        resource: `${parent}.glb`,
        resource_type: 'door'
      };
    }
  }

  // Add technical settings
  building['Technical'] = {
    ambientLight: 0.5,
    pointLight: 50,
    scaleFactor: galleryDist.geometry.itemMaxSize
  };

  // Merge gallery settings if available
  if (typeof GallerySettings !== 'undefined') {
    Object.assign(building['Technical'], GallerySettings.getValues());
  }

  if (onProgress) {
    onProgress(totalImages, totalImages, 'Done!');
  }

  return building;
}

/**
 * Build a map of resource path → File object for preview blob URLs.
 * @param {Array} galleries - Array of {name, folderName, files} objects
 * @returns {Object} Map of "/folderName/filename.jpg" → File
 */
function buildFileMap(galleries) {
  const fileMap = {};
  for (const gallery of galleries) {
    const folderName = gallery.folderName || gallery.name;
    const imageFiles = filterImageFiles(gallery.files);
    for (const file of imageFiles) {
      fileMap[`/${folderName}/${file.name}`] = file;
    }
  }
  return fileMap;
}

/**
 * Download JSON as a file
 */
function downloadJSON(data, filename = 'building_v2.json') {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GalleryWithOptionalPanels,
    createGalleryManager,
    getImageDimensions,
    filterImageFiles,
    groupFilesByFolder,
    buildGalleryJSON,
    buildFileMap,
    downloadJSON,
    IMAGE_TYPES
  };
}
