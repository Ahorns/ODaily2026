import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const PLANET_STYLES = {
  earth:   { identity: "Earth", texture: "earth", roughness: 0.7, bump: 0.028, clouds: true, atmosphere: "#67b8ff", atmosphereOpacity: 0.3, tints: ["#ffffff"] },
  mercury: { identity: "Mercury", texture: "mercury", roughness: 0.98, bump: 0.052, tints: ["#ffffff", "#e9e1d7", "#d8dce3"] },
  venus:   { identity: "Venus", texture: "venus", roughness: 0.82, yScale: 0.99, atmosphere: "#e8bd78", atmosphereOpacity: 0.2, tints: ["#fff8e8", "#efd6ad", "#e6c59d"] },
  mars:    { identity: "Mars", texture: "mars", roughness: 0.95, bump: 0.046, atmosphere: "#bc704f", atmosphereOpacity: 0.1, tints: ["#ffffff", "#e8c3ad", "#d8aa91"] },
  moon:    { identity: "Moon", texture: "moon", roughness: 1, bump: 0.058, tints: ["#ffffff", "#dce2e7", "#e1d8ce"] },
  jupiter: { identity: "Jupiter", texture: "jupiter", roughness: 0.66, yScale: 0.92, atmosphere: "#dfc49d", atmosphereOpacity: 0.13, tints: ["#ffffff", "#f0dfca", "#e9d0b2"] },
  saturn:  { identity: "Saturn", texture: "saturn", roughness: 0.7, yScale: 0.9, ring: "saturn", atmosphere: "#e5d4ad", atmosphereOpacity: 0.11, tints: ["#ffffff", "#f0e3c8", "#dfd0b5"] },
  uranus:  { identity: "Uranus", texture: "uranus", roughness: 0.62, yScale: 0.95, ring: "uranus", atmosphere: "#8fdfe2", atmosphereOpacity: 0.17, tints: ["#ffffff", "#d9f1ee", "#c6e5e8"] },
  neptune: { identity: "Neptune", texture: "neptune", roughness: 0.63, yScale: 0.94, atmosphere: "#668dff", atmosphereOpacity: 0.2, tints: ["#ffffff", "#ced8ff", "#b9caf5"] }
};

const NAMED_SOLAR_BODIES = {
  earth: "earth",
  mercury: "mercury",
  venus: "venus",
  mars: "mars",
  moon: "moon",
  jupiter: "jupiter",
  saturn: "saturn",
  uranus: "uranus",
  neptune: "neptune"
};

const WORLD_CLASS_LABELS = {
  ice: "ice world",
  rock: "rock world",
  ocean: "ocean world",
  lava: "volcanic world",
  forest: "living world",
  gas: "gas giant"
};

const PLANET_CATALOGS = {
  // Earth is deliberately absent from automatic catalogues. It appears only
  // when a record is explicitly named Earth, so another system never silently
  // receives a duplicate Earth identity.
  ice: ["neptune", "uranus"],
  rock: ["mercury", "mars", "moon"],
  ocean: ["neptune", "uranus"],
  lava: ["mars", "venus", "mercury"],
  forest: ["venus", "uranus", "neptune"],
  gas: ["jupiter", "saturn", "neptune", "uranus"]
};

const root = document.getElementById("galaxy-3d-root");

if (root) {
  boot().catch(function (error) {
    console.error(error);
    const loading = document.getElementById("g3d-loading");
    if (loading) loading.innerHTML = "The 3D galaxy could not be charted. <a href='/'>Open the 2D map</a>.";
  });
}

