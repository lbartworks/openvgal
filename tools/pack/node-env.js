'use strict';
/**
 * Runs the generator's own browser scripts in Node.
 *
 * Nothing here re-implements layout or packing. It loads site/js/*.js and the
 * site's own Babylon build as-is, and supplies the three browser APIs they
 * touch on this path:
 *   fetch          — Node's fetch has no file: scheme; templates come from disk
 *   XMLHttpRequest — Babylon's SceneLoader reads GLBs through it (occupancy probe)
 *   Image          — getImageDimensions() measures via <img>; here the bytes are
 *                    measured by image-dimensions.js, orientation-corrected
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fileURLToPath } = require('node:url');
const { resolveObjectURL } = require('node:buffer');
const { measureImage } = require('./image-dimensions');

const SITE = path.resolve(__dirname, '..', '..', 'site');
const netFetch = globalThis.fetch;

async function fetchAny(url, init) {
  const href = String(url);
  if (!href.startsWith('file:')) return netFetch(href, init);
  try {
    return new Response(await fs.promises.readFile(fileURLToPath(href)));
  } catch (e) {
    return new Response(null, { status: 404, statusText: 'Not Found' });
  }
}

// The subset of XMLHttpRequest that Babylon's WebRequest uses.
class NodeXMLHttpRequest {
  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.response = null;
    this.responseText = '';
    this.responseType = '';
    this.responseURL = '';
    this.timeout = 0;
    this.withCredentials = false;
    this._listeners = {};
    this._headers = null;
    this._aborted = false;
  }
  open(method, url) { this._method = method; this._url = url; this.readyState = 1; }
  setRequestHeader() {}
  overrideMimeType() {}
  getResponseHeader(name) { return this._headers ? this._headers.get(name) : null; }
  getAllResponseHeaders() { return ''; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(function(f) { return f !== fn; });
  }
  abort() { this._aborted = true; }
  _emit(type) {
    const ev = { type: type, target: this, lengthComputable: false, loaded: 0, total: 0 };
    if (typeof this['on' + type] === 'function') this['on' + type](ev);
    (this._listeners[type] || []).slice().forEach((fn) => fn.call(this, ev));
  }
  send() {
    fetchAny(this._url, { method: this._method }).then(async (res) => {
      const bytes = await res.arrayBuffer();
      if (this._aborted) return;
      this.status = res.status;
      this.statusText = res.statusText;
      this.responseURL = this._url;
      this._headers = res.headers;
      if (this.responseType === 'arraybuffer') {
        this.response = bytes;
      } else {
        this.responseText = new TextDecoder().decode(bytes);
        this.response = this.responseType === 'json' ? JSON.parse(this.responseText) : this.responseText;
      }
      this.readyState = 4;
      this._emit('readystatechange');
      this._emit('load');
      this._emit('loadend');
    }, () => {
      if (this._aborted) return;
      this.readyState = 4;
      this._emit('readystatechange');
      this._emit('error');
      this._emit('loadend');
    });
  }
}
NodeXMLHttpRequest.UNSENT = 0;
NodeXMLHttpRequest.OPENED = 1;
NodeXMLHttpRequest.HEADERS_RECEIVED = 2;
NodeXMLHttpRequest.LOADING = 3;
NodeXMLHttpRequest.DONE = 4;

// Enough of <img> for getImageDimensions(): src is a blob: URL of a File.
class NodeImage {
  get src() { return this._src; }
  set src(url) {
    this._src = url;
    const blob = resolveObjectURL(url);
    Promise.resolve(blob ? blob.arrayBuffer() : Promise.reject(new Error('not a blob: URL')))
      .then((bytes) => {
        const dims = measureImage(Buffer.from(bytes));
        this.naturalWidth = this.width = dims.width;
        this.naturalHeight = this.height = dims.height;
        if (this.onload) this.onload();
      })
      .catch((e) => { if (this.onerror) this.onerror(e); });
  }
}

function runSiteScript(rel) {
  const file = path.join(SITE, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}

let loaded = null;

function loadEngine() {
  if (loaded) return loaded;
  globalThis.fetch = fetchAny;
  globalThis.XMLHttpRequest = NodeXMLHttpRequest;
  globalThis.Image = NodeImage;

  // Run as plain scripts so each defines its browser global (BABYLON,
  // GallerySettings, OpenVGALPack) exactly as the page's <script> tags do.
  runSiteScript('babylon.js');
  runSiteScript('babylonjs.loaders.min.js');
  globalThis.BABYLON.Logger.LogLevels = globalThis.BABYLON.Logger.WarningLogLevel | globalThis.BABYLON.Logger.ErrorLogLevel;
  runSiteScript('js/gallery-settings.js');
  runSiteScript('js/pack-definition.js');

  loaded = {
    generator: require(path.join(SITE, 'js', 'gallery-generator.js')),
    pack: globalThis.OpenVGALPack
  };
  return loaded;
}

module.exports = { loadEngine };
