/* The pixel renderer.
 *
 * Draws the galaxy into a small integer-sized buffer and scales it up by a whole
 * number, so every pixel on screen is a deliberate one. Uses planet-core.js for
 * the sprites themselves.
 *
 * The one thing a per-pixel buffer cannot afford is large soft areas, so the
 * nebulae are drawn separately with canvas gradients into a second buffer at half
 * this one's size, ordered-dithered down to a handful of tones, and the sprite
 * buffer is composited over them. That gas depends on the camera and the zoom but
 * never on time, so it is cached and only redrawn when you actually move — which
 * is what makes watching the systems revolve nearly free.
 *
 * Zoom moves along a fixed ladder rather than being continuous: sprites are
 * cached per radius, and a smoothly varying radius would mean rendering a fresh
 * set of thirty-two rotation frames for every planet on every wheel notch.
 */
(function (global) {
  "use strict";

  var P = global.ODailyPlanet;
  var RYF = 0.70;
  var TAU = Math.PI * 2;

  // A 4x4 ordered dither matrix. This is how the era actually drew a gradient:
  // not with more colours, but by trading a pixel of one tone against a pixel of
  // the next in a fixed pattern. It quantises the gas *and* breaks up the band
  // boundaries — which is why smooth gradients had to go. A hard step between
  // two flat colours draws a perfect ellipse, and twenty of those stacked read
  // as a Venn diagram rather than as gas.
  var BAYER = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ];

  // The step is picked for what is actually in the nebula buffer, not for the
  // full 0-255 range: the gas, the void and the vignette all live in the darkest
  // quarter, so quantising to five tones across the whole range would flatten
  // every one of them to black.
  //
  // Seven, not eleven. A wide step sounds more like pixel art and is not: the
  // gas only spans about seventy levels, so a coarse step collapses it to one
  // flat colour and the dither then covers the whole screen evenly, which reads
  // as a halftone screen rather than as banded gas. Seven leaves ten bands, so
  // the dither appears where tones change and nowhere else.
  //
  // It also divides the pixel skin's ground exactly, which matters more than it
  // sounds: a flat colour sitting halfway between two levels dithers into a
  // checkerboard, and empty sky is most of the screen.
  var STEP = 7;

  // The one palette. This was a table of two skins until the flat style was
  // removed; it stays a named block because every colour the map uses is here
  // and nowhere else.
  var S = {
    bg: [7, 7, 21],       // every channel a multiple of STEP — see above
    ring: [44, 58, 96], ringFar: [26, 35, 60],
    ray: [17, 24, 42],
    empty: [46, 58, 88],
    emptyShard: [111, 128, 168],
    emptyGlint: [197, 210, 239],
    label: "#93a4cc", labelShadow: [6, 9, 18],
    moon: "#cdd8f0",
    select: "#f2c46b", today: "#7fd8f7", hover: "#8b9cc4",
    starMax: 230
  };

  // Three bands per cloud, dark enough to survive being composited additively —
  // three or four overlap almost everywhere, so anything with real brightness in
  // it sums to neon within one screen.
  var CLOUDS = [
    ["#131c38", "#0d1326", "#070b16"],   // indigo
    ["#211534", "#160e24", "#0c0716"],   // violet
    ["#0b232c", "#081820", "#040e13"],   // teal
    ["#29181a", "#1b1012", "#0f090a"]    // rust
  ];

  var STAR_TINTS = [
    [0.72, 0.80, 1.00],   // blue-white, the common case
    [1.00, 0.94, 0.82],   // warm
    [1.00, 0.82, 0.70],   // red giant
    [0.86, 1.00, 0.96]    // cool white
  ];

  var surf = null;
  var neb = null;
  var scale = 3;
  var clouds = null;
  var cloudCount = -1;
  var lastSize = null;
  var nebCtx = null;
  var nebW = 0, nebH = 0;
  var nebKey = "";   // invalidates the cached gas; see drawNebula

  // The gas is drawn at half the sprite buffer's resolution and scaled back up
  // when it is composited. It is the softest, lowest-frequency thing on screen,
  // so it loses nothing — and it quarters the three costs that made dragging
  // expensive: the gradient fill area, the pixel readback the dither needs, and
  // the dither arithmetic itself.
  var NEB_DIV = 2;

  function init() {
    surf = null;   // rebuilt on the next resize
    neb = null;
    nebCtx = null;
    nebKey = "";
  }

  function resize(canvas, cssW, cssH) {
    scale = cssW < 760 ? 2 : 3;
    var w = Math.max(160, Math.ceil(cssW / scale));
    var h = Math.max(160, Math.ceil(cssH / scale));
    canvas.width = w * scale;
    canvas.height = h * scale;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    surf = new P.Surface(w, h, S.bg);
    lastSize = { w: w, h: h };

    neb = neb || document.createElement("canvas");
    nebW = Math.max(1, Math.ceil(w / NEB_DIV));
    nebH = Math.max(1, Math.ceil(h / NEB_DIV));
    neb.width = nebW; neb.height = nebH;
    // Deliberately NOT created with willReadFrequently. It looks like the right
    // hint — the dither reads this canvas back every time it is recomputed — but
    // it was measured at four times slower overall. The hint moves the canvas to
    // the CPU, and software-rasterising eighty radial gradients costs far more
    // than the one GPU readback it saves.
    nebCtx = neb.getContext("2d");
    nebKey = "";   // resizing a canvas clears it
    return { w: w, h: h };
  }

  function toLogical(x, y) { return { x: x / scale, y: y / scale }; }
  function pixelsPerCss() { return 1 / scale; }

  function rnd(i, k) {
    var n = Math.imul(i | 0, 374761393) ^ Math.imul(k | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  /* --------------------------------------------------------------- the gas -- */

  function cloudsFor(scene) {
    if (clouds && cloudCount === scene.systems.length) return clouds;
    var reach = 420 * Math.sqrt(Math.max(1, scene.systems.length)) + 1000;
    clouds = [];
    for (var i = 0; i < 16; i++) {
      var a = rnd(i, 61) * TAU;
      var d = Math.sqrt(rnd(i, 62)) * reach;
      var r = 110 + rnd(i, 63) * 260;
      var lobes = [];
      for (var l = 0; l < 5; l++) {
        var la = rnd(i * 6 + l, 66) * TAU;
        // Kept tight on purpose. Lobes that sit apart read as separate blobs;
        // lobes that mostly overlap merge into one irregular mass, which is the
        // entire reason for having more than one.
        var ld = l === 0 ? 0 : (0.12 + rnd(i * 6 + l, 67) * 0.34) * r;
        lobes.push({
          dx: Math.cos(la) * ld,
          dy: Math.sin(la) * ld * 0.7,
          r: r * (0.58 + rnd(i * 6 + l, 68) * 0.4),
          // Gently rotated ellipses, not discs. Circles overlapping circles read
          // as a diagram no matter how soft their edges are.
          rot: rnd(i * 6 + l, 69) * Math.PI,
          squash: 0.58 + rnd(i * 6 + l, 70) * 0.34
        });
      }
      clouds.push({
        x: Math.cos(a) * d,
        y: Math.sin(a) * d * 0.8,
        lobes: lobes,
        pal: CLOUDS[Math.floor(rnd(i, 64) * CLOUDS.length)],
        depth: 0.55 + rnd(i, 65) * 0.35
      });
    }
    cloudCount = scene.systems.length;
    return clouds;
  }

  function drawNebula(scene, w, h, camx, camy, z) {

    // The gas depends on where the camera is and how far out it is zoomed —
    // never on time. While you sit and watch the systems revolve, the camera is
    // still and this is the same image every single frame, so redrawing and
    // re-dithering it sixty times a second is pure waste. It was also most of
    // the frame: the dither alone needs a GPU-to-CPU readback of the whole
    // buffer, which is the most expensive thing this renderer does.
    var key = Math.round(camx * z) + "," + Math.round(camy * z) + "," +
      z + "," + w + "," + h + "," + scene.systems.length;
    if (key === nebKey) return;
    nebKey = key;

    var n = nebCtx;
    var nw = nebW, nh = nebH;
    n.globalCompositeOperation = "source-over";
    n.fillStyle = "rgb(" + S.bg[0] + "," + S.bg[1] + "," + S.bg[2] + ")";
    n.fillRect(0, 0, nw, nh);
    n.globalCompositeOperation = "lighter";

    var list = cloudsFor(scene);
    var k = z / NEB_DIV;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var cx = (c.x - camx * c.depth) * k + nw / 2;
      var cy = (c.y - camy * c.depth) * k + nh / 2;
      for (var l = 0; l < c.lobes.length; l++) {
        var lo = c.lobes[l];
        var px = cx + lo.dx * k, py = cy + lo.dy * k, r = lo.r * k;
        if (px + r < 0 || py + r < 0 || px - r > nw || py - r > nh) continue;
        var g = n.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, c.pal[0]);
        g.addColorStop(0.34, c.pal[1]);
        g.addColorStop(0.62, c.pal[2]);
        g.addColorStop(1, "#000000");
        n.save();
        n.translate(px, py);
        n.rotate(lo.rot);
        n.scale(1, lo.squash);
        n.fillStyle = g;
        n.beginPath();
        n.arc(0, 0, r, 0, TAU);
        n.fill();
        n.restore();
      }
    }

    // A vignette, applied before the dither so it bands with everything else.
    n.globalCompositeOperation = "multiply";
    var v = n.createRadialGradient(nw / 2, nh / 2, Math.min(nw, nh) * 0.36,
      nw / 2, nh / 2, Math.hypot(nw, nh) * 0.58);
    v.addColorStop(0, "#ffffff");
    v.addColorStop(1, "#8c8c8c");
    n.fillStyle = v;
    n.fillRect(0, 0, nw, nh);
    n.globalCompositeOperation = "source-over";

    dither(n, nw, nh);
  }

  // One lookup table per cell of the dither matrix, mapping an input level
  // straight to its dithered output. There are only sixteen cells and 256 input
  // levels, so the whole thing is 4KB and it replaces a divide, a round, a
  // multiply and two clamps per channel with a single array read.
  var DLUT = null;

  function buildLut() {
    DLUT = [];
    for (var cell = 0; cell < 16; cell++) {
      var off = (BAYER[cell] * 0.0625 - 0.46875) * STEP;
      var t = new Uint8Array(256);
      for (var v = 0; v < 256; v++) {
        var q = Math.round((v + off) / STEP) * STEP;
        t[v] = q < 0 ? 0 : q > 255 ? 255 : q;
      }
      DLUT.push(t);
    }
  }

  // Snap the nebula buffer to a small palette, offsetting each pixel by its
  // position in the dither matrix first.
  function dither(n, w, h) {
    if (!DLUT) buildLut();
    var img = n.getImageData(0, 0, w, h);
    var d = img.data;
    for (var y = 0; y < h; y++) {
      var row = (y & 3) * 4;
      // Hoisted out of the inner loop: four tables, chosen by x & 3.
      var l0 = DLUT[row], l1 = DLUT[row + 1], l2 = DLUT[row + 2], l3 = DLUT[row + 3];
      var i = y * w * 4;
      for (var x = 0; x < w; x++, i += 4) {
        var lut = (x & 3) === 0 ? l0 : (x & 3) === 1 ? l1 : (x & 3) === 2 ? l2 : l3;
        d[i] = lut[d[i]];
        d[i + 1] = lut[d[i + 1]];
        d[i + 2] = lut[d[i + 2]];
      }
    }
    n.putImageData(img, 0, 0);
  }

  /* ---------------------------------------------------------------- draw -- */

  function draw(canvas, scene) {
    if (!surf) return;

    // Transparent, so the sprite buffer composites over the gas drawn beneath it.
    surf.clear(0);

    var w = scene.view.w, h = scene.view.h;
    var z = scene.camera.zoom;
    var camx = scene.camera.x, camy = scene.camera.y;

    function sx(wx) { return (wx - camx) * z + w / 2; }
    function sy(wy) { return (wy - camy) * z + h / 2; }

    drawNebula(scene, w, h, camx, camy, z);

    starfield(scene, camx, camy, z, w, h, S);

    // Behind the systems, so the lines pass under the worlds they join.
    if (scene.filter) constellation(scene, sx, sy, S, false);

    for (var s = 0; s < scene.systems.length; s++) {
      system(scene, scene.systems[s], sx, sy, w, h, z, S);
    }

    // And again on top, for the markers alone.
    if (scene.filter) constellation(scene, sx, sy, S, true);

    var vctx = canvas.getContext("2d");
    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, canvas.width, canvas.height);
    vctx.drawImage(neb, 0, 0, canvas.width, canvas.height);
    surf.blit(canvas, true);
  }

  // Stars drift at their own depth, which is the only cue that the field has any
  // depth at all when everything else is flat colour.
  function starfield(scene, camx, camy, z, w, h, S) {
    var stars = scene.stars;
    var buf = surf.buf;
    // Hoisted: these are the same for every one of the fifteen hundred stars.
    var hw = w / 2, hh = h / 2;

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var px = (st.x - camx * st.depth) * z + hw;
      var py = (st.y - camy * st.depth) * z + hh;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;

      var v = 30 + Math.round(st.b * S.starMax);
      // The tint comes from the star's own numbers, so the field is varied but
      // never flickers between frames.
      var tint = STAR_TINTS[Math.floor(((st.b * 13) % 1) * STAR_TINTS.length)];
      var r = v * tint[0]; if (r > 255) r = 255;
      var g = v * tint[1]; if (g > 255) g = 255;
      var b = v * tint[2]; if (b > 255) b = 255;

      // The bounds are already known here, so the pixel goes straight into the
      // buffer rather than through px() and a second round of checks.
      var idx = (((py | 0) * w) + (px | 0)) * 4;
      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b; buf[idx + 3] = 255;

      // The few first-magnitude stars get a cross, which is the pixel-art way of
      // saying bright without any glow at all. Rare enough to go through px(),
      // which is doing the edge clipping for the four arms.
      if (st.b > 0.94) {
        var dim = [r * 0.5, g * 0.5, b * 0.5];
        surf.px(px - 1, py, dim); surf.px(px + 1, py, dim);
        surf.px(px, py - 1, dim); surf.px(px, py + 1, dim);
      }
    }
  }

  /* A constellation: every day that touched one project, joined in order.
   *
   * It deliberately runs across the whole galaxy rather than stopping at the
   * edge of a month — a pattern that gives up at a month boundary is not a
   * constellation, it is a bar chart. This is the one thing on the map that
   * reads along the project axis instead of the time axis, which is the whole
   * reason the metaphor has constellations in it at all.
   *
   * Drawn in the project's own colour, so which constellation you are looking at
   * needs no legend.
   */
  function constellation(scene, sx, sy, S, markers) {
    var proj = scene.projects[scene.filter];
    var col = P.hex((proj && proj.color) || "#7d6531");
    var prev = null;

    for (var i = 0; i < scene.systems.length; i++) {
      var sys = scene.systems[i];
      for (var j = 0; j < sys.slots.length; j++) {
        var sl = sys.slots[j];
        if (!sl.entry || sl.projects.indexOf(scene.filter) < 0) continue;
        var x = Math.round(sx(sl.x)), y = Math.round(sy(sl.y));

        if (markers) {
          // A four-pixel cross on each node: the days themselves are already
          // planets, and this says "and this one is in the figure".
          surf.px(x - 2, y, col); surf.px(x + 2, y, col);
          surf.px(x, y - 2, col); surf.px(x, y + 2, col);
        } else if (prev) {
          // Dotted, the way a star chart joins a figure.
          surf.line(prev[0], prev[1], x, y, col, true);
        }
        prev = [x, y];
      }
    }
  }

  // An unrecorded day is not absent: it is a broken world waiting for a log.
  // The shards are deterministic from the date, so the same empty day keeps
  // the same shape while the system turns around its star.
  function fragmentedPlanet(x, y, r, seed, k) {
    var shard = surf.fade(S.emptyShard, k);
    var glint = surf.fade(S.emptyGlint, k * 0.72);
    var phase = P.h2(seed, 45, 1) * TAU;

    // Broken arcs suggest the missing sphere without filling its centre.
    var pieces = 4 + Math.floor(P.h2(seed, 46, 1) * 3);
    for (var i = 0; i < pieces; i++) {
      var start = phase + (i / pieces) * TAU;
      var span = 0.24 + P.h2(seed, 50 + i, 1) * 0.2;
      var steps = Math.max(2, Math.round(r * span * 3));
      for (var j = 0; j <= steps; j++) {
        var a = start + span * (j / steps);
        var px = Math.round(x + Math.cos(a) * r);
        var py = Math.round(y + Math.sin(a) * r * 0.72);
        surf.px(px, py, j === 0 ? glint : shard);
      }
    }

    // A few pieces have drifted away from the main fracture.
    var debris = 2 + Math.floor(P.h2(seed, 47, 1) * 2);
    for (var d = 0; d < debris; d++) {
      var da = phase + P.h2(seed, 60 + d, 1) * TAU;
      var dist = r + 2 + Math.round(P.h2(seed, 70 + d, 1) * 2);
      var dx = Math.round(x + Math.cos(da) * dist);
      var dy = Math.round(y + Math.sin(da) * dist * 0.72);
      surf.px(dx, dy, shard);
      if (P.h2(seed, 80 + d, 1) > 0.55) surf.px(dx + (d % 2 ? 1 : -1), dy, glint);
    }
  }

  function system(scene, sys, sx, sy, w, h, z, S) {
    var scx = sx(sys.cx), scy = sy(sys.cy);
    var outer = sys.outer * z;
    if (scx < -outer - 60 || scy < -outer - 60 || scx > w + outer + 60 || scy > h + outer + 60) return;

    // One ring per week of the month.
    for (var r = 0; r < sys.rings.length; r++) {
      var rr = sys.rings[r] * z;
      var pts = P.ringPixels(scx, scy, rr, rr * RYF);
      // The near half of each orbit is stated a shade firmer than the far half.
      // One extra colour, and the rings stop looking like flat discs.
      for (var pi = 0; pi < pts.length; pi += 3) {
        surf.px(pts[pi][0], pts[pi][1], pts[pi][2] >= 0 ? S.ring : S.ringFar);
      }
    }

    // Seven weekday spokes, Sunday at the top. They turn with the system they
    // belong to — that is what keeps "angle is the weekday" true while the whole
    // thing revolves.
    for (var dow = 0; dow < 7; dow++) {
      var a = -Math.PI / 2 + (dow / 7) * TAU + (sys.rot || 0);
      for (var t = 24 * z; t < outer + 6; t += 5) {
        var rx = scx + t * Math.cos(a), ry = scy + t * RYF * Math.sin(a);
        if (Math.hypot((rx - scx) / (outer + 4), (ry - scy) / (outer * RYF + 4)) > 1) break;
        surf.px(rx, ry, S.ray);
      }
    }

    star(scx, scy, Math.max(2, Math.round(5 * z)));

    if (z > 0.55) {
      var lx = Math.round(scx - P.textWidth(sys.label) / 2);
      var ly = Math.round(scy - sys.outer * RYF * z - 16);
      // Set once in near-black and again a pixel up: a hard drop shadow, so a
      // label stays readable over a bright cloud without any halo.
      surf.text(sys.label, lx + 1, ly + 1, S.labelShadow);
      surf.text(sys.label, lx, ly, P.hex(S.label));
    }

    for (var j = 0; j < sys.slots.length; j++) {
      var sl = sys.slots[j];
      var px2 = Math.round(sx(sl.x)), py2 = Math.round(sy(sl.y));
      if (px2 < -20 || py2 < -20 || px2 > w + 20 || py2 > h + 20) continue;

      var lit = !scene.filter || sl.projects.indexOf(scene.filter) >= 0;
      var kk = lit ? 1 : 0.24;

      if (!sl.entry) {
        fragmentedPlanet(px2, py2, Math.max(2, Math.round(sl.r * z)), sl.seed, kk);
        continue;
      }

      var pr = Math.max(2, Math.round(sl.r * z));
      var turn = ((sl.phase + scene.time * sl.spinRate) % 1 + 1) % 1;

      body(px2, py2, pr, sl, turn, kk);

      var extra = sl.projects.length - 1;
      if (extra > 0 && pr >= 5) {
        P.drawMoons(surf, px2, py2, pr, extra, sl.seed, kk, scene.time, moonColours(scene, sl));
      }
      if (sl.entry.idea) comet(px2 + pr + 3, py2 - pr - 3, kk);

      if (sl === scene.selected || sl === scene.hover || sl === scene.today) {
        var col = sl === scene.selected ? P.hex(S.select)
          : sl === scene.today ? P.hex(S.today) : P.hex(S.hover);
        bracket(px2, py2, pr + 3, col);
      }
    }
  }

  // Cached on the slot: the projects of a day never change once built, and this
  // would otherwise allocate an array per planet per frame.
  function moonColours(scene, sl) {
    if (sl.moonCols) return sl.moonCols;
    var out = [];
    for (var i = 1; i < sl.projects.length; i++) {
      var p = scene.projects[sl.projects[i]];
      out.push((p && p.color) || S.moon);
    }
    sl.moonCols = out;
    return out;
  }

  /* --------------------------------------------------------------- bodies -- */

  function body(x, y, r, sl, turn, k) {
    var step = Math.floor(turn * P.SPIN_STEPS) % P.SPIN_STEPS;
    if (sl.entry.milestone) P.drawMilestoneRing(surf, x, y, r, "back", k);
    P.drawPlanet(surf, x, y, r, sl.type, sl.seed, step, k, sl.color);
    if (sl.entry.milestone) P.drawMilestoneRing(surf, x, y, r, "front", k);
  }

  // The star at the centre is the month itself: a hot core with four rays.
  function star(cx, cy, r) {
    for (var y2 = -r; y2 <= r; y2++) {
      for (var x2 = -r; x2 <= r; x2++) {
        var d = Math.hypot(x2, y2);
        if (d > r + 0.2) continue;
        var kk = 1 - d / (r + 0.2);
        surf.px(cx + x2, cy + y2, [
          Math.round(96 + 159 * kk * kk),
          Math.round(74 + 171 * kk * kk),
          Math.round(42 + 198 * kk * kk * kk)
        ]);
      }
    }
    var reach = Math.round(r * 2.4);
    for (var i = r + 1; i <= reach; i++) {
      var f = 1 - (i - r) / (reach - r + 0.5);
      var c2 = [Math.round(150 * f), Math.round(120 * f), Math.round(64 * f)];
      if ((i - r) % 2 === 0) continue;   // dashed rays read as light, not as spokes
      surf.px(cx + i, cy, c2); surf.px(cx - i, cy, c2);
      surf.px(cx, cy + i, c2); surf.px(cx, cy - i, c2);
    }
  }

  function comet(x, y, k) {
    P.drawComet(surf, x, y, k);
  }

  function bracket(x, y, b, c) {
    for (var i = -1; i <= 1; i++) {
      surf.px(x - b + i + 1, y - b, c); surf.px(x + b - i - 1, y - b, c);
      surf.px(x - b + i + 1, y + b, c); surf.px(x + b - i - 1, y + b, c);
      surf.px(x - b, y - b + i + 1, c); surf.px(x - b, y + b - i - 1, c);
      surf.px(x + b, y - b + i + 1, c); surf.px(x + b, y + b - i - 1, c);
    }
  }

  /* --------------------------------------------------------- one day alone -- */

  // The planet at the top of an entry, in whichever skin is current. Same marks
  // the map uses, so the day you clicked is recognisably the same world.
  // Deliberately still: the entry is the reading register, and nothing on it
  // should move while you are reading.
  function sprite(canvas, day) {
    // The box has to hold the widest thing drawn in it, which is the moon orbit
    // at 1.6r + 4, not the planet.
    var B = 80, R = 18, C = 40, px = 2;

    var s = new P.Surface(B, B, S.bg);
    s.clear(0);   // transparent: the sprite sits on whatever the page is

    canvas.width = B * px;
    canvas.height = B * px;
    canvas.style.width = (B * px) + "px";
    canvas.style.height = (B * px) + "px";

    var was = surf;
    surf = s;
    var slot = {
      color: day.color, type: day.type, seed: day.seed,
      entry: { milestone: day.milestone }
    };
    body(C, C, R, slot, (day.seed % P.SPIN_STEPS) / P.SPIN_STEPS, 1);
    if (day.moons > 0) P.drawMoons(s, C, C, R, day.moons, day.seed, 1, 0, day.moonColors || S.moon);
    if (day.idea) comet(C + R + 3, C - R - 3, 1);
    surf = was;

    s.blit(canvas);
  }

  global.ODailyPixel = {
    init: init, resize: resize, draw: draw,
    toLogical: toLogical, pixelsPerCss: pixelsPerCss,
    sprite: sprite
  };
})(window);
