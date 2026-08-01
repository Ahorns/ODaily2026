/* The pixel renderer.
 *
 * Draws the galaxy into a small integer-sized buffer and scales it up by a whole
 * number, so every pixel on screen is a deliberate one. Uses planet-core.js for
 * the sprites themselves.
 *
 * The one thing a per-pixel buffer cannot afford is large soft areas, so the
 * nebulae are drawn separately with hard-stopped gradients into a second buffer
 * of the same small size, and the sprite buffer is composited over them. Hard
 * stops mean the clouds come out as flat quantised bands — which is what a
 * pixel-art nebula is anyway, and it costs nothing.
 *
 * Zoom moves along a fixed ladder rather than being continuous: sprites are
 * cached per radius, and a smoothly varying radius would mean rendering a fresh
 * set of thirty-two rotation frames for every planet on every wheel notch.
 */
(function (global) {
  "use strict";

  var P = global.ODailyPlanet;
  var BG = [11, 11, 22];   // a multiple of STEP in every channel — see below
  var RYF = 0.70;

  // Three bands per cloud, laid down as hard stops so the clouds come out as
  // flat quantised steps rather than as a smooth wash.
  //
  // These look far too dark listed here, and they have to be: the clouds are
  // composited additively and three or four of them overlap almost everywhere,
  // so anything with real brightness in it sums to neon within one screen.
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

  // A 4x4 ordered dither matrix. This is how the era actually drew a gradient:
  // not with more colours, but by trading a pixel of one colour against a pixel
  // of the next in a fixed pattern. It quantises the gas to a handful of tones
  // *and* breaks up the band boundaries, which is why smooth gradients had to
  // go — a hard step between two flat colours draws a perfect ellipse, and
  // twenty of those stacked read as a Venn diagram rather than as gas.
  var BAYER = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ];
  // The step is picked for what is actually in this buffer, not for the full
  // 0-255 range: the gas, the void and the vignette all live in the darkest
  // quarter, so quantising to five tones across the whole range would flatten
  // every one of them to black. Eleven gives the gas about six bands.
  //
  // It also divides BG exactly, which matters more than it sounds: a flat colour
  // sitting halfway between two levels dithers into a checkerboard, and the
  // empty sky is most of the screen.
  var STEP = 11;

  var surf = null;
  var neb = null;
  var scale = 3;
  var clouds = null;
  var cloudCount = -1;

  function init() {
    surf = null;   // rebuilt on the next resize
    neb = null;
  }

  function resize(canvas, cssW, cssH) {
    scale = cssW < 760 ? 2 : 3;
    var w = Math.max(160, Math.ceil(cssW / scale));
    var h = Math.max(160, Math.ceil(cssH / scale));
    canvas.width = w * scale;
    canvas.height = h * scale;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    surf = new P.Surface(w, h, BG);

    neb = neb || document.createElement("canvas");
    neb.width = w; neb.height = h;
    return { w: w, h: h };
  }

  function toLogical(x, y) { return { x: x / scale, y: y / scale }; }
  function pixelsPerCss() { return 1 / scale; }

  function rnd(i, k) {
    var n = Math.imul(i | 0, 374761393) ^ Math.imul(k | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function cloudsFor(scene) {
    if (clouds && cloudCount === scene.systems.length) return clouds;
    var reach = 420 * Math.sqrt(Math.max(1, scene.systems.length)) + 1000;
    clouds = [];
    for (var i = 0; i < 16; i++) {
      var a = rnd(i, 61) * Math.PI * 2;
      var d = Math.sqrt(rnd(i, 62)) * reach;
      // About one stellar system across at most, and built from three offset
      // lobes rather than one disc. A single disc of banded colour at this size
      // reads as an enormous circle drawn on the sky, not as gas.
      var r = 110 + rnd(i, 63) * 260;
      var lobes = [];
      for (var l = 0; l < 5; l++) {
        var la = rnd(i * 6 + l, 66) * Math.PI * 2;
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

  // Flat bands, not a smooth falloff: three hard stops give three visible steps,
  // which is the whole grammar of the style.
  function drawNebula(scene, w, h, camx, camy, z) {
    var n = neb.getContext("2d");
    n.globalCompositeOperation = "source-over";
    n.fillStyle = "rgb(" + BG[0] + "," + BG[1] + "," + BG[2] + ")";
    n.fillRect(0, 0, w, h);
    n.globalCompositeOperation = "lighter";

    var list = cloudsFor(scene);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var cx = (c.x - camx * c.depth) * z + w / 2;
      var cy = (c.y - camy * c.depth) * z + h / 2;
      for (var l = 0; l < c.lobes.length; l++) {
        var lo = c.lobes[l];
        var px = cx + lo.dx * z, py = cy + lo.dy * z, r = lo.r * z;
        if (px + r < 0 || py + r < 0 || px - r > w || py - r > h) continue;
        // Smooth, despite everything else here being hard-edged. The buffer is a
        // third of the screen's size and is scaled up with smoothing off, so the
        // gradient arrives already broken into visible cells — the quantising
        // comes free. Stopping it by hand only draws a hard ellipse instead.
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
        n.arc(0, 0, r, 0, Math.PI * 2);
        n.fill();
        n.restore();
      }
    }

    // A vignette. Smooth here on purpose: this buffer is a third of the screen's
    // size, so the scale-up quantises it into visible steps for free, and a
    // hand-stepped one lands as a hard circle drawn across the view.
    n.globalCompositeOperation = "multiply";
    var v = n.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36,
      w / 2, h / 2, Math.hypot(w, h) * 0.58);
    v.addColorStop(0, "#ffffff");
    v.addColorStop(1, "#8c8c8c");
    n.fillStyle = v;
    n.fillRect(0, 0, w, h);
    n.globalCompositeOperation = "source-over";

    dither(n, w, h);
  }

  // Snap the whole nebula buffer to a small palette, offsetting each pixel by
  // its position in the dither matrix first. One pass over a buffer that is a
  // third of the screen's size in each direction, so it costs a ninth of what
  // it looks like it costs.
  function dither(n, w, h) {
    var img = n.getImageData(0, 0, w, h);
    var d = img.data;
    for (var y = 0; y < h; y++) {
      var row = (y & 3) * 4;
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var t = (BAYER[row + (x & 3)] * 0.0625 - 0.46875) * STEP;
        var r = Math.round((d[i] + t) / STEP) * STEP;
        var g = Math.round((d[i + 1] + t) / STEP) * STEP;
        var b = Math.round((d[i + 2] + t) / STEP) * STEP;
        d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }
    n.putImageData(img, 0, 0);
  }

  function draw(canvas, scene) {
    if (!surf) return;
    // Transparent, so the sprite buffer composites over the nebula rather than
    // painting a flat sky on top of it.
    surf.clear(0);

    var w = scene.view.w, h = scene.view.h;
    var z = scene.camera.zoom;
    var camx = scene.camera.x, camy = scene.camera.y;

    function sx(wx) { return (wx - camx) * z + w / 2; }
    function sy(wy) { return (wy - camy) * z + h / 2; }

    drawNebula(scene, w, h, camx, camy, z);

    // Stars drift at their own depth, which is the only cue that the field has
    // any depth at all when everything else is flat colour.
    for (var i = 0; i < scene.stars.length; i++) {
      var st = scene.stars[i];
      var px = (st.x - camx * st.depth) * z + w / 2;
      var py = (st.y - camy * st.depth) * z + h / 2;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      var v = 30 + Math.round(st.b * 200);
      // The tint comes from the star's own numbers, so the field is varied but
      // never flickers between frames.
      var tint = STAR_TINTS[Math.floor(((st.b * 13) % 1) * STAR_TINTS.length)];
      var c = [
        Math.min(255, Math.round(v * tint[0])),
        Math.min(255, Math.round(v * tint[1])),
        Math.min(255, Math.round(v * tint[2]))
      ];
      surf.px(px, py, c);
      // The few first-magnitude stars get a cross, which is the pixel-art way
      // of saying bright without any glow at all.
      if (st.b > 0.94) {
        var dim = [Math.round(c[0] * 0.5), Math.round(c[1] * 0.5), Math.round(c[2] * 0.5)];
        surf.px(px - 1, py, dim); surf.px(px + 1, py, dim);
        surf.px(px, py - 1, dim); surf.px(px, py + 1, dim);
      }
    }

    for (var s = 0; s < scene.systems.length; s++) {
      var sys = scene.systems[s];
      var scx = sx(sys.cx), scy = sy(sys.cy);
      var outer = sys.rings[sys.rings.length - 1] * z;
      if (scx < -outer - 60 || scy < -outer - 60 || scx > w + outer + 60 || scy > h + outer + 60) continue;

      for (var r = 0; r < sys.rings.length; r++) {
        var rr = sys.rings[r] * z;
        var pts = P.ringPixels(scx, scy, rr, rr * RYF);
        for (var pi = 0; pi < pts.length; pi += 3) {
          // The near half of each orbit is stated a shade brighter than the far
          // half. One extra colour, and the rings stop looking like flat discs.
          surf.px(pts[pi][0], pts[pi][1], pts[pi][2] >= 0 ? [44, 58, 96] : [26, 35, 60]);
        }
      }

      for (var dow = 0; dow < 7; dow++) {
        var a = -Math.PI / 2 + (dow / 7) * Math.PI * 2;
        for (var t = 24 * z; t < outer + 6; t += 5) {
          var rx = scx + t * Math.cos(a), ry = scy + t * RYF * Math.sin(a);
          if (Math.hypot((rx - scx) / (outer + 4), (ry - scy) / (outer * RYF + 4)) > 1) break;
          surf.px(rx, ry, [17, 24, 42]);
        }
      }

      star(scx, scy, Math.max(2, Math.round(5 * z)));

      if (z > 0.55) {
        var lx = Math.round(scx - P.textWidth(sys.label) / 2);
        var ly = Math.round(scy - sys.rings[sys.rings.length - 1] * RYF * z - 16);
        // Set once in near-black and again a pixel up: a hard drop shadow, so a
        // label stays readable over a bright cloud without any halo.
        surf.text(sys.label, lx + 1, ly + 1, [6, 9, 18]);
        surf.text(sys.label, lx, ly, P.hex("#93a4cc"));
      }

      if (scene.filter) {
        var chain = sys.slots.filter(function (sl) { return sl.projects.indexOf(scene.filter) >= 0; });
        for (var c2 = 1; c2 < chain.length; c2++) {
          surf.line(sx(chain[c2 - 1].x), sy(chain[c2 - 1].y), sx(chain[c2].x), sy(chain[c2].y),
            P.hex("#7d6531"), true);
        }
      }

      for (var j = 0; j < sys.slots.length; j++) {
        var sl = sys.slots[j];
        var px2 = Math.round(sx(sl.x)), py2 = Math.round(sy(sl.y));
        if (px2 < -20 || py2 < -20 || px2 > w + 20 || py2 > h + 20) continue;

        var lit = !scene.filter || sl.projects.indexOf(scene.filter) >= 0;
        var kk = lit ? 1 : 0.24;

        if (!sl.entry) {
          var ec = surf.fade([46, 58, 88], kk);
          surf.px(px2, py2, ec);
          if (z > 0.7) { surf.px(px2 + 2, py2 - 1, ec); surf.px(px2 - 2, py2 + 1, ec); }
          continue;
        }

        var pr = Math.max(2, Math.round(sl.r * z));
        var turn = ((sl.phase + scene.time * sl.spinRate) % 1 + 1) % 1;
        var step = Math.floor(turn * P.SPIN_STEPS) % P.SPIN_STEPS;

        if (sl.entry.milestone) P.drawMilestoneRing(surf, px2, py2, pr, "back", kk);
        P.drawPlanet(surf, px2, py2, pr, sl.type, sl.seed, step, kk, sl.color);
        if (sl.entry.milestone) P.drawMilestoneRing(surf, px2, py2, pr, "front", kk);

        var extra = sl.projects.length - 1;
        if (extra > 0 && pr >= 5) P.drawMoons(surf, px2, py2, pr, extra, sl.seed, kk, scene.time);
        if (sl.entry.idea) P.drawComet(surf, px2 + pr + 3, py2 - pr - 3, kk);

        if (sl === scene.selected || sl === scene.hover || sl === scene.today) {
          var col = sl === scene.selected ? P.hex("#f2c46b")
            : sl === scene.today ? P.hex("#7fd8f7") : P.hex("#8b9cc4");
          bracket(px2, py2, pr + 3, col);
        }
      }
    }

    var vctx = canvas.getContext("2d");
    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, canvas.width, canvas.height);
    vctx.drawImage(neb, 0, 0, canvas.width, canvas.height);
    surf.blit(canvas, true);
  }

  // The star at the centre is the month itself: a hot core, a dimmer skirt and
  // four rays, drawn as pixels rather than as a glow.
  function star(cx, cy, r) {
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var d = Math.hypot(dx, dy);
        if (d > r + 0.2) continue;
        var k = 1 - d / (r + 0.2);
        surf.px(cx + dx, cy + dy, [
          Math.round(96 + 159 * k * k),
          Math.round(74 + 171 * k * k),
          Math.round(42 + 198 * k * k * k)
        ]);
      }
    }
    var reach = Math.round(r * 2.4);
    for (var i = r + 1; i <= reach; i++) {
      var f = 1 - (i - r) / (reach - r + 0.5);
      var c = [Math.round(150 * f), Math.round(120 * f), Math.round(64 * f)];
      if ((i - r) % 2 === 0) continue;   // dashed rays read as light, not as spokes
      surf.px(cx + i, cy, c); surf.px(cx - i, cy, c);
      surf.px(cx, cy + i, c); surf.px(cx, cy - i, c);
    }
  }

  function bracket(x, y, b, c) {
    for (var i = -1; i <= 1; i++) {
      surf.px(x - b + i + 1, y - b, c); surf.px(x + b - i - 1, y - b, c);
      surf.px(x - b + i + 1, y + b, c); surf.px(x + b - i - 1, y + b, c);
      surf.px(x - b, y - b + i + 1, c); surf.px(x - b, y + b - i - 1, c);
      surf.px(x + b, y - b + i + 1, c); surf.px(x + b, y + b - i - 1, c);
    }
  }

  global.ODailyPixel = {
    init: init, resize: resize, draw: draw,
    toLogical: toLogical, pixelsPerCss: pixelsPerCss
  };
})(window);
