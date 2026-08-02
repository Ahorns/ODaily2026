# ODaily 2026

A daily log built as a galaxy. A day is a planet, a month is a stellar system,
a project is a constellation traced across whatever nights it appeared in.

The site has two registers on purpose. What you **navigate** — the month map on
the home page — is pixel art. What you **read** — an entry — is quiet and
text-first, in the same palette. The metaphor stops at the door of an entry.

## Writing a day

```sh
python scripts/new_day.py            # today
python scripts/new_day.py 2026-08-04 # a specific day
python scripts/new_day.py --milestone
```

That creates `log/<date>.qmd` from `_templates/day.qmd` and runs the build. Fill
in the prose sections, and set the `sessions:` list at the top:

```yaml
sessions:
  - project: thesis      # a slug from projects.yml
    hours: 2.5
    category: writing    # writing reading coding data meeting admin
    note: "Rewrote the methods opening"
```

Then rebuild and render:

```sh
python scripts/build.py
quarto render          # or: quarto preview
```

Use `quarto preview` while working on the map. It serves `assets/*.js` with
`cache-control: no-store`, and a plain static server does not — which means the
browser will happily keep running yesterday's renderer while you wonder why an
edit did nothing.

## The universe view

The home page opens on the whole galaxy, with today's planet at the centre of
the screen. Each month is its own stellar system, placed on a golden-angle
spiral so the systems never line up into a grid.

| Do this | Get this |
|:--|:--|
| Scroll | Travel through the field — the page itself never scrolls |
| Drag | Steer |
| `Ctrl` + scroll, pinch, `+` / `-`, or the buttons | Zoom, along a fixed ladder |
| **Click** a planet | Its day, in the card — you stay where you are |
| **Double-click** a planet | Go down and read it |
| `Leave orbit`, `Esc`, or `Read it below` | Hand the scroll back, drop to the journal |
| `Back into orbit`, the navbar `Galaxy` link, or `Esc` | Fly back up |
| `<-` / `->` / `Enter` | Step through days; open the selected one |

Scrolling deliberately never exits: the universe keeps the wheel until you say
otherwise. The camera is bounded — you may drift a few hundred units past the
outermost system and no further, and the edge glows faintly when you reach it,
so it reads as a limit rather than as the page having frozen.

The cursor is a UFO, and switches to a tractor beam over anything clickable.
Planets turn on their axes, and each month revolves around its own star as a
rigid body — spokes included, so a day never leaves its weekday.
All motion stops under `prefers-reduced-motion`, and pauses when the tab is
hidden or you leave orbit.

## How a day becomes a planet

Nothing is drawn by hand. Every sprite comes from the day's own data, so the
same entry always produces the same world.

| Planet property | Driven by |
|:--|:--|
| Surface pattern / terrain | Hash of the date — unique but stable |
| Diameter | Hours worked, in six buckets |
| **Colour** | **The projects worked that day, blended by hours** |
| Terrain type — ice, rock, ocean, lava, gas, forest | Dominant category that day |
| Number of moons | Extra projects beyond the first |
| Ring | A milestone day |
| Passing comet | An idea was recorded |
| Asteroid debris, no planet | No entry that day |
| Name | A real star, exoplanet or moon, from the date |

Colour and terrain are deliberately separate. **Colour says what you worked on**
— each project has a `color:` in `projects.yml`, and a day is their blend
weighted by hours, mixed in linear light so two projects give a real mixture
rather than mud. **Terrain says how you worked** — the dominant category. Two
writing days on different projects now look different; two ODaily days in
different modes look related but not identical.

Every day is also named after something real — Vega, Europa, Kepler-442b — from
a list of about 130 stars, exoplanets and moons, picked deterministically from
the date. The name shows in the readout, on the entry, and in the list.

## Two views

Every collection has **a map and a list**. The map is for browsing and thinking;
the list is a dense sortable table for finding what you did on 12 March. Toggle
in the top left. Small screens open on the list, because a draggable universe on
a phone is a demo, not a tool.

Nothing here is an image file. The nebulae are canvas gradients drawn into a
buffer a sixth of the screen's size, then ordered-dithered down to a handful of
tones with a 4x4 Bayer matrix — which is how the era actually drew a gradient,
and the only way to band gas without every cloud showing its own outline.

The gas depends on the camera and the zoom, never on time, so it is cached and
only redrawn when you actually move. That is what makes watching the systems
revolve nearly free, and it is why the frame cap could be removed: a cap inside
an animation-frame loop is itself a source of judder, because the display
refreshes on its own clock and a 24fps gate lands some frames two refreshes
apart and some three.

## What is written by hand, and what is not

`log/*.qmd` and `projects.yml` are yours. Everything else is generated by
`scripts/build.py` and will be overwritten:

- `assets/sky.json` — the data the map is drawn from
- `projects/*.qmd` — one constellation page per project, plus the index
- `_includes/summary.md`, `_includes/archive.md`

The build also rewrites regions it owns *inside* your day files: the `system`,
`hours` and `categories` frontmatter keys, and the blocks between the
`odaily:planet` and `odaily:time` markers. Everything else in a day file is left
exactly as written. Delete a marker pair and the build tells you it skipped it
rather than putting it back.

Projects are keyed by slug, and a slug is permanent — past entries refer to it
forever. Rename the `name`, regroup it, change its default category, but never
change the key.

## Layout

```
log/            one .qmd per day — the only files written by hand
projects.yml    the constellation registry
scripts/        new_day.py (scaffold), build.py (everything derived),
                demo.py (sample days, --clear to remove)
assets/         planet-core.js   the sprite engine, the bitmap font, the cache
                galaxy.js        layout, camera, motion, interaction, the panel
                render-pixel.js  the map: gas, orbits, bodies, constellations
                ui.js            the map/list toggle and list sorting
                day.js           the single planet atop an entry
_templates/     the day template
```
