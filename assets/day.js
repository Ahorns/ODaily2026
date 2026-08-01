/* The single planet at the top of an entry.
 *
 * Same data and same engine as the universe, so the day you clicked is
 * recognisably the same world when it arrives — and in the same visual language,
 * because a pixel sprite dropped onto an engraved plate reads as a mistake
 * rather than as a style. Redraws when the style switch is used.
 *
 * Deliberately still: the entry is the reading register, and nothing on it
 * should move while you are reading.
 */
(function () {
  "use strict";

  var P = window.ODailyPlanet;
  var el = document.querySelector("canvas.day-planet");
  if (!el || !P) return;

  var day = {
    seed: parseInt(el.dataset.seed, 10) || 0,
    type: el.dataset.type || "rock",
    color: el.dataset.color || null,
    moons: parseInt(el.dataset.moons, 10) || 0,
    milestone: el.dataset.milestone === "true",
    idea: el.dataset.idea === "true"
  };

  function pixel() {
    // The box has to hold the widest thing drawn in it, which is the moon orbit
    // at 1.6r + 4, not the planet.
    var B = 80, R = 18, C = 40, scale = 2;
    var surf = new P.Surface(B, B, [13, 20, 36]);
    surf.clear(0);   // transparent: the sprite sits on whatever the page is

    el.width = B * scale;
    el.height = B * scale;
    el.style.width = (B * scale) + "px";
    el.style.height = (B * scale) + "px";

    if (day.milestone) P.drawMilestoneRing(surf, C, C, R, "back", 1);
    P.drawPlanet(surf, C, C, R, day.type, day.seed, day.seed % P.SPIN_STEPS, 1, day.color);
    if (day.milestone) P.drawMilestoneRing(surf, C, C, R, "front", 1);
    if (day.moons > 0) P.drawMoons(surf, C, C, R, day.moons, day.seed, 1);
    if (day.idea) P.drawComet(surf, C + R + 3, C - R - 3, 1);

    surf.blit(el);
  }

  function render() {
    var style = document.documentElement.dataset.style || "pixel";
    var V = window.ODailyVector;
    if (style === "pixel" || !V || !V.sprite) { pixel(); return; }
    V.setSkin(style);
    V.sprite(el, day);
  }

  render();
  window.addEventListener("odaily:style", render);
})();
