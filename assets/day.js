/* The single planet at the top of an entry.
 *
 * Same data and same engine as the universe, so the day you clicked is
 * recognisably the same world when it arrives.
 *
 * Deliberately still: the entry is the reading register, and nothing on it
 * should move while you are reading.
 */
(function () {
  "use strict";

  var el = document.querySelector("canvas.day-planet");
  if (!el || !window.ODailyPixel) return;

  var day = {
    seed: parseInt(el.dataset.seed, 10) || 0,
    type: el.dataset.type || "rock",
    color: el.dataset.color || null,
    moons: parseInt(el.dataset.moons, 10) || 0,
    milestone: el.dataset.milestone === "true",
    idea: el.dataset.idea === "true"
  };

  window.ODailyPixel.sprite(el, day);
})();
