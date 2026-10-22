/*!
 * patterns-extra.js
 * Extra A/B-composite reveal patterns for the Color Tap me generator.
 *
 * How it plugs in (no edits to script.min.js needed):
 *   1. Adds an <optgroup> with the new patterns to #abPatternSelect.
 *   2. Wraps the global isCheckerboardVisiblePixel(x, y). For a new pattern id it answers
 *      itself; for every other id it falls through to the original function.
 *
 * Convention (same as the built-in patterns):
 *   return true  -> pixel is KEPT (visible in B')
 *   return false -> pixel becomes fully transparent (index 255)
 * Pattern Scale is honoured: coordinates are divided by the scale first.
 */
(function () {
  'use strict';

  var m = function (a, n) { return ((a % n) + n) % n; };

  // Wrapped signed distance on a repeating axis, result in [-P/2, P/2)
  var wrap = function (v, c, P) { return m(v - c + P / 2, P) - P / 2; };

  // ---- 1. Exact 16x16 tile measured from the reference image (48 dots, 18.75 %) ----
  var REF16_ROWS = [
    '#........#......',
    '.#......#.#....#',
    '#.#....#.#.#..#.',
    '.#.#..#.#.#....#',
    '#.#....#.#......',
    '.#......#.......',
    '................',
    '................',
    '.#......#.......',
    '#.#....#.#......',
    '.#.#..#.#.#....#',
    '#.#....#.#.#..#.',
    '.#......#.#....#',
    '#........#......',
    '................',
    '................'
  ];
  var REF16 = REF16_ROWS.map(function (r) {
    return r.split('').map(function (c) { return c === '#' ? 1 : 0; });
  });

  // Bold version: every dot also lights the pixel to its right (2x1 dots)
  var REF16_BOLD = REF16.map(function (row, y) {
    return row.map(function (v, x) { return (v || REF16[y][(x + 15) & 15]) ? 1 : 0; });
  });

  // ---- 1b. Resample-trick tile (measured from a working 2016x3584 original; 6 of 16 pixels = 37.5 %) ----
  // Meant for LARGE originals (e.g. 2016x3584). When X shrinks such an image for the feed/preview, this fine
  // pattern turns into a much sparser one, so the shrunken copy shows mostly image A.
  var RES4_ROWS = [
    '...#',
    '#.#.',
    '.#..',
    '#.#.'
  ];
  var RES4 = RES4_ROWS.map(function (r) {
    return r.split('').map(function (c) { return c === '#' ? 1 : 0; });
  });

  // ---- pattern table ----
  var PATTERNS = [
    {
      id: 'xRes4',
      label: '★ Resample 4×4 • 37.5% (for 2016×3584 originals)',
      fn: function (sx, sy) { return RES4[sy & 3][sx & 3] === 1; }
    },
    {
      id: 'xLatticeRef16',
      label: '★ Diamond Lattice 16×16 (reference tile)',
      fn: function (sx, sy) { return REF16[sy & 15][sx & 15] === 1; }
    },
    {
      id: 'xLatticeRef16Bold',
      label: '★ Diamond Lattice 16×16 • Bold dots',
      fn: function (sx, sy) { return REF16_BOLD[sy & 15][sx & 15] === 1; }
    },
    {
      id: 'xLatticeRef16Inv',
      label: 'Diamond Lattice 16×16 • Inverted (keeps the gaps)',
      fn: function (sx, sy) { return REF16[sy & 15][sx & 15] === 0; }
    },
    {
      // Diamond outline made of exactly 12 dots: |dx|+|dy| == 3
      id: 'xRing12',
      label: '★ Diamond Ring • 12 dots (8×8)',
      fn: function (sx, sy) {
        var dx = wrap(sx, 4, 8), dy = wrap(sy, 4, 8);
        return Math.abs(dx) + Math.abs(dy) === 3;
      }
    },
    {
      id: 'xRing12Core',
      label: 'Diamond Ring + Core Dot • 13 dots (8×8)',
      fn: function (sx, sy) {
        var dx = wrap(sx, 4, 8), dy = wrap(sy, 4, 8);
        var d = Math.abs(dx) + Math.abs(dy);
        return d === 3 || d === 0;
      }
    },
    {
      // 12-dot rings on a staggered (quincunx) lattice = 24 dots per 8x8
      id: 'xRing12Quincunx',
      label: 'Diamond Rings Quincunx • 24 dots (8×8)',
      fn: function (sx, sy) {
        var a = Math.abs(wrap(sx, 4, 8)) + Math.abs(wrap(sy, 4, 8));
        var b = Math.abs(wrap(sx, 0, 8)) + Math.abs(wrap(sy, 0, 8));
        return a === 3 || b === 3;
      }
    },
    {
      // Solid diamond filled in a checker (every other pixel) = 25 dots, like the reference motif
      id: 'xChecker25',
      label: 'Checker-Filled Diamond • 25 dots (10×10)',
      fn: function (sx, sy) {
        var dx = wrap(sx, 5, 10), dy = wrap(sy, 5, 10);
        var d = Math.abs(dx) + Math.abs(dy);
        return d <= 4 && (d & 1) === 0;
      }
    },
    {
      // Two interleaved diamond outlines (argyle weave)
      id: 'xArgyle16',
      label: 'Argyle Weave 16×16',
      fn: function (sx, sy) {
        var a = Math.abs(wrap(sx, 0, 16)) + Math.abs(wrap(sy, 0, 16));
        var b = Math.abs(wrap(sx, 8, 16)) + Math.abs(wrap(sy, 8, 16));
        return a === 7 || b === 7;
      }
    },
    {
      // Concentric dotted diamonds: core + ring r=3 + ring r=7
      id: 'xNested16',
      label: 'Nested Diamond Rings 16×16',
      fn: function (sx, sy) {
        var d = Math.abs(wrap(sx, 8, 16)) + Math.abs(wrap(sy, 8, 16));
        return d <= 7 && (d === 0 || d % 4 === 3);
      }
    },
    {
      id: 'xWeave8',
      label: 'Diagonal Weave 8×8',
      fn: function (sx, sy) { return m(sx + sy, 8) === 0 || m(sx - sy, 8) === 0; }
    }
  ];

  var TABLE = {};
  PATTERNS.forEach(function (p) { TABLE[p.id] = p.fn; });

  // ---- 2. wrap the global pixel test ----
  // Whole-number scales: plain scaling (each pattern pixel becomes an N x N block).
  // Fractional scales (e.g. 1.5x): plain scaling makes dots alternate between 1 px and 2 px and
  // distorts the shapes, so instead each output pixel is decided from how much of a pattern dot it
  // covers (exact area), compared against a 4x4 Bayer threshold. Density and shape stay close to 1x.
  var BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

  function coverage(fn, x, y, s) {
    var x0 = x / s, x1 = (x + 1) / s, y0 = y / s, y1 = (y + 1) / s;
    var total = 0;
    for (var sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
      var oy = Math.min(y1, sy + 1) - Math.max(y0, sy);
      if (oy <= 0) continue;
      for (var sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
        var ox = Math.min(x1, sx + 1) - Math.max(x0, sx);
        if (ox > 0 && fn(sx, sy)) total += ox * oy;
      }
    }
    return total / ((x1 - x0) * (y1 - y0));
  }

  var original = window.isCheckerboardVisiblePixel;
  if (typeof original === 'function') {
    window.isCheckerboardVisiblePixel = function (x, y) {
      var select = document.getElementById('abPatternSelect');
      var id = select ? select.value : '';
      var fn = TABLE[id];
      if (!fn) return original(x, y);
      var scaleControl = document.getElementById('abPatternScale');
      var scale = scaleControl ? Math.max(1, Number(scaleControl.value) || 1) : 1;
      if (scale === Math.floor(scale)) {
        return fn(Math.floor(x / scale), Math.floor(y / scale));
      }
      var cov = coverage(fn, x, y, scale);
      return cov > 0 && cov > (BAYER4[y & 3][x & 3] / 16) + 0.0001;
    };
  } else {
    console.warn('patterns-extra: isCheckerboardVisiblePixel not found; load this file AFTER script.min.js');
  }

  // ---- 3. add the options to the dropdown ----
  function addOptions() {
    var select = document.getElementById('abPatternSelect');
    if (!select || select.querySelector('optgroup[data-extra="1"]')) return;
    var group = document.createElement('optgroup');
    group.label = 'New diamond patterns';
    group.setAttribute('data-extra', '1');
    PATTERNS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      group.appendChild(o);
    });
    // put the new group at the top of the list, but keep the current selection (Classic by default)
    var previous = select.value;
    select.insertBefore(group, select.firstChild);
    select.value = previous;
  }
  addOptions();

  // ---- 4. put the pattern name (and scale) into the saved filename ----
  function slugify(text) {
    return String(text)
      .replace(/×/g, 'x')
      .replace(/[★•]/g, ' ')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }
  var originalDownloadBlob = window.downloadBlob;
  if (typeof originalDownloadBlob === 'function') {
    window.downloadBlob = function (blob, filename) {
      try {
        var re = /_(tapme_composite|paint_composite|checkerboard)\.png$/;
        var select = document.getElementById('abPatternSelect');
        if (select && typeof filename === 'string' && re.test(filename)) {
          var opt = select.options[select.selectedIndex];
          var slug = slugify(opt ? opt.textContent : select.value);
          var scaleControl = document.getElementById('abPatternScale');
          var scale = scaleControl ? Math.max(1, Number(scaleControl.value) || 1) : 1;
          if (slug) {
            filename = filename.replace(re, '_' + slug + (scale > 1 ? '_' + scale + 'x' : '') + '.png');
          }
        }
      } catch (e) { /* keep the original filename on any problem */ }
      return originalDownloadBlob(blob, filename);
    };
  }

  // ---- 5. add a 1.5x option to Pattern Scale (script.min.js already reads it with Number()) ----
  function addScaleOption() {
    var scaleSelect = document.getElementById('abPatternScale');
    if (!scaleSelect || !scaleSelect.options) return;
    for (var i = 0; i < scaleSelect.options.length; i++) {
      if (scaleSelect.options[i].value === '1.5') return;
    }
    var opt = document.createElement('option');
    opt.value = '1.5';
    opt.textContent = '1.5×';
    var before = null;
    for (var j = 0; j < scaleSelect.options.length; j++) {
      if (scaleSelect.options[j].value === '2') { before = scaleSelect.options[j]; break; }
    }
    var previous = scaleSelect.value;
    scaleSelect.insertBefore(opt, before);
    scaleSelect.value = previous;
  }
  addScaleOption();

  // exposed for testing / reuse
  window.TAPME_EXTRA_PATTERNS = PATTERNS;
})();
