/* Pixel-planet engine.
 *
 * Planets are spheres of value noise sampled in longitude/latitude, lit from a
 * fixed direction and quantised to a five-colour palette. A planet is described
 * entirely by (surface type, seed, radius, rotation step), so the same day always
 * produces the same world and nothing is ever drawn by hand.
 *
 * Per-pixel work is expensive, so every sprite is rendered once into a palette
 * index array and cached. After one revolution an animating planet is pure
 * blitting.
 *
 * Used by sky.js (the month map) and day.js (the sprite at the top of an entry).
 */
(function (global) {
  "use strict";

  var TYPES = {
    ice:    { pal: ["#152a44", "#2c5680", "#5691bb", "#9ccfe6", "#e6f5ff"], vfreq: 1.6, band: 0.00, contrast: 1.5 },
    ocean:  { pal: ["#0a1f3c", "#0f4068", "#1a6f9c", "#39a6c2", "#9adfe8"], vfreq: 1.4, band: 0.00, contrast: 2.4 },
    forest: { pal: ["#10241a", "#1d472c", "#327843", "#5cab59", "#a5da87"], vfreq: 1.5, band: 0.00, contrast: 2.0 },
    gas:    { pal: ["#271b38", "#453160", "#764e90", "#ad78bd", "#e0b6de"], vfreq: 2.6, band: 0.80, contrast: 1.6 },
    lava:   { pal: ["#260d12", "#581818", "#9a3815", "#d26e1c", "#f4be48"], vfreq: 1.6, band: 0.10, contrast: 2.6 },
    rock:   { pal: ["#241b1e", "#493631", "#775946", "#a58166", "#d3b591"], vfreq: 1.3, band: 0.00, contrast: 1.15 }
  };

  var TYPE_LABEL = {
    ice: "Ice — writing", ocean: "Ocean — data & analysis", forest: "Forest — reading",
    gas: "Gas giant — coding", lava: "Volcanic — meetings", rock: "Barren — admin"
  };

  /* ---------------------------------------------------------------- font --
   * A 5x7 bitmap font, so labels drawn inside the canvas are pixels like
   * everything else rather than smooth text sitting on top of a pixel scene. */

  var FONT = {
    "A": ".###./#...#/#...#/#####/#...#/#...#/#...#",
    "B": "####./#...#/#...#/####./#...#/#...#/####.",
    "C": ".###./#...#/#..../#..../#..../#...#/.###.",
    "D": "####./#...#/#...#/#...#/#...#/#...#/####.",
    "E": "#####/#..../#..../####./#..../#..../#####",
    "F": "#####/#..../#..../####./#..../#..../#....",
    "G": ".###./#...#/#..../#.###/#...#/#...#/.###.",
    "H": "#...#/#...#/#...#/#####/#...#/#...#/#...#",
    "I": "#####/..#../..#../..#../..#../..#../#####",
    "J": "..###/...#./...#./...#./...#./#..#./.##..",
    "K": "#...#/#..#./#.#../##.../#.#../#..#./#...#",
    "L": "#..../#..../#..../#..../#..../#..../#####",
    "M": "#...#/##.##/#.#.#/#...#/#...#/#...#/#...#",
    "N": "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#",
    "O": ".###./#...#/#...#/#...#/#...#/#...#/.###.",
    "P": "####./#...#/#...#/####./#..../#..../#....",
    "Q": ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
    "R": "####./#...#/#...#/####./#.#../#..#./#...#",
    "S": ".####/#..../#..../.###./....#/....#/####.",
    "T": "#####/..#../..#../..#../..#../..#../..#..",
    "U": "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
    "V": "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
    "W": "#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#",
    "X": "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
    "Y": "#...#/#...#/.#.#./..#../..#../..#../..#..",
    "Z": "#####/....#/...#./..#../.#.../#..../#####",
    "0": ".###./#...#/#..##/#.#.#/##..#/#...#/.###.",
    "1": "..#../.##../..#../..#../..#../..#../.###.",
    "2": ".###./#...#/....#/...#./..#../.#.../#####",
    "3": "#####/...#./..##./....#/....#/#...#/.###.",
    "4": "...#./..##./.#.#./#..#./#####/...#./...#.",
    "5": "#####/#..../####./....#/....#/#...#/.###.",
    "6": "..##./.#.../#..../####./#...#/#...#/.###.",
    "7": "#####/....#/...#./..#../.#.../.#.../.#...",
    "8": ".###./#...#/#...#/.###./#...#/#...#/.###.",
    "9": ".###./#...#/#...#/.####/....#/...#./.##..",
    " ": "...../...../...../...../...../...../.....",
    ".": "...../...../...../...../...../.##../.##..",
    "-": "...../...../...../.###./...../...../.....",
    ":": "...../.##../.##../...../.##../.##../.....",
    "·": "...../...../...../..#../...../...../....."
  };

  var GLYPHS = {};
  for (var ch in FONT) {
    var rows = FONT[ch].split("/");
    var pts = [];
    for (var gy = 0; gy < 7; gy++)
      for (var gx = 0; gx < 5; gx++)
        if (rows[gy][gx] === "#") pts.push([gx, gy]);
    GLYPHS[ch] = pts;
  }

  /* --------------------------------------------------------------- noise -- */

  function h2(xi, yi, seed) {
    var n = Math.imul(xi | 0, 374761393) ^ Math.imul(yi | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  var PERIOD = 8;

  function vnoise(x, y, seed, period) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    // Longitude wraps, so the noise must wrap with it or the planet shows a seam.
    var x0 = ((xi % period) + period) % period;
    var x1 = ((xi + 1) % period + period) % period;
    var a = h2(x0, yi, seed), b = h2(x1, yi, seed);
    var c = h2(x0, yi + 1, seed), d = h2(x1, yi + 1, seed);
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }

  function fbm(x, y, seed, oct) {
    var s = 0, amp = 1, f = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      s += amp * vnoise(x * f, y * f, seed + i * 7919, PERIOD * f);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return s / norm;
  }

  var LX = -0.45, LY = -0.55, LZ = 0.70;
  var SPIN_STEPS = 32;
  var spriteCache = new Map();

  function planetSprite(typeKey, seed, r, step) {
    var key = typeKey + "|" + seed + "|" + r + "|" + step;
    var cached = spriteCache.get(key);
    if (cached) return cached;

    var T = TYPES[typeKey] || TYPES.rock;
    var n = T.pal.length;
    var size = r * 2 + 1;
    var data = new Int8Array(size * size).fill(-1);
    var spin = step / SPIN_STEPS;

    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var nx = (dx + 0.5) / (r + 0.5);
        var ny = (dy + 0.5) / (r + 0.5);
        var d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        var nz = Math.sqrt(1 - d2);

        var lon = Math.atan2(nx, nz);
        var lat = Math.asin(Math.max(-1, Math.min(1, ny)));
        var u = (lon / (2 * Math.PI) + 0.5 + spin) * PERIOD;
        var v = (lat / Math.PI + 0.5) * PERIOD * T.vfreq;

        var val = fbm(u, v, seed, 3);
        if (T.band > 0) val = val * (1 - T.band) + fbm(3.0, v, seed + 555, 2) * T.band;
        val = (val - 0.5) * T.contrast + 0.5;
        val = val < 0 ? 0 : val > 1 ? 1 : val;

        var diff = Math.max(0, nx * LX + ny * LY + nz * LZ);
        var lum = (val * 0.55 + diff * 0.62 - 0.05) * (0.74 + 0.26 * nz);
        var idx = Math.floor(lum * n);
        idx = idx < 0 ? 0 : idx >= n ? n - 1 : idx;
        data[(dy + r) * size + (dx + r)] = idx;
      }
    }

    var sp = { size: size, data: data };
    spriteCache.set(key, sp);
    return sp;
  }

  function hex(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  /* ------------------------------------------------------- day palettes --
   * The terrain comes from the kind of work (TYPES above); the colour comes
   * from the projects worked that day, already blended by the build. This turns
   * one blended colour into the five-stop ramp a sprite needs, so two days of
   * the same kind of work still look different if they were different projects.
   */

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    var r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      var ch = function (t) {
        t = (t % 1 + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      r = ch(h + 1 / 3); g = ch(h); b = ch(h - 1 / 3);
    }
    var two = function (v) { return ("0" + Math.round(v * 255).toString(16)).slice(-2); };
    return "#" + two(r) + two(g) + two(b);
  }

  var rampCache = {};

  function mixHex(a, b, amount) {
    var x = hex(a), y = hex(b);
    var channel = function (i) { return Math.round(x[i] + (y[i] - x[i]) * amount); };
    return "#" + [channel(0), channel(1), channel(2)].map(function (v) {
      return ("0" + v.toString(16)).slice(-2);
    }).join("");
  }

  function rampFrom(colour, typeKey) {
    var cacheKey = colour + "|" + typeKey;
    if (rampCache[cacheKey]) return rampCache[cacheKey];
    var c = hex(colour);
    var hsl = rgbToHsl(c[0], c[1], c[2]);
    var hue = hsl[0], sat = Math.max(0.28, Math.min(0.78, hsl[1]));
    var terrain = (TYPES[typeKey] || TYPES.rock).pal;
    var out = [];
    for (var i = 0; i < 5; i++) {
      var t = i / 4;
      // Keep the project's colour as the identity, but pull each end of the
      // ramp toward the terrain palette. A coding day can therefore read as
      // blue-and-violet gas, while a writing day keeps its project colour with
      // cool ice highlights instead of collapsing into one hue.
      var projectStop = hslToHex(hue + (0.5 - t) * 34, sat * (1 - 0.15 * t), 0.15 + t * 0.66);
      var terrainWeight = (i === 0 || i === 4) ? 0.58 : 0.28;
      out.push(mixHex(projectStop, terrain[i], terrainWeight));
    }
    rampCache[cacheKey] = out;
    return out;
  }

  /* ------------------------------------------------------------- surface -- */

  function Surface(w, h, bg) {
    this.w = w; this.h = h; this.bg = bg;
    this.off = document.createElement("canvas");
    this.off.width = w; this.off.height = h;
    this.octx = this.off.getContext("2d");
    this.img = this.octx.createImageData(w, h);
    this.buf = this.img.data;
  }

  // Clearing is done once per frame over the whole buffer, so it is worth not
  // doing it a byte at a time. Both paths hand the work to the engine's own
  // memory primitives instead of a JavaScript loop.
  Surface.prototype.clear = function (alpha) {
    var buf = this.buf;
    var a = alpha === undefined ? 255 : alpha;

    // Fully transparent: the colour underneath is irrelevant, so this is a
    // straight memset. This is the pixel skin's path, where the sprite buffer
    // is composited over the gas.
    if (a === 0) { buf.fill(0); return; }

    // Opaque: write one pixel, then keep doubling it across the buffer. Each
    // copyWithin is a block move, so the whole fill costs log2(n) of them.
    buf[0] = this.bg[0]; buf[1] = this.bg[1]; buf[2] = this.bg[2]; buf[3] = a;
    var len = buf.length, filled = 4;
    while (filled < len) {
      var n = filled;
      if (filled + n > len) n = len - filled;
      buf.copyWithin(filled, 0, n);
      filled += n;
    }
  };

  Surface.prototype.px = function (x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    var i = (y * this.w + x) * 4;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2]; this.buf[i + 3] = 255;
  };

  // Dim toward the background rather than toward black, so a faded planet still
  // sits in the same sky.
  Surface.prototype.fade = function (c, k) {
    return [
      Math.round(this.bg[0] + (c[0] - this.bg[0]) * k),
      Math.round(this.bg[1] + (c[1] - this.bg[1]) * k),
      Math.round(this.bg[2] + (c[2] - this.bg[2]) * k)
    ];
  };

  Surface.prototype.text = function (str, x, y, c) {
    var cx = x, s = String(str).toUpperCase();
    for (var i = 0; i < s.length; i++) {
      var g = GLYPHS[s[i]] || GLYPHS[" "];
      for (var j = 0; j < g.length; j++) this.px(cx + g[j][0], y + g[j][1], c);
      cx += 6;
    }
  };

  Surface.prototype.line = function (x0, y0, x1, y1, c, dotted) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy, i = 0;
    for (;;) {
      if (!dotted || i % 2 === 0) this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      i++;
    }
  };

  // `over` composites onto whatever is already on the view instead of clearing
  // it, which is how the pixel renderer lays its sprites over a nebula it drew
  // first. The surface must have been cleared transparent for that to read.
  Surface.prototype.blit = function (view, over) {
    this.octx.putImageData(this.img, 0, 0);
    var vctx = view.getContext("2d");
    vctx.imageSmoothingEnabled = false;
    if (!over) vctx.clearRect(0, 0, view.width, view.height);
    vctx.drawImage(this.off, 0, 0, view.width, view.height);
  };

  /* --------------------------------------------------------------- draws -- */

  function drawPlanet(surf, cx, cy, r, typeKey, seed, step, k, colour) {
    var T = TYPES[typeKey] || TYPES.rock;
    var stops = colour ? rampFrom(colour, typeKey) : T.pal;
    var pal = stops.map(hex).map(function (c) { return k < 1 ? surf.fade(c, k) : c; });
    var sp = planetSprite(typeKey in TYPES ? typeKey : "rock", seed, r, step);
    for (var y = 0; y < sp.size; y++) {
      for (var x = 0; x < sp.size; x++) {
        var idx = sp.data[y * sp.size + x];
        if (idx < 0) continue;
        surf.px(cx - r + x, cy - r + y, pal[idx]);
      }
    }
  }

  function ringPixels(cx, cy, rx, ry) {
    var pts = [];
    var steps = Math.max(24, Math.round(rx * 4));
    for (var i = 0; i < steps; i++) {
      var a = (i / steps) * Math.PI * 2;
      pts.push([Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a)), Math.sin(a)]);
    }
    return pts;
  }

  // A milestone is a supernova in the metaphor, but a gold ring reads far more
  // clearly at this size than a burst does, and it never swamps its neighbours.
  function drawMilestoneRing(surf, cx, cy, r, half, k) {
    var c = surf.fade(hex("#f2c46b"), k);
    var pts = ringPixels(cx, cy, r + 5, (r + 5) * 0.33);
    for (var i = 0; i < pts.length; i++) {
      if (half === "back" ? pts[i][2] < 0 : pts[i][2] >= 0) surf.px(pts[i][0], pts[i][1], c);
    }
  }

  // `time` is optional, and omitting it holds the moons still — which is what
  // the sprite at the top of an entry wants. On the map it must be passed, or
  // the planet turns under satellites that never go anywhere.
  //
  // Same starting phase and same rate the vector styles use, so a given day's
  // moons are in the same place whichever style you are looking at it in.
  // `colours` may be one colour or one per moon. A moon stands for a project
  // beyond the day's first, so giving each its own colour says *which* project
  // rather than merely how many — the planet's own colour is the blend of them
  // all and cannot answer that.
  function drawMoons(surf, cx, cy, r, count, seed, k, time, colours) {
    var t = time || 0;
    var list = !colours ? [] : (typeof colours === "string" ? [colours] : colours);
    // Wide enough, and round enough, that the moon clears the limb at the top
    // and bottom of its circuit. At the old r+5 with a 0.45 squash it spent half
    // of every orbit crossing the planet's own face, where a two-pixel dot is
    // simply invisible — so the moons read as pinned even while they moved.
    var orbit = r * 1.6 + 4;
    var size = Math.max(2, Math.round(r * 0.3));

    for (var i = 0; i < count; i++) {
      var a = h2(seed, i * 17 + 3, 991) * Math.PI * 2 + t * 0.5 * (1 + i * 0.35);
      var mx = Math.round(cx + orbit * Math.cos(a)) - (size >> 1);
      var my = Math.round(cy + orbit * 0.5 * Math.sin(a)) - (size >> 1);
      // The far half of the orbit is dimmer, the same way the milestone ring's
      // back half is: without it the moon reads as sliding around on the glass
      // rather than as going behind the world.
      var tone = hex(list.length ? list[i % list.length] : "#cdd8f0");
      var c = surf.fade(tone, k * (Math.sin(a) < 0 ? 0.5 : 1));
      for (var dy = 0; dy < size; dy++) {
        for (var dx = 0; dx < size; dx++) surf.px(mx + dx, my + dy, c);
      }
    }
  }

  function drawComet(surf, cx, cy, k, dx, dy, radius) {
    var head = surf.fade(hex("#ffe9b0"), k);
    var tail = surf.fade(hex("#8d6d33"), k);
    // The galaxy passes the planet's current radius. Scale the comet with it
    // so zooming never makes the marker look detached from its world. The
    // static entry sprite omits radius and keeps its original 2x2 head.
    var size = radius === undefined ? 2 : Math.max(1, Math.round(radius * 0.22 + 0.75));
    for (var hy = 0; hy < size; hy++) {
      for (var hx = 0; hx < size; hx++) surf.px(cx + hx, cy + hy, head);
    }

    // The entry sprite passes no direction and keeps the original fixed tail.
    // The galaxy passes the comet's travel direction so its tail follows the
    // moving head instead of making the idea marker look pinned in place.
    if (dx !== undefined && dy !== undefined) {
      var scale = Math.max(Math.abs(dx), Math.abs(dy), 0.001);
      dx /= scale; dy /= scale;
      var movingLength = radius === undefined ? 4 : Math.max(2, Math.round(size * 2));
      for (var moving = 0; moving < movingLength; moving++) {
        var movingDistance = size + 1 + moving;
        surf.px(cx + Math.round(dx * movingDistance), cy + Math.round(dy * movingDistance), tail);
      }
      return;
    }
    for (var i = 1; i <= 4; i++) surf.px(cx + 1 + i, cy - i, tail);
  }

  global.ODailyPlanet = {
    TYPES: TYPES,
    TYPE_LABEL: TYPE_LABEL,
    SPIN_STEPS: SPIN_STEPS,
    Surface: Surface,
    hex: hex,
    h2: h2,
    rampFrom: rampFrom,
    textWidth: function (s) { return String(s).length * 6 - 1; },
    drawPlanet: drawPlanet,
    drawMilestoneRing: drawMilestoneRing,
    drawMoons: drawMoons,
    drawComet: drawComet,
    ringPixels: ringPixels
  };
})(window);
