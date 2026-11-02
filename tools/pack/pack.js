#!/usr/bin/env node
'use strict';
/**
 * Headless cloud-pack builder (OIP-0012). Turns a folder of room folders into
 * the cloud pack (ADR-0008): building_v2.json at the root, images at
 * room/filename. Layout and packing are the generator's own code — see
 * node-env.js — so the manifest matches what /create builds from the same input.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { pathToFileURL } = require('node:url');
const JSZip = require('jszip');
const { loadEngine } = require('./node-env');

const USAGE = [
  'Usage: node tools/pack/pack.js <folder> --style <key> [--out <file.zip>] [--cdn <dir|url>]',
  '',
  '  <folder>   each direct subfolder is one room; its images are the artworks',
  '  --style    a style key from templates/catalog.json (e.g. classic)',
  '  --out      ZIP to write (default: openvgal-gallery-cloud.zip)',
  '  --cdn      templates source: a local cdn folder (default: this repo\'s cdn/)',
  '             or a URL such as https://cdn.openvgal.com'
].join('\n');

function fail(message) {
  console.error('Error: ' + message);
  process.exit(1);
}

function cdnBaseFrom(value) {
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '');
  return pathToFileURL(path.resolve(value)).href.replace(/\/+$/, '');
}

const byName = function(a, b) { return a.localeCompare(b, undefined, { numeric: true }); };

function listDir(dir, wantDirs) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(function(d) { return wantDirs ? d.isDirectory() : d.isFile(); })
    .map(function(d) { return d.name; })
    .sort(byName);
}

// One room per direct subfolder, screened and ordered the way the page's
// drop-zone does it (gallery-page.js _addGroup). Folders and unnumbered files
// are taken in name order; a browser takes them in the order the OS lists them.
async function readGalleries(root, generator) {
  const galleries = [];
  const rejected = [];
  for (const room of listDir(root, true)) {
    const dir = path.join(root, room);
    const files = listDir(dir, false).map(function(name) {
      const full = path.join(dir, name);
      return new File([fs.readFileSync(full)], name, { lastModified: fs.statSync(full).mtimeMs });
    });
    const screened = await generator.screenImageFiles(files);
    screened.rejected.forEach(function(name) { rejected.push(room + '/' + name); });
    if (screened.accepted.length === 0) continue;
    const ordered = generator.orderBySequence(screened.accepted);
    galleries.push({ name: room, folderName: room, path: room, files: ordered.files });
  }
  return { galleries: galleries, rejected: rejected };
}

async function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        style: { type: 'string' },
        out: { type: 'string', default: 'openvgal-gallery-cloud.zip' },
        cdn: { type: 'string', default: path.resolve(__dirname, '..', '..', 'cdn') },
        help: { type: 'boolean', short: 'h' }
      }
    });
  } catch (e) {
    fail(e.message + '\n\n' + USAGE);
  }
  if (args.values.help) { console.log(USAGE); return; }
  const root = args.positionals[0];
  if (!root || args.positionals.length > 1) fail('give exactly one folder\n\n' + USAGE);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('not a folder: ' + root);
  if (!args.values.style) fail('--style is required\n\n' + USAGE);

  const { generator, pack } = loadEngine();
  const cdnBase = cdnBaseFrom(args.values.cdn);
  const catalog = await generator.loadCatalog(cdnBase);
  const styleConfig = catalog.styles && catalog.styles[args.values.style];
  if (!styleConfig) {
    fail('unknown style "' + args.values.style + '" (known: ' + Object.keys(catalog.styles || {}).join(', ') + ')');
  }

  const { galleries, rejected } = await readGalleries(root, generator);
  rejected.forEach(function(name) { console.warn('Skipped (not a PNG, JPEG or WebP): ' + name); });
  if (galleries.length === 0) fail('no subfolder of ' + root + ' holds a usable image');

  const config = await generator.buildGalleryJSON(galleries, null, styleConfig, { cdnBase: cdnBase });
  const fileMap = generator.buildFileMap(galleries, config);
  const entries = pack.describe('cloud', { config: config, imagePaths: Object.keys(fileMap) });

  const zip = new JSZip();
  for (const entry of entries) {
    if (entry.kind === 'inline') {
      zip.file(entry.path, entry.content);
    } else if (entry.kind === 'image') {
      const file = fileMap[entry.source];
      if (!file) fail('no file for ' + entry.source);
      zip.file(entry.path, Buffer.from(await file.arrayBuffer()), { compression: 'STORE' });
    } else {
      fail('cloud pack described an unexpected ' + entry.kind + ' entry: ' + entry.path);
    }
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(args.values.out, bytes);

  const rooms = Object.keys(config).filter(function(k) { return k !== 'Technical' && k !== 'root' && !/^root#/.test(k); });
  console.log('Wrote ' + args.values.out + ': ' + rooms.length + ' room(s), ' +
    Object.keys(fileMap).length + ' image(s), style ' + args.values.style);
}

main().catch(function(e) { fail(e && e.stack || String(e)); });
