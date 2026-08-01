/* Three non-pixel visual languages over exactly the same universe.
 *
 *   chart    An 18th-century celestial plate. The sheet is parchment — laid,
 *            foxed, plate-marked — and the year is engraved onto it in iron-gall
 *            ink, sepia, gilt and one vermilion rubric. Sun in splendour, ruled
 *            orbits with a graduated limb, globes shaded with burin hatching,
 *            titles in tracked roman caps under a hairline flourish.
 *   deep     Photographic deep space. Near-black, heavy bloom, glowing bodies.
 *            High impact; the least legible of the three.
 *   dataviz  A clean chart that happens to be shaped like a galaxy. Flat discs,
 *            hairline orbits, no glow, everything optimised for reading values.
 *
 * All three share one draw path, so layout, hit tests and meanings are provably
 * identical between them — which is the only way comparing them is fair. Only
 * the marks differ.
 *
 * Colour always comes from the day's blended project colour; the terrain hint
 * comes from the category. Never the other way round.
 */
(function (global) {
  "use strict";

  var P = global.ODailyPlanet;
  var RYF = 0.70;
  var TAU = 6.283185307179586;

  // An old-style serif with real oldstyle proportions wherever the machine has
  // one, falling back through the Palatino family to Georgia.
  var SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",' +
    '"URW Palladio L",P052,"Hoefler Text",Georgia,serif';

  // The data style is the one that should look like it came out of a good chart
  // library, so it gets the interface face rather than the console one.
  var SANS = 'ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

  var SKINS = {
    chart: {
      // The sheet, not the sky: the ground is drawn once per resize and the
      // chart is engraved over it. See buildPaper.
      paper: true,
      ground: ["#f7eeda", "#eddcbb", "#d3b98d"],
      ink: "#2b2117",              // iron gall, gone brown with age
      sepia: "#6b5334",
      gilt: "#9d7526",
      rubric: "#9c3b22",           // the second ink, kept for today alone
      star: "#2f2517", starDim: "#8a7452", starMax: 1.0,
      orbit: "rgba(70,54,32,0.34)", ray: "rgba(70,54,32,0.13)",
      sun: "#8a6a1f", sunGlow: 0,
      label: "rgba(43,33,23,0.82)",
      labelFont: '400 12px ' + SERIF,
      labelTrack: "0.34em",
      empty: "rgba(70,54,32,0.3)",
      chain: "rgba(156,59,34,0.55)", bloom: 0
    },
    deep: {
      sky: ["#03040c", "#060814", "#010205"],
      star: "#f2f6ff", starDim: "#8296c6", starWarm: "#ffd9a8", starMax: 1.3,
      orbit: "rgba(150,180,240,0.07)", ray: "rgba(150,180,240,0.03)",
      sun: "#fff0c8", sunGlow: 1.0,
      label: "rgba(198,212,245,0.5)", labelFont: '300 11px ui-sans-serif, system-ui, sans-serif',
      labelTrack: "0.3em", empty: "rgba(150,170,215,0.16)",
      chain: "rgba(242,196,107,0.32)", bloom: 1,
      // The clouds this galaxy is lit from. Deliberately few and desaturated:
      // one more colour and it stops being a photograph.
      clouds: ["#2b3f8c", "#6a2a72", "#12545f", "#6d3a20", "#1d2a6b"],
      vignette: 0.55
    },
    dataviz: {
      sky: ["#12151c", "#0f1218", "#0c0f14"],
      star: "#3d465a", starDim: "#2a3040", starMax: 0,
      orbit: "rgba(168,184,210,0.15)", ray: "rgba(168,184,210,0.055)",
      sun: "#dbe2ec", sunGlow: 0.1,
      label: "#e7ecf5", labelFont: '500 11px ' + SANS,
      labelTrack: "0.1em", empty: "rgba(160,175,200,0.22)",
      chain: "rgba(242,196,107,0.55)", bloom: 0,
      // A chart stands on a grid, not on stars.
      grid: "rgba(168,184,210,0.16)", gridMajor: "rgba(168,184,210,0.32)",
      value: "rgba(160,175,200,0.62)", accent: "#7fd8f7"
    }
  };

  var DOW_INITIAL = ["S", "M", "T", "W", "T", "F", "S"];

  var skinKey = "chart";
  var ctx = null;
  var dpr = 1;

  function init(canvas) {
    ctx = canvas.getContext("2d");
  }

  function setSkin(k) { skinKey = SKINS[k] ? k : "chart"; }

  function resize(canvas, cssW, cssH) {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: cssW, h: cssH };
  }

  function toLogical(x, y) { return { x: x, y: y }; }
  function pixelsPerCss() { return 1; }

  function shade(colour, amount) {
    var c = P.hex(colour);
    var f = function (v) {
      return Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount));
    };
    return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")";
  }

  function alpha(colour, a) {
    var c = P.hex(colour);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  // A fixed hash, so the sheet is the same sheet every time the window changes
  // size rather than a new one being pulled off the pile.
  function rnd(i, k) {
    var n = Math.imul(i | 0, 374761393) ^ Math.imul(k | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  /* ------------------------------------------------------------- the sheet -- */

  // Parchment is expensive to draw and never moves: the chart travels over the
  // sheet, the sheet stays where it is. So it is baked once per size and blitted.
  var paper = { key: "", canvas: null };

  function paperFor(w, h, S) {
    var key = Math.round(w) + "x" + Math.round(h) + "@" + dpr;
    if (paper.key === key && paper.canvas) return paper.canvas;

    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    var p = c.getContext("2d");
    p.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. The ground: warm at the centre where the light falls, cooler and
    //    dirtier towards the edges where the sheet has been handled.
    var g = p.createRadialGradient(
      w * 0.44, h * 0.38, Math.min(w, h) * 0.05,
      w * 0.5, h * 0.5, Math.hypot(w, h) * 0.66
    );
    g.addColorStop(0, S.ground[0]);
    g.addColorStop(0.52, S.ground[1]);
    g.addColorStop(1, S.ground[2]);
    p.fillStyle = g;
    p.fillRect(0, 0, w, h);

    // 2. Laid lines. Hand-made paper carries the impression of the mould: close
    //    wires one way, chain lines every inch or so the other.
    p.strokeStyle = "rgba(120,96,60,0.045)";
    p.lineWidth = 1;
    p.beginPath();
    for (var ly = 0.5; ly < h; ly += 3) { p.moveTo(0, ly); p.lineTo(w, ly); }
    p.stroke();
    p.strokeStyle = "rgba(120,96,60,0.075)";
    p.beginPath();
    for (var lx = 12.5; lx < w; lx += 27) { p.moveTo(lx, 0); p.lineTo(lx, h); }
    p.stroke();

    // 3. Foxing: the soft rust blooms that age brings to rag paper. Large and
    //    very faint, so they read as tone rather than as marks.
    for (var i = 0; i < 34; i++) {
      var fx = rnd(i, 11) * w;
      var fy = rnd(i, 12) * h;
      var fr = 26 + rnd(i, 13) * 140;
      var fg = p.createRadialGradient(fx, fy, 0, fx, fy, fr);
      var strength = 0.028 + rnd(i, 14) * 0.05;
      fg.addColorStop(0, "rgba(150,108,54," + strength.toFixed(3) + ")");
      fg.addColorStop(0.6, "rgba(150,108,54," + (strength * 0.35).toFixed(3) + ")");
      fg.addColorStop(1, "rgba(150,108,54,0)");
      p.fillStyle = fg;
      p.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
    }

    // 4. Fibre and speck. A little tooth, or the sheet looks like a screen.
    p.fillStyle = "rgba(92,70,40,0.13)";
    for (var s = 0; s < 900; s++) {
      p.fillRect(rnd(s, 21) * w, rnd(s, 22) * h, 1, 1);
    }
    p.fillStyle = "rgba(255,250,238,0.5)";
    for (var s2 = 0; s2 < 600; s2++) {
      p.fillRect(rnd(s2, 31) * w, rnd(s2, 32) * h, 1, 1);
    }
    p.strokeStyle = "rgba(104,80,46,0.1)";
    p.lineWidth = 0.6;
    p.beginPath();
    for (var f = 0; f < 90; f++) {
      var ax = rnd(f, 41) * w, ay = rnd(f, 42) * h;
      var aa = rnd(f, 43) * TAU, al = 3 + rnd(f, 44) * 12;
      p.moveTo(ax, ay);
      p.lineTo(ax + Math.cos(aa) * al, ay + Math.sin(aa) * al);
    }
    p.stroke();

    // 5. The plate mark: the bruise the copper plate presses into damp paper,
    //    a shade darker outside the impression and a hair lighter within.
    var inset = Math.max(12, Math.min(30, Math.min(w, h) * 0.028));
    p.save();
    p.strokeStyle = "rgba(120,94,58,0.16)";
    p.lineWidth = 2.5;
    p.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    p.strokeStyle = "rgba(255,250,236,0.4)";
    p.lineWidth = 1;
    p.strokeRect(inset + 1.5, inset + 1.5, w - inset * 2 - 3, h - inset * 2 - 3);
    p.restore();

    // 6. The printed border: a heavy rule and a light one, the way a plate is
    //    ruled, with a small lozenge closing each corner.
    var b = inset + 7;
    p.strokeStyle = "rgba(43,33,23,0.5)";
    p.lineWidth = 1.4;
    p.strokeRect(b, b, w - b * 2, h - b * 2);
    p.strokeStyle = "rgba(43,33,23,0.3)";
    p.lineWidth = 0.7;
    p.strokeRect(b + 4.5, b + 4.5, w - b * 2 - 9, h - b * 2 - 9);

    p.fillStyle = "rgba(43,33,23,0.45)";
    [[b, b], [w - b, b], [b, h - b], [w - b, h - b]].forEach(function (pt) {
      p.save();
      p.translate(pt[0], pt[1]);
      p.rotate(Math.PI / 4);
      p.fillRect(-3, -3, 6, 6);
      p.restore();
    });

    // 7. Vignette. The corners of a two-hundred-year-old sheet are always darker
    //    than its middle, and it is what makes the ground read as an object.
    var v = p.createRadialGradient(
      w * 0.5, h * 0.5, Math.min(w, h) * 0.34,
      w * 0.5, h * 0.5, Math.hypot(w, h) * 0.58
    );
    v.addColorStop(0, "rgba(96,70,36,0)");
    v.addColorStop(1, "rgba(96,70,36,0.3)");
    p.fillStyle = v;
    p.fillRect(0, 0, w, h);

    paper.key = key;
    paper.canvas = c;
    return c;
  }

  /* ---------------------------------------------------------------- draw -- */

  function draw(canvas, scene) {
    if (!ctx) return;
    var S = SKINS[skinKey];
    var w = scene.view.w, h = scene.view.h;
    var z = scene.camera.zoom;
    var camx = scene.camera.x, camy = scene.camera.y;
    var sx = function (wx) { return (wx - camx) * z + w / 2; };
    var sy = function (wy) { return (wy - camy) * z + h / 2; };

    if (S.paper) {
      ctx.drawImage(paperFor(w, h, S), 0, 0, w, h);
    } else {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, S.sky[0]);
      g.addColorStop(0.55, S.sky[1]);
      g.addColorStop(1, S.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (S.clouds) nebula(scene, camx, camy, z, w, h, S);
    if (S.grid) grid(camx, camy, z, w, h, S);
    if (S.starMax > 0) starfield(scene, camx, camy, z, w, h, S);

    for (var s = 0; s < scene.systems.length; s++) {
      system(scene, scene.systems[s], sx, sy, w, h, z, S);
    }

    if (S.vignette) {
      var v = ctx.createRadialGradient(
        w * 0.5, h * 0.5, Math.min(w, h) * 0.3,
        w * 0.5, h * 0.5, Math.hypot(w, h) * 0.56);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0," + S.vignette + ")");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ------------------------------------------------------------ the ground -- */

  // Deep space is mostly gas, and gas is the one thing a hard-edged renderer
  // cannot fake. Drawn at a quarter size and scaled back up: the browser's own
  // smoothing does the blurring for free, and the fill cost drops sixteenfold.
  var neb = { canvas: null, w: 0, h: 0, clouds: null, forCount: -1 };

  function cloudsFor(scene, S) {
    if (neb.clouds && neb.forCount === scene.systems.length) return neb.clouds;
    var reach = 420 * Math.sqrt(Math.max(1, scene.systems.length)) + 1100;
    var out = [];
    for (var i = 0; i < 26; i++) {
      var a = rnd(i, 51) * TAU;
      var d = Math.sqrt(rnd(i, 52)) * reach;
      out.push({
        x: Math.cos(a) * d,
        y: Math.sin(a) * d * 0.8,
        r: 260 + rnd(i, 53) * 620,
        c: S.clouds[Math.floor(rnd(i, 54) * S.clouds.length)],
        a: 0.16 + rnd(i, 55) * 0.2,
        depth: 0.6 + rnd(i, 56) * 0.3
      });
    }
    neb.clouds = out;
    neb.forCount = scene.systems.length;
    return out;
  }

  function nebula(scene, camx, camy, z, w, h, S) {
    var qw = Math.max(1, Math.ceil(w / 4)), qh = Math.max(1, Math.ceil(h / 4));
    if (!neb.canvas) neb.canvas = document.createElement("canvas");
    if (neb.w !== qw || neb.h !== qh) {
      neb.canvas.width = qw; neb.canvas.height = qh;
      neb.w = qw; neb.h = qh;
    }
    var n = neb.canvas.getContext("2d");
    n.clearRect(0, 0, qw, qh);
    n.globalCompositeOperation = "lighter";

    var list = cloudsFor(scene, S);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var px = ((c.x - camx * c.depth) * z + w / 2) / 4;
      var py = ((c.y - camy * c.depth) * z + h / 2) / 4;
      var r = (c.r * z) / 4;
      if (px + r < 0 || py + r < 0 || px - r > qw || py - r > qh) continue;
      var g = n.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, alpha(c.c, c.a));
      g.addColorStop(0.45, alpha(c.c, c.a * 0.42));
      g.addColorStop(1, alpha(c.c, 0));
      n.fillStyle = g;
      n.fillRect(px - r, py - r, r * 2, r * 2);
    }
    n.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(neb.canvas, 0, 0, w, h);
    ctx.restore();
  }

  // The data style's ground: a world-space grid that steps by powers of two so
  // the spacing on screen stays in a comfortable band at every zoom.
  function grid(camx, camy, z, w, h, S) {
    var step = 50;
    while (step * z < 34) step *= 2;
    while (step * z > 96) step /= 2;

    var x0 = Math.floor((camx - w / 2 / z) / step) * step;
    var y0 = Math.floor((camy - h / 2 / z) / step) * step;

    for (var pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? S.gridMajor : S.grid;
      ctx.beginPath();
      for (var wx = x0; (wx - camx) * z + w / 2 < w + step * z; wx += step) {
        var sxp = (wx - camx) * z + w / 2;
        if (sxp < -2 || sxp > w + 2) continue;
        for (var wy = y0; (wy - camy) * z + h / 2 < h + step * z; wy += step) {
          var syp = (wy - camy) * z + h / 2;
          if (syp < -2 || syp > h + 2) continue;
          // Every fourth intersection is stated a little more firmly, which is
          // what lets the eye measure distance without any axis at all.
          var major = Math.round(wx / step) % 4 === 0 && Math.round(wy / step) % 4 === 0;
          if (major !== !!pass) continue;
          ctx.rect(sxp - 0.5, syp - 0.5, major ? 1.6 : 1, major ? 1.6 : 1);
        }
      }
      ctx.fill();
    }
  }

  // Batched into brightness bands: fifteen hundred separate fills is a real cost
  // at 24fps, and four is not.
  function starfield(scene, camx, camy, z, w, h, S) {
    var bands = [[], [], [], []];
    for (var i = 0; i < scene.stars.length; i++) {
      var st = scene.stars[i];
      var px = (st.x - camx * st.depth) * z + w / 2;
      var py = (st.y - camy * st.depth) * z + h / 2;
      if (px < -3 || py < -3 || px > w + 3 || py > h + 3) continue;
      // Not every star is white. The warm ones come from the star's own numbers,
      // so the field is varied without being random from frame to frame.
      var warm = S.starWarm && ((st.b * 7) % 1) > 0.74;
      bands[st.b > 0.88 ? 3 : warm ? 2 : st.b > 0.55 ? 1 : 0].push(px, py, st.b);
    }

    var setup = [
      { a: 0.34, c: S.starDim },
      { a: 0.62, c: S.starDim },
      { a: 0.7, c: S.starWarm || S.starDim },
      { a: 0.95, c: S.star }
    ];

    for (var band = 0; band < 4; band++) {
      var pts = bands[band];
      if (!pts.length) continue;
      ctx.globalAlpha = Math.min(1, setup[band].a * S.starMax);
      ctx.fillStyle = setup[band].c;
      ctx.beginPath();
      for (var k = 0; k < pts.length; k += 3) {
        var r = 0.4 + pts[k + 2] * 1.1;
        ctx.moveTo(pts[k] + r, pts[k + 1]);
        ctx.arc(pts[k], pts[k + 1], r, 0, TAU);
      }
      ctx.fill();

      if (band !== 3) continue;

      // The brightest stars get rays: engraved four-point ones on paper, and in
      // deep space the diffraction spikes a real lens would give them.
      if (S.paper) {
        ctx.strokeStyle = S.star;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (var m = 0; m < pts.length; m += 3) {
          var ray = 2.2 + pts[m + 2] * 2.6;
          ctx.moveTo(pts[m] - ray, pts[m + 1]); ctx.lineTo(pts[m] + ray, pts[m + 1]);
          ctx.moveTo(pts[m], pts[m + 1] - ray); ctx.lineTo(pts[m], pts[m + 1] + ray);
        }
        ctx.stroke();
      } else if (S.bloom) {
        for (var q = 0; q < pts.length; q += 3) {
          var sp = 3 + pts[q + 2] * 7;
          var gx = ctx.createLinearGradient(pts[q] - sp, 0, pts[q] + sp, 0);
          gx.addColorStop(0, alpha(S.star, 0));
          gx.addColorStop(0.5, alpha(S.star, 0.5));
          gx.addColorStop(1, alpha(S.star, 0));
          ctx.fillStyle = gx;
          ctx.fillRect(pts[q] - sp, pts[q + 1] - 0.4, sp * 2, 0.8);
          ctx.fillRect(pts[q] - 0.4, pts[q + 1] - sp, 0.8, sp * 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function system(scene, sys, sx, sy, w, h, z, S) {
    var scx = sx(sys.cx), scy = sy(sys.cy);
    var last = sys.rings[sys.rings.length - 1];
    var outer = last * z;
    if (scx < -outer - 160 || scy < -outer - 160 || scx > w + outer + 160 || scy > h + outer + 160) return;

    var atlas = skinKey === "chart";

    // Ruled orbits. On the plate the week rings are hairlines and the outermost
    // is the limb: a heavier rule, graduated at every weekday.
    ctx.lineWidth = 1;
    ctx.strokeStyle = S.orbit;
    for (var r = 0; r < sys.rings.length; r++) {
      if (atlas && r === sys.rings.length - 1) continue;
      ctx.beginPath();
      ctx.ellipse(scx, scy, sys.rings[r] * z, sys.rings[r] * RYF * z, 0, 0, TAU);
      ctx.stroke();
    }

    // Weekday rays: the chart's radial graticule.
    ctx.strokeStyle = S.ray;
    for (var dow = 0; dow < 7; dow++) {
      var a = -Math.PI / 2 + (dow / 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(scx + Math.cos(a) * 24 * z, scy + Math.sin(a) * 24 * RYF * z);
      ctx.lineTo(scx + Math.cos(a) * outer, scy + Math.sin(a) * outer * RYF);
      ctx.stroke();
    }

    if (atlas) limb(scx, scy, last * z, z, S);

    sun(scx, scy, 8 * z, S);

    if (z > 0.42) {
      var top = scy - last * RYF * z - 20;
      if (atlas) {
        plate(sys, scx, scy, last * RYF * z, z, S);
      } else {
        ctx.fillStyle = S.label;
        ctx.font = S.labelFont;
        ctx.textAlign = "center";
        ctx.letterSpacing = S.labelTrack;
        ctx.fillText(sys.label.toUpperCase(), scx, top);
        ctx.letterSpacing = "0px";
        // A chart labels its groups with their value. The map already shows the
        // month; saying what the month came to is the part only a chart does.
        if (S.value && z > 0.62) {
          var sum = totals(sys);
          ctx.fillStyle = S.value;
          ctx.font = '400 10px ' + SANS;
          ctx.fillText(sum.hours.toFixed(0) + "h · " + sum.days + " days", scx, top + 14);
        }
      }
    }

    if (scene.filter) {
      var chain = sys.slots.filter(function (sl) { return sl.projects.indexOf(scene.filter) >= 0; });
      if (chain.length > 1) {
        ctx.strokeStyle = S.chain;
        ctx.setLineDash(atlas ? [1, 4] : [2, 5]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var c = 0; c < chain.length; c++) ctx[c ? "lineTo" : "moveTo"](sx(chain[c].x), sy(chain[c].y));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (var j = 0; j < sys.slots.length; j++) {
      var sl = sys.slots[j];
      var x = sx(sl.x), y = sy(sl.y);
      var pr = sl.r * 1.15 * z;
      if (x < -50 || y < -50 || x > w + 50 || y > h + 50) continue;

      var lit = !scene.filter || sl.projects.indexOf(scene.filter) >= 0;
      ctx.globalAlpha = lit ? 1 : 0.2;

      if (!sl.entry) {
        // Where no entry was written the gap is recorded, not hidden: debris in
        // space, and on the plate the engraver's bare pricking point.
        ctx.fillStyle = S.empty;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.7, 1.1 * z), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }

      var turn = ((sl.phase + scene.time * sl.spinRate) % 1 + 1) % 1;
      planet(x, y, pr, sl, turn, S);

      if (sl.entry.milestone) ring(x, y, pr, S);
      var extra = sl.projects.length - 1;
      if (extra > 0) moons(x, y, pr, extra, sl.seed, scene.time, S);
      if (sl.entry.idea) comet(x + pr * 1.5 + 3, y - pr * 1.5 - 3, z, S);

      if (sl === scene.selected || sl === scene.hover || sl === scene.today) {
        if (atlas) {
          // Sighted through an instrument rather than boxed by a cursor.
          sight(x, y, pr + 7,
            sl === scene.selected ? S.gilt : sl === scene.today ? S.rubric : S.sepia,
            sl === scene.selected ? 1 : sl === scene.today ? 0.85 : 0.5);
        } else {
          ctx.strokeStyle = sl === scene.selected ? "rgba(242,196,107,0.95)"
            : sl === scene.today ? "rgba(127,216,247,0.85)" : "rgba(200,212,240,0.55)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, pr + 6, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  }

  // Cached on the system: the slots never change once the galaxy is built.
  function totals(sys) {
    if (sys._sum) return sys._sum;
    var hours = 0, days = 0;
    for (var i = 0; i < sys.slots.length; i++) {
      if (!sys.slots[i].entry) continue;
      days++;
      hours += sys.slots[i].hours || 0;
    }
    sys._sum = { hours: hours, days: days };
    return sys._sum;
  }

  /* ------------------------------------------------------- atlas furniture -- */

  // The graduated limb of the month: a doubled rule with a tick at every
  // weekday, and the weekday letters once you are close enough to read them.
  function limb(cx, cy, r, z, S) {
    ctx.strokeStyle = S.orbit;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * RYF, 0, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r + 5, (r + 5) * RYF, 0, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = alpha(S.sepia, 0.5);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (var i = 0; i < 28; i++) {
      var a = -Math.PI / 2 + (i / 28) * TAU;
      var major = i % 4 === 0;
      var t = major ? 5 : 2.5;
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * RYF);
      ctx.lineTo(cx + Math.cos(a) * (r + t), cy + Math.sin(a) * (r + t) * RYF);
    }
    ctx.stroke();

    if (z < 1.15) return;
    ctx.fillStyle = alpha(S.sepia, 0.62);
    ctx.font = 'italic 400 10px ' + SERIF;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var d = 0; d < 7; d++) {
      var da = -Math.PI / 2 + (d / 7) * TAU;
      ctx.fillText(DOW_INITIAL[d],
        cx + Math.cos(da) * (r + 14),
        cy + Math.sin(da) * (r + 14) * RYF);
    }
    ctx.textBaseline = "alphabetic";
  }

  // The plate's title: the month in tracked roman caps, the year beneath it in
  // italic, and a hairline flourish drawn to the width of the longer of the two.
  function plate(sys, cx, cy, ry, z, S) {
    var month = sys.label.replace(/\s+\d+$/, "").toUpperCase();
    var year = String(sys.year);
    var top = cy - ry - 30;

    ctx.textAlign = "center";
    ctx.fillStyle = S.label;
    ctx.font = S.labelFont;
    ctx.letterSpacing = S.labelTrack;
    var wide = ctx.measureText(month).width;
    ctx.fillText(month, cx, top);
    ctx.letterSpacing = "0px";

    ctx.fillStyle = alpha(S.sepia, 0.75);
    ctx.font = 'italic 400 11px ' + SERIF;
    ctx.fillText(year, cx, top + 22);

    // The flourish separates the title from the year, so it needs air on both
    // sides — set tight against either it fouls the type.
    var rule = top + 9;
    var half = Math.max(26, wide / 2 + 6);
    ctx.strokeStyle = alpha(S.sepia, 0.45);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - half, rule);
    ctx.lineTo(cx - 5, rule);
    ctx.moveTo(cx + 5, rule);
    ctx.lineTo(cx + half, rule);
    ctx.stroke();
    ctx.fillStyle = alpha(S.sepia, 0.55);
    ctx.save();
    ctx.translate(cx, rule);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-1.7, -1.7, 3.4, 3.4);
    ctx.restore();
  }

  // A sight: a broken circle with cross-hairs at the cardinals. Reads as an
  // instrument trained on the day rather than as a UI selection box.
  function sight(x, y, r, colour, a) {
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * a;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var q = 0; q < 4; q++) {
      var from = q * Math.PI / 2 + 0.28;
      ctx.moveTo(x + Math.cos(from) * r, y + Math.sin(from) * r);
      ctx.arc(x, y, r, from, from + Math.PI / 2 - 0.56);
    }
    ctx.stroke();
    ctx.beginPath();
    for (var c = 0; c < 4; c++) {
      var ca = c * Math.PI / 2;
      ctx.moveTo(x + Math.cos(ca) * (r - 3), y + Math.sin(ca) * (r - 3));
      ctx.lineTo(x + Math.cos(ca) * (r + 4), y + Math.sin(ca) * (r + 4));
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------- the marks -- */

  function sun(x, y, r, S) {
    if (S.bloom) {
      // A star seen through a lens: a tight core, a wide corona that falls off
      // far slower than the core does, and the flare the glass adds.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var halo = ctx.createRadialGradient(x, y, 0, x, y, r * 9);
      halo.addColorStop(0, alpha(S.sun, 0.9));
      halo.addColorStop(0.08, alpha(S.sun, 0.55));
      halo.addColorStop(0.28, alpha(S.sun, 0.16));
      halo.addColorStop(1, alpha(S.sun, 0));
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(x, y, r * 9, 0, TAU); ctx.fill();

      var flare = ctx.createLinearGradient(x - r * 7, 0, x + r * 7, 0);
      flare.addColorStop(0, alpha(S.sun, 0));
      flare.addColorStop(0.5, alpha(S.sun, 0.32));
      flare.addColorStop(1, alpha(S.sun, 0));
      ctx.fillStyle = flare;
      ctx.fillRect(x - r * 7, y - r * 0.16, r * 14, r * 0.32);

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }

    if (S.sunGlow > 0) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      g.addColorStop(0, alpha(S.sun, 0.95 * S.sunGlow + 0.05));
      g.addColorStop(0.3, alpha(S.sun, 0.35 * S.sunGlow));
      g.addColorStop(1, alpha(S.sun, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 5, 0, TAU);
      ctx.fill();
    }

    if (skinKey === "chart") {
      // A sun in splendour, as the plates draw it: a gilt disc inside a ring,
      // with sixteen rays alternating long and short.
      ctx.strokeStyle = alpha(S.gilt, 0.75);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (var i = 0; i < 16; i++) {
        var a = (i / 16) * TAU;
        var len = r * (i % 2 ? 1.55 : 2.25);
        ctx.moveTo(x + Math.cos(a) * r * 1.18, y + Math.sin(a) * r * 1.18);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      }
      ctx.stroke();

      ctx.fillStyle = alpha(S.gilt, 0.22);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = S.sun;
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, TAU); ctx.stroke();
      ctx.fillStyle = alpha(S.gilt, 0.7);
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.9, r * 0.16), 0, TAU); ctx.fill();
      return;
    }

    // dataviz: a marker, not a light source — a dot inside its own ring.
    ctx.fillStyle = S.sun;
    ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, TAU); ctx.fill();
    ctx.strokeStyle = alpha(S.sun, 0.38);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r * 0.95, 0, TAU); ctx.stroke();
  }

  function planet(x, y, r, sl, turn, S) {
    var col = sl.color || "#8fa3c8";

    if (skinKey === "chart") { engrave(x, y, r, sl, turn, col, S); return; }

    if (skinKey === "dataviz") {
      // A flat disc reads its value fastest. The rotation is a light arc riding
      // the rim rather than a spoke through the middle: the day is still visibly
      // alive, and the disc stays a clean readable area.
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      var a = turn * TAU;
      ctx.strokeStyle = shade(col, 0.6);
      ctx.lineWidth = Math.max(1.2, r * 0.2);
      ctx.beginPath();
      ctx.arc(x, y, r - ctx.lineWidth / 2, a, a + 1.15);
      ctx.stroke();
      ctx.strokeStyle = shade(col, -0.5);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, TAU); ctx.stroke();
      return;
    }

    // deep: a lit body inside its own bloom
    var halo = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 3);
    halo.addColorStop(0, alpha(col, 0.42));
    halo.addColorStop(0.4, alpha(col, 0.13));
    halo.addColorStop(1, alpha(col, 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, y, r * 3, 0, TAU); ctx.fill();

    var lx = x - r * (0.34 - turn * 0.12), ly = y - r * 0.36;
    var body = ctx.createRadialGradient(lx, ly, r * 0.06, x, y, r * 1.05);
    body.addColorStop(0, shade(col, 0.62));
    body.addColorStop(0.42, col);
    body.addColorStop(1, shade(col, -0.72));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = alpha(col, 0.5);
    ctx.lineWidth = Math.max(0.6, r * 0.1);
    ctx.beginPath(); ctx.arc(x, y, r - ctx.lineWidth / 2, 0.6, 2.9); ctx.stroke();
  }

  /* An engraved globe.
   *
   * Four passes, in the order a burin would take them: a wash of the day's
   * project colour, the terrain hatching, the shading of the unlit limb, and
   * last the outline — swelled towards the shadow, which is the single detail
   * that makes a drawn circle read as a sphere.
   */
  function engrave(x, y, r, sl, turn, col, S) {
    // Too small to hold detail: a solid dot is the honest mark at this size.
    if (r < 3.2) {
      ctx.fillStyle = alpha(col, 0.75);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = alpha(S.ink, 0.7);
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();

    // The wash: laid on lighter where the light strikes, so the paper still
    // shows through the top-left of every globe.
    var wash = ctx.createRadialGradient(
      x - r * 0.38, y - r * 0.4, r * 0.08, x, y, r * 1.15);
    wash.addColorStop(0, alpha(col, 0.16));
    wash.addColorStop(0.55, alpha(col, 0.36));
    wash.addColorStop(1, alpha(col, 0.5));
    ctx.fillStyle = wash;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    hatch(x, y, r, sl.type, turn, col, S);
    limbShade(x, y, r, S);
    ctx.restore();

    // The outline, twice: a hairline all round, then a heavier arc on the
    // shadow side. Engravers call it the swell, and it costs one extra stroke.
    ctx.strokeStyle = alpha(S.ink, 0.62);
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = alpha(S.ink, 0.85);
    ctx.lineWidth = Math.min(1.9, 0.9 + r * 0.06);
    ctx.beginPath(); ctx.arc(x, y, r, 0.35, 2.5); ctx.stroke();

    // A speck of paper left unengraved where the light hits: the highlight.
    ctx.fillStyle = "rgba(255,250,236,0.5)";
    ctx.beginPath();
    ctx.arc(x - r * 0.36, y - r * 0.38, Math.max(0.7, r * 0.16), 0, TAU);
    ctx.fill();
  }

  // The shaded limb: parallel burin strokes across the lower-right crescent,
  // crowding together towards the edge. Clipped to the globe by the caller.
  function limbShade(x, y, r, S) {
    var dirx = Math.SQRT1_2, diry = Math.SQRT1_2;   // light from the upper left
    var lines = Math.max(4, Math.round(r * 0.85));
    ctx.strokeStyle = alpha(S.ink, 0.5);
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    for (var i = 1; i <= lines; i++) {
      var k = i / lines;                 // 0 at the terminator, 1 at the limb
      var t = (0.05 + Math.pow(k, 1.55) * 1.05) * r;
      var mx = x + dirx * t, my = y + diry * t;
      ctx.moveTo(mx - diry * r, my + dirx * r);
      ctx.lineTo(mx + diry * r, my - dirx * r);
    }
    ctx.stroke();
  }

  // The terrain hint, drawn as engraving rather than as texture. Ink carries the
  // pattern; the colour underneath still says which projects the day was.
  function hatch(x, y, r, type, turn, col, S) {
    var ink = S && S.ink ? S.ink : col;
    ctx.strokeStyle = skinKey === "chart" ? alpha(ink, 0.34) : alpha(col, 0.75);
    ctx.lineWidth = skinKey === "chart" ? 0.6 : 0.7;
    var i, off = (turn * r * 2) % (r / 2.5);
    ctx.beginPath();
    if (type === "gas") {
      // Banding, bowed the way a band lies on a turning sphere.
      for (i = -r; i < r; i += r / 2.8) {
        var yy = y + i + off;
        ctx.moveTo(x - r, yy);
        ctx.quadraticCurveTo(x, yy + (i < 0 ? -1 : 1) * r * 0.1, x + r, yy);
      }
    } else if (type === "ice") {
      for (i = -r * 1.6; i < r * 1.6; i += r / 2.2) {
        ctx.moveTo(x + i, y - r); ctx.lineTo(x + i + r * 0.55, y + r);
      }
    } else if (type === "ocean") {
      for (i = -r; i < r; i += r / 2.4) {
        var wy = y + i + off * 0.4;
        ctx.moveTo(x - r, wy);
        ctx.quadraticCurveTo(x - r * 0.3, wy - r * 0.12, x, wy);
        ctx.quadraticCurveTo(x + r * 0.3, wy + r * 0.12, x + r, wy);
      }
    } else if (type === "forest") {
      // Hachure: the short paired strokes a map uses for wooded ground.
      for (i = -r * 1.4; i < r * 1.4; i += r / 1.8) {
        ctx.moveTo(x + i, y - r); ctx.lineTo(x + i + r, y + r);
        ctx.moveTo(x + i + r, y - r); ctx.lineTo(x + i, y + r);
      }
    } else if (type === "lava") {
      for (i = 0; i < 9; i++) {
        var a = i / 9 * TAU + turn;
        ctx.moveTo(x + Math.cos(a) * r * 0.12, y + Math.sin(a) * r * 0.12);
        ctx.lineTo(x + Math.cos(a + 0.25) * r, y + Math.sin(a + 0.25) * r);
      }
    } else {
      for (i = -r; i < r; i += r / 1.7) {
        ctx.moveTo(x - r, y + i); ctx.lineTo(x + r, y + i);
        ctx.moveTo(x + i, y - r); ctx.lineTo(x + i, y + r);
      }
    }
    ctx.stroke();
  }

  function ring(x, y, r, S) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.32);
    if (skinKey === "chart") {
      // Two gilt rules with the paper left between them, so the ring reads as
      // an annulus seen edge-on rather than as a painted band.
      ctx.strokeStyle = alpha(S.gilt, 0.95);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.9, r * 0.58, 0, 0, TAU); ctx.stroke();
      ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.55, r * 0.46, 0, 0, TAU); ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(246,208,130,0.85)";
      ctx.lineWidth = Math.max(1, r * 0.13);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.55, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function moons(x, y, r, count, seed, time, S) {
    var atlas = skinKey === "chart";
    for (var i = 0; i < count; i++) {
      var a = P.h2(seed, i * 17 + 3, 991) * TAU + time * 0.5 * (1 + i * 0.35);
      var mx = x + Math.cos(a) * r * 2.0;
      var my = y + Math.sin(a) * r * 2.0 * 0.5;
      var mr = Math.max(1.1, r * 0.15);
      if (atlas) {
        // Outlined, not filled: a satellite is a small drawn body on the plate.
        ctx.fillStyle = "rgba(250,243,226,0.85)";
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
        ctx.strokeStyle = alpha(S.ink, 0.7);
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(235,242,255,0.92)";
        ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
      }
    }
  }

  function comet(x, y, z, S) {
    var len = 16 * Math.min(z, 1.5);

    if (skinKey === "dataviz") {
      // A chart does not draw comets, it annotates. A small open diamond is the
      // mark every chart already uses for "there is a note on this point".
      var d = 3.2 * Math.min(z, 1.4);
      ctx.strokeStyle = S.accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y - d); ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d); ctx.lineTo(x - d, y);
      ctx.closePath();
      ctx.stroke();
      return;
    }

    if (skinKey === "chart") {
      // A tail of three tapering burin strokes, splayed the way the plates draw
      // a comet, plus a small nucleus with its own short rays.
      ctx.lineWidth = 0.7;
      for (var i = -1; i <= 1; i++) {
        var spread = i * 0.15;
        var tip = len * (i ? 0.82 : 1.15);
        // The tail fades out rather than stopping, which is the difference
        // between a comet and three lines drawn from a dot.
        var tg = ctx.createLinearGradient(
          x, y,
          x + Math.cos(-0.785 + spread) * tip,
          y + Math.sin(-0.785 + spread) * tip);
        tg.addColorStop(0, alpha(S.sepia, 0.8));
        tg.addColorStop(1, alpha(S.sepia, 0));
        ctx.strokeStyle = tg;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(
          x + Math.cos(-0.785 + spread * 0.4) * tip * 0.55,
          y + Math.sin(-0.785 + spread * 0.4) * tip * 0.55,
          x + Math.cos(-0.785 + spread) * tip,
          y + Math.sin(-0.785 + spread) * tip);
        ctx.stroke();
      }
      ctx.fillStyle = alpha(S.gilt, 0.9);
      ctx.beginPath(); ctx.arc(x, y, 1.9 * Math.min(z, 1.4), 0, TAU); ctx.fill();
      ctx.strokeStyle = alpha(S.ink, 0.55);
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.arc(x, y, 1.9 * Math.min(z, 1.4), 0, TAU); ctx.stroke();
      return;
    }

    var g = ctx.createLinearGradient(x, y, x + len, y - len);
    g.addColorStop(0, "rgba(255,240,200,0.9)");
    g.addColorStop(1, "rgba(255,240,200,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + len, y - len);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,248,222,0.95)";
    ctx.beginPath();
    ctx.arc(x, y, 2.2 * Math.min(z, 1.4), 0, TAU);
    ctx.fill();
  }

  /* --------------------------------------------------------- one day alone -- */

  // The planet at the top of an entry, in whichever language the site is
  // currently speaking. Same marks the map uses, so the day you clicked is
  // recognisably the same world when you arrive at it — an engraved globe on
  // the plate, a glowing body in deep space, a flat disc in the chart.
  //
  // Deliberately still: the entry is the reading register, and nothing on it
  // should move while you are reading.
  function sprite(canvas, day) {
    var S = SKINS[skinKey];
    var size = day.size || 150;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    var c = size / 2;
    // Small enough that the milestone ring and the deep style's halo still have
    // room inside the box rather than being cut off by it.
    var r = size * 0.175;
    var sl = { color: day.color, type: day.type, seed: day.seed, r: r };

    planet(c, c, r, sl, 0.18, S);
    if (day.milestone) ring(c, c, r, S);
    if (day.moons > 0) moons(c, c, r, day.moons, day.seed, 0.7, S);
    if (day.idea) comet(c + r * 1.9, c - r * 1.9, 1, S);
  }

  global.ODailyVector = {
    init: init, resize: resize, draw: draw,
    toLogical: toLogical, pixelsPerCss: pixelsPerCss,
    setSkin: setSkin, sprite: sprite
  };
})(window);