async function boot() {
  const response = await fetch(root.dataset.src, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load ODaily sky data");
  const data = await response.json();

  const canvas = document.getElementById("galaxy-3d-canvas");
  const stage = root.querySelector(".galaxy-3d-stage");
  const readout = document.getElementById("g3d-readout");
  const systemBar = document.getElementById("g3d-systems");
  const filterBar = document.getElementById("g3d-filters");
  const loading = document.getElementById("g3d-loading");

  document.documentElement.classList.add("galaxy-3d-active");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#050812");
  scene.fog = new THREE.FogExp2("#050812", 0.00082);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2400);
  camera.position.set(150, 170, 250);

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.25 : 1.5));

  const planetTextures = await loadPlanetTextures(renderer, data);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.48;
  controls.zoomSpeed = 0.78;
  controls.panSpeed = 0.5;
  controls.minDistance = 14;
  controls.maxDistance = 1050;
  controls.target.set(0, 0, 0);

  // A dim fill preserves texture detail on the night side. The nearby system
  // star is the real key light, so every planet gains a proper terminator.
  scene.add(new THREE.HemisphereLight("#91acd8", "#080b14", 0.55));
  const keyLight = new THREE.DirectionalLight("#a9bee0", 0.4);
  keyLight.position.set(-100, 180, 140);
  scene.add(keyLight);

  const softDot = makeSoftDot();
  const starLayers = buildStarfield(scene, softDot);
  buildNebula(scene, softDot);

  const world = new THREE.Group();
  scene.add(world);

  const pickables = [];
  const records = [];
  const systems = [];
  const chronological = data.systems.slice().sort(function (a, b) {
    return a.start.localeCompare(b.start);
  });

  chronological.forEach(function (systemData, index) {
    systems.push(buildSystem(systemData, index, chronological.length));
  });

  const universeBounds = new THREE.Box3().setFromObject(world);
  const universeCenter = universeBounds.getCenter(new THREE.Vector3());
  const universeSize = universeBounds.getSize(new THREE.Vector3());
  const universeRadius = Math.max(80, universeSize.length() * 0.54);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selected = null;
  let hovered = null;
  let activeFilter = "";
  let paused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let simTime = 0;
  let previousFrame = performance.now();
  let flight = null;
  let pointerDown = null;

  const latest = records.filter(function (record) { return record.entry; }).sort(function (a, b) {
    return b.iso.localeCompare(a.iso);
  })[0] || records[records.length - 1] || null;

  buildSystemButtons();
  buildFilterButtons();
  updateMotionButton();
  overview(false);
  if (latest) selectRecord(latest, false);

  canvas.addEventListener("pointerdown", function (event) {
    pointerDown = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener("pointerup", function (event) {
    if (!pointerDown) return;
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (moved > 5) return;
    const hit = hitTest(event);
    if (hit) selectRecord(hit, true);
  });

  canvas.addEventListener("pointermove", function (event) {
    const hit = hitTest(event);
    if (hit === hovered) return;
    if (hovered) setHover(hovered, false);
    hovered = hit;
    if (hovered) setHover(hovered, true);
    canvas.classList.toggle("is-over-planet", !!hovered);
  });

  canvas.addEventListener("pointerleave", function () {
    if (hovered) setHover(hovered, false);
    hovered = null;
    canvas.classList.remove("is-over-planet");
  });

  canvas.addEventListener("dblclick", function (event) {
    event.preventDefault();
    const hit = hitTest(event);
    if (hit && hit.entry) window.location.href = entryUrl(hit.entry.url);
  });

  document.getElementById("g3d-overview").addEventListener("click", function () { overview(true); });
  document.getElementById("g3d-today").addEventListener("click", function () {
    if (latest) selectRecord(latest, true);
  });
  document.getElementById("g3d-motion").addEventListener("click", function () {
    paused = !paused;
    updateMotionButton();
  });

  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", function () {
    renderer.setAnimationLoop(null);
    document.documentElement.classList.remove("galaxy-3d-active");
  });

  resize();
  loading.classList.add("is-gone");
  renderer.setAnimationLoop(animate);

  function buildSystem(systemData, index, total) {
    const seed = hashString(systemData.key);
    const rand = mulberry32(seed);
    const system = new THREE.Group();
    const spiralRadius = index === 0 ? 0 : 105 + index * 82;
    const spiralAngle = index * 2.32;
    system.position.set(
      Math.cos(spiralAngle) * spiralRadius,
      (index - (total - 1) * 0.5) * 25 + (rand() - 0.5) * 20,
      Math.sin(spiralAngle) * spiralRadius
    );
    system.rotation.x = -0.18 + rand() * 0.32;
    system.rotation.z = -0.12 + rand() * 0.24;
    world.add(system);

    const starColor = new THREE.Color(index === total - 1 ? "#f2c46b" : "#dbe7ff");
    const star = new THREE.Mesh(
      new THREE.SphereGeometry(5.2, 48, 32),
      new THREE.MeshBasicMaterial({ color: starColor, map: planetTextures.sun })
    );
    system.add(star);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot,
      color: starColor,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    glow.scale.set(34, 34, 1);
    system.add(glow);

    const point = new THREE.PointLight(starColor, 1200, 480, 2);
    system.add(point);

    const label = makeLabelSprite(systemData.name || systemData.key, "#c5d2ef", 0.92);
    label.position.set(0, 13, 0);
    system.add(label);

    const start = parseISO(systemData.start);
    const end = parseISO(systemData.end);
    const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const firstDow = start.getUTCDay();
    const weeks = Math.max(1, Math.ceil((totalDays + firstDow) / 7));
    const ringRadii = [];
    const largestBodyRadius = Object.values(systemData.days).reduce(function (largest, entry) {
      return Math.max(largest, planetRadius(entry.hours));
    }, 3.2);
    const firstOrbitRadius = Math.max(25, largestBodyRadius * 4.1);
    const weekSpacing = Math.max(19, largestBodyRadius * 3.3);

    for (let week = 0; week < weeks; week++) {
      const radius = firstOrbitRadius + week * weekSpacing;
      ringRadii.push(radius);
      const ring = makeOrbit(radius, index === total - 1 ? "#384d78" : "#253451");
      system.add(ring);
    }

    const systemRecord = {
      data: systemData,
      node: system,
      star: star,
      glow: glow,
      records: [],
      centre: system.position.clone(),
      radius: ringRadii[ringRadii.length - 1] + weekSpacing * 0.8,
      seed: seed,
      orbitSpeed: 0.014 + (seed % 7) * 0.0007
    };

    for (let offset = 0; offset < totalDays; offset++) {
      const date = new Date(start.getTime() + offset * 86400000);
      const iso = isoDate(date);
      const entry = systemData.days[iso] || null;
      const dow = date.getUTCDay();
      const week = Math.floor((offset + firstDow) / 7);
      const orbitRadius = ringRadii[Math.min(week, ringRadii.length - 1)];
      const angle = -Math.PI / 2 + (dow / 7) * Math.PI * 2;
      const daySeed = Number(iso.replaceAll("-", ""));
      const dayRand = mulberry32(daySeed);
      const size = entry ? planetRadius(entry.hours) : 2.15 + dayRand() * 0.55;
      const planet = entry
        ? makePlanet(entry, size, daySeed)
        : makeFragments(size, daySeed);

      planet.position.set(Math.cos(angle) * orbitRadius, 0, Math.sin(angle) * orbitRadius);
      system.add(planet);

      const record = {
        iso: iso,
        date: date,
        entry: entry,
        node: planet,
        system: systemRecord,
        baseAngle: angle,
        orbitRadius: orbitRadius,
        // Every date keeps its calendar position. Rotating the system as one
        // rigid wheel prevents neighbouring days from drifting into collisions.
        orbitSpeed: systemRecord.orbitSpeed,
        spinSpeed: 0.08 + dayRand() * 0.11,
        size: size,
        moons: [],
        comet: null,
        projectSlugs: entry ? entry.projects.slice() : []
      };

      planet.traverse(function (object) {
        if (object.isMesh && object.userData.pickable) {
          object.userData.record = record;
          pickables.push(object);
        }
      });

      if (entry && entry.projects.length > 1) addMoons(record, daySeed);
      if (entry && entry.idea) addComet(record, daySeed);

      const dayLabel = makeLabelSprite(iso.slice(5), entry ? "#dce7ff" : "#7182aa", 0.63);
      dayLabel.position.set(0, size + 2.2, 0);
      dayLabel.visible = false;
      planet.add(dayLabel);
      record.label = dayLabel;

      records.push(record);
      systemRecord.records.push(record);
    }

    return systemRecord;
  }

  function makePlanet(entry, radius, seed) {
    const group = new THREE.Group();
    const style = choosePlanetStyle(entry, seed);
    const geometry = new THREE.SphereGeometry(radius, 64, 40);
    const material = new THREE.MeshStandardMaterial({
      color: naturalPlanetTint(style, seed),
      map: planetTextures[style.texture],
      bumpMap: style.bump ? planetTextures[style.texture] : null,
      bumpScale: style.bump ? radius * style.bump : 0,
      roughness: style.roughness,
      metalness: style.metalness || 0,
      emissive: style.emissive || "#000000",
      emissiveIntensity: style.emissiveIntensity || 0,
      dithering: true
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(style.xScale || 1, style.yScale || 1, style.zScale || 1);
    mesh.userData.pickable = true;
    mesh.userData.baseScale = 1;
    group.add(mesh);
    group.userData.surface = mesh;
    group.userData.visualType = style.label;

    if (style.atmosphere) {
      const atmosphere = makeAtmosphere(radius, style.atmosphere, style.atmosphereOpacity);
      atmosphere.scale.set(style.xScale || 1, style.yScale || 1, style.zScale || 1);
      group.add(atmosphere);
    }

    if (style.clouds) {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.015, 64, 40),
        new THREE.MeshStandardMaterial({
          color: "#ffffff",
          map: planetTextures.earthClouds,
          alphaMap: planetTextures.earthClouds,
          roughness: 0.72,
          transparent: true,
          opacity: 0.42,
          alphaTest: 0.025,
          depthWrite: false
        })
      );
      group.add(clouds);
      group.userData.clouds = clouds;
    }

    if (style.ring) addPlanetRing(group, radius, style.ring, seed);

    // A glow belongs only to a milestone. Ordinary planets keep their natural
    // limb and lighting, so the milestone signal remains unambiguous.
    if (entry.milestone) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.14, 48, 28),
        new THREE.MeshBasicMaterial({
          color: "#f2c46b",
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          transparent: true,
          opacity: 0.28,
          depthWrite: false
        })
      );
      group.add(halo);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.53, Math.max(0.045, radius * 0.018), 8, 96),
        new THREE.MeshBasicMaterial({
          color: "#f2c46b",
          transparent: true,
          opacity: 0.92,
          blending: THREE.AdditiveBlending
        })
      );
      ring.rotation.x = Math.PI / 2.6;
      group.add(ring);
    }
    return group;
  }

  function addPlanetRing(group, radius, ringKind, seed) {
    const inner = radius * (ringKind === "saturn" ? 1.22 : 1.38);
    const outer = radius * (ringKind === "saturn" ? 2.18 : 1.82);
    const geometry = new THREE.RingGeometry(inner, outer, 128);
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      const radial = Math.hypot(positions.getX(i), positions.getY(i));
      uv.setXY(i, (radial - inner) / (outer - inner), 0.5);
    }
    const material = new THREE.MeshBasicMaterial({
      color: ringKind === "saturn" ? "#ffffff" : "#a9dfe3",
      map: planetTextures.saturnRing,
      alphaMap: planetTextures.saturnRing,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: ringKind === "saturn" ? 0.9 : 0.32,
      alphaTest: 0.025,
      depthWrite: false
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / (2.15 + (seed % 5) * 0.07);
    ring.rotation.z = ((seed % 17) / 17 - 0.5) * 0.35;
    group.add(ring);
  }

  function makeFragments(radius, seed) {
    const group = new THREE.Group();
    const rand = mulberry32(seed ^ 0xa5a5a5);
    const material = new THREE.MeshStandardMaterial({
      color: "#65769e",
      roughness: 0.92,
      metalness: 0.02,
      emissive: "#17213a",
      emissiveIntensity: 0.5
    });
    for (let i = 0; i < 6; i++) {
      const fragment = new THREE.Mesh(
        new THREE.TetrahedronGeometry(radius * (0.28 + rand() * 0.28), 0),
        material
      );
      const angle = (i / 6) * Math.PI * 2 + rand() * 0.5;
      fragment.position.set(
        Math.cos(angle) * radius * (0.32 + rand() * 0.5),
        (rand() - 0.5) * radius * 0.9,
        Math.sin(angle) * radius * (0.32 + rand() * 0.5)
      );
      fragment.rotation.set(rand() * 5, rand() * 5, rand() * 5);
      group.add(fragment);
    }
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.15, 12, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hit.userData.pickable = true;
    hit.userData.baseScale = 1;
    group.add(hit);
    group.userData.fragmented = true;
    return group;
  }

  function addMoons(record, seed) {
    const rand = mulberry32(seed + 7781);
    record.entry.projects.slice(1).forEach(function (_slug, index) {
      const radius = Math.max(0.36, record.size * 0.14);
      const moon = new THREE.Group();
      const moonBody = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 16),
        new THREE.MeshStandardMaterial({
          color: "#ffffff",
          map: planetTextures.moon,
          roughness: 1
        })
      );
      moon.add(moonBody);
      moon.userData.orbitRadius = record.size * 1.65 + 1.4 + index * 0.7;
      moon.userData.phase = rand() * Math.PI * 2;
      moon.userData.speed = 0.45 + index * 0.11 + rand() * 0.18;
      record.node.add(moon);
      record.moons.push(moon);
    });
  }

  function addComet(record, seed) {
    const comet = new THREE.Group();
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.28, record.size * 0.1), 10, 8),
      new THREE.MeshBasicMaterial({ color: "#ffe9b0" })
    );
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(0.14, record.size * 0.06), record.size * 0.75, 8),
      new THREE.MeshBasicMaterial({ color: "#8d6d33", transparent: true, opacity: 0.82 })
    );
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -record.size * 0.42;
    comet.add(head, tail);
    comet.userData.phase = mulberry32(seed + 887)() * Math.PI * 2;
    comet.userData.orbitRadius = record.size * 1.75 + 1.8;
    record.node.add(comet);
    record.comet = comet;
  }

  function makeOrbit(radius, color) {
    const points = [];
    for (let i = 0; i < 128; i++) {
      const angle = i / 128 * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.48
    }));
  }

  function buildSystemButtons() {
    systems.slice().reverse().forEach(function (system) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = system.data.name || system.data.key;
      button.addEventListener("click", function () { focusSystem(system); });
      systemBar.appendChild(button);
    });
  }

  function buildFilterButtons() {
    const present = new Set();
    records.forEach(function (record) {
      record.projectSlugs.forEach(function (slug) { present.add(slug); });
    });
    addFilter("", "All");
    Object.keys(data.projects).forEach(function (slug) {
      if (present.has(slug)) addFilter(slug, data.projects[slug].name);
    });
  }

  function addFilter(slug, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.slug = slug;
    button.setAttribute("aria-pressed", slug === "" ? "true" : "false");
    if (slug && data.projects[slug]) button.style.setProperty("--project", data.projects[slug].color);
    button.addEventListener("click", function () {
      activeFilter = slug;
      filterBar.querySelectorAll("button").forEach(function (item) {
        item.setAttribute("aria-pressed", String(item.dataset.slug === activeFilter));
      });
      applyFilter();
    });
    filterBar.appendChild(button);
  }

  function applyFilter() {
    records.forEach(function (record) {
      const lit = !activeFilter || record.projectSlugs.includes(activeFilter);
      record.node.traverse(function (object) {
        if (!object.material || object.userData.pickable && object.material.opacity === 0) return;
        object.material.transparent = !lit;
        object.material.opacity = lit ? 1 : 0.13;
      });
      if (record.label && record !== selected && record !== hovered) record.label.visible = false;
    });
  }

  function hitTest(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.length ? hits[0].object.userData.record : null;
  }

  function setHover(record, on) {
    if (record.label && record !== selected) record.label.visible = on;
    const targetScale = on ? 1.08 : 1;
    record.node.scale.setScalar(targetScale);
  }

  function selectRecord(record, fly) {
    if (selected && selected.label) selected.label.visible = false;
    selected = record;
    if (selected.label) selected.label.visible = true;
    showRecord(record);
    if (fly) focusRecord(record);
  }

  function showRecord(record) {
    const systemName = escapeHTML(record.system.data.name || record.system.data.key);
    if (!record.entry) {
      readout.innerHTML =
        "<p class='g3d-eyebrow'>" + systemName + " · UNLOGGED WORLD</p>" +
        "<h2>" + escapeHTML(longDate(record.date)) + "</h2>" +
        "<p class='g3d-muted'>No entry was recorded for this day. Its fragments remain in the system as part of the timeline.</p>";
      return;
    }

    const entry = record.entry;
    const projects = entry.projects.map(function (slug) {
      const project = data.projects[slug];
      if (!project) return "";
      return "<span class='g3d-project' style='--project:" + project.color + "'>" + escapeHTML(project.name) + "</span>";
    }).join("");
    const sessions = (entry.sessions || []).map(function (session) {
      const note = session[2] ? " · " + escapeHTML(session[2]) : "";
      return "<li><span>" + escapeHTML(session[0]) + note + "</span><strong>" + formatHours(session[1]) + "</strong></li>";
    }).join("");

    readout.innerHTML =
      "<p class='g3d-eyebrow'>" + systemName + " · " + escapeHTML(record.node.userData.visualType || entry.type || "PLANET") + "</p>" +
      "<h2>" + escapeHTML(entry.name || longDate(record.date)) + "</h2>" +
      "<p class='g3d-date'>" + escapeHTML(longDate(record.date)) + " <span>" + formatHours(entry.hours) + " logged</span></p>" +
      "<div class='g3d-projects'>" + projects + "</div>" +
      (sessions ? "<ul class='g3d-sessions'>" + sessions + "</ul>" : "") +
      "<a class='g3d-open' href='" + entryUrl(entry.url) + "'>Read this entry →</a>";
  }

  function focusRecord(record) {
    const target = new THREE.Vector3();
    record.node.getWorldPosition(target);
    const direction = camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() < 0.1) direction.set(0.5, 0.42, 0.76).normalize();
    const distance = Math.max(18, record.size * 7.5);
    beginFlight(target, target.clone().add(direction.multiplyScalar(distance)));
  }

  function focusSystem(system) {
    const target = new THREE.Vector3();
    system.node.getWorldPosition(target);
    const distance = Math.max(52, system.radius * 2.3);
    beginFlight(target, target.clone().add(new THREE.Vector3(distance * 0.72, distance * 0.58, distance)));
    showSystem(system);
  }

  function showSystem(system) {
    const logged = system.records.filter(function (record) { return record.entry; });
    const hours = logged.reduce(function (total, record) { return total + record.entry.hours; }, 0);
    readout.innerHTML =
      "<p class='g3d-eyebrow'>STELLAR SYSTEM</p>" +
      "<h2>" + escapeHTML(system.data.name || system.data.key) + "</h2>" +
      "<p class='g3d-date'>" + escapeHTML(system.data.start) + " — " + escapeHTML(system.data.end) + "</p>" +
      "<div class='g3d-system-stats'><span><strong>" + logged.length + "</strong> days logged</span><span><strong>" + formatHours(hours) + "</strong> total</span></div>";
  }

  function overview(smooth) {
    const target = universeCenter.clone();
    const end = target.clone().add(new THREE.Vector3(
      universeRadius * 0.72,
      universeRadius * 0.64,
      universeRadius * 1.35
    ));
    if (smooth) beginFlight(target, end);
    else {
      controls.target.copy(target);
      camera.position.copy(end);
      controls.update();
    }
    readout.innerHTML =
      "<p class='g3d-eyebrow'>ODAILY 2026 · UNIVERSE</p>" +
      "<h2>" + systems.length + " stellar systems</h2>" +
      "<p>Every logged day remains a planet. Empty days are fractured worlds; project colours and satellites keep their original meaning.</p>";
  }

  function beginFlight(target, position) {
    flight = {
      started: performance.now(),
      duration: 1150,
      fromTarget: controls.target.clone(),
      toTarget: target.clone(),
      fromPosition: camera.position.clone(),
      toPosition: position.clone()
    };
  }

  function updateFlight(now) {
    if (!flight) return;
    let amount = clamp((now - flight.started) / flight.duration, 0, 1);
    amount = amount * amount * (3 - 2 * amount);
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, amount);
    camera.position.lerpVectors(flight.fromPosition, flight.toPosition, amount);
    if (amount >= 1) flight = null;
  }

  function animate(now) {
    const delta = Math.min(0.05, Math.max(0, (now - previousFrame) / 1000));
    previousFrame = now;
    if (!paused) simTime += delta;
    updateFlight(now);

    records.forEach(function (record) {
      const angle = record.baseAngle + simTime * record.orbitSpeed;
      record.node.position.set(
        Math.cos(angle) * record.orbitRadius,
        Math.sin(angle * 1.7 + record.iso.length) * 0.65,
        Math.sin(angle) * record.orbitRadius
      );
      record.node.rotation.y = simTime * record.spinSpeed;
      if (record.node.userData.clouds) {
        record.node.userData.clouds.rotation.y = simTime * record.spinSpeed * 0.18;
      }
      if (record.node.userData.fragmented) {
        record.node.children.forEach(function (fragment, index) {
          if (!fragment.userData.pickable) fragment.rotation.y += delta * (0.08 + index * 0.012);
        });
      }
      record.moons.forEach(function (moon, index) {
        const moonAngle = moon.userData.phase + simTime * moon.userData.speed;
        moon.position.set(
          Math.cos(moonAngle) * moon.userData.orbitRadius,
          Math.sin(moonAngle) * moon.userData.orbitRadius * 0.34,
          Math.sin(moonAngle) * moon.userData.orbitRadius * 0.72
        );
      });
      if (record.comet) {
        const cometAngle = record.comet.userData.phase + simTime * 0.62;
        const cometRadius = record.comet.userData.orbitRadius;
        record.comet.position.set(
          Math.cos(cometAngle) * cometRadius,
          Math.sin(cometAngle) * cometRadius * 0.76,
          Math.sin(cometAngle) * cometRadius * 0.38
        );
        record.comet.rotation.z = cometAngle + Math.PI / 2;
      }
    });

    systems.forEach(function (system, index) {
      system.star.rotation.y = simTime * (0.025 + index * 0.004);
      system.star.scale.setScalar(1 + Math.sin(simTime * 1.8 + index) * 0.025);
      system.glow.material.opacity = 0.54 + Math.sin(simTime * 1.25 + index) * 0.08;
    });
    starLayers.rotation.y = simTime * 0.0014;
    controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function updateMotionButton() {
    const button = document.getElementById("g3d-motion");
    button.textContent = paused ? "Play" : "Pause";
    button.setAttribute("aria-pressed", String(paused));
  }
}

