/**
 * OpenVGAL pack definition (ADR-0013 §2).
 *
 * The single answer to "what does a gallery pack contain?" — file lists,
 * template derivation, destination paths, where each file is fetched from, and
 * the generated text files. Data and pure functions only: no fetching, no
 * zipping, no DOM. Callers walk the description and supply the bytes.
 *
 * Consumers:
 *   - site/create/index.html  — zips the entries into a download
 *   - openvgal-site           — writes the entries to disk for an artist
 *
 * Both load this same deployed file (cdn.openvgal.com/core/js/pack-definition.js)
 * so the lists cannot drift apart. A hand-maintained copy falling behind the CDN
 * is what shipped galleries without their materials (4ecbd09).
 *
 * ---------------------------------------------------------------------------
 * Flavors (ADR-0008). The KERNEL is building_v2.json plus the user images, each
 * named `room/filename` — identical bytes and paths in every flavor, because
 * that is the cross-repo storage contract ({artist}/{hall}/{room}/{filename}).
 * A flavor is a per-asset-family choice of bundle-or-reference:
 *
 *   flavor  images   engine+templates  materials   delivery
 *   full    bundled  bundled           bundled     self-contained
 *   cdn     bundled  referenced(CDN)   referenced  thin client
 *   cloud   bundled  referenced        referenced  handed to a parent/backend
 *
 * Entry order is part of the contract: it fixes the order of entries in the
 * produced ZIP, so changing it changes shipped bytes.
 * ---------------------------------------------------------------------------
 *
 * Entry shape returned by describe():
 *   path       destination inside the pack
 *   kind       'remote' | 'image' | 'inline'
 *   url        (remote) absolute or caller-relative URL to fetch
 *   binary     (remote) true if the bytes must not be treated as text
 *   transform  (remote, optional) pure fn(text) -> text applied before writing
 *   source     (image) the manifest-relative path, e.g. '/room/file.jpg'
 *   content    (inline) the exact text to write
 *   label      progress message for this entry
 */
