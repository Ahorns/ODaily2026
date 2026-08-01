/* The universe view.
 *
 * Every month is a stellar system; the systems are laid out across one
 * continuous galaxy. Today's planet sits at the exact centre of the screen when
 * you arrive.
 *
 * While the universe is open it owns the scroll wheel: scrolling travels through
 * the field, past nebulae, rather than scrolling the page. The page only gives
 * the scroll back when you deliberately leave orbit.
 *
 * Clicking a planet shows what that day was. Double-clicking takes you down to
 * read it. Nothing here ever navigates away.
 */
(function () {
  "use strict";

  var root = document.getElementById("galaxy-root");
  if (!root) return;

  var canvas = document.getElementById("galaxy");
  var stage = root.querySelector(".galaxy-stage");
  var overlay = document.getElementById("galaxy-readout");
  var panel = document.getElementById("journal-panel");

  // --- world geometry -------------------------------------------------------
  // Systems are placed by golden-angle phyllotaxis: it spaces them evenly
  // without ever lining them up on a grid, which is what makes the field read
  // as a galaxy rather than a calendar.
  var GOLDEN = 2.3999632297286533;
  var SPREAD = 390;
  var INNER = 42, OUTER = 148, RYF = 0.70;

  // How far past the outermost system you may drift before the galaxy stops
  // you. Without this the field is unbounded and it is very easy to scroll off
  // into blank space with nothing to steer back by.
  var SLACK = 300;

  // Zoom moves along a ladder, not continuously: the sprites are cached per
  // radius, and a smoothly varying radius would rebuild every one of them on
  // every wheel notch.
  var ZOOMS = [0.35, 0.5, 0.7, 1, 1.4, 1.9, 2.5];
  var HOME_ZOOM = 3;
  var zoomIndex = HOME_ZOOM;

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  var scene = {
    systems: [],
    stars: [],
    camera: { x: 0, y: 0, zoom: ZOOMS[zoomIndex] },
    view: { w: 0, h: 0 },
    selected: null,
    hover: null,
    time: 0,
    filter: "",
    today: null,
    projects: {}
  };

  var DATA = null;
  var renderer = null;
  var bounds = null;
  var entryCache = {};
  var inGalaxy = true;

  function motionOK() {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function hash(i, k) {
    var n = Math.imul(i | 0, 374761393) ^ Math.imul(k | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  /* ---------------------------------------------------------------- build -- */

  function orbitsFor(weekRows) {
    var rings = [];
    var gap = weekRows > 1 ? (OUTER - INNER) / (weekRows - 1) : 0;
    for (var i = 0; i < weekRows; i++) rings.push(INNER + gap * i);
    return { rings: rings, maxR: Math.max(5, Math.min(11, Math.floor((gap || OUTER) * RYF / 2))) };
  }

  function radiusFor(hours, maxR) {
    var band = hours < 1 ? 0.36 : hours < 2 ? 0.46 : hours < 3.5 ? 0.62
      : hours < 5 ? 0.76 : hours < 7 ? 0.9 : 1.0;
    // A day with an entry but no hours logged is still a day: it must not shrink
    // to the size of an empty slot.
    return Math.max(4, Math.round(band * maxR));
  }

  function buildGalaxy() {
    // Oldest system at the centre of the spiral, so the galaxy grows outward as
    // the year does and old months never move once placed.
    var ordered = DATA.systems.slice().reverse();

    scene.systems = ordered.map(function (sys, i) {
      var angle = i * GOLDEN;
      var dist = SPREAD * Math.sqrt(i);
      var cx = Math.cos(angle) * dist;
      var cy = Math.sin(angle) * dist * 0.82;   // slight flattening: a disc, not a ball

      var month = sys.month - 1;
      var daysInMonth = new Date(sys.year, month + 1, 0).getDate();
      var firstDow = new Date(sys.year, month, 1).getDay();
      var plan = orbitsFor(Math.ceil((daysInMonth + firstDow) / 7));

      var slots = [];
      for (var d = 1; d <= daysInMonth; d++) {
        var dow = new Date(sys.year, month, d).getDay();
        var week = Math.floor((d + firstDow - 1) / 7);
        var rx = plan.rings[Math.min(week, plan.rings.length - 1)];
        var a = -Math.PI / 2 + (dow / 7) * Math.PI * 2;
        var e = sys.days[String(d)] || null;
        var seed = (sys.year * 10000 + sys.month * 100 + d) | 0;
        slots.push({
          d: d, dow: dow, entry: e,
          hours: e ? e.hours : 0,
          type: e ? e.type : "rock",
          color: e ? e.color : null,
          name: e ? e.name : "",
          r: e ? radiusFor(e.hours, plan.maxR) : 0,
          x: cx + rx * Math.cos(a),
          y: cy + rx * RYF * Math.sin(a),
          seed: seed,
          // Each world turns at its own rate, from its own starting angle, so the
          // field never looks like one object spinning in lockstep.
          phase: hash(seed, 21),
          spinRate: 0.055 + hash(seed, 22) * 0.075,
          projects: e ? e.projects : [],
          sys: i
        });
      }

      return {
        key: sys.key, year: sys.year, month: sys.month,
        label: MONTH_NAMES[month] + " " + sys.year,
        cx: cx, cy: cy, rings: plan.rings, slots: slots
      };
    });

    computeBounds();
    buildStars();
    aimAtToday();
    buildFilters();
  }

  // The camera may drift this far past the outermost system and no further.
  function computeBounds() {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    scene.systems.forEach(function (s) {
      if (s.cx < minX) minX = s.cx;
      if (s.cx > maxX) maxX = s.cx;
      if (s.cy < minY) minY = s.cy;
      if (s.cy > maxY) maxY = s.cy;
    });
    var pad = OUTER + SLACK;
    bounds = { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
  }

  // Deliberately clamps the camera itself rather than the visible rectangle: if
  // it clamped the rectangle, a small galaxy in a large window could never put
  // today's planet at the centre, which is the one thing the view promises.
  function clampCamera() {
    if (!bounds) return;
    scene.camera.x = Math.min(bounds.maxX, Math.max(bounds.minX, scene.camera.x));
    scene.camera.y = Math.min(bounds.maxY, Math.max(bounds.minY, scene.camera.y));
    var atEdge =
      scene.camera.x <= bounds.minX + 0.5 || scene.camera.x >= bounds.maxX - 0.5 ||
      scene.camera.y <= bounds.minY + 0.5 || scene.camera.y >= bounds.maxY - 0.5;
    stage.classList.toggle("at-edge", atEdge);
  }

  function buildStars() {
    // A field that covers the whole reachable area, so travelling to the very
    // edge never shows empty black.
    var reach = SPREAD * Math.sqrt(Math.max(1, scene.systems.length)) + SLACK + OUTER + 900;
    scene.stars = [];
    for (var i = 0; i < 1500; i++) {
      var a = hash(i, 1) * Math.PI * 2;
      var d = Math.sqrt(hash(i, 2)) * reach;
      scene.stars.push({
        x: Math.cos(a) * d,
        y: Math.sin(a) * d * 0.85,
        b: hash(i, 3),
        depth: 0.45 + hash(i, 4) * 0.55   // parallax: far stars drift slower
      });
    }
  }

  // "On first entry, the planet representing the current day should be at the
  // exact centre of the screen." If today has no entry yet, its empty slot is
  // still the right place to be standing.
  function aimAtToday() {
    var now = new Date();
    var key = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    var target = null;

    for (var i = 0; i < scene.systems.length; i++) {
      if (scene.systems[i].key !== key) continue;
      var slot = scene.systems[i].slots[now.getDate() - 1];
      if (slot) { target = slot; scene.today = slot; }
    }
    if (!target) {
      var newest = scene.systems[scene.systems.length - 1];
      var logged = newest ? newest.slots.filter(function (s) { return s.entry; }) : [];
      target = logged.length ? logged[logged.length - 1] : null;
    }
    if (target) {
      scene.camera.x = target.x;
      scene.camera.y = target.y;
      clampCamera();
      // Arriving with today already loaded below means the journal is never an
      // empty box on first visit.
      if (target.entry) { showInfo(target); loadInto(target.entry.url, target.entry.title); }
    }
  }

  /* --------------------------------------------------------------- camera -- */

  function setZoom(index, anchorX, anchorY) {
    index = Math.max(0, Math.min(ZOOMS.length - 1, index));
    if (index === zoomIndex) return;

    var before = anchorX !== undefined ? clientToWorld(anchorX, anchorY) : null;
    zoomIndex = index;
    scene.camera.zoom = ZOOMS[zoomIndex];

    // Keep whatever was under the cursor under the cursor.
    if (before) {
      var after = clientToWorld(anchorX, anchorY);
      scene.camera.x += before.x - after.x;
      scene.camera.y += before.y - after.y;
    }
    clampCamera();
    syncZoomChrome();
    draw();
  }

  function syncZoomChrome() {
    var out = document.getElementById("galaxy-zoom-out");
    var inn = document.getElementById("galaxy-zoom-in");
    if (out) out.disabled = zoomIndex === 0;
    if (inn) inn.disabled = zoomIndex === ZOOMS.length - 1;
    var label = document.getElementById("galaxy-zoom-label");
    if (label) label.textContent = Math.round(ZOOMS[zoomIndex] * 100) + "%";
  }

  function clientToWorld(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var p = renderer.toLogical(clientX - rect.left, clientY - rect.top);
    var z = scene.camera.zoom;
    return {
      x: scene.camera.x + (p.x - scene.view.w / 2) / z,
      y: scene.camera.y + (p.y - scene.view.h / 2) / z
    };
  }

  /* ------------------------------------------------------------- picking -- */

  function slotAt(wx, wy) {
    var hit = null, best = Infinity;
    // Below a certain zoom the planets are smaller than a comfortable target, so
    // the hit radius stops shrinking with them.
    var pad = 4 / scene.camera.zoom;
    for (var i = 0; i < scene.systems.length; i++) {
      var sys = scene.systems[i];
      if (Math.abs(wx - sys.cx) > OUTER + 40 || Math.abs(wy - sys.cy) > OUTER + 40) continue;
      for (var j = 0; j < sys.slots.length; j++) {
        var s = sys.slots[j];
        if (!s.entry) continue;
        var d = Math.hypot(wx - s.x, wy - s.y);
        if (d <= s.r + pad && d < best) { best = d; hit = s; }
      }
    }
    return hit;
  }

  /* ------------------------------------------------------------ the read -- */

  // One click: what this day was, without moving you anywhere.
  function showInfo(slot) {
    scene.selected = slot;
    var e = slot.entry;
    if (!e) return;

    var stamp = DAY_NAMES[slot.dow] + " " + slot.d + " " +
      MONTH_NAMES[scene.systems[slot.sys].month - 1] + " " + scene.systems[slot.sys].year;
    var names = e.projects.map(function (p) { return esc(scene.projects[p].name); }).join(", ");

    overlay.innerHTML =
      '<p class="stamp"><span>' + stamp + "</span>" +
      (e.milestone ? '<span class="milestone">✦ Milestone</span>' : "") +
      (e.idea ? '<span class="idea">☄ Idea</span>' : "") + "</p>" +
      '<p class="readout-name">' + esc(e.name) + "</p>" +
      "<h2>" + esc(e.title) + "</h2>" +
      '<p class="readout-foot">' + e.hours.toFixed(1) + " hours · " + names + "</p>" +
      '<button type="button" class="readout-go">Read it below ↓</button>' +
      '<p class="readout-tip">Double-click a planet to jump straight down</p>';

    overlay.querySelector(".readout-go").addEventListener("click", function () {
      openBelow(scene.selected);
    });
    draw();
  }

  // Double click: same day, but take me down to it.
  function openBelow(slot) {
    if (!slot || !slot.entry) return;
    showInfo(slot);
    loadInto(slot.entry.url, slot.entry.title);
    leaveOrbit();
  }

  // The entry is fetched from its own already-rendered page, so the journal
  // below is never a second copy of the writing that could drift out of step.
  function loadInto(url, title) {
    if (entryCache[url]) { panel.innerHTML = entryCache[url]; return; }
    panel.setAttribute("aria-busy", "true");
    panel.innerHTML = '<p class="readout-empty">Loading ' + esc(title) + "…</p>";

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var content = doc.querySelector("#quarto-document-content") || doc.querySelector("main");
        if (!content) throw new Error("no content");
        // The universe already shows this day's planet; a second copy directly
        // underneath it just reads as a duplicate.
        var hero = content.querySelector(".day-hero");
        if (hero) hero.remove();
        var built =
          '<p class="panel-eyebrow">Journal · <a href="' + url + '">open as its own page ↗</a></p>' +
          '<h2 class="panel-title">' + esc(title) + "</h2>" + content.innerHTML;
        entryCache[url] = built;
        panel.innerHTML = built;
      })
      .catch(function (err) {
        panel.innerHTML = '<p class="readout-empty">Could not load that entry (' +
          esc(err.message) + '). <a href="' + url + '">Open it directly ↗</a></p>';
      })
      .finally(function () { panel.removeAttribute("aria-busy"); });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* -------------------------------------------------------------- filter -- */

  function buildFilters() {
    var bar = document.getElementById("galaxy-filters");
    var present = {};
    scene.systems.forEach(function (sys) {
      sys.slots.forEach(function (s) { s.projects.forEach(function (p) { present[p] = true; }); });
    });

    bar.innerHTML = "";
    [""].concat(Object.keys(present)).forEach(function (slug) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = slug ? scene.projects[slug].name : "All";
      b.setAttribute("aria-pressed", String(slug === scene.filter));
      b.addEventListener("click", function () {
        scene.filter = slug;
        buildFilters();
        draw();
      });
      bar.appendChild(b);
    });
  }

  /* ------------------------------------------------- entering and leaving -- */

  // Rolled by hand rather than with scroll-behavior: smooth, which is silently
  // ignored in some browsers and leaves you stranded with nothing having moved.
  var scrolling = null;

  function scrollToY(target, done) {
    if (scrolling) cancelAnimationFrame(scrolling);
    if (!motionOK()) {
      window.scrollTo(0, target);
      if (done) done();
      return;
    }
    var start = window.scrollY, dist = target - start, began = null, dur = 520;
    var frame = function (ts) {
      if (began === null) began = ts;
      var k = Math.min(1, (ts - began) / dur);
      var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      window.scrollTo(0, start + dist * e);
      if (k < 1) { scrolling = requestAnimationFrame(frame); }
      else { scrolling = null; if (done) done(); }
    };
    scrolling = requestAnimationFrame(frame);

    // A browser that has suspended animation frames (an occluded or background
    // tab) would otherwise never move at all, and enterOrbit would never get to
    // re-lock the page. Jump straight there instead of hanging.
    setTimeout(function () {
      if (began !== null) return;
      if (scrolling) cancelAnimationFrame(scrolling);
      scrolling = null;
      window.scrollTo(0, target);
      if (done) done();
    }, 120);
  }

  function journalTop() {
    var j = document.getElementById("journal");
    return j.getBoundingClientRect().top + window.scrollY;
  }

  // Scrolling never leaves the universe. Only this does.
  function leaveOrbit() {
    if (!inGalaxy) { scrollToY(journalTop()); return; }
    inGalaxy = false;
    document.documentElement.classList.remove("galaxy-locked");
    root.classList.add("is-left");
    document.body.classList.add("out-of-orbit");
    stopLoop();
    // The page is not scrollable until the unlock has actually been applied.
    // Reading a layout property forces that synchronously — waiting for an
    // animation frame would not, since a background tab may not get one.
    void document.documentElement.offsetHeight;
    scrollToY(journalTop());
  }

  function enterOrbit() {
    if (inGalaxy) return;
    inGalaxy = true;
    root.classList.remove("is-left");
    document.body.classList.remove("out-of-orbit");
    // Only take the scrollbar away once we are actually back at the top, or the
    // page is left stranded halfway down with no way to move.
    scrollToY(0, function () {
      document.documentElement.classList.add("galaxy-locked");
    });
    startLoop();
  }

  /* --------------------------------------------------------- interaction -- */

  var dragging = false, moved = 0, lastX = 0, lastY = 0, pointerId = null;
  var pointers = new Map();
  var pinchFrom = 0;

  canvas.addEventListener("pointerdown", function (ev) {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      dragging = false;
      var p = [].concat(Array.from(pointers.values()));
      pinchFrom = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      return;
    }
    if (ev.button !== 0) return;
    dragging = true; moved = 0; pointerId = ev.pointerId;
    lastX = ev.clientX; lastY = ev.clientY;
    canvas.setPointerCapture(ev.pointerId);
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size === 2) {
      var p = [].concat(Array.from(pointers.values()));
      var now = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinchFrom > 0 && Math.abs(now - pinchFrom) > 40) {
        setZoom(zoomIndex + (now > pinchFrom ? 1 : -1),
          (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
        pinchFrom = now;
      }
      return;
    }

    if (dragging) {
      var dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = ev.clientX; lastY = ev.clientY;
      var k = renderer.pixelsPerCss() / scene.camera.zoom;
      scene.camera.x -= dx * k;
      scene.camera.y -= dy * k;
      clampCamera();
      draw();
      return;
    }

    var w = clientToWorld(ev.clientX, ev.clientY);
    var hit = slotAt(w.x, w.y);
    var was = scene.hover;
    scene.hover = hit;
    canvas.classList.toggle("is-over-planet", !!hit);
    if (hit !== was) draw();
  });

  // One click shows the day; two clicks on the same planet go down to read it.
  // The single-click action waits out the double-click window so a double never
  // fires both.
  var tapTimer = null, tapSlot = null;

  function onTap(hit) {
    if (tapTimer && tapSlot === hit) {
      clearTimeout(tapTimer);
      tapTimer = null; tapSlot = null;
      openBelow(hit);
      return;
    }
    if (tapTimer) { clearTimeout(tapTimer); }
    tapSlot = hit;
    tapTimer = setTimeout(function () {
      tapTimer = null; tapSlot = null;
      showInfo(hit);
      // Loaded quietly so "Read it below" and a later double-click are instant.
      loadInto(hit.entry.url, hit.entry.title);
    }, 260);
  }

  function endDrag(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchFrom = 0;
    if (!dragging) return;
    dragging = false;
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
    // A drag is not a click. A few pixels of slop keeps a shaky hand from panning
    // the sky when it meant to open a day.
    if (moved < 5 && ev) {
      var w = clientToWorld(ev.clientX, ev.clientY);
      var hit = slotAt(w.x, w.y);
      if (hit) onTap(hit);
    }
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("mouseleave", function () {
    if (scene.hover) { scene.hover = null; canvas.classList.remove("is-over-planet"); draw(); }
  });
  // The browser's own dblclick would otherwise select text under the canvas.
  canvas.addEventListener("dblclick", function (ev) { ev.preventDefault(); });

  // The wheel travels through the universe instead of scrolling the page. Held
  // with ctrl (or pinched on a trackpad) it zooms, which is what browsers have
  // trained everyone to expect.
  stage.addEventListener("wheel", function (ev) {
    if (!inGalaxy) return;
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      setZoom(zoomIndex + (ev.deltaY < 0 ? 1 : -1), ev.clientX, ev.clientY);
      return;
    }
    var k = 1 / scene.camera.zoom;
    var unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? scene.view.h : 1;
    scene.camera.x += ev.deltaX * unit * 0.85 * k;
    scene.camera.y += ev.deltaY * unit * 0.85 * k;
    clampCamera();
    draw();
  }, { passive: false });

  function allLogged() {
    var out = [];
    scene.systems.forEach(function (sys) {
      sys.slots.forEach(function (s) { if (s.entry) out.push(s); });
    });
    return out;
  }

  function step(dir) {
    var list = allLogged();
    if (!list.length) return;
    var i = scene.selected ? list.indexOf(scene.selected) : -1;
    i = (i + dir + list.length) % list.length;
    var target = list[i];
    scene.camera.x = target.x;
    scene.camera.y = target.y;
    clampCamera();
    showInfo(target);
    loadInto(target.entry.url, target.entry.title);
  }

  canvas.addEventListener("keydown", function (ev) {
    var pan = (ev.shiftKey ? 140 : 45) / scene.camera.zoom;
    if (ev.key === "ArrowRight") { ev.preventDefault(); ev.altKey ? (scene.camera.x += pan) : step(1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); ev.altKey ? (scene.camera.x -= pan) : step(-1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); scene.camera.y -= pan; }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); scene.camera.y += pan; }
    else if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); setZoom(zoomIndex + 1); return; }
    else if (ev.key === "-" || ev.key === "_") { ev.preventDefault(); setZoom(zoomIndex - 1); return; }
    else if (ev.key === "Enter") { ev.preventDefault(); openBelow(scene.selected); return; }
    else return;
    clampCamera();
    draw();
  });

  /* ---------------------------------------------------------------- loop -- */

  var raf = null, t0 = 0, lastDraw = 0;
  var FRAME_MS = 1000 / 24;

  function tick(ts) {
    if (!t0) t0 = ts;
    if (ts - lastDraw >= FRAME_MS) {
      scene.time = (ts - t0) / 1000;
      lastDraw = ts;
      if (renderer && DATA) renderer.draw(canvas, scene);
    }
    raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (raf !== null || !motionOK()) return;
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (raf === null) return;
    cancelAnimationFrame(raf);
    raf = null;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopLoop();
    else if (inGalaxy) startLoop();
  });

  /* ------------------------------------------------------------- drawing -- */

  function draw() {
    if (renderer && DATA) renderer.draw(canvas, scene);
  }

  function resize() {
    if (!renderer) return;
    var box = stage.getBoundingClientRect();
    var v = renderer.resize(canvas, box.width, box.height);
    scene.view.w = v.w;
    scene.view.h = v.h;
    clampCamera();
    draw();
  }

  window.addEventListener("resize", resize);

  /* -------------------------------------------------------------- chrome -- */

  document.getElementById("galaxy-home").addEventListener("click", function () {
    zoomIndex = HOME_ZOOM;
    scene.camera.zoom = ZOOMS[zoomIndex];
    syncZoomChrome();
    aimAtToday();
    draw();
  });
  document.getElementById("galaxy-exit").addEventListener("click", leaveOrbit);
  document.getElementById("galaxy-zoom-in").addEventListener("click", function () { setZoom(zoomIndex + 1); });
  document.getElementById("galaxy-zoom-out").addEventListener("click", function () { setZoom(zoomIndex - 1); });

  // Three ways back into the universe, because being stuck below with no way up
  // is the obvious failure of a view you can leave.
  ["journal-return", "orbit-return"].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.addEventListener("click", enterOrbit);
  });

  // On this page the navbar's own "Galaxy" link should fly you back rather than
  // reload the whole document. "/" and "/index.html" are the same page, so the
  // comparison has to normalise before it can match.
  function samePage(path) {
    return path.replace(/index\.html$/, "") === window.location.pathname.replace(/index\.html$/, "");
  }
  Array.prototype.forEach.call(document.querySelectorAll(".navbar a"), function (a) {
    if (a.getAttribute("href") && samePage(a.pathname)) {
      a.addEventListener("click", function (ev) { ev.preventDefault(); enterOrbit(); });
    }
  });

  function useRenderer() {
    var style = document.documentElement.dataset.style || "pixel";
    var next = style === "pixel" ? window.ODailyPixel : window.ODailyVector;
    if (!next) return;
    if (next.setSkin) next.setSkin(style);
    if (next !== renderer) { renderer = next; renderer.init(canvas); }
    resize();
  }

  window.addEventListener("odaily:style", function () { useRenderer(); });

  // The universe costs nothing while the list is showing.
  window.addEventListener("odaily:view", function (ev) {
    if (ev.detail === "list") { stopLoop(); }
    else { resize(); if (inGalaxy) { document.documentElement.classList.add("galaxy-locked"); startLoop(); } }
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (inGalaxy) leaveOrbit();
    else enterOrbit();
  });

  /* ------------------------------------------------------------------ go -- */

  fetch(root.dataset.src)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      DATA = data;
      scene.projects = data.projects;
      if (!data.systems.length) {
        stage.innerHTML =
          '<p class="readout-empty">No days logged yet. Run <code>python scripts/new_day.py</code>.</p>';
        document.documentElement.classList.remove("galaxy-locked");
        return;
      }
      useRenderer();
      buildGalaxy();
      resize();
      syncZoomChrome();
      document.documentElement.classList.add("galaxy-locked");
      startLoop();
      if (!motionOK()) draw();
    })
    .catch(function (err) {
      stage.innerHTML = '<p class="readout-empty">Could not load the sky (' + esc(err.message) + ").</p>";
      document.documentElement.classList.remove("galaxy-locked");
    });
})();