function choosePlanetStyle(entry, seed) {
  const recordedName = String(entry.name || "").trim().toLowerCase();
  const namedStyleKey = NAMED_SOLAR_BODIES[recordedName];
  if (namedStyleKey) {
    const namedStyle = PLANET_STYLES[namedStyleKey];
    return Object.assign({}, namedStyle, { label: namedStyle.identity, exactIdentity: true });
  }

  const catalog = PLANET_CATALOGS[entry.type] || PLANET_CATALOGS.gas;
  const appearanceSeed = hashString(recordedName + ":" + seed + ":" + entry.type);
  const style = PLANET_STYLES[catalog[Math.abs(appearanceSeed) % catalog.length]];
  return Object.assign({}, style, {
    label: WORLD_CLASS_LABELS[entry.type] || "archive world"
  });
}

function naturalPlanetTint(style, seed) {
  if (style.exactIdentity || !style.tints || !style.tints.length) return "#ffffff";
  return style.tints[Math.abs(seed * 17 + hashString(style.texture)) % style.tints.length];
}

function makeAtmosphere(radius, color, opacity) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      rimColor: { value: new THREE.Color(color) },
      rimOpacity: { value: opacity || 0.14 }
    },
    vertexShader: `
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = viewPosition.xyz;
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 rimColor;
      uniform float rimOpacity;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      void main() {
        vec3 viewDirection = normalize(-vViewPosition);
        float facing = max(dot(normalize(vViewNormal), viewDirection), 0.0);
        float rim = pow(1.0 - facing, 3.6);
        float alpha = rim * rimOpacity;
        gl_FragColor = vec4(rimColor, alpha);
      }
    `,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.018, 48, 32),
    material
  );
  atmosphere.renderOrder = 1;
  return atmosphere;
}

