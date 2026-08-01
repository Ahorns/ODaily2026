/* Chrome that sits outside the universe itself: the style switch, the map/list
 * toggle, and sorting on the list.
 *
 * The map and the list are two views of the same collection, on purpose. The map
 * is for browsing and thinking; the list is for finding what you did on 12 March.
 * Small screens get the list first, because a draggable universe on a phone is a
 * demo, not a tool.
 */
(function () {
  "use strict";

  var STYLE_KEY = "odaily-style";
  var VIEW_KEY = "odaily-view";
  var STYLES = [
    { id: "pixel", label: "Pixel" },
    { id: "chart", label: "Atlas" },
    { id: "deep", label: "Deep" },
    { id: "dataviz", label: "Data" }
  ];

  function currentStyle() {
    var s = document.documentElement.dataset.style;
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === s) return s;
    return "pixel";
  }

  function applyStyle(id) {
    document.documentElement.dataset.style = id;
    try { localStorage.setItem(STYLE_KEY, id); } catch (e) { /* private mode */ }
    syncStyle();
    window.dispatchEvent(new CustomEvent("odaily:style", { detail: id }));
  }

  var styleBar = null;

  function syncStyle() {
    if (!styleBar) return;
    Array.prototype.forEach.call(styleBar.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.style === currentStyle()));
    });
  }

  function mountStyleSwitch() {
    var nav = document.querySelector(".navbar-nav");
    if (!nav) return;
    var li = document.createElement("li");
    li.className = "nav-item style-switch-item";
    styleBar = document.createElement("span");
    styleBar.className = "style-switch";
    STYLES.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.style = s.id;
      b.textContent = s.label;
      b.title = "Visual style: " + s.label;
      b.addEventListener("click", function () { applyStyle(s.id); });
      styleBar.appendChild(b);
    });
    li.appendChild(styleBar);
    nav.appendChild(li);
    syncStyle();
  }

  /* ------------------------------------------------------------ map/list -- */

  function setView(mode, remember) {
    var list = mode === "list";
    document.body.classList.toggle("mode-list", list);
    if (list) document.documentElement.classList.remove("galaxy-locked");
    Array.prototype.forEach.call(document.querySelectorAll("[data-view-btn]"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.viewBtn === mode));
    });
    if (remember !== false) {
      try { localStorage.setItem(VIEW_KEY, mode); } catch (e) { /* ignore */ }
    }
    window.dispatchEvent(new CustomEvent("odaily:view", { detail: mode }));
  }

  function mountViewToggle() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-view-btn]"), function (b) {
      b.addEventListener("click", function () { setView(b.dataset.viewBtn); });
    });

    var stored = null;
    try { stored = localStorage.getItem(VIEW_KEY); } catch (e) { /* ignore */ }
    // A draggable universe is not a usable index on a phone, so the list leads
    // there unless the reader has said otherwise.
    var mode = stored || (window.matchMedia("(max-width: 700px)").matches ? "list" : "map");
    setView(mode, !!stored);
  }

  /* ---------------------------------------------------------------- sort -- */

  function mountSort() {
    var table = document.getElementById("log-table");
    if (!table) return;
    var body = table.tBodies[0];
    var state = { key: "date", dir: -1 };

    function value(row, key) {
      if (key === "date") return row.dataset.date;
      if (key === "hours") return parseFloat(row.dataset.hours) || 0;
      var idx = { name: 1, kind: 3, projects: 4, marks: 5 }[key];
      return (row.cells[idx].textContent || "").trim().toLowerCase();
    }

    Array.prototype.forEach.call(table.querySelectorAll("th[data-sort]"), function (th) {
      th.addEventListener("click", function () {
        var key = th.dataset.sort;
        state.dir = state.key === key ? -state.dir : (key === "hours" || key === "date" ? -1 : 1);
        state.key = key;
        var rows = Array.prototype.slice.call(body.rows);
        rows.sort(function (a, b) {
          var va = value(a, key), vb = value(b, key);
          return (va < vb ? -1 : va > vb ? 1 : 0) * state.dir;
        });
        rows.forEach(function (r) { body.appendChild(r); });
        Array.prototype.forEach.call(table.querySelectorAll("th[data-sort]"), function (o) {
          o.removeAttribute("aria-sort");
        });
        th.setAttribute("aria-sort", state.dir < 0 ? "descending" : "ascending");
      });
    });
  }

  function start() {
    mountStyleSwitch();
    mountViewToggle();
    mountSort();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