(function(global) {
  'use strict';

  // Materials fetched from the CDN for the self-contained (full) pack.
  // This mirrors cdn/materials/ in full — every JSON and every texture, not
  // just the ones currently referenced. Curating the list by hand let styles
  // ship without their material, so the pack takes the whole folder instead.
  // When a file is added to cdn/materials/, add it here too.
  var MATERIALS = [
    'materials/BJS_PBRmidgrey.json',
    'materials/BJS_PBRwhite.json',
    'materials/BJS_asphalt1k.json',
    'materials/BJS_black_metal.json',
    'materials/BJS_blackrubber1k.json',
    'materials/BJS_chrome.json',
    'materials/BJS_creme1k.json',
    'materials/BJS_default_floor.json',
    'materials/BJS_default_wall.json',
    'materials/BJS_glow.json',
    'materials/BJS_glow_masked.json',
    'materials/BJS_marble1k.json',
    'materials/BJS_plaster1k.json',
    'materials/BJS_rough_cream.json',
    'materials/BJS_rust.json',
    'materials/BJS_white.json',
    'materials/BJS_wood.json',
    'materials/logo.png',
    'materials/shadow.png',
    // Texture folders
    'materials/asphalt1k/Asphalt031_1K-JPG_Color.jpg',
    'materials/blackrubber1k/Rubber001_1K-JPG_Color.jpg',
    'materials/creme1k/Concrete048_1K-JPG_Color.jpg',
    'materials/marble1k/Marble019_1K-JPG_Color.jpg',
    'materials/plaster1k/Plaster001_1K-JPG_Color.jpg',
    'materials/rust2/Rust006.png',
    'materials/rust2/Rust006_1K-JPG_Color.jpg',
    'materials/rust2/Rust006_1K-JPG_Displacement.jpg',
    'materials/rust2/Rust006_1K-JPG_Metalness.jpg',
    'materials/rust2/Rust006_1K-JPG_NormalDX.jpg',
    'materials/rust2/Rust006_1K-JPG_NormalGL.jpg',
    'materials/rust2/Rust006_1K-JPG_Roughness.jpg',
    'materials/wood_floor/WoodFloor051_2K_AmbientOcclusion.jpg',
    'materials/wood_floor/WoodFloor051_2K_Color.jpg',
    'materials/wood_floor/WoodFloor051_2K_Displacement.jpg',
    'materials/wood_floor/WoodFloor051_2K_NormalDX.jpg',
    'materials/wood_floor/WoodFloor051_2K_NormalGL.jpg',
    'materials/wood_floor/WoodFloor051_2K_Roughness.jpg',
    'materials/wood_floor/WoodFloor051_PREVIEW.jpg'
  ];

  // Viewer/engine files bundled by the full pack. Names are both the source
  // name under viewerBase and the destination path inside the pack.
  var VIEWER_FILES = [
    'viewer.html',
    'openvgal-viewer.js',
    'openvgal-lighting.js',
    'room_builder_aux.js',
    'overlay.js',
    'overlay.html',
    'overlay.css',
    'babylon.js',
    'babylonjs.loaders.min.js',
    'icons/keyboard_move.png',
    'icons/keyboard_pan.png',
    'icons/touch_move.png',
    'icons/touch_pan.png'
  ];

  // Where the style catalog lives, relative to cdnBase. Callers fetch it and
  // hand the parsed object in; this file never fetches.
  var CATALOG_PATH = '/templates/catalog.json';

  // Deployment declarations.js for the self-contained pack (local resolution).
  var DECLARATIONS_JS = [
    '// OpenVGAL Viewer Configuration',
    '// Generated by OpenVGAL Generator',
    '//',
    "// Deployment path: '.' means relative to viewer.html — works in any subfolder.",
    '// Examples:',
    "//   Root:      https://example.com/          -> keep '.'",
    "//   Subfolder: https://example.com/gallery/  -> keep '.'",
    "//   Custom:    set to '/my/path' if assets are served from a different location",
    "var openvgal_location = '.';",
    '',
    "var glb_location = openvgal_location + '/templates/';",
    "var config_file_name = openvgal_location + '/building_v2.json';",
    "var materials_folder = openvgal_location + '/materials';",
    "var hallspics_prefix = openvgal_location + '';",
    'window.resolveImageUrl = function(path) { return hallspics_prefix + path; };',
    '',
    '// Program constants',
    'var regul_exp_door = /^d_/;',
    'var regul_exp_tail = /_[0-9]*$/;',
    'var regul_exp_artworks = /_\\d{1,3}$/;',
    'var frame_material = "BJS_white";',
    ''
  ].join('\n');

  var BINARY_RE = /\.(png|jpg|jpeg|gif|webp|glb)$/i;

  // --- style derivation -------------------------------------------------
  //
  // The manifest is the only required input. A consumer retrieving a published
  // gallery has building_v2.json and nothing else — no picker, no DOM — so the
  // style must be recoverable from `config.root.template` alone, against the
  // catalog that is already published engine data.

  // The one implementation: match a root GLB name to a style key.
  // Returns null when nothing matches. StylePicker.inferStyleFromTemplate()
  // is a thin wrapper over this so there is no second copy.
  function styleKeyFromTemplate(catalog, templateName) {
    var styles = (catalog && catalog.styles) || {};
    var keys = Object.keys(styles);
    for (var i = 0; i < keys.length; i++) {
      if (styles[keys[i]].root === templateName) return keys[i];
    }
    return null;
  }

  /**
   * Resolve the style a manifest was built on.
   *
   * Throws when it cannot. A gallery on a style we failed to recognise would
   * otherwise receive some other style's rooms and only fail at view time —
   * the same silent-wrong-contents failure 4ecbd09 fixed, relocated. An
   * uncertain answer is a failure, not an answer.
   *
   * @returns {{key: string, config: object}}
   */
  function resolveStyle(config, catalog, galleryName) {
    var template = config && config.root && config.root.template;
    var who = galleryName ? '"' + galleryName + '"' : 'gallery';
    if (!template) {
      throw new Error(
        'Cannot describe pack for ' + who + ': manifest has no root.template.'
      );
    }
    var key = styleKeyFromTemplate(catalog, template);
    if (!key) {
      var known = Object.keys((catalog && catalog.styles) || {});
      throw new Error(
        'Cannot describe pack for ' + who + ': no style in the catalog has ' +
        'root template "' + template + '" (known styles: ' +
        (known.length ? known.join(', ') : 'none — catalog missing or empty') + ').'
      );
    }
    return { key: key, config: catalog.styles[key] };
  }

  // A style's whole set — its root and every shape GLB, not just the shapes the
  // gallery's current rooms happen to use. That is what a `full` zip contains,
  // and the two must not diverge. styleConfig is a catalog style entry:
  // { root, glbs: { shape: file } }.
  function templateList(styleConfig) {
    var list = ['templates/' + styleConfig.root];
    var glbs = styleConfig.glbs || {};
    Object.keys(glbs).forEach(function(shape) {
      list.push('templates/' + glbs[shape]);
    });
    return list;
  }

  // viewer.html ships with the deployment path pinned to the pack root.
  function pinViewerLocation(content) {
    return content.replace(
      /window\.openvgal_location = '[^']*';/,
      "window.openvgal_location = '.';"
    );
  }

  function galleryFolders(config) {
    return Object.keys(config).filter(function(k) {
      return k !== 'Technical' && k !== 'root';
    });
  }

  function readmeFull(config) {
    var folders = galleryFolders(config);
    return '# OpenVGAL Virtual Gallery\n\n' +
      'Your virtual 3D art gallery is ready to deploy!\n\n' +
      '## Quick Start\n\n' +
      '1. Extract this ZIP to your web server folder\n' +
      '2. Open viewer.html in a browser (or serve with any web server)\n\n' +
      'Your images are already included in the ZIP under these folders:\n' +
      folders.map(function(k) { return '- ' + k + '/'; }).join('\n') + '\n\n' +
      '## Folder Structure\n\n```\nyour-gallery/\n' +
      '├── viewer.html         # Main viewer\n' +
      '├── building_v2.json    # Gallery configuration\n' +
      '├── declarations.js     # Path configuration\n' +
      '├── templates/          # 3D room templates\n' +
      '├── materials/          # Textures and materials\n' +
      folders.map(function(k) { return '├── ' + k + '/               # Your images'; }).join('\n') + '\n' +
      '├── overlay.js          # UI overlay\n' +
      '├── overlay.html        # UI overlay markup\n' +
      '├── overlay.css         # UI styles\n' +
      '└── babylon.js          # 3D engine\n```\n\n' +
      '## Deploying to a Subfolder\n\n' +
      'This gallery works in any subfolder — just extract and serve. All paths are\n' +
      'relative to viewer.html, so no configuration needed. For example:\n' +
      '- https://example.com/ (root)\n' +
      '- https://example.com/gallery/ (subfolder)\n' +
      '- https://example.com/art/my-gallery/ (nested subfolder)\n\n' +
      'If you need to customize paths, edit `declarations.js`.\n\n' +
      '## Custom Logo\n\n' +
      'Replace `materials/logo.png` with your own image.\n' +
      'Use white artwork on a black background (the white areas will glow).\n' +
      'Recommended size: 1024x512 px, PNG format.\n\n' +
      '## Attribution\n\n' +
      'This pack resolves `overlay.html` locally, so removing the\n' +
      '`Made with OpenVGal` link from that file removes it from your gallery (MIT licence).\n\n' +
      '## Need Help?\n\n' +
      'Visit https://openvgal.com for documentation and support.\n\n' +
      'Generated with OpenVGAL Generator\n';
  }

  function readmeCdn(config) {
    var folders = galleryFolders(config);
    return '# OpenVGAL Virtual Gallery (CDN-first)\n\n' +
      'Your virtual 3D art gallery is ready to deploy!\n\n' +
      '## Quick Start\n\n' +
      '1. Extract this ZIP to your web server folder\n' +
      '2. Open `index.html` in a browser\n\n' +
      '## How it works\n\n' +
      'This gallery uses **CDN-first deployment**. All viewer code (babylon.js,\n' +
      'templates, materials, overlay) loads from `cdn.openvgal.com`. Your deployment\n' +
      'only contains content and configuration:\n\n' +
      '```\nyour-gallery/\n' +
      '  index.html          <- viewer (loads scripts from CDN)\n' +
      '  building_v2.json    <- gallery configuration\n' +
      folders.map(function(k) { return '  ' + k + '/               <- your images'; }).join('\n') + '\n```\n\n' +
      '## Updating\n\n' +
      'Code updates happen automatically via CDN. To update your gallery content,\n' +
      'just replace `building_v2.json` and your image folders.\n\n' +
      '## Customization\n\n' +
      '- **Custom logo**: Add `materials/logo.png` next to index.html. White artwork\n' +
      '  on black background, 1024x512 px recommended. The viewer checks for a local\n' +
      '  logo first, then falls back to the CDN default.\n' +
      '- **Custom overlay**: Add `overlay.js` next to index.html to override the\n' +
      '  default CDN overlay behavior.\n' +
      '- **Attribution**: the overlay markup comes from the CDN, so removing the\n' +
      '  `Made with OpenVGal` link means editing your own `overlay.js` (MIT licence).\n\n' +
      '## Need the self-contained version?\n\n' +
      'Visit https://openvgal.com/create/ for a ZIP that includes all code and\n' +
      'works offline (no CDN dependency).\n\n' +
      '## Need Help?\n\n' +
      'Visit https://openvgal.com for documentation and support.\n\n' +
      'Generated with OpenVGAL Generator (CDN-first mode)\n';
  }

  // Thin loader that fetches viewer.html from the CDN at runtime. The page
  // origin stays local so building_v2.json and images resolve locally.
  function cdnIndexHtml(cdnBase) {
    return '<!DOCTYPE html>\n' +
      '<html><head><meta charset="utf-8"></head>\n' +
      '<body style="margin:0;background:#000;color:#a1a1aa;font-family:Inter,system-ui,sans-serif;' +
      'display:flex;align-items:center;justify-content:center;height:100vh">\n' +
      '<p id="cdn-status">Loading gallery...</p>\n' +
      '<script>\n' +
      'fetch("' + cdnBase + '/core/viewer.html")\n' +
      '  .then(function(r) { if (!r.ok) throw new Error(r.status); return r.text(); })\n' +
      '  .then(function(html) { document.open(); document.write(html); document.close(); })\n' +
      '  .catch(function(e) { document.getElementById("cdn-status").textContent = "Failed to load viewer from CDN: " + e.message; });\n' +
      '<\/script>\n' +
      '</body></html>';
  }

  function manifestText(config) {
    return JSON.stringify(config, null, 2);
  }

  // --- entry builders ---------------------------------------------------

  function remoteEntry(path, url, binary, transform) {
    return {
      path: path,
      kind: 'remote',
      url: url,
      binary: binary,
      transform: transform,
      label: 'Fetched ' + path
    };
  }

  function inlineEntry(path, content, verb) {
    return {
      path: path,
      kind: 'inline',
      content: content,
      label: verb + ' ' + path
    };
  }

  // imagePath is manifest-relative with a leading slash ('/room/file.jpg');
  // the pack drops the slash and keeps the rest verbatim.
  function imageEntry(imagePath) {
    var path = imagePath.replace(/^\//, '');
    return {
      path: path,
      kind: 'image',
      source: imagePath,
      label: 'Added ' + path
    };
  }

  function templateEntries(cdnBase, styleConfig) {
    return templateList(styleConfig).map(function(file) {
      return remoteEntry(file, cdnBase + '/' + file, true);
    });
  }

  function materialEntries(cdnBase) {
    return MATERIALS.map(function(file) {
      return remoteEntry(file, cdnBase + '/' + file, true);
    });
  }

  function viewerEntries(viewerBase) {
    return VIEWER_FILES.map(function(file) {
      var binary = BINARY_RE.test(file);
      return remoteEntry(
        file,
        viewerBase + file,
        binary,
        file === 'viewer.html' ? pinViewerLocation : undefined
      );
    });
  }

  function imageEntries(imagePaths) {
    return imagePaths.map(imageEntry);
  }

  /**
   * Describe a pack as an ordered list of entries.
   *
   * @param {string} flavor  'full' | 'cdn' | 'cloud'
   * @param {object} opts
   *   config       {object}   building_v2.json contents (required)
   *   imagePaths   {string[]} manifest-relative image paths, '/room/file.jpg'
   *   catalog      {object}   parsed templates/catalog.json (required for 'full')
   *   styleConfig  {object}   optional hint: a catalog style entry already in
   *                           hand (the create flow's picker selection). When
   *                           absent the style is derived from the manifest.
   *   galleryName  {string}   optional, only to name the gallery in errors
   *   cdnBase      {string}   prefix for templates/materials, no trailing slash
   *   viewerBase   {string}   prefix for engine files, WITH trailing slash
   *   update       {boolean}  cdn flavor only: kernel-only update package
   * @returns {object[]} ordered entries
   * @throws  {Error}    'full' flavor whose style cannot be resolved
   */
  function describe(flavor, opts) {
    opts = opts || {};
    var config = opts.config;
    var images = imageEntries(opts.imagePaths || []);
    var cdnBase = opts.cdnBase || '';

    if (flavor === 'full') {
      var styleConfig = opts.styleConfig && opts.styleConfig.root
        ? opts.styleConfig
        : resolveStyle(config, opts.catalog, opts.galleryName).config;
      return [].concat(
        templateEntries(cdnBase, styleConfig),
        materialEntries(cdnBase),
        viewerEntries(opts.viewerBase || ''),
        images,
        [inlineEntry('declarations.js', DECLARATIONS_JS, 'Created')],
        [inlineEntry('building_v2.json', manifestText(config), 'Added')],
        [inlineEntry('README.md', readmeFull(config), 'Added')]
      );
    }

    // cloud: the kernel alone — every family referenced, nothing else bundled.
    if (flavor === 'cloud') {
      return [inlineEntry('building_v2.json', manifestText(config), 'Added')]
        .concat(images);
    }

    // cdn: an update package is the kernel alone; otherwise a thin-client pack.
    if (opts.update) {
      return [inlineEntry('building_v2.json', manifestText(config), 'Added')]
        .concat(images);
    }
    return [].concat(
      [inlineEntry('index.html', cdnIndexHtml(cdnBase), 'Created')],
      [inlineEntry('building_v2.json', manifestText(config), 'Added')],
      images,
      [inlineEntry('README.md', readmeCdn(config), 'Added')]
    );
  }

  global.OpenVGALPack = {
    MATERIALS: MATERIALS,
    VIEWER_FILES: VIEWER_FILES,
    DECLARATIONS_JS: DECLARATIONS_JS,
    CATALOG_PATH: CATALOG_PATH,
    styleKeyFromTemplate: styleKeyFromTemplate,
    resolveStyle: resolveStyle,
    templateList: templateList,
    readmeFull: readmeFull,
    readmeCdn: readmeCdn,
    cdnIndexHtml: cdnIndexHtml,
    describe: describe
  };
})(typeof window !== 'undefined' ? window : globalThis);