async function loadPlanetTextures(renderer, data) {
  const files = {
    earth: "earth-day.jpg",
    earthClouds: "earth-clouds.jpg",
    moon: "moon.jpg",
    mercury: "mercury.jpg",
    venus: "venus-atmosphere.jpg",
    mars: "mars.jpg",
    jupiter: "jupiter.jpg",
    saturn: "saturn.jpg",
    saturnRing: "saturn-rings.png",
    uranus: "uranus.jpg",
    neptune: "neptune.jpg",
    sun: "sun.jpg"
  };
  const required = new Set(["sun"]);
  data.systems.forEach(function (system) {
    Object.keys(system.days).forEach(function (iso) {
      const entry = system.days[iso];
      const seed = Number(iso.replaceAll("-", ""));
      const style = choosePlanetStyle(entry, seed);
      required.add(style.texture);
      if (style.clouds) required.add("earthClouds");
      if (style.ring) required.add("saturnRing");
      if (entry.projects.length > 1) required.add("moon");
    });
  });
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const output = {};
  await Promise.all(Array.from(required).map(async function (key) {
    const texture = await loader.loadAsync("/assets/planet-textures/" + files[key]);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    if (key !== "saturnRing") texture.wrapS = THREE.RepeatWrapping;
    output[key] = texture;
  }));
  return output;
}

