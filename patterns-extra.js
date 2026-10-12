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

  // ---- pattern table ----
  var PATTERNS = [
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
  var original = window.isCheckerboardVisiblePixel;
  if (typeof original === 'function') {
    window.isCheckerboardVisiblePixel = function (x, y) {
      var select = document.getElementById('abPatternSelect');
      var id = select ? select.value : '';
      var fn = TABLE[id];
      if (!fn) return original(x, y);
      var scaleControl = document.getElementById('abPatternScale');
      var scale = scaleControl ? Math.max(1, Number(scaleControl.value) || 1) : 1;
      return fn(Math.floor(x / scale), Math.floor(y / scale));
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

  // exposed for testing / reuse
  window.TAPME_EXTRA_PATTERNS = PATTERNS;
})();
