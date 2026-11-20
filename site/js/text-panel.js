/**
 * OpenVGAL Text Panel
 *
 * Renders typed text to a PNG with a transparent background: only the letters
 * are painted, so the viewer hangs it as lettering on the wall. The typed text
 * travels in the entry's metadata as `panel` (docs/gallery-json.md § Text panels);
 * nothing is stored inside the PNG.
 *
 * Standalone on purpose: no gallery, room or upload code, so the hosted editor
 * can load it from cdn.openvgal.com/core/js/text-panel.js. Fonts resolve against
 * this script's own URL (../fonts/), so the site copy and the CDN copy each find
 * theirs. Override with TextPanel.fontBase or opts.fontBase.
 *
 *   TextPanel.render({ text, font, align, scheme, size, name })
 *     → Promise<{ file, width, height, widthCm, heightCm, panel }>
 *   Rejects with an Error carrying `code`: 'empty' | 'too_long' | 'too_tall' | 'fonts'.
 */
var TextPanel = (function() {

  var MAX_CHARS = 2000;
  var MAX_HEIGHT_CM = 250;
  var MAX_PX = 3200;                     // longest edge of the PNG
  var SIZES = { S: 60, M: 120, L: 180 }; // width in cm, same buckets as the Customize editor
  var MARGIN = 0.08;                     // fraction of the width, on every side

  // Type sizes are physical (cm), not relative to the panel: a wider panel holds
  // more per line and comes out shorter. `before` is the gap above a block that
  // is not the first one.
  var PRESETS = {
    h1:   { size: 6.0, lead: 1.2,  bold: true,  before: 4.0 },
    h2:   { size: 4.2, lead: 1.25, bold: true,  before: 3.4 },
    body: { size: 3.0, lead: 1.45, bold: false, before: 2.4 }
  };

  // Lettering colour: 'light' paints dark text (for light walls), 'dark' paints
  // light text (for dark walls). The background is always transparent.
  var SCHEMES = {
    light: { ink: '#1d1c21' },
    dark:  { ink: '#ece8df' }
  };

  var FAMILIES = {
    serif: {
      name: 'OpenVGAL Panel Serif', generic: 'serif',
      faces: [
        { file: 'SourceSerif4-Regular.woff2', weight: '400', style: 'normal' },
        { file: 'SourceSerif4-It.woff2',      weight: '400', style: 'italic' },
        { file: 'SourceSerif4-Bold.woff2',    weight: '700', style: 'normal' },
        { file: 'SourceSerif4-BoldIt.woff2',  weight: '700', style: 'italic' }
      ]
    },
    sans: {
      name: 'OpenVGAL Panel Sans', generic: 'sans-serif',
      faces: [
        { file: 'Inter-Regular.woff2',    weight: '400', style: 'normal' },
        { file: 'Inter-Italic.woff2',     weight: '400', style: 'italic' },
        { file: 'Inter-Bold.woff2',       weight: '700', style: 'normal' },
        { file: 'Inter-BoldItalic.woff2', weight: '700', style: 'italic' }
      ]
    }
  };

  // Captured while this script executes; currentScript is null afterwards.
  var SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

  function panelError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function fontBase(opts) {
    var base = (opts && opts.fontBase) || api.fontBase ||
      new URL('../fonts/', SCRIPT_SRC || location.href).href;
    return base.charAt(base.length - 1) === '/' ? base : base + '/';
  }

  var _fontLoads = {};
  function loadFonts(familyKey, base) {
    var fam = FAMILIES[familyKey];
    var id = familyKey + '|' + base;
    if (!_fontLoads[id]) {
      _fontLoads[id] = Promise.all(fam.faces.map(function(f) {
        var face = new FontFace(fam.name, 'url("' + base + f.file + '")', { weight: f.weight, style: f.style });
        return face.load().then(function(loaded) { document.fonts.add(loaded); });
      })).catch(function() {
        delete _fontLoads[id]; // let a later attempt retry
        throw panelError('fonts', 'The panel fonts could not be loaded. Check the connection and try again.');
      });
    }
    return _fontLoads[id];
  }

  function normalize(opts) {
    opts = opts || {};
    return {
      text: String(opts.text || '').replace(/\r\n?/g, '\n'),
      font: FAMILIES[opts.font] ? opts.font : 'serif',
      align: opts.align === 'center' ? 'center' : 'left',
      scheme: SCHEMES[opts.scheme] ? opts.scheme : 'light',
      size: SIZES[opts.size] ? opts.size : 'M',
      name: opts.name
    };
  }

  function fileName(name) {
    var base = String(name || '').replace(/\.png$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
    return (base || 'text-panel') + '.png';
  }

  // "# " heading, "## " subheading, blank lines between paragraphs. A single
  // newline inside a paragraph stays a line break, as typed.
  function parseBlocks(text) {
    var blocks = [];
    var para = null;
    text.split('\n').forEach(function(line) {
      var m = /^(#{1,2})\s+(.*)$/.exec(line);
      if (m) {
        para = null;
        blocks.push({ kind: m[1].length === 1 ? 'h1' : 'h2', lines: [m[2].replace(/\s+$/, '')] });
        return;
      }
      if (!line.trim()) { para = null; return; }
      if (!para) { para = { kind: 'body', lines: [] }; blocks.push(para); }
      para.lines.push(line.replace(/\s+$/, ''));
    });
    return blocks;
  }

  // *italic*, **bold**, ***both***. An asterisk without a partner is plain text.
  function parseInline(s, bold, italic, out) {
    var buf = '';
    function flush() { if (buf) out.push({ text: buf, bold: bold, italic: italic }); buf = ''; }
    function closeSingle(from) {
      for (var k = from; k < s.length; k++) {
        if (s.charAt(k) !== '*') continue;
        if (s.charAt(k + 1) === '*') { k++; continue; } // part of a ** pair
        return k;
      }
      return -1;
    }
    var i = 0;
    while (i < s.length) {
      var j;
      if (s.substr(i, 3) === '***' && (j = s.indexOf('***', i + 3)) > i + 3) {
        flush(); parseInline(s.slice(i + 3, j), true, true, out); i = j + 3; continue;
      }
      if (s.substr(i, 2) === '**' && (j = s.indexOf('**', i + 2)) > i + 2) {
        flush(); parseInline(s.slice(i + 2, j), true, italic, out); i = j + 2; continue;
      }
      if (s.charAt(i) === '*' && s.charAt(i + 1) !== '*' && (j = closeSingle(i + 1)) > i + 1) {
        flush(); parseInline(s.slice(i + 1, j), bold, true, out); i = j + 1; continue;
      }
      buf += s.charAt(i);
      i++;
    }
    flush();
    return out;
  }

  function cssFont(fam, bold, italic, px) {
    return (italic ? 'italic ' : 'normal ') + (bold ? '700 ' : '400 ') + px + 'px "' + fam.name + '", ' + fam.generic;
  }

  // Greedy wrap of one typed line. Neighbouring styled runs with no space between
  // them ("**word**,") stay one word so the line never breaks inside it.
  function wrapLine(ctx, runs, fam, px, maxW) {
    function measure(font, t) { ctx.font = font; return ctx.measureText(t).width; }
    var items = [];
    var word = null;
    runs.forEach(function(r) {
      var font = cssFont(fam, r.bold, r.italic, px);
      r.text.split(/(\s+)/).forEach(function(part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { word = null; items.push({ space: part, font: font }); return; }
        if (!word) { word = { pieces: [] }; items.push(word); }
        word.pieces.push({ text: part, font: font });
      });
    });

    var lines = [];
    var cur = [], x = 0, pending = 0;
    function pushLine() { lines.push({ segs: cur, width: x }); cur = []; x = 0; }

    items.forEach(function(it) {
      if (it.space) { if (cur.length) pending = measure(it.font, it.space); return; }
      var w = 0;
      it.pieces.forEach(function(p) { w += measure(p.font, p.text); });
      if (cur.length && x + pending + w > maxW) { pushLine(); pending = 0; }
      x += pending;
      pending = 0;
      if (w <= maxW) {
        it.pieces.forEach(function(p) { cur.push({ text: p.text, font: p.font, x: x }); x += measure(p.font, p.text); });
        return;
      }
      // A single word wider than the panel: break it between characters.
      it.pieces.forEach(function(p) {
        var buf = '', bufX = x;
        Array.from(p.text).forEach(function(ch) {
          var cw = measure(p.font, ch);
          if (x + cw > maxW && (cur.length || buf)) {
            if (buf) cur.push({ text: buf, font: p.font, x: bufX });
            buf = '';
            pushLine();
            bufX = 0;
          }
          buf += ch;
          x += cw;
        });
        if (buf) cur.push({ text: buf, font: p.font, x: bufX });
      });
    });
    if (cur.length || lines.length === 0) pushLine();
    return lines;
  }

  // Positions every line in layout pixels. Returns { lines, height }.
  function layout(ctx, blocks, fam, pxPerCm, innerW) {
    var out = [];
    var y = 0;
    blocks.forEach(function(block, bi) {
      var p = PRESETS[block.kind];
      var px = p.size * pxPerCm;
      var lineH = px * p.lead;
      if (bi > 0) y += p.before * pxPerCm;
      block.lines.forEach(function(typed) {
        wrapLine(ctx, parseInline(typed, p.bold, false, []), fam, px, innerW).forEach(function(line) {
          // Baseline sits so the em box (ascent ≈ 0.8 em) is centred in the line box.
          out.push({ segs: line.segs, width: line.width, baseline: y + (lineH - px) / 2 + px * 0.8 });
          y += lineH;
        });
      });
    });
    return { lines: out, height: y };
  }

  // Draws the panel to a canvas. Validation runs before any drawing.
  async function draw(opts) {
    var o = normalize(opts);
    if (!o.text.trim()) throw panelError('empty', 'Type some text for the panel.');
    var chars = Array.from(o.text).length;
    if (chars > MAX_CHARS) {
      throw panelError('too_long', 'Text panels hold up to ' + MAX_CHARS.toLocaleString('en') +
        ' characters; this one has ' + chars.toLocaleString('en') + '. Shorten the text.');
    }
    await loadFonts(o.font, fontBase(opts));

    var fam = FAMILIES[o.font];
    var widthCm = SIZES[o.size];
    var pxPerCm = MAX_PX / widthCm; // layout scale; a panel taller than wide is scaled down below
    var margin = widthCm * MARGIN * pxPerCm;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var lay = layout(ctx, parseBlocks(o.text), fam, pxPerCm, MAX_PX - 2 * margin);

    var heightPx = lay.height + 2 * margin;
    var heightCm = heightPx / pxPerCm;
    if (heightCm > MAX_HEIGHT_CM) {
      throw panelError('too_tall', 'This text needs ' + Math.ceil(heightCm) + ' cm of height at size ' + o.size +
        ' (' + widthCm + ' cm wide); panels stop at ' + MAX_HEIGHT_CM + ' cm. Shorten the text or choose a wider size.');
    }

    var f = Math.min(1, MAX_PX / heightPx);
    canvas.width = Math.round(MAX_PX * f);
    canvas.height = Math.round(heightPx * f);
    ctx.scale(f, f);
    ctx.fillStyle = SCHEMES[o.scheme].ink;
    ctx.textBaseline = 'alphabetic';
    var innerW = MAX_PX - 2 * margin;
    lay.lines.forEach(function(line) {
      var left = margin + (o.align === 'center' ? (innerW - line.width) / 2 : 0);
      line.segs.forEach(function(seg) {
        ctx.font = seg.font;
        ctx.fillText(seg.text, left + seg.x, margin + line.baseline);
      });
    });
    return { canvas: canvas, options: o, widthCm: widthCm, heightCm: widthCm * canvas.height / canvas.width };
  }

  async function render(opts) {
    var d = await draw(opts);
    var blob = await new Promise(function(resolve) { d.canvas.toBlob(resolve, 'image/png'); });
    var width = d.canvas.width, height = d.canvas.height;
    d.canvas.width = d.canvas.height = 0; // release the backing store now
    if (!blob) throw panelError('encode', 'The panel image could not be created.');
    var o = d.options;
    return {
      file: new File([blob], fileName(o.name), { type: 'image/png' }),
      width: width,
      height: height,
      widthCm: d.widthCm,
      heightCm: d.heightCm,
      panel: { text: o.text, font: o.font, align: o.align, scheme: o.scheme }
    };
  }

  var api = {
    render: render,
    fileName: fileName,
    fontBase: null,
    SIZES: SIZES,
    MAX_CHARS: MAX_CHARS,
    MAX_HEIGHT_CM: MAX_HEIGHT_CM,
    MAX_PX: MAX_PX
  };
  return api;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextPanel;
}
