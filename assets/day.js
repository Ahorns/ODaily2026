/* The planet and the time table at the top of an entry.
 *
 * Both are drawn here rather than written into the day file, so a `.qmd`
 * contains only what was typed into it. Everything below comes from
 * assets/sky.json, which is the same data the universe is drawn from — so the
 * day you clicked is recognisably the same world when it arrives.
 *
 * Deliberately still: the entry is the reading register, and nothing on it
 * should move while you are reading.
 */
(function () {
  "use strict";

  // The galaxy's journal panel shows the same entry, fetched as HTML — which
  // no longer carries the table, since nothing generated is written into a
  // day file any more. Sharing the builder keeps the two identical.
  window.ODailyDay = { timeTable: timeTable, placeTable: placeTable };

  var main = document.querySelector("#quarto-document-content") ||
    document.querySelector("main");
  if (!main) return;

  // The file name is the date, so the page knows which day it is without
  // anything having to be written into it.
  var iso = (location.pathname.match(/(\d{4}-\d{2}-\d{2})(?:\.html)?$/) || [])[1];
  if (!iso) return;

  // Entries live one directory down, so the data sits alongside at ../assets.
  fetch(new URL("../assets/sky.json", location.href).href)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) { if (data) render(data, iso); })
    .catch(function () { /* the writing is the page; the planet is a bonus */ });

  function findDay(data, iso) {
    for (var i = 0; i < data.systems.length; i++) {
      var found = data.systems[i].days[iso];
      if (found) return found;
    }
    return null;
  }

  function fmtHours(h) {
    if (!h) return "0m";
    var mins = Math.round(h * 60);
    var hrs = Math.floor(mins / 60);
    mins = mins % 60;
    return (hrs ? hrs + "h" : "") + (mins ? (hrs ? " " : "") + mins + "m" : hrs ? "" : "0m");
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function render(data, iso) {
    var day = findDay(data, iso);
    if (!day) return;

    // Moons are the projects beyond the first, in the same order the map
    // sorts them, so a day's moons match between the two views.
    var moonColors = (day.projects || []).slice(1).map(function (slug) {
      return (data.projects[slug] || {}).color || "#cdd8f0";
    });

    var parts = iso.split("-");
    var hero = el("div", "day-hero");
    var canvas = el("canvas", "day-planet");
    canvas.width = canvas.height = 112;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "The planet for " + iso);
    hero.appendChild(canvas);
    hero.appendChild(el("p", "day-name", day.name || ""));

    // After the date, before the writing: the planet is the day's portrait,
    // and a portrait belongs under the name rather than above it.
    var title = main.querySelector("#title-block-header");
    if (title && title.nextSibling) main.insertBefore(hero, title.nextSibling);
    else if (title) main.appendChild(hero);
    else main.insertBefore(hero, main.firstChild);

    // The hours are part of what the day was, so they open that section
    // rather than sitting up with the portrait.
    placeTable(main, timeTable(data, day));

    if (window.ODailyPixel) {
      window.ODailyPixel.sprite(canvas, {
        seed: (parseInt(parts[0], 10) * 10000 +
               parseInt(parts[1], 10) * 100 +
               parseInt(parts[2], 10)) | 0,
        type: day.type || "rock",
        color: day.color || null,
        moons: moonColors.length,
        moonColors: moonColors,
        milestone: !!day.milestone,
        idea: !!day.idea
      });
    }
  }

  // Puts the table at the top of "What I did". Quarto's own id is the first
  // choice; the heading text is the fallback, so renaming the section in the
  // template does not silently strand the table at the bottom of the page.
  function placeTable(root, table) {
    if (!table) return;

    var section = root.querySelector("#what-i-did");
    if (!section) {
      var heads = root.querySelectorAll("h1, h2, h3");
      for (var i = 0; i < heads.length; i++) {
        if (heads[i].textContent.trim().toLowerCase() === "what i did") {
          section = heads[i].parentNode;
          break;
        }
      }
    }
    if (!section) { root.appendChild(table); return; }

    var heading = section.querySelector("h1, h2, h3");
    if (heading && heading.nextSibling) section.insertBefore(table, heading.nextSibling);
    else if (heading) section.appendChild(table);
    else section.insertBefore(table, section.firstChild);
  }

  function timeTable(data, day) {
    var sessions = day.sessions || [];
    if (!sessions.length) return null;

    var wrap = el("div", "day-time");
    var table = el("table");
    var tbody = document.createElement("tbody");

    sessions.forEach(function (row) {
      var tr = document.createElement("tr");
      tr.appendChild(el("th", null, row[0]));
      tr.appendChild(el("td", "day-time-hours", fmtHours(row[1])));
      tr.appendChild(el("td", "day-time-note", row[2] || ""));
      tbody.appendChild(tr);
    });

    if (sessions.length > 1) {
      var total = document.createElement("tr");
      total.className = "day-time-total";
      total.appendChild(el("th", null, "Total"));
      total.appendChild(el("td", "day-time-hours", fmtHours(day.hours)));
      total.appendChild(el("td"));
      tbody.appendChild(total);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
})();
