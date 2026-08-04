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
  var RYF = 0.70;

  // --- a system ---------------------------------------------------------------
  // A day's place is its date: the ring it sits on is the week of the month, and
  // its angle is the weekday, Sunday at the top and going clockwise. Days in the
  // same weekday column line up on one of seven spokes, which is what makes the
  // month readable as a month.
  var INNER = 42, OUTER = 148;

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
    // A body must not outgrow the space between two rings, or the weeks collide.
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

      // A system's own span of dates, not necessarily a whole month: the ring
      // a day sits on is the week since the Sunday on or before the system's
      // first day, so weeks still line up as real weeks even when a system
      // starts mid-month.
      var start = dateFromISO(sys.start);
      var end = dateFromISO(sys.end);
      var startDow = start.getDay();
      var totalDays = Math.round((end - start) / 86400000) + 1;
      var plan = orbitsFor(Math.ceil((totalDays + startDow) / 7));

      var slots = [];
      for (var offset = 0; offset < totalDays; offset++) {
        var dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
        var dow = dt.getDay();
        var week = Math.floor((offset + startDow) / 7);
        var e = sys.days[isoFromDate(dt)] || null;
        // A day with a real `orbit` sits at its own distance from the sun —
        // Mercury near it, Eris at the outer edge — regardless of which
        // calendar week it falls in. Angle stays weekday-only either way, so
        // every Monday still lines up on one spoke, just at each planet's
        // own distance along it. Without an `orbit`, the old week-ring
        // position is the fallback, unchanged.
        var rx = (e && e.orbit != null)
          ? INNER + e.orbit * (OUTER - INNER)
          : plan.rings[Math.min(week, plan.rings.length - 1)];
        var a = -Math.PI / 2 + (dow / 7) * Math.PI * 2;
        var seed = (dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate()) | 0;
        slots.push({
          d: dt.getDate(), yr: dt.getFullYear(), m: dt.getMonth() + 1, dow: dow, entry: e,
          hours: e ? e.hours : 0,
          type: e ? e.type : "rock",
          color: e ? e.color : null,
          name: e ? e.name : "",
          r: e ? radiusFor(e.hours, plan.maxR) : 0,
          // The ring and the angle are the date, not coordinates. x and y are
          // derived from them every frame so the system can turn — see advance().
          // ca/sa are taken once so that turn costs four multiplies, not two trig
          // calls, per planet per frame.
          rx: rx, baseA: a, ca: Math.cos(a), sa: Math.sin(a),
          x: cx + rx * Math.cos(a),
          y: cy + rx * RYF * Math.sin(a),
          seed: seed,
          // Each world turns at its own rate, from its own starting angle, so the
          // field never looks like one object spinning in lockstep.
          //
          // Slow on purpose. A sprite has only thirty-two rotation frames, and
          // its surface is quantised to five colours, so a small turn tips a lot
          // of pixels across a palette boundary at once. Spun fast the frame
          // changes two or three times a second and the planet reads as shaking
          // rather than turning. At roughly a minute a revolution the same
          // machinery reads as a slow roll.
          phase: hash(seed, 21),
          spinRate: 0.012 + hash(seed, 22) * 0.020,
          projects: e ? e.projects : [],
          sys: i
        });
      }

      // The short header drawn above the rings: the system's own name if it
      // has one, else the month it spans (the old behaviour, for a plain
      // calendar-month system that was never given a name).
      var label = sys.name || (MONTH_NAMES[start.getMonth()] + " " + start.getFullYear());

      return {
        key: sys.key, name: sys.name || "", label: label, range: rangeLabel(start, end),
        start: start, end: end,
        cx: cx, cy: cy, rings: plan.rings, slots: slots,
        outer: plan.rings[plan.rings.length - 1],
        // Each month turns at its own rate, so the field is never in lockstep —
        // and slowly, about six to nine minutes a revolution. The map is
        // something you sit and read, not something that performs at you: fast
        // enough that it is clearly alive when you look twice, slow enough that
        // it never pulls your eye off the entry you are reading.
        spin: 0.012 + hash(i, 31) * 0.008,
        rot: 0
      };
    });

    computeBounds();
    buildStars();
    advance(0);          // before aiming: the camera needs real positions
    aimAtToday();
    buildFilters();
  }

  /* Revolution.
   *
   * A day's place on the map is its date: the ring is the week of the month and
   * the angle is the weekday. So the planets cannot orbit at their own speeds —
   * a Tuesday would drift into where Friday was and the map would stop being a
   * calendar.
   *
   * Each system therefore turns as a rigid body, graticule included. Every planet
   * keeps its position relative to its own weekday spoke, so the reading survives
   * exactly while the system visibly revolves around its star.
   *
   * Positions are recomputed here rather than in the renderer so that picking,
   * the camera and the constellation lines all agree with what is drawn.
   */
  function advance(t) {
    for (var i = 0; i < scene.systems.length; i++) {
      var sys = scene.systems[i];
      var rot = sys.spin * t;
      sys.rot = rot;
      // Two trig calls per system rather than two per planet.
      var cr = Math.cos(rot), sr = Math.sin(rot);
      var slots = sys.slots;
      for (var j = 0; j < slots.length; j++) {
        var sl = slots[j];
        var c = sl.ca * cr - sl.sa * sr;    // cos(baseA + rot)
        var sn = sl.sa * cr + sl.ca * sr;   // sin(baseA + rot)
        sl.x = sys.cx + sl.rx * c;
        sl.y = sys.cy + sl.rx * RYF * sn;
      }
    }
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
    var y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    var target = null;

    // A system's key is no longer always "YYYY-MM" — a custom range has its
    // own name-derived key — so today's slot is found by its actual date,
    // not by matching the system it happens to belong to.
    for (var i = 0; i < scene.systems.length && !target; i++) {
      var slots = scene.systems[i].slots;
      for (var j = 0; j < slots.length; j++) {
        if (slots[j].yr === y && slots[j].m === m && slots[j].d === d) {
          target = slots[j]; scene.today = slots[j]; break;
        }
      }
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
      if (target.entry) { showInfo(target); loadInto(target.entry.url, target.entry.title, target.entry); }
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

  // The sun at a system's centre is a small, fixed-size target — it does not
  // shrink with the planets, so it stays clickable even zoomed far out.
  function systemAt(wx, wy) {
    var pad = 10 / scene.camera.zoom;
    // The sun's own sprite is tiny, but the space between it and the first
    // ring (INNER = 42) is otherwise dead — so the target can be generous
    // without ever overlapping a planet's own hit area.
    var r = 34 + pad;
    var hit = null, best = Infinity;
    for (var i = 0; i < scene.systems.length; i++) {
      var sys = scene.systems[i];
      var d = Math.hypot(wx - sys.cx, wy - sys.cy);
      if (d <= r && d < best) { best = d; hit = sys; }
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
      MONTH_NAMES[slot.m - 1] + " " + slot.yr;
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

    overlay.classList.add("is-on");
    overlay.querySelector(".readout-go").addEventListener("click", function () {
      openBelow(scene.selected);
    });
    draw();
  }

  // Clicking the sun tells you what the system itself is — its own name if it
  // has been given one, and always the month it represents.
  function showSystemInfo(sys) {
    scene.selected = null;
    var logged = sys.slots.filter(function (s) { return s.entry; }).length;
    overlay.innerHTML =
      '<p class="stamp"><span>Stellar system</span></p>' +
      '<p class="readout-name">' + esc(sys.name || sys.range) + "</p>" +
      "<h2>" + esc(sys.range) + "</h2>" +
      '<p class="readout-foot">' + logged + (logged === 1 ? " day logged" : " days logged") + "</p>";
    overlay.classList.add("is-on");
    draw();
  }

  // Double click: same day, but take me down to it.
  function openBelow(slot) {
    if (!slot || !slot.entry) return;
    showInfo(slot);
    loadInto(slot.entry.url, slot.entry.title, slot.entry);
    leaveOrbit();
  }

  // The entry is fetched from its own already-rendered page, so the journal
  // below is never a second copy of the writing that could drift out of step.
  function loadInto(url, title, entry) {
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
        // The table is drawn by day.js on the entry's own page, so the
        // fetched HTML has none — build the same one from the data we hold,
        // and put it where the entry's own page puts it.
        if (entry && window.ODailyDay) {
          window.ODailyDay.placeTable(content, window.ODailyDay.timeTable(DATA, entry));
        }
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

  /* What a constellation actually is.
   *
   * Selecting one used to light up the map and say nothing about the thing it
   * had lit up. This introduces it: what it is for, how much of the year it has
   * taken, and when it started — so the filter answers a question rather than
   * only asking one.
   */
  function showConstellation(slug) {
    var card = document.getElementById("galaxy-constellation");
    if (!card) return;
    var p = slug && scene.projects[slug];
    if (!p) { card.innerHTML = ""; card.classList.remove("is-on"); return; }

    var span = p.first
      ? monthYear(p.first) + (monthYear(p.last) !== monthYear(p.first) ? " – " + monthYear(p.last) : "")
      : "not yet logged";

    card.innerHTML =
      '<p class="cc-eyebrow"><i class="cc-dot" style="background:' + esc(p.color) + '"></i>' +
      "Constellation" + (p.group ? " · " + esc(p.group) : "") + "</p>" +
      "<h2>" + esc(p.name) + "</h2>" +
      (p.blurb ? '<p class="cc-blurb">' + esc(p.blurb) + "</p>" : "") +
      '<dl class="cc-stats">' +
      "<div><dt>Days</dt><dd>" + p.days + "</dd></div>" +
      "<div><dt>Hours</dt><dd>" + Math.round(p.hours) + "</dd></div>" +
      "<div><dt>Since</dt><dd>" + esc(span) + "</dd></div>" +
      "</dl>" +
      '<p class="cc-foot"><a href="' + esc(p.url) + '">The whole constellation ↗</a></p>';
    card.classList.add("is-on");
  }

  function monthYear(iso) {
    var parts = String(iso).split("-");
    return MONTH_NAMES[(parseInt(parts[1], 10) || 1) - 1].slice(0, 3) + " " + parts[0];
  }

  // Parsed by hand rather than `new Date(iso)`: the built-in ISO parser reads
  // a bare date as UTC midnight, which lands on the wrong day in any
  // negative-UTC-offset timezone.
  function dateFromISO(iso) {
    var p = String(iso).split("-");
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function isoFromDate(dt) {
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }

  // A human span for a system's own dates: "August 2026" when it is a whole
  // calendar month, otherwise the day range it actually covers.
  function rangeLabel(start, end) {
    var sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    var wholeMonth = start.getDate() === 1 &&
      end.getDate() === new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
    if (sameMonth && wholeMonth) return MONTH_NAMES[start.getMonth()] + " " + start.getFullYear();
    if (sameMonth) {
      return start.getDate() + "–" + end.getDate() + " " + MONTH_NAMES[start.getMonth()] + " " + start.getFullYear();
    }
    return start.getDate() + " " + MONTH_NAMES[start.getMonth()] + " " + start.getFullYear() +
      " – " + end.getDate() + " " + MONTH_NAMES[end.getMonth()] + " " + end.getFullYear();
  }

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
        showConstellation(slug);
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
  // The one button that changes what it says. Left as a fixed "Leave orbit ↓" it
  // lied twice over once you had already left: it pointed down when the only way
  // left to go was up, and clicking it scrolled you back to the journal you were
  // already reading instead of flying you home.
  var exitBtn = document.getElementById("galaxy-exit");

  function syncExit() {
    if (!exitBtn) return;
    exitBtn.textContent = inGalaxy ? "Leave orbit ↓" : "↑ Back into orbit";
    exitBtn.setAttribute("aria-label",
      inGalaxy ? "Leave orbit and read the journal below" : "Fly back into orbit");
  }

  function leaveOrbit() {
    if (!inGalaxy) { scrollToY(journalTop()); return; }
    inGalaxy = false;
    syncExit();
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
    syncExit();
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
      loadInto(hit.entry.url, hit.entry.title, hit.entry);
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
      if (hit) { onTap(hit); }
      else {
        var sysHit = systemAt(w.x, w.y);
        if (sysHit) showSystemInfo(sysHit);
      }
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
    loadInto(target.entry.url, target.entry.title, target.entry);
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

  var raf = null, t0 = 0;

  // Deliberately unthrottled, and it used to be capped at 24fps.
  //
  // A cap inside an animation-frame loop is the classic cause of judder: the
  // display refreshes on its own clock, so a 24fps gate inside a 60Hz callback
  // presents some frames after two refreshes and some after three. The motion is
  // even; the presentation is not, and the eye reads the unevenness as stutter.
  //
  // Drawing on every callback hands the pacing back to vsync, where it belongs.
  // requestAnimationFrame is already self-limiting on a slow machine, so there
  // is nothing left for a cap to protect. This is only affordable because the
  // gas is now cached — see drawNebula.
  function tick(ts) {
    if (!t0) t0 = ts;
    scene.time = (ts - t0) / 1000;
    advance(scene.time);
    if (renderer && DATA) renderer.draw(canvas, scene);
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
  exitBtn.addEventListener("click", function () {
    if (inGalaxy) leaveOrbit(); else enterOrbit();
  });
  document.getElementById("galaxy-zoom-in").addEventListener("click", function () { setZoom(zoomIndex + 1); });
  document.getElementById("galaxy-zoom-out").addEventListener("click", function () { setZoom(zoomIndex - 1); });

  // On this page the navbar's own "Galaxy" link should fly you back rather than
  // reload the whole document. "/" and "/index.html" are the same page, so the
  // comparison has to normalise before it can match.
  function samePage(path) {
    return path.replace(/index\.html$/, "") === window.location.pathname.replace(/index\.html$/, "");
  }
  Array.prototype.forEach.call(document.querySelectorAll(".navbar a"), function (a) {
    // The brand is deliberately exempt: on this page it is not a way back, it is
    // the way *in*. See aimBrand.
    if (a.classList.contains("navbar-brand")) return;
    if (a.getAttribute("href") && samePage(a.pathname)) {
      a.addEventListener("click", function (ev) { ev.preventDefault(); enterOrbit(); });
    }
  });

  /* Where the title takes you.
   *
   * On every other page the brand already points at the galaxy, which is where
   * you want to go from them. On the galaxy itself that link points at the page
   * you are already looking at, so it is spent — and the one thing you cannot
   * reach from here in a click is the day you are about to write.
   *
   * So here, and only here, the title opens today's entry.
   */
  function aimBrand() {
    var brand = document.querySelector(".navbar-brand");
    if (!brand) return;

    var today = scene.today && scene.today.entry;
    if (today) {
      brand.setAttribute("href", today.url);
      brand.setAttribute("title", "Write today's entry — " + today.title);
      return;
    }

    // Today has not been started. A browser cannot create the file, so the
    // honest thing is to say so and offer the newest day instead of a 404.
    var logged = allLogged();
    var newest = logged.length ? logged[logged.length - 1].entry : null;
    if (!newest) return;
    brand.setAttribute("href", newest.url);
    brand.setAttribute("title",
      "No entry for today yet — run: python scripts/new_day.py. " +
      "This opens the most recent day instead.");
  }

  function useRenderer() {
    if (!window.ODailyPixel) return;
    renderer = window.ODailyPixel;
    renderer.init(canvas);
    resize();
  }

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
      aimBrand();
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
