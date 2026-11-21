"use strict";

(() => {
  const { Simulation, templates, rhythms, defaults, atrialFoci, atrialFocusPatterns, morphologyTiming, validateMorphology, clone } = window.Conduction;
  const { EcgStrip } = window;
  const TILE_MS = EcgStrip.tileMs;
  const ECG_LOOKAHEAD_MS = 2000;
  const AV_BLOCK_MARKER_MS = 100;
  const KEY = "ecg-lecture-lab.waveforms.v1";
  const REENTRY_CIRCUITS = [{
    rhythm: "flutter",
    label: "Atrial flutter reentry circuit",
    path: "M 322.91 298.24 C 331.12 305.63 321.30 329.92 300.97 352.50 C 280.64 375.07 257.52 387.37 249.31 379.98 C 241.10 372.60 250.92 348.30 271.25 325.73 C 291.58 303.16 314.71 290.85 322.91 298.24 Z"
  }, {
    rhythm: "avnrt",
    label: "AVNRT: schematic slow and fast AV nodal pathways",
    dotLimit: 12,
    path: "M 370 302 C 360 299 347 309 341 323 C 332 342 331 359 337 365 C 343 371 353 365 359 357 L 356 355 L 362 354 L 358 352 L 364 351 L 360 348 L 366 347 L 362 344 L 368 343 L 364 340 L 370 339 L 366 336 L 372 335 L 368 332 L 374 331 L 370 328 L 376 327 L 372 324 L 378 323 L 374 320 L 380 319 L 376 316 L 381 315 L 377 312 L 380 310 C 378 307 375 304 370 302 Z"
  }, {
    rhythm: "avrt",
    label: "Orthodromic AVRT: schematic left-sided accessory pathway",
    path: "M 372 302 C 388 307 397 322 400 339 C 404 366 425 393 448 411 C 480 435 510 460 531 458 C 549 457 548 436 540 410 C 531 377 516 343 505 312 C 499 292 495 276 484 251 C 475 247 453 238 431 240 C 400 240 374 253 368 271 C 363 286 367 297 372 302 Z",
    accessoryPath: "M 505 312 C 499 292 495 276 484 251"
  }];
  const $ = selector => document.querySelector(selector);
  const canvas = $("#ecg-canvas");
  const ctx = canvas.getContext("2d");
  const plot = $("#ecg-plot");
  const waveform = $("#ecg-waveform");
  const trace = $("#ecg-trace");
  const readouts = Object.fromEntries(["readout", "pr-readout", "qrs-readout", "time-readout"].map(id => [id, $(`#${id}`)]));
  const settings = { ...defaults };
  let simulation;
  let ecgStrip;
  let paused = false;
  let speed = 1;
  let frame = 0;
  let suspended = document.hidden;
  let clockTime = 0;
  let clockSimulation = 0;
  let lastReadout = -Infinity;
  const animations = new Map();
  const impulses = [];
  const reentryCircuits = [];
  const ecgTiles = new Map();
  let prefetchPending = false;
  let ecgViewport;
  let activeId = "automatic";
  let library = [];
  let anatomyItems = [];
  let blockMarkers = [];
  let avDelayMarker;
  let crossPath;
  let sinusDots;
  let avDots;
  let escapeDots;
  const focusMarkers = new Map();
  const focusRoutes = new Map();
  let canvasWidth = 0;
  let canvasHeight = 0;

  function reportError(error) {
    console.error(error);
    $("#error-message").textContent = error.message || String(error);
    $("#error-message").hidden = false;
  }

  function normalizeLibrary(data) {
    if (!Array.isArray(data)) throw new Error("The waveform library must be a JSON array.");
    const ids = new Set(["automatic"]);
    return data.map(value => {
      const item = clone(value);
      if (!item || !Array.isArray(item.waves)) throw new Error("A waveform has no wave array.");
      for (const w of item.waves) {
        if (!Number.isFinite(w.topRadius) && Number.isFinite(w.sharpness)) {
          w.topRadius = Math.min(50, Math.max(1, Math.round(w.sharpness * 3)));
        }
      }
      validateMorphology(item);
      if (typeof item.id !== "string" || !item.id || ids.has(item.id)) item.id = uid();
      ids.add(item.id);
      return item;
    });
  }

  function uid() {
    return `waveform-${crypto.randomUUID()}`;
  }

  function currentMorphology() {
    return activeId === "automatic" ? templates[settings.bundle] : library.find(item => item.id === activeId);
  }

  function scenarioSettings(overrides = {}) {
    const scenario = { ...settings, ...overrides };
    return rhythms[scenario.rhythm]?.avReentry ? { ...scenario, av: "normal" } : scenario;
  }

  function saveLibrary(message) {
    try {
      localStorage.setItem(KEY, JSON.stringify(library));
      $("#authoring-status").textContent = message;
      return true;
    } catch (error) {
      reportError(new Error(`Could not save the waveform library: ${error.message}`));
      return false;
    }
  }

  function populateLibrary() {
    const select = $("#waveform-select");
    const automatic = new Option("Automatic V1 (follows bundle selection)", "automatic");
    select.replaceChildren(automatic, ...library.map(item => new Option(item.name, item.id)));
    select.value = activeId;
  }

  function updateScenario() {
    const rhythm = rhythms[settings.rhythm];
    const av = simulation.settings.av;
    $("#rhythm-pattern").value = settings.rhythm;
    $("#rate-label").textContent = rhythm.rateLabel;
    $("#heart-rate").min = rhythm.minRate;
    $("#heart-rate").max = rhythm.maxRate;
    $("#heart-rate").value = settings.atrialRate;
    $("#av-pattern").value = av;
    $("#av-pattern").disabled = !!rhythm.avReentry;
    $("#av-reentry-note").hidden = !rhythm.avReentry;
    $("#junctional-av-note").hidden = !rhythm.junctional || av === "normal";
    $("#pr-field").hidden = av !== "first";
    $("#wenckebach-field").hidden = av !== "mobitz1";
    $("#pr-step-field").hidden = av !== "mobitz1";
    $("#ratio-field").hidden = !["mobitz1", "mobitz2"].includes(av);
    $("#escape-field").hidden = av !== "third";
    $("#custom-warning").hidden = activeId === "automatic";
    blockMarkers.forEach(marker => {
      marker.node.style.display = marker.bundle === settings.bundle ? "" : "none";
    });
    for (const item of anatomyItems.filter(item => item.type === "path")) {
      const bundle = item.name === "Right Bundle" ? "rbbb" : item.name === "Left Bundle" ? "lbbb" : null;
      item.path.setAttribute("stroke", bundle && settings.bundle === bundle ? "#b42318" : "#a18a20");
    }
  }

  function timelineTime() {
    return document.timeline.currentTime ?? performance.now();
  }

  function advanceClock(now = timelineTime()) {
    if (!paused && !suspended) simulation.advanceTo(clockSimulation + Math.max(0, now - clockTime) * speed);
  }

  function anchorClock() {
    clockTime = timelineTime();
    clockSimulation = simulation.now;
  }

  function alignAnimation(animation, start) {
    animation.pause();
    animation.playbackRate = speed;
    animation.currentTime = simulation.now - start;
    if (!paused && !suspended && simulation.now - start < animation.effect.getComputedTiming().endTime) {
      animation.play();
      animation.startTime = clockTime + (start - clockSimulation) / speed;
    }
  }

  function registerAnimation(element, keyframes, timing, start) {
    const animation = element.animate(keyframes, timing);
    animations.set(animation, start);
    alignAnimation(animation, start);
    return animation;
  }

  function cancelAnimation(animation) {
    if (!animation) return;
    animation.cancel();
    animations.delete(animation);
  }

  function scheduleFrame() {
    if (!frame && !paused && !suspended) frame = requestAnimationFrame(tick);
  }

  function restart() {
    clearEcgTiles();
    for (const animation of animations.keys()) animation.cancel();
    animations.clear();
    for (const impulse of impulses) { impulse.key = null; impulse.animations = []; }
    simulation = new Simulation(scenarioSettings(), currentMorphology());
    ecgStrip = new EcgStrip(new Simulation(scenarioSettings(), currentMorphology()));
    anchorClock();
    updateScenario();
    startReentryCircuits();
    draw(true);
    scheduleFrame();
  }

  function setPaused(value) {
    advanceClock();
    paused = value;
    $("#pause-button").textContent = paused ? "Resume" : "Pause";
    $("#pause-button").setAttribute("aria-pressed", String(paused));
    $("#monitor-status").textContent = paused ? "PAUSED" : "RUNNING";
    anchorClock();
    draw();
    for (const [animation, start] of animations) alignAnimation(animation, start);
    drawReadouts(true);
    if (paused) { cancelAnimationFrame(frame); frame = 0; }
    else scheduleFrame();
  }

  function resize() {
    const bounds = plot.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    if (bounds.width === canvasWidth && bounds.height === canvasHeight && ctx.getTransform().a === ratio) return;
    canvasWidth = bounds.width;
    canvasHeight = bounds.height;
    canvas.width = Math.round(canvasWidth * ratio);
    canvas.height = Math.round(canvasHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawEcgBackground();
    if (simulation) { advanceClock(); draw(true); }
  }

  function drawEcgBackground() {
    const w = canvasWidth;
    const h = canvasHeight;
    const baseline = h * 0.53;
    const scale = h * 0.3;
    const ratio = ctx.getTransform().a;
    const plotWidth = Math.round((w - 88) * ratio) / ratio;
    const startX = (w - plotWidth) / 2;
    const endX = w - startX;
    waveform.style.left = `${startX}px`;
    waveform.style.right = `${startX}px`;
    $(".ecg-axis").style.left = `${startX}px`;
    $(".ecg-axis").style.right = `${startX}px`;
    ecgViewport = { left: startX, right: endX, baseline, amplitude: scale, height: h };
    ctx.fillStyle = "#061b15";
    ctx.fillRect(0, 0, w, h);
    for (const spacing of [10, 50]) {
      ctx.strokeStyle = spacing === 10 ? "#b1f1cd12" : "#b1f1cd28";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += spacing) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
      for (let y = 0; y <= h; y += spacing) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
      ctx.stroke();
    }
    ctx.strokeStyle = "#9bb8aa";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(7, baseline);
    ctx.lineTo(12, baseline);
    ctx.lineTo(12, baseline - scale);
    ctx.lineTo(28, baseline - scale);
    ctx.lineTo(28, baseline);
    ctx.lineTo(34, baseline);
    ctx.stroke();
    ctx.fillStyle = "#9bb8aa";
    ctx.font = "9px monospace";
    ctx.fillText("1 mV", 5, baseline - scale - 9);
  }

  function removeEcgTile(index, { image, animation }) {
    cancelAnimation(animation);
    image.remove();
    ecgTiles.delete(index);
  }

  function clearEcgTiles() {
    for (const [index, tile] of ecgTiles) removeEcgTile(index, tile);
  }

  function syncEcgTiles(lookahead) {
    const half = ecgStrip.halfWindowMs;
    const first = Math.max(0, Math.floor((simulation.now - half) / TILE_MS));
    const last = Math.floor((simulation.now + half + lookahead) / TILE_MS);
    for (const [index, tile] of ecgTiles) {
      if (index < first) removeEcgTile(index, tile);
    }
    for (let index = first; index <= last; index++) {
      if (ecgTiles.has(index)) continue;
      const image = ecgStrip.renderTile(index);
      image.dataset.ecgTile = index;
      image.style.width = `${ecgStrip.tileWidth}px`;
      image.style.height = `${image.height / ecgStrip.geometry.ratio}px`;
      trace.append(image);
      // Each tile crosses the same clipped viewport on the common playback clock.
      const animation = registerAnimation(image, [
        { transform: `translate3d(${ecgViewport.right - ecgViewport.left}px, 0, 0)` },
        { transform: `translate3d(${-ecgStrip.tileWidth}px, 0, 0)` }
      ], { duration: TILE_MS + 2 * half, fill: "both" }, index * TILE_MS - half);
      ecgTiles.set(index, { image, animation });
    }
  }

  function updateEcg(force) {
    if (force && ecgStrip.configure(ecgViewport, ctx.getTransform().a)) clearEcgTiles();
    syncEcgTiles(0);
    const next = Math.floor((simulation.now + ecgStrip.halfWindowMs + ECG_LOOKAHEAD_MS) / TILE_MS);
    if (paused || suspended || prefetchPending || ecgTiles.has(next)) return;
    prefetchPending = true;
    const prefetch = () => {
      prefetchPending = false;
      if (!paused && !suspended) syncEcgTiles(ECG_LOOKAHEAD_MS);
    };
    if (window.requestIdleCallback) window.requestIdleCallback(prefetch);
    else setTimeout(prefetch, 0);
  }

  function svgElement(tag, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }

  function pulsePath(impulse, start, duration, reverse = false) {
    const key = start === null ? null : `${start}:${duration}:${reverse}`;
    if (impulse.key === key) return;
    impulse.animations.forEach(cancelAnimation);
    impulse.animations = [];
    impulse.key = key;
    if (start === null || simulation.now > start + duration) return;
    impulse.dots.forEach((dot, index) => {
      const trailing = index * 4 / impulse.length;
      const opacity = 1 - index * 0.023;
      const animation = registerAnimation(dot, [
        { offsetDistance: reverse ? "100%" : "0%", opacity },
        { offsetDistance: `${(reverse ? trailing : 1 - trailing) * 100}%`, opacity }
      ], { duration: duration * (1 - trailing), delay: duration * trailing, fill: "none" }, start);
      impulse.animations.push(animation);
    });
  }

  function addDot(parent, attributes = {}) {
    const dot = svgElement("circle", { r: 3.5, fill: "#ffea54", stroke: "#8b5900", "stroke-width": 0.9, ...attributes });
    parent.append(dot);
    return dot;
  }

  function addImpulse(parent, path, label, dotLimit = 24) {
    const length = path.getTotalLength();
    const group = svgElement("g", { class: "impulse-dots", "data-path": label });
    const dots = Array.from({ length: Math.min(dotLimit, Math.ceil(length / 4)) }, (_, index) => {
      const dot = addDot(group, { r: index === 0 ? 4.5 : 3 });
      dot.style.opacity = "0";
      dot.style.offsetPath = `path("${path.getAttribute("d")}")`;
      dot.style.offsetRotate = "0deg";
      return dot;
    });
    parent.append(group);
    const impulse = { path, length, group, dots, key: null, animations: [] };
    impulses.push(impulse);
    return impulse;
  }

  function addReentryCircuit(parent, definition) {
    const group = svgElement("g", { "data-reentry-circuit": definition.rhythm });
    const path = svgElement("path", {
      d: definition.path, fill: "none", stroke: "#a18a20", "stroke-width": 2, "stroke-opacity": 0.8
    });
    const title = svgElement("title");
    title.textContent = definition.label;
    path.append(title);
    group.append(path);
    if (definition.accessoryPath) {
      const accessory = svgElement("path", {
        d: definition.accessoryPath, fill: "none", stroke: "#007b56", "stroke-width": 3,
        "stroke-dasharray": "4 3", "data-accessory-path": definition.rhythm
      });
      const accessoryTitle = svgElement("title");
      accessoryTitle.textContent = "Retrograde left-sided accessory pathway";
      accessory.append(accessoryTitle);
      group.append(accessory);
    }
    parent.append(group);
    reentryCircuits.push({ ...definition, group, impulse: addImpulse(group, path, definition.label, definition.dotLimit) });
  }

  function startReentryCircuits() {
    for (const circuit of reentryCircuits) {
      const active = circuit.rhythm === settings.rhythm;
      circuit.group.style.display = active ? "" : "none";
      if (!active) continue;
      const duration = 60000 / settings.atrialRate;
      circuit.impulse.dots.forEach((dot, index) => {
        const trailing = index * 4 / circuit.impulse.length;
        const opacity = 1 - index * 0.023;
        const animation = registerAnimation(dot, [
          { offsetDistance: "0%", opacity },
          { offsetDistance: "100%", opacity }
        ], { duration, delay: index ? -duration * (1 - trailing) : 0, iterations: Infinity }, 0);
        circuit.impulse.animations.push(animation);
      });
    }
  }

  function addNodeDots(parent, x, y, label) {
    const group = svgElement("g", { class: "impulse-dots", "data-node": label });
    const title = svgElement("title");
    title.textContent = label;
    group.append(title);
    addDot(group, { cx: x * 822, cy: y * 566 });
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      addDot(group, { cx: x * 822 + Math.cos(angle) * 7, cy: y * 566 + Math.sin(angle) * 7, r: 2.7 });
    }
    parent.append(group);
    return group;
  }

  function addFocusMarker(parent, id, focus) {
    const group = svgElement("g", {
      "data-atrial-focus": id, transform: `translate(${focus.x * 822} ${focus.y * 566})`
    });
    const title = svgElement("title");
    title.textContent = focus.label;
    const ring = svgElement("circle", { fill: "none", stroke: "#e07000", "stroke-width": 3 });
    const circle = svgElement("circle", { r: 6, stroke: "#8b5900", "stroke-width": 2 });
    group.append(title, ring, circle);
    parent.append(group);
    focusMarkers.set(id, { group, circle, ring });
  }

  function closestPointOnPath(points, target) {
    let closest = null;
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const fraction = lengthSquared ?
        Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared)) : 0;
      const point = { x: start.x + fraction * dx, y: start.y + fraction * dy };
      const distance = Math.hypot(target.x - point.x, target.y - point.y);
      if (!closest || distance < closest.distance) closest = { point, segment: i, distance };
    }
    return closest;
  }

  function pointsBetween(points, from, to) {
    const vertices = from.segment <= to.segment ?
      points.slice(from.segment + 1, to.segment + 1) :
      points.slice(to.segment + 1, from.segment + 1).reverse();
    return [from.point, ...vertices, to.point];
  }

  function addFocusRoute(parent, id, focus, atrialPaths) {
    const origin = { x: focus.x * 822, y: focus.y * 566 };
    const candidates = atrialPaths.map(item => ({ item, nearest: closestPointOnPath(item.points, origin) }));
    const { item, nearest } = candidates.reduce((best, candidate) =>
      candidate.nearest.distance < best.nearest.distance ? candidate : best);
    const avNode = { x: 0.451 * 822, y: 0.53 * 566 };
    const branch = item.name === "Atria3" ? atrialPaths.find(path => path.name === "Atria4") : null;
    const endpoint = branch ? closestPointOnPath(item.points, branch.points[0]) : {
      point: item.points.at(-1), segment: item.points.length - 2
    };
    const points = [origin, ...pointsBetween(item.points, nearest, endpoint),
      ...(branch ? branch.points : []), avNode];
    const group = svgElement("g", { "data-atrial-focus-route": id, "data-via-path": item.name });
    const path = svgElement("path", {
      d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
      fill: "none", stroke: "#c27b00", "stroke-width": 2.5, "stroke-linejoin": "round"
    });
    const title = svgElement("title");
    title.textContent = `${focus.label} to AV node via ${item.name}`;
    path.append(title);
    group.append(path);
    parent.append(group);
    focusRoutes.set(id, { group, impulse: addImpulse(group, path, title.textContent) });
  }

  function addBlock(parent, x, y, label, delayed = false) {
    const group = svgElement("g", {
      transform: `translate(${x} ${y})`, "data-conduction-marker": delayed ? "delay" : "block"
    });
    group.append(svgElement("circle", { r: 12, fill: "white", stroke: "#b42318", "stroke-width": 2 }));
    group.append(svgElement("path", {
      d: delayed ? "M -5 -7 H 5 V -5 L -5 5 V 7 H 5 V 5 L -5 -5 Z" :
        "M -5 -5 L 5 5 M 5 -5 L -5 5",
      stroke: "#b42318", "stroke-width": delayed ? 2 : 3, fill: "none",
      "stroke-linejoin": "round"
    }));
    const title = svgElement("title");
    title.textContent = label;
    group.append(title);
    parent.append(group);
    return group;
  }

  function buildAnatomy(items) {
    const parent = $("#anatomy-overlays");
    // Cap the composite once so overlapping chamber outlines never exceed 50%.
    const chamberLayer = svgElement("g", { opacity: 0.5 });
    parent.append(chamberLayer);
    anatomyItems = items.map(item => {
      if (!item || !Array.isArray(item.points) || item.points.length < 2 ||
          !item.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) &&
            p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) {
        throw new Error("The saved anatomy contains an invalid path.");
      }
      const d = item.points.map((p, index) => `${index ? "L" : "M"} ${p.x * 822} ${p.y * 566}`).join(" ");
      const path = svgElement("path", {
        d: d + (item.type === "shape" ? " Z" : ""), fill: "none",
        stroke: item.type === "path" ? "#b59f3c" : "none", "stroke-width": 2,
        "stroke-opacity": 0.35, "stroke-linejoin": "round",
        ...(item.type === "path" ? { "data-conduction-path": item.name } : {})
      });
      const title = svgElement("title");
      title.textContent = item.name;
      path.append(title);
      const isChamber = item.name.includes("Atrium") || item.name.includes("Ventricle");
      if (isChamber) {
        path.setAttribute("fill", "#ff0000");
        path.setAttribute("fill-opacity", 0);
      }
      (isChamber ? chamberLayer : parent).append(path);
      return { name: item.name, type: item.type, path,
        points: item.points.map(point => ({ x: point.x * 822, y: point.y * 566 })),
        impulse: item.type === "path" ? addImpulse(parent, path, item.name) : null };
    });
    const required = ["SA Node", "AV Node", "Right Atrium", "Left Atrium", "Right Ventricle", "Left Ventricle",
      "Right Bundle", "Left Bundle", "Atria1", "Atria2", "Atria3", "Atria4"];
    if (!required.every(name => anatomyItems.some(item => item.name === name))) {
      throw new Error("The saved anatomy is missing a required chamber or conduction structure.");
    }
    const cross = svgElement("path", { d: "M 483 447 Q 452 419 411 444", fill: "none", stroke: "#c27b00", "stroke-width": 3, "stroke-dasharray": "6 5" });
    const crossTitle = svgElement("title");
    crossTitle.textContent = "Delayed transseptal myocardial conduction";
    cross.append(crossTitle);
    parent.append(cross);
    crossPath = addImpulse(parent, cross, "Transseptal myocardium");
    REENTRY_CIRCUITS.forEach(circuit => addReentryCircuit(parent, circuit));
    const atrialPaths = anatomyItems.filter(item => /^Atria[1-4]$/.test(item.name) && item.type === "path");
    if (!["Atria1", "Atria2", "Atria3", "Atria4"].every(name => atrialPaths.some(path => path.name === name))) {
      throw new Error("The saved anatomy is missing an atrial conduction pathway.");
    }
    for (const [id, focus] of Object.entries(atrialFoci)) {
      if (id !== "sinus") addFocusRoute(parent, id, focus, atrialPaths);
    }
    sinusDots = addNodeDots(parent, 0.347, 0.414, "SA node firing");
    avDots = addNodeDots(parent, 0.451, 0.53, "AV nodal transit");
    escapeDots = addNodeDots(parent, 0.478, 0.577, "Independent junctional/His escape focus");
    for (const [id, focus] of Object.entries(atrialFoci)) addFocusMarker(parent, id, focus);
    blockMarkers = ["rbbb", "lbbb"].map(bundle => {
      const item = anatomyItems.find(candidate => candidate.name === (bundle === "rbbb" ? "Right Bundle" : "Left Bundle"));
      const p = item.path.getPointAtLength(item.path.getTotalLength() * 0.14);
      return { bundle, node: addBlock(parent, p.x, p.y, `${bundle.toUpperCase()}: no antegrade conduction`) };
    });
    blockMarkers.push({ bundle: "av", node: addBlock(parent, 372, 305, "Atrial impulse fails to conduct") });
    blockMarkers.push({ bundle: "his", node: addBlock(parent, 398, 335, "His-Purkinje conduction fails") });
    avDelayMarker = addBlock(parent, 372, 305, "Delayed AV nodal conduction", true);
  }

  function nodeOpacity(group, amount) {
    const display = amount > 0 ? "" : "none";
    if (group.style.display !== display) group.style.display = display;
    setAttribute(group, "opacity", amount);
  }

  function setAttribute(node, name, value) {
    const text = String(value);
    if (node.getAttribute(name) !== text) node.setAttribute(name, text);
  }

  function drawAnatomy() {
    const now = simulation.now;
    const atrial = simulation.atria[simulation.atria.length - 1];
    const aTime = atrial ? now - atrial.time : Infinity;
    const ventricular = simulation.ventricles[simulation.ventricles.length - 1];
    const vTime = ventricular ? now - ventricular.time : Infinity;
    const latestBlock = simulation.events.findLast(event => event.type === "block");
    const sinus = settings.rhythm === "flutter" ?
      simulation.events.findLast(event => event.type === "sinus-firing") : atrial;
    const sinusTime = sinus ? now - sinus.time : Infinity;
    for (const item of anatomyItems) {
      if (item.type === "path") {
        const bundle = item.name === "Right Bundle" ? "rbbb" : item.name === "Left Bundle" ? "lbbb" : null;
        const beat = bundle ? ventricular : settings.rhythm === "flutter" ? sinus : atrial;
        const duration = bundle ? Math.min(90, simulation.timing.qrsMs) :
          beat?.pWave?.duration || simulation.morphology.waves[0].duration;
        const blocked = bundle && settings.bundle === bundle;
        const ectopic = !bundle && beat?.focus && beat.focus !== "sinus";
        pulsePath(item.impulse, blocked || !beat || ectopic ? null : beat.time, duration, !!beat?.retrograde);
      } else {
        const chamber = item.name.includes("Atrium") ? "atria" :
          item.name === "Right Ventricle" ? "rv" : item.name === "Left Ventricle" ? "lv" : null;
        if (chamber) setAttribute(item.path, "fill-opacity", simulation.chamberOpacity(now, chamber) * 2);
      }
    }
    const sinusDriven = ["sinus", "wpw", "flutter"].includes(settings.rhythm) ||
      (settings.rhythm === "pac" && atrial?.origin !== "PAC");
    nodeOpacity(sinusDots, sinusDriven && sinus && !sinus.retrograde && sinusTime < 55 ? 1 - sinusTime / 55 : 0);
    const focusPattern = atrialFocusPatterns[settings.rhythm];
    for (const [id, route] of focusRoutes) {
      const current = focusPattern && atrial?.focus === id;
      route.group.style.display = current ? "" : "none";
      pulsePath(route.impulse, current ? atrial.time : null, 80);
    }
    for (const [id, marker] of focusMarkers) {
      const visible = focusPattern?.sequence.includes(id);
      const current = visible && atrial?.focus === id;
      const activating = current && aTime >= 0 && aTime < atrial.pWave.duration;
      const progress = activating ? aTime / atrial.pWave.duration : 0;
      marker.group.style.display = visible ? "" : "none";
      setAttribute(marker.group, "opacity", current ? 1 : 0.6);
      setAttribute(marker.group, "data-current", String(!!current));
      setAttribute(marker.group, "data-activating", String(!!activating));
      setAttribute(marker.circle, "r", activating ? 9 : 6);
      setAttribute(marker.circle, "fill", activating ? "#ffea54" : current ? "#fff2bd" : "white");
      setAttribute(marker.ring, "r", 11 + 16 * progress);
      setAttribute(marker.ring, "opacity", activating ? 1 - progress : 0);
    }
    const focusReadout = $("#atrial-focus-readout");
    focusReadout.hidden = !focusPattern || !atrial?.focus;
    if (!focusReadout.hidden) {
      const focus = atrialFoci[atrial.focus];
      focusReadout.textContent = `Focus: ${focus.label}`;
    }
    const avAtrial = simulation.atria.findLast(beat => {
      const age = now - beat.time;
      const end = beat.pr === null ? 110 : beat.pr - 35;
      return !beat.retrograde && !(settings.rhythm === "wpw" && simulation.settings.av === "third") &&
        age >= 80 && age <= end &&
        !simulation.events.some(event => event.type === "block" && event.site === "av" && event.beat === beat);
    });
    const tachy = rhythms[settings.rhythm].avReentry ?
      simulation.events.findLast(event => event.type === "tachy") : null;
    const reentryAtAv = tachy && now - tachy.time < 55;
    const retrogradeAtAv = settings.rhythm !== "avrt" && atrial?.retrograde && aTime >= 0 && aTime <= 55;
    const delayedAtAv = avAtrial?.conducted &&
      (simulation.settings.av === "first" || (simulation.settings.av === "mobitz1" && avAtrial.pr > settings.wenckebachPr)) &&
      settings.rhythm !== "wpw";
    const delayDisplay = delayedAtAv ? "" : "none";
    if (avDelayMarker.style.display !== delayDisplay) avDelayMarker.style.display = delayDisplay;
    nodeOpacity(avDots, reentryAtAv || retrogradeAtAv || avAtrial ? 1 : 0);
    const escapeFocus = simulation.events.findLast(event => event.type === "escape" ||
      (event.type === "tachy" && rhythms[settings.rhythm].junctional));
    const escapeAge = escapeFocus ? now - escapeFocus.time : Infinity;
    nodeOpacity(escapeDots, escapeAge < 80 ? 1 - escapeAge / 80 : 0);
    const crossVisible = settings.bundle !== "none" && vTime >= 35 && vTime <= 105;
    const crossDisplay = crossVisible ? "" : "none";
    if (crossPath.path.style.display !== crossDisplay) crossPath.path.style.display = crossDisplay;
    pulsePath(crossPath, crossVisible ? ventricular.time + 35 : null, 70, settings.bundle === "lbbb");
    for (const marker of blockMarkers.filter(item => item.bundle === "av" || item.bundle === "his")) {
      const conductedDuringBlock = marker.bundle === "av" && latestBlock && simulation.atria.some(beat =>
        (beat.conducted || beat.blockSite === "his") && !beat.retrograde && beat.time + 80 <= now &&
        beat.time + beat.pr - 35 >= latestBlock.time);
      const visible = (simulation.settings.av === "third" && marker.bundle === "av") ||
        (latestBlock && latestBlock.site === marker.bundle && !conductedDuringBlock &&
          now - latestBlock.time < (marker.bundle === "av" ? AV_BLOCK_MARKER_MS : 350));
      const display = visible ? "" : "none";
      if (marker.node.style.display !== display) marker.node.style.display = display;
    }
  }

  function setReadout(id, value) {
    if (readouts[id].textContent !== value) readouts[id].textContent = value;
  }

  function drawReadouts(force = false) {
    const now = timelineTime();
    if (!force && now - lastReadout < 100) return;
    lastReadout = now;
    const s = simulation.settings;
    function measuredRate(beats, fallback) {
      if (beats.length < 2) return fallback;
      const recent = beats.slice(-6);
      const duration = recent.at(-1).time - recent[0].time;
      return duration > 0 ? 60000 * (recent.length - 1) / duration : fallback;
    }
    const fallbackVRate = s.av === "third" && !rhythms[s.rhythm].junctional ? s.escapeRate :
      s.rhythm === "flutter" ? s.atrialRate / 2 : s.atrialRate;
    const ventricularRate = measuredRate(simulation.ventricles, fallbackVRate);
    const atrialRate = s.rhythm === "afib" ? "Fib" :
      (rhythms[s.rhythm].avReentry || rhythms[s.rhythm].junctional) ? "retrograde" :
      Math.round(measuredRate(simulation.atria.filter(beat => !beat.retrograde), s.atrialRate));
    const meanRate = ["mobitz1", "mobitz2"].includes(s.av) ||
      ["wandering", "pac", "afib", "multifocal_atrial_tachy"].includes(s.rhythm);
    setReadout("readout", `A ${atrialRate} · V ${Math.round(ventricularRate)} bpm${meanRate ? " (mean)" : ""}`);
    const lastAtrial = simulation.atria[simulation.atria.length - 1];
    setReadout("pr-readout", s.rhythm === "afib" ? "No P waves" :
      (rhythms[s.rhythm].avReentry || rhythms[s.rhythm].junctional) ? "Retrograde" :
      s.av === "third" && s.rhythm !== "wpw" ? "Dissociated" :
      lastAtrial && !lastAtrial.conducted ? "Blocked" : `${lastAtrial.pr} ms`);
    const latestVentricular = simulation.ventricles.at(-1);
    setReadout("qrs-readout", `${latestVentricular?.qrsMs || simulation.timing.qrsMs} ms`);
    setReadout("time-readout", `${(simulation.now / 1000).toFixed(2)} s`);
  }

  function draw(force = false) {
    updateEcg(force);
    drawAnatomy();
    drawReadouts(force);
  }

  function tick(now) {
    frame = 0;
    advanceClock(now);
    draw();
    scheduleFrame();
  }

  function editorControl(index, key, label, min, max, step) {
    const item = currentMorphology().waves[index];
    const control = document.createElement("label");
    control.className = "wave-control";
    const span = document.createElement("span");
    span.textContent = label;
    control.append(span);
    for (const type of ["range", "number"]) {
      const input = document.createElement("input");
      Object.assign(input, { type, min, max, step, value: item[key] });
      input.required = type === "number";
      input.dataset.index = index;
      input.dataset.key = key;
      control.append(input);
    }
    return control;
  }

  function syncEditor() {
    const morphology = currentMorphology();
    const timing = morphologyTiming(morphology);
    $("#waveform-name").value = morphology.name;
    $("#qt-interval").min = timing.tStart + 10;
    $("#qt-interval").max = timing.tStart + 400;
    $("#qt-interval").value = timing.qtMs;
    for (const segment of ["pr", "st"]) {
      const value = morphology.segments?.[segment] || 0;
      $(`#${segment}-offset`).value = value;
      $(`#${segment}-offset-value`).textContent = value.toFixed(2);
    }
  }

  function buildEditor() {
    const custom = activeId !== "automatic";
    $("#waveform-fields").disabled = !custom;
    $("#save-waveform").disabled = !custom;
    $("#delete-waveform").disabled = !custom;
    $("#wave-editor").replaceChildren(...currentMorphology().waves.map((item, index, waves) => {
      const card = document.createElement("article");
      card.className = "wave-card";
      card.style.setProperty("--wave-color", templates.none.waves.find(w => w.id === item.id)?.color || "#00805d");
      const heading = document.createElement("h3");
      heading.textContent = templates.rbbb.waves.find(w => w.id === item.id).label;
      card.append(heading,
        editorControl(index, "amplitude", "Amplitude (mV)", -2, 2, 0.01),
        editorControl(index, "topRadius", "Top radius", 1, 50, 1),
        editorControl(index, "orientation", "Peak position", 0.15, 0.85, 0.01),
        editorControl(index, "duration", "Duration (ms)", 10, 400, 1));
      if (index > 0 && index < waves.length - 1) {
        card.append(editorControl(index, "gap", "Interval after (ms)", 0, 600, 1));
      }
      return card;
    }));
    syncEditor();
  }

  function bindControls() {
    const bindings = [
      ["av-pattern", "av"], ["bundle-pattern", "bundle"], ["heart-rate", "atrialRate"],
      ["pr-interval", "pr"], ["wenckebach-pr", "wenckebachPr"], ["pr-step", "prStep"],
      ["conducted-beats", "conductedBeats"], ["escape-rate", "escapeRate"]
    ];
    for (const [id, key] of bindings) {
      $(`#${id}`).addEventListener("change", event => {
        const input = event.target;
        const value = key === "av" || key === "bundle" ? input.value : Number(input.value);
        const previous = settings[key];
        try {
          if (!input.checkValidity() || input.value === "") throw new Error(`Please enter a valid ${input.closest("label").firstChild.textContent.trim()}.`);
          new Simulation(scenarioSettings({ [key]: value }), activeId === "automatic" ? undefined : currentMorphology());
          settings[key] = value;
          restart();
          if (activeId === "automatic") buildEditor();
        } catch (error) {
          input.value = previous;
          reportError(error);
        }
      });
    }
    $("#rhythm-pattern").addEventListener("change", event => {
      const input = event.target;
      const previousRhythm = settings.rhythm;
      const previousRate = settings.atrialRate;
      const rhythm = input.value;
      const atrialRate = rhythms[rhythm]?.defaultRate;
      try {
        if (!Number.isFinite(atrialRate)) throw new Error("Please choose a valid rhythm.");
        new Simulation(scenarioSettings({ rhythm, atrialRate }), activeId === "automatic" ? undefined : currentMorphology());
        settings.rhythm = rhythm;
        settings.atrialRate = atrialRate;
        restart();
      } catch (error) {
        input.value = previousRhythm;
        settings.atrialRate = previousRate;
        reportError(error);
      }
    });
    $("#pause-button").onclick = () => setPaused(!paused);
    $("#speed").oninput = event => {
      advanceClock();
      speed = Number(event.target.value);
      anchorClock();
      for (const [animation, start] of animations) alignAnimation(animation, start);
      $("#speed-value").textContent = `${speed.toFixed(1)}x`;
    };
    document.addEventListener("visibilitychange", () => {
      if (!simulation) { suspended = document.hidden; return; }
      advanceClock();
      suspended = document.hidden;
      anchorClock();
      draw();
      for (const [animation, start] of animations) alignAnimation(animation, start);
      if (suspended) { cancelAnimationFrame(frame); frame = 0; }
      else scheduleFrame();
    });
    function showAuthoring(show) {
      $("#developer-panel").hidden = !show;
      $("#developer-toggle").setAttribute("aria-expanded", String(show));
      if (show) {
        $("#developer-close").focus();
        $("#developer-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      } else $("#developer-toggle").focus();
    }
    $("#developer-toggle").onclick = () => showAuthoring($("#developer-panel").hidden);
    $("#developer-close").onclick = () => showAuthoring(false);
    $("#waveform-select").onchange = event => {
      activeId = event.target.value;
      buildEditor();
      restart();
    };
    $("#duplicate-waveform").onclick = () => {
      const item = clone(currentMorphology());
      item.id = uid();
      item.name = `${item.name.slice(0, 70)} copy`;
      library.push(item);
      activeId = item.id;
      populateLibrary();
      buildEditor();
      restart();
    };
    $("#wave-editor").addEventListener("input", event => {
      const input = event.target;
      if (activeId === "automatic" || !input.dataset.key) return;
      if (!input.checkValidity() || input.value === "") {
        input.reportValidity();
        return;
      }
      const item = currentMorphology().waves[Number(input.dataset.index)];
      item[input.dataset.key] = Number(input.value);
      $("#wave-editor").querySelectorAll(`[data-index="${input.dataset.index}"][data-key="${input.dataset.key}"]`)
        .forEach(other => { other.value = input.value; });
      syncEditor();
      restart();
    });
    $("#waveform-name").onchange = event => {
      const name = event.target.value.trim();
      if (!name) {
        reportError(new Error("Waveform name cannot be empty."));
        syncEditor();
        return;
      }
      currentMorphology().name = name;
      populateLibrary();
    };
    $("#qt-interval").onchange = event => {
      const input = event.target;
      const morphology = currentMorphology();
      const t = morphology.waves[morphology.waves.length - 1];
      const duration = Number(input.value) - morphologyTiming(morphology).tStart;
      if (!input.checkValidity() || input.value === "" || duration < 10 || duration > 400) {
        reportError(new Error("That QT cannot be reached with the current QRS/ST settings. T duration must remain between 10 and 400 ms."));
        syncEditor();
        return;
      }
      t.duration = duration;
      buildEditor();
      restart();
    };
    for (const segment of ["pr", "st"]) {
      $(`#${segment}-offset`).oninput = event => {
        const morphology = currentMorphology();
        morphology.segments = { ...morphology.segments, [segment]: Number(event.target.value) };
        syncEditor();
        restart();
      };
    }
    $("#save-waveform").onclick = () => saveLibrary("Waveform library saved in this browser.");
    $("#delete-waveform").onclick = () => {
      const remaining = library.filter(item => item.id !== activeId);
      const previous = library;
      library = remaining;
      if (!saveLibrary("Waveform deleted.")) { library = previous; return; }
      activeId = "automatic";
      populateLibrary();
      buildEditor();
      restart();
    };
    $("#export-waveforms").onclick = () => {
      const blob = new Blob([JSON.stringify(library, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = "ecg-waveforms.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $("#authoring-status").textContent = `Exported ${library.length} custom waveform(s).`;
    };
    $("#import-waveforms").onchange = async event => {
      const [file] = event.target.files;
      if (!file) return;
      try {
        const imported = normalizeLibrary(JSON.parse(await file.text()));
        if (!confirm("Replace the custom waveform library with this file? Export first to keep your current library.")) return;
        const previous = library;
        library = imported;
        if (!saveLibrary(`Imported ${library.length} custom waveform(s).`)) { library = previous; return; }
        activeId = "automatic";
        populateLibrary();
        buildEditor();
        restart();
      } catch (error) {
        reportError(new Error(`Could not import waveform library: ${error.message}`));
      } finally {
        event.target.value = "";
      }
    };
  }

  async function initialize() {
    if (!CSS.supports("offset-path", 'path("M 0 0 L 1 1")')) throw new Error("This browser does not support animated conduction paths.");
    try {
      const stored = localStorage.getItem(KEY);
      if (stored !== null) library = normalizeLibrary(JSON.parse(stored));
    } catch (error) {
      reportError(new Error(`Saved waveform library could not be loaded; the stored data has not been changed. ${error.message}`));
    }
    const response = await fetch("sketch-data.json");
    if (!response.ok) throw new Error(`Could not load anatomy data (HTTP ${response.status}).`);
    const data = await response.json();
    const items = JSON.parse(data["ecg.conductionItems.v1"]);
    if (!Array.isArray(items)) throw new Error("The anatomy data must contain an array of conduction items.");
    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not load CCS.png."));
      image.src = "CCS.png";
    });
    buildAnatomy(items);
    populateLibrary();
    buildEditor();
    bindControls();
    new ResizeObserver(resize).observe(plot);
    window.addEventListener("resize", resize);
    resize();
    restart();
    $("#pause-button").disabled = false;
    setPaused(false);
  }

  initialize().catch(error => {
    reportError(new Error(`Could not start Conduction Lab: ${error.message} Serve this folder over HTTP (see README) rather than opening it as a file.`));
    $("#monitor-status").textContent = "ERROR";
  });
})();