function buildStarfield(scene, dotTexture) {
  const group = new THREE.Group();
  const rand = mulberry32(20260317);
  const count = window.innerWidth < 700 ? 1900 : 3600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const colorChoices = [new THREE.Color("#8fa8d8"), new THREE.Color("#f2ddb2"), new THREE.Color("#92d9d2")];
  for (let i = 0; i < count; i++) {
    const radius = 260 + Math.pow(rand(), 0.42) * 850;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) * 0.72;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    const color = colorChoices[Math.floor(rand() * colorChoices.length)].clone().multiplyScalar(0.55 + rand() * 0.45);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 1.25,
    map: dotTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    alphaTest: 0.08,
    depthWrite: false,
    sizeAttenuation: true
  }));
  group.add(points);
  scene.add(group);
  return group;
}

function buildNebula(scene, dotTexture) {
  const palettes = ["#243c78", "#492c69", "#17495c", "#6b342f"];
  palettes.forEach(function (color, cloudIndex) {
    const rand = mulberry32(5501 + cloudIndex * 101);
    const count = window.innerWidth < 700 ? 180 : 340;
    const positions = new Float32Array(count * 3);
    const centre = new THREE.Vector3((cloudIndex - 1.5) * 135, (rand() - 0.5) * 150, (rand() - 0.5) * 350);
    for (let i = 0; i < count; i++) {
      const spread = 45 + rand() * 135;
      positions[i * 3] = centre.x + gaussian(rand) * spread;
      positions[i * 3 + 1] = centre.y + gaussian(rand) * spread * 0.42;
      positions[i * 3 + 2] = centre.z + gaussian(rand) * spread * 0.9;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({
      color: color,
      size: 32,
      map: dotTexture,
      transparent: true,
      opacity: 0.075,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    })));
  });
}

function makeSoftDot() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,.78)");
  gradient.addColorStop(0.5, "rgba(255,255,255,.18)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabelSprite(text, color, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  ctx.font = "600 25px 'Cascadia Mono', Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(3,6,14,.95)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  }));
  sprite.scale.set(34 * scale, 4.8 * scale, 1);
  return sprite;
}

function parseISO(iso) {
  const parts = iso.split("-").map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function longDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
  }).format(date);
}

function planetRadius(hours) {
  return 2.5 + Math.min(3.7, Math.sqrt(Math.max(0, hours || 0)) * 0.95);
}

function formatHours(hours) {
  const value = Number(hours || 0);
  const whole = Math.floor(value);
  const minutes = Math.round((value - whole) * 60);
  if (!minutes) return whole + "h";
  return whole + "h " + minutes + "m";
}

function entryUrl(url) {
  return "/" + String(url || "").replace(/^\/+/, "");
}

function escapeHTML(value) {
  return String(value == null ? "" : value).replace(/[&<>'"]/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
  });
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function () {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(0.000001, rand());
  const v = Math.max(0.000001, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
