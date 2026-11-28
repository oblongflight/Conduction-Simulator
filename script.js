"use strict";

(() => {
  const { Simulation, templates, rhythms, defaults, atrialFoci, atrialFocusPatterns, morphologyTiming, validateMorphology, clone } = window.Conduction;
  const { EcgStrip } = window;
  const { AutomaticityIllustration } = window;
  const TILE_MS = EcgStrip.tileMs;
  const ECG_LOOKAHEAD_MS = 2000;
  const AV_BLOCK_MARKER_MS = 100;
  const MOBITZ_MARKER_LEAD_MS = 30;
  const KEY = "ecg-lecture-lab.waveforms.v1";
  const ARROW_SPACING = 7;
  const ARROW_TRAIL = 96;
  const LEFT_ACCESSORY_PATH = "M 505 312 C 499 292 495 276 484 251";
  const FIBRILLATION_PATHWAY_PERIOD = 1400;
  const FIBRILLATION_PATHWAY_STARTS = [0, 150, 360, 540, 790, 960, 1180];
  const FIBRILLATION_PATHWAY_DURATION = 90;
  const VENTRICULAR_FOCI = { lv: [0.637, 0.674], rv: [0.498, 0.789] };
  const REENTRY_CIRCUITS = [{
    rhythm: "atrial_tachy",
    label: "Focal atrial tachycardia: schematic local reentry circuit",
    dotLimit: 4,
    arrowScale: 0.5,
    path: "M 466 245 A 16 16 0 1 1 434 245 A 16 16 0 1 1 466 245 Z"
  }, {
    rhythm: "flutter",
    label: "Atrial flutter reentry circuit",
    path: "M 322.91 298.24 C 331.12 305.63 321.30 329.92 300.97 352.50 C 280.64 375.07 257.52 387.37 249.31 379.98 C 241.10 372.60 250.92 348.30 271.25 325.73 C 291.58 303.16 314.71 290.85 322.91 298.24 Z"
  }, {
    rhythm: "avnrt",
    label: "AVNRT: schematic slow and fast AV nodal pathways",
    dotLimit: 4,
    arrowScale: 0.3,
    path: "M 371 291 C 367 291 365 294 366 299 C 366 303 368 306 371 306 L 373 304 L 371 302 L 374 300 L 372 298 L 375 296 L 373 294 L 375 292 C 374 291 373 291 371 291 Z"
  }, {
    rhythm: "avrt",
    label: "Orthodromic AVRT: schematic left-sided accessory pathway",
    path: LEFT_ACCESSORY_PATH,
    accessoryPath: true
  }];
  let viewWindow = window;
  let presenterWindow = null;
  let viewportObserver;
  const $ = selector => document.querySelector(selector) || viewWindow.document.querySelector(selector);
  const presentation = $(".teaching-grid");
  const presentationHome = presentation.parentNode;
  const presentationNext = presentation.nextSibling;
  const canvas = $("#ecg-canvas");
  const ctx = canvas.getContext("2d");
  const plot = $("#ecg-plot");
  const waveform = $("#ecg-waveform");
  const trace = $("#ecg-trace");
  const readouts = Object.fromEntries(["readout", "pr-readout", "qrs-readout", "time-readout"].map(id => [id, $(`#${id}`)]));
  const settings = { ...defaults };
  let simulation;
  let ecgStrip;
  let ecgOffset = 0;
  const pendingScenarios = [];
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
  let prefetchVersion = 0;
  let ecgViewport;
  let activeId = "automatic";
  let library = [];
  let anatomyItems = [];
  let blockMarkers = [];
  let avDelayMarker;
  let crossPath;
  let wpwAccessory;
  let wpwDepolarization;
  let sinusDots;
  let avDots;
  let junctionalMarker;
  let ventricularFocusMarker;
  const sourceHighlights = new Map();
  const focusMarkers = new Map();
  const automaticityCells = [];
  let automaticityLayer;
  let automaticityModel;
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
    if (!rhythms[scenario.rhythm]?.wpw) scenario.wpw = false;
    if (rhythms[scenario.rhythm]?.avReentry || rhythms[scenario.rhythm]?.independentVentricular ||
        ["afib", "flutter"].includes(scenario.rhythm)) scenario.av = "normal";
    return scenario;
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
    const selected = pendingScenarios.at(-1)?.model || simulation;
    const av = selected.settings.av;
    $("#rhythm-pattern").value = settings.rhythm;
    $("#rate-label").textContent = rhythm.rateLabel;
    $("#heart-rate").min = rhythm.minRate;
    $("#heart-rate").max = rhythm.maxRate;
    $("#heart-rate").value = settings.atrialRate;
    $("#pvc-focus").value = settings.pvcFocus;
    $("#pvc-focus-field").hidden = settings.rhythm !== "pvc";
    const usesRefractoriness = ["afib", "flutter"].includes(settings.rhythm);
    $("#rate-field").hidden = ["afib", "vfib"].includes(settings.rhythm);
    $("#av-field").hidden = usesRefractoriness || !!rhythm.independentVentricular;
    $("#refractory-field").hidden = !usesRefractoriness;
    $("#av-refractory").value = settings.avRefractory;
    $("#av-refractory").disabled = selected.settings.wpw && settings.rhythm === "afib";
    $("#refractory-value").textContent = `${settings.avRefractory} ms`;
    $("#refractory-note").textContent = selected.settings.wpw ?
      settings.rhythm === "flutter" ?
        "Adjust AV nodal conduction; the accessory pathway still conducts every flutter beat." :
        "WPW bypasses the AV node; this setting does not affect the rhythm." :
      "Longer refractory periods reduce AV nodal conduction.";
    $("#wpw-field").hidden = !rhythm.wpw;
    $("#wpw-enabled").checked = settings.wpw;
    $("#wpw-note").textContent = settings.rhythm === "avrt" ?
      "AVRT remains orthodromic: the accessory pathway conducts retrogradely, without a delta wave." :
      settings.rhythm === "afib" && settings.wpw ?
        "AF with WPW is illustrated as immediate ventricular fibrillation." :
        "The pathway bypasses the selected AV block when conducting antegradely.";
    $("#av-pattern").value = av;
    $("#av-pattern").disabled = !!rhythm.avReentry;
    $("#av-reentry-note").hidden = !rhythm.avReentry && !rhythm.independentVentricular;
    $("#junctional-av-note").hidden = !rhythm.junctional || av === "normal";
    const bypassesAv = selected.preexcitation || selected.ventricularFibrillation;
    $("#pr-field").hidden = bypassesAv || av !== "first";
    $("#wenckebach-field").hidden = bypassesAv || av !== "mobitz1";
    $("#pr-step-field").hidden = bypassesAv || av !== "mobitz1";
    $("#ratio-field").hidden = bypassesAv || !["mobitz1", "mobitz2"].includes(av);
    $("#escape-field").hidden = bypassesAv || av !== "third";
    $("#custom-warning").hidden = activeId === "automatic";
    blockMarkers.forEach(marker => {
      marker.node.style.display = marker.bundle === simulation.settings.bundle ? "" : "none";
    });
    for (const item of anatomyItems.filter(item => item.type === "path")) {
      const bundle = item.name === "Right Bundle" ? "rbbb" : item.name === "Left Bundle" ? "lbbb" : null;
      item.path.setAttribute("stroke", bundle && simulation.settings.bundle === bundle ? "#b42318" : "#a18a20");
    }
  }

  function timelineTime() {
    return viewWindow.document.timeline.currentTime ?? viewWindow.performance.now();
  }

  function advanceClock(now = timelineTime()) {
    if (paused || suspended) return;
    const target = clockSimulation + Math.max(0, now - clockTime) * speed;
    let changed = false;
    while (pendingScenarios.length && pendingScenarios[0].start <= target) {
      const next = pendingScenarios.shift();
      simulation.advanceTo(next.start - ecgOffset);
      simulation = next.model;
      ecgOffset = next.start;
      changed = true;
    }
    simulation.advanceTo(target - ecgOffset);
    if (changed) {
      const tiles = new Set([...ecgTiles.values()].map(tile => tile.animation));
      for (const animation of animations.keys()) {
        if (!tiles.has(animation)) cancelAnimation(animation);
      }
      for (const impulse of impulses) { impulse.key = null; impulse.animations = []; }
      startReentryCircuits();
      updateScenario();
      updatePlaybackStatus();
    }
  }

  function anchorClock() {
    clockTime = timelineTime();
    clockSimulation = ecgOffset + simulation.now;
  }

  function alignAnimation(animation, start) {
    animation.pause();
    animation.playbackRate = speed;
    animation.currentTime = ecgOffset + simulation.now - start;
    if (!paused && !suspended && ecgOffset + simulation.now - start < animation.effect.getComputedTiming().endTime) {
      animation.play();
      animation.startTime = clockTime + (start - clockSimulation) / speed;
    }
  }

  function registerAnimation(element, keyframes, timing, start, global = false) {
    const animation = element.animate(keyframes, timing);
    const recordingStart = global ? start : ecgOffset + start;
    animations.set(animation, recordingStart);
    alignAnimation(animation, recordingStart);
    return animation;
  }

  function cancelAnimation(animation) {
    if (!animation) return;
    animation.cancel();
    animations.delete(animation);
  }

  function scheduleFrame() {
    if (!frame && !paused && !suspended) frame = viewWindow.requestAnimationFrame(tick);
  }

  function cancelFrame() {
    viewWindow.cancelAnimationFrame(frame);
    frame = 0;
  }

  function updateVisibility() {
    if (!simulation) { suspended = viewWindow.document.hidden; return; }
    advanceClock();
    suspended = viewWindow.document.hidden;
    anchorClock();
    draw();
    for (const [animation, start] of animations) alignAnimation(animation, start);
    if (suspended) cancelFrame();
    else scheduleFrame();
  }

  function observeViewport() {
    viewportObserver?.disconnect();
    viewportObserver = new viewWindow.ResizeObserver(resize);
    viewportObserver.observe(plot);
  }

  function movePresentation(destination, parent, before = null) {
    advanceClock();
    cancelFrame();
    prefetchPending = false;
    prefetchVersion++;
    clearEcgTiles();
    for (const animation of animations.keys()) animation.cancel();
    animations.clear();
    for (const impulse of impulses) { impulse.key = null; impulse.animations = []; }
    viewportObserver?.disconnect();
    parent.insertBefore(presentation, before);
    viewWindow = destination;
    suspended = destination.document.hidden;
    anchorClock();
    startReentryCircuits();
    observeViewport();
    resize();
    draw(true);
    scheduleFrame();
  }

  function restorePresentation() {
    if (viewWindow !== window) movePresentation(window, presentationHome, presentationNext);
    presenterWindow = null;
    $("#presenter-mode").disabled = false;
    $("#presenter-mode").setAttribute("aria-pressed", "false");
    $("#presenter-mode").textContent = "Presenter mode";
    $("#presenter-status").textContent = "Presenter window closed. Diagram and ECG are back here.";
  }

  function openPresenter() {
    if (presenterWindow && !presenterWindow.closed) {
      presenterWindow.focus();
      return;
    }
    const popup = window.open("about:blank", "_blank", "popup,width=1280,height=800");
    if (!popup) {
      reportError(new Error("Presenter window was blocked. Allow pop-ups for this site and try Presenter mode again."));
      return;
    }
    presenterWindow = popup;
    $("#presenter-mode").disabled = true;
    $("#presenter-status").textContent = "Opening presenter window...";
    popup.addEventListener("pagehide", () => {
      if (presenterWindow === popup) restorePresentation();
    }, { once: true });
    popup.document.addEventListener("visibilitychange", updateVisibility);
    popup.addEventListener("resize", resize);
    popup.document.title = "Conduction Lab - Presenter";
    const base = popup.document.createElement("base");
    base.href = document.baseURI;
    const stylesheet = popup.document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("style.css?v=1", document.baseURI).href;
    const shell = popup.document.createElement("main");
    shell.className = "presenter-shell";
    popup.document.body.append(shell);
    stylesheet.onload = () => {
      if (presenterWindow !== popup || popup.closed) return;
      try {
        movePresentation(popup, shell);
        $("#presenter-mode").disabled = false;
        $("#presenter-mode").setAttribute("aria-pressed", "true");
        $("#presenter-mode").textContent = "Focus presenter window";
        $("#presenter-status").textContent = "Controls stay here. Close the presenter window to bring the diagram and ECG back.";
        popup.focus();
      } catch (error) {
        restorePresentation();
        popup.close();
        reportError(new Error(`Could not open presenter mode: ${error.message}`));
      }
    };
    stylesheet.onerror = () => {
      if (presenterWindow !== popup || popup.closed) return;
      restorePresentation();
      popup.close();
      reportError(new Error("Could not load presenter window styles."));
    };
    popup.document.head.append(base, stylesheet);
  }

  function restart() {
    prefetchPending = false;
    prefetchVersion++;
    clearEcgTiles();
    for (const animation of animations.keys()) animation.cancel();
    animations.clear();
    for (const impulse of impulses) { impulse.key = null; impulse.animations = []; }
    const scenario = scenarioSettings({ randomSeed: Math.floor(Math.random() * 4294967296) });
    simulation = new Simulation(scenario, currentMorphology());
    ecgStrip = new EcgStrip(new Simulation(scenario, currentMorphology()));
    ecgOffset = 0;
    pendingScenarios.length = 0;
    anchorClock();
    updateScenario();
    updatePlaybackStatus();
    startReentryCircuits();
    draw(true);
    scheduleFrame();
  }

  function queueScenarioChange() {
    advanceClock();
    const padding = Math.ceil(4 * ecgStrip.geometry.ratio) * TILE_MS / ecgStrip.geometry.tileWidth;
    const start = Math.max(ecgOffset + simulation.now + ecgStrip.halfWindowMs + padding,
      pendingScenarios.at(-1)?.start ?? 0);
    const scenario = scenarioSettings({ randomSeed: Math.floor(Math.random() * 4294967296) });
    const model = new Simulation(scenario, currentMorphology());
    ecgStrip.append(new Simulation(scenario, currentMorphology()), start);
    if (pendingScenarios.at(-1)?.start === start) pendingScenarios.pop();
    pendingScenarios.push({ start, model });
    const previousTiles = new Map();
    for (const [index, tile] of ecgTiles) {
      if ((index + 1) * TILE_MS + padding >= start) {
        previousTiles.set(index, tile.image);
        removeEcgTile(index, tile);
      }
    }
    updateScenario();
    updatePlaybackStatus();
    syncEcgTiles(0, previousTiles, start - padding);
    draw(true);
    scheduleFrame();
  }

  function updatePlaybackStatus() {
    $("#monitor-status").textContent = `${paused ? "PAUSED" : "RUNNING"}${pendingScenarios.length ? " · CHANGE QUEUED" : ""}`;
  }

  function setPaused(value) {
    advanceClock();
    paused = value;
    $("#pause-button").textContent = paused ? "Resume" : "Pause";
    $("#pause-button").setAttribute("aria-pressed", String(paused));
    updatePlaybackStatus();
    anchorClock();
    draw();
    for (const [animation, start] of animations) alignAnimation(animation, start);
    drawReadouts(true);
    if (paused) { prefetchPending = false; prefetchVersion++; cancelFrame(); }
    else scheduleFrame();
  }

  function resize() {
    const bounds = plot.getBoundingClientRect();
    const ratio = Math.min(viewWindow.devicePixelRatio || 1, 2);
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

  function syncEcgTiles(lookahead, previousTiles = null, preserveUntil = 0) {
    const half = ecgStrip.halfWindowMs;
    const now = ecgOffset + simulation.now;
    const first = Math.max(0, Math.floor((now - half) / TILE_MS));
    const last = Math.floor((now + half + lookahead) / TILE_MS);
    for (const [index, tile] of ecgTiles) {
      if (index < first) removeEcgTile(index, tile);
    }
    const paddingMs = Math.ceil(4 * ecgStrip.geometry.ratio) * TILE_MS / ecgStrip.geometry.tileWidth;
    ecgStrip.discardBefore(Math.max(0, first * TILE_MS - paddingMs));
    for (let index = first; index <= last; index++) {
      if (ecgTiles.has(index)) continue;
      const image = ecgStrip.renderTile(index);
      const previous = previousTiles?.get(index);
      if (previous) {
        // Preserve visible pixels: extending a canvas path can change its rasterization.
        const width = Math.max(0, Math.min(image.width,
          Math.floor((preserveUntil - index * TILE_MS) * image.width / TILE_MS)));
        if (width) {
          const context = image.getContext("2d");
          context.clearRect(0, 0, width, image.height);
          context.drawImage(previous, 0, 0, width, image.height, 0, 0, width, image.height);
        }
      }
      image.dataset.ecgTile = index;
      image.style.width = `${ecgStrip.tileWidth}px`;
      image.style.height = `${image.height / ecgStrip.geometry.ratio}px`;
      trace.append(image);
      // Each tile crosses the same clipped viewport on the common playback clock.
      const animation = registerAnimation(image, [
        { transform: `translate3d(${ecgViewport.right - ecgViewport.left}px, 0, 0)` },
        { transform: `translate3d(${-ecgStrip.tileWidth}px, 0, 0)` }
      ], { duration: TILE_MS + 2 * half, fill: "both" }, index * TILE_MS - half, true);
      ecgTiles.set(index, { image, animation });
    }
  }

  function updateEcg(force) {
    if (force && ecgStrip.configure(ecgViewport, ctx.getTransform().a)) clearEcgTiles();
    syncEcgTiles(0);
    const next = Math.floor((ecgOffset + simulation.now + ecgStrip.halfWindowMs + ECG_LOOKAHEAD_MS) / TILE_MS);
    if (paused || suspended || prefetchPending || ecgTiles.has(next)) return;
    prefetchPending = true;
    const version = ++prefetchVersion;
    const prefetch = () => {
      if (version !== prefetchVersion) return;
      prefetchPending = false;
      if (!paused && !suspended) syncEcgTiles(ECG_LOOKAHEAD_MS);
    };
    if (viewWindow.requestIdleCallback) viewWindow.requestIdleCallback(prefetch);
    else viewWindow.setTimeout(prefetch, 0);
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
      const trailing = index * ARROW_SPACING / impulse.length;
      const opacity = 1 - index * 0.023;
      dot.style.offsetRotate = reverse ? "auto 180deg" : "auto";
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

  function addImpulse(parent, path, label, dotLimit = 24, arrowScale = 1) {
    const length = path.getTotalLength();
    const group = svgElement("g", { class: "impulse-dots", "data-path": label });
    const count = Math.min(Math.ceil(ARROW_TRAIL * dotLimit / 24 / ARROW_SPACING), Math.ceil(length / ARROW_SPACING));
    const dots = Array.from({ length: count }, (_, index) => {
      const scale = (index === 0 ? 2 : 1) * arrowScale;
      const halfLength = 11.5 * scale / 2;
      const halfWidth = 10 * scale / 2;
      const dot = svgElement("polygon", {
        points: `${-halfLength},${-halfWidth} ${halfLength},0 ${-halfLength},${halfWidth}`,
        fill: "#ffea54", stroke: "#8b5900", "stroke-width": 0.9, "stroke-linejoin": "round"
      });
      group.append(dot);
      dot.style.opacity = "0";
      dot.style.offsetPath = `path("${path.getAttribute("d")}")`;
      dot.style.offsetRotate = "auto";
      return dot;
    });
    parent.append(group);
    const impulse = { path, length, group, dots, key: null, animations: [] };
    impulses.push(impulse);
    return impulse;
  }

  function addAccessoryPath(parent, rhythm, pathData, label) {
    const path = svgElement("path", {
      d: pathData, fill: "none", stroke: "#007b56", "stroke-width": 3,
      "stroke-dasharray": "4 3", "data-accessory-path": rhythm
    });
    const title = svgElement("title");
    title.textContent = label;
    path.append(title);
    parent.append(path);
    return path;
  }

  function addReentryCircuit(parent, definition) {
    const group = svgElement("g", { "data-reentry-circuit": definition.rhythm });
    let path;
    if (definition.accessoryPath) {
      path = addAccessoryPath(group, definition.rhythm, definition.path, "Retrograde left-sided accessory pathway");
    } else {
      path = svgElement("path", {
        d: definition.path, fill: "none", stroke: "#a18a20", "stroke-width": 2, "stroke-opacity": 0.8
      });
      const title = svgElement("title");
      title.textContent = definition.label;
      path.append(title);
      group.append(path);
    }
    parent.append(group);
    reentryCircuits.push({ ...definition, group,
      impulse: addImpulse(group, path, definition.label, definition.dotLimit, definition.arrowScale) });
  }

  function startReentryCircuits() {
    const settings = simulation.settings;
    for (const circuit of reentryCircuits) {
      const active = circuit.rhythm === settings.rhythm;
      circuit.group.style.display = active ? "" : "none";
      if (!active || circuit.accessoryPath) continue;
      const duration = 60000 / settings.atrialRate;
      circuit.impulse.dots.forEach((dot, index) => {
        const trailing = index * ARROW_SPACING / circuit.impulse.length;
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

  function addFocusMarker(parent, id, focus, attribute = "data-atrial-focus") {
    const group = svgElement("g", {
      [attribute]: id, transform: `translate(${focus.x * 822} ${focus.y * 566})`
    });
    const title = svgElement("title");
    title.textContent = focus.label;
    const ring = svgElement("circle", { fill: "none", stroke: "#e07000", "stroke-width": 3 });
    const circle = svgElement("circle", { r: 6, stroke: "#8b5900", "stroke-width": 2 });
    group.append(title, ring, circle);
    parent.append(group);
    return { group, circle, ring };
  }

  function updateFocusMarker(marker, visible, current, age, duration) {
    const activating = current && age >= 0 && age < duration;
    const progress = activating ? age / duration : 0;
    marker.group.style.display = visible ? "" : "none";
    setAttribute(marker.group, "opacity", current ? 1 : 0.6);
    setAttribute(marker.group, "data-current", String(!!current));
    setAttribute(marker.group, "data-activating", String(!!activating));
    setAttribute(marker.circle, "r", activating ? 9 : 6);
    setAttribute(marker.circle, "fill", activating ? "#ffea54" : current ? "#fff2bd" : "white");
    setAttribute(marker.ring, "r", 11 + 16 * progress);
    setAttribute(marker.ring, "opacity", activating ? 1 - progress : 0);
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
    const highlights = svgElement("g", { "aria-hidden": "true", "pointer-events": "none" });
    parent.append(chamberLayer, highlights);
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
    const accessoryGroup = svgElement("g", { "data-wpw-accessory": "" });
    const accessoryPath = addAccessoryPath(accessoryGroup, "wpw", LEFT_ACCESSORY_PATH,
      "Antegrade left-sided accessory pathway");
    parent.append(accessoryGroup);
    wpwAccessory = { group: accessoryGroup, impulse: addImpulse(accessoryGroup, accessoryPath, "WPW accessory pathway") };
    const ventricle = anatomyItems.find(item => item.name === "Left Ventricle");
    const clip = svgElement("clipPath", { id: "wpw-left-ventricle-clip" });
    clip.append(svgElement("path", { d: ventricle.path.getAttribute("d") }));
    parent.append(clip);
    const insertion = accessoryPath.getPointAtLength(0);
    wpwDepolarization = svgElement("circle", {
      cx: insertion.x, cy: insertion.y, r: 8, fill: "#ff0000", "fill-opacity": 0,
      "clip-path": "url(#wpw-left-ventricle-clip)", "data-wpw-depolarization": ""
    });
    const depolarizationTitle = svgElement("title");
    depolarizationTitle.textContent = "Early left ventricular depolarization via accessory pathway";
    wpwDepolarization.append(depolarizationTitle);
    chamberLayer.append(wpwDepolarization);
    const atrialPaths = anatomyItems.filter(item => /^Atria[1-4]$/.test(item.name) && item.type === "path");
    if (!["Atria1", "Atria2", "Atria3", "Atria4"].every(name => atrialPaths.some(path => path.name === name))) {
      throw new Error("The saved anatomy is missing an atrial conduction pathway.");
    }
    sinusDots = addNodeDots(parent, 0.347, 0.414, "SA node firing");
    avDots = addNodeDots(parent, 0.451, 0.53, "AV nodal transit");
    junctionalMarker = addFocusMarker(parent, "junctional", {
      label: "AV nodal focus", x: 0.451, y: 0.53
    }, "data-junctional-focus");
    ventricularFocusMarker = addFocusMarker(parent, "ventricular", {
      label: "Ventricular ectopic focus", x: 0.61, y: 0.73
    }, "data-ventricular-focus");
    for (const [id, focus] of Object.entries(atrialFoci)) {
      focusMarkers.set(id, addFocusMarker(parent, id, focus));
    }
    blockMarkers = ["rbbb", "lbbb"].map(bundle => {
      const item = anatomyItems.find(candidate => candidate.name === (bundle === "rbbb" ? "Right Bundle" : "Left Bundle"));
      const p = item.path.getPointAtLength(item.path.getTotalLength() * 0.14);
      return { bundle, node: addBlock(parent, p.x, p.y, `${bundle.toUpperCase()}: no antegrade conduction`) };
    });
    blockMarkers.push({ bundle: "av", node: addBlock(parent, 372, 305, "Atrial impulse fails to conduct") });
    blockMarkers.push({ bundle: "his", node: addBlock(parent, 398, 335, "His-Purkinje conduction fails") });
    avDelayMarker = addBlock(parent, 372, 305, "Delayed AV nodal conduction", true);
    function addHighlight(id, node) {
      node.setAttribute("data-source-highlight", id);
      node.setAttribute("fill", "none");
      node.setAttribute("stroke", "#7625ab");
      node.setAttribute("stroke-width", 7);
      node.setAttribute("stroke-opacity", 0.8);
      node.setAttribute("stroke-linejoin", "round");
      node.style.display = "none";
      highlights.append(node);
      sourceHighlights.set(id, node);
    }
    for (const [id, name] of [["sinus", "SA Node"], ["junctional", "AV Node"]]) {
      const path = anatomyItems.find(item => item.name === name).path;
      addHighlight(id, svgElement("path", { d: path.getAttribute("d") }));
    }
    for (const [id, focus] of Object.entries(atrialFoci)) {
      if (id !== "sinus") addHighlight(id, svgElement("circle", { cx: focus.x * 822, cy: focus.y * 566, r: 13 }));
    }
    addHighlight("ventricular", svgElement("circle", { r: 13 }));
    for (const circuit of reentryCircuits) {
      addHighlight(circuit.rhythm, svgElement("path", { d: circuit.path }));
    }
    buildAutomaticityOverlay(parent);
  }

  function buildAutomaticityOverlay(parent) {
    automaticityLayer = svgElement("g", {
      "data-automaticity-layer": "", "aria-hidden": "true", "pointer-events": "none"
    });
    automaticityLayer.style.display = "none";
    parent.append(automaticityLayer);
    const sites = [
      ...Object.entries(atrialFoci).map(([id, focus]) => ({
        id, x: focus.x * 822, y: focus.y * 566, chamber: "atria",
        region: id === "left" ? "Left Atrium" : "Right Atrium"
      })),
      ...Object.entries(VENTRICULAR_FOCI).map(([id, [x, y]]) => ({
        id, x: x * 822, y: y * 566, chamber: id,
        region: id === "lv" ? "Left Ventricle" : "Right Ventricle"
      })),
      { id: "av", x: 0.451 * 822, y: 0.53 * 566, chamber: "av", region: "AV Node" }
    ];
    function addCell(x, y, chamber, region, site = "muscle") {
      const node = svgElement("text", {
        x, y, class: "automaticity-cell", "data-counter-chamber": chamber,
        "data-counter-region": region, "data-counter-site": site
      });
      node.textContent = "0";
      automaticityLayer.append(node);
      automaticityCells.push({ node, chamber, site,
        scale: site === "muscle" ? 0.8 + (automaticityCells.length % 5) * 0.1 : 1 });
    }
    for (const region of ["Right Atrium", "Left Atrium", "Right Ventricle", "Left Ventricle"]) {
      const path = anatomyItems.find(item => item.name === region).path;
      const bounds = path.getBBox();
      const localSites = sites.filter(site => site.region === region);
      for (let y = Math.ceil(bounds.y / 24) * 24; y < bounds.y + bounds.height; y += 24) {
        for (let x = Math.ceil(bounds.x / 24) * 24; x < bounds.x + bounds.width; x += 24) {
          if (![[x - 7, y - 11], [x + 7, y - 11], [x - 7, y + 11], [x + 7, y + 11]]
            .every(([px, py]) => path.isPointInFill(new DOMPoint(px, py)))) continue;
          if (sites.some(site => Math.hypot(site.x - x, site.y - y) <
            (site.id === "sinus" || site.id === "av" ? 28 : 18))) continue;
          const focus = localSites.find(site => Math.hypot(site.x - x, site.y - y) < 32);
          const chamber = region.includes("Atrium") ? "atria" : region === "Right Ventricle" ? "rv" : "lv";
          addCell(x, y, chamber, region, focus?.id);
        }
      }
    }
    for (const site of sites) {
      addCell(site.x, site.y, site.chamber, site.id === "sinus" ? "SA Node" : site.region, site.id);
    }
  }

  function drawAutomaticity() {
    const enabled = $("#show-automaticity").checked;
    const supported = AutomaticityIllustration.supports(simulation.settings.rhythm);
    const display = enabled && supported ? "" : "none";
    if (automaticityLayer.style.display !== display) automaticityLayer.style.display = display;
    const status = !enabled ? "Counters off." : !supported ? "Not available for this rhythm." :
      simulation.ventricularFibrillation ? "AF with WPW: schematic local fibrillation counters." :
      ["afib", "flutter"].includes(simulation.settings.rhythm) ?
        "Red AV digit: refractory. Blocked inputs do not reset it." :
        "Teaching illustration; follows local activations.";
    if ($("#automaticity-status").textContent !== status) $("#automaticity-status").textContent = status;
    if (!enabled || !supported) return;
    if (automaticityModel?.source !== simulation) automaticityModel = new AutomaticityIllustration(simulation);
    const states = automaticityModel.sample(simulation.now);
    for (const [index, cell] of automaticityCells.entries()) {
      const base = cell.node.dataset.counterRegion === "SA Node" && states.sinus ? states.sinus :
        states[cell.chamber];
      const state = automaticityModel.cellState(simulation.now, cell.chamber, cell.site, index, base);
      const digit = state.phase !== "charging" ? state.digit :
        Math.min(9, Math.floor(state.charges[cell.site] * cell.scale));
      const color = state.phase !== "charging" ? "#d7191c" :
        `rgb(${Math.round(255 * digit / 9)}, ${Math.round(230 * digit / 9)}, 0)`;
      if (cell.node.textContent !== String(digit)) cell.node.textContent = String(digit);
      setAttribute(cell.node, "fill", color);
      setAttribute(cell.node, "data-counter-phase", state.phase);
    }
  }

  function updateSourceHighlights(atrial) {
    const active = new Map();
    const s = simulation.settings;
    if ($("#highlight-source").checked) {
      const add = (id, label) => active.set(id, label);
      if (["sinus", "pac", "pvc"].includes(s.rhythm)) add("sinus", "SA node");
      if (s.rhythm === "pac") add("left", "PAC focus");
      if (s.rhythm === "pvc") add("ventricular", `${s.pvcFocus === "lv" ? "Left" : "Right"} ventricular PVC focus`);
      if (s.rhythm === "atrial_tachy") add("atrial_tachy", "Focal atrial reentry circuit");
      if (["wandering", "multifocal_atrial_tachy"].includes(s.rhythm) && atrial?.focus) {
        add(atrial.focus, atrialFoci[atrial.focus].label);
      }
      if (rhythms[s.rhythm].junctional) add("junctional", "AV nodal focus");
      if (["flutter", "avnrt", "avrt"].includes(s.rhythm)) {
        add(s.rhythm, s.rhythm === "flutter" ? "Atrial flutter circuit" : `${s.rhythm.toUpperCase()} circuit`);
        if (s.rhythm === "avrt") add("junctional", "AV node");
      }
      if (s.av === "third" && !rhythms[s.rhythm].junctional &&
          !rhythms[s.rhythm].independentVentricular && !simulation.preexcitation && !simulation.ventricularFibrillation) {
        add("junctional", "Junctional escape focus");
      }
    }
    for (const [id, node] of sourceHighlights) {
      const display = active.has(id) ? "" : "none";
      if (node.style.display !== display) node.style.display = display;
    }
    const [x, y] = VENTRICULAR_FOCI[s.pvcFocus];
    setAttribute(sourceHighlights.get("ventricular"), "cx", x * 822);
    setAttribute(sourceHighlights.get("ventricular"), "cy", y * 566);
    const description = !$("#highlight-source").checked ? "Highlighting off" :
      active.size ? `Source: ${[...active.values()].join(" + ")}` :
        ["wandering", "multifocal_atrial_tachy"].includes(s.rhythm) ? "Awaiting atrial focus" : "No discrete source modeled";
    if ($("#source-description").textContent !== description) $("#source-description").textContent = description;
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
    const settings = simulation.settings;
    const now = simulation.now;
    const atrial = simulation.atria[simulation.atria.length - 1];
    const aTime = atrial ? now - atrial.time : Infinity;
    const ventricular = simulation.ventricles[simulation.ventricles.length - 1];
    const vTime = ventricular ? now - ventricular.time : Infinity;
    const latestBlock = simulation.events.findLast(event => event.type === "block");
    const mobitz = ["mobitz1", "mobitz2"].includes(settings.av) &&
      !["afib", "flutter"].includes(settings.rhythm);
    const nextAtrial = mobitz ? simulation.queue.find(event => event.type === "atrial" || event.type === "pac") : null;
    const transition = pendingScenarios.length ? pendingScenarios[0].start - ecgOffset : Infinity;
    const nextTime = Math.min(nextAtrial?.time ?? Infinity, transition);
    const nextDrop = nextAtrial && nextAtrial.time < transition && simulation.isAvPatternDrop(simulation.beatIndex);
    const currentDrop = atrial && !atrial.retrograde && simulation.isAvPatternDrop(simulation.beatIndex - 1);
    const mobitzMarker = mobitz && ((nextDrop && now >= nextAtrial.time - MOBITZ_MARKER_LEAD_MS) ||
      (currentDrop && now < nextTime - MOBITZ_MARKER_LEAD_MS));
    const sinus = settings.rhythm === "flutter" ?
      simulation.events.findLast(event => event.type === "sinus-firing") : atrial;
    const sinusTime = sinus ? now - sinus.time : Infinity;
    const avrtCircuit = reentryCircuits.find(circuit => circuit.rhythm === "avrt");
    const retrogradeAccessory = simulation.events.findLast(event => event.type === "accessory-retrograde");
    pulsePath(avrtCircuit.impulse, retrogradeAccessory?.time ?? null,
      retrogradeAccessory ? retrogradeAccessory.endTime - retrogradeAccessory.time : 0);
    const wpwBeat = simulation.preexcitation ? atrial : null;
    const accessoryStart = wpwBeat ? Math.min((wpwBeat.pWave?.duration || simulation.morphology.waves[0].duration) / 2, wpwBeat.pr / 2) : 0;
    const fibrillationCycle = Math.floor(now / FIBRILLATION_PATHWAY_PERIOD) * FIBRILLATION_PATHWAY_PERIOD;
    const wpwFibrillation = simulation.ventricularFibrillation && settings.rhythm === "afib";
    const fibrillationStart = wpwFibrillation ?
      fibrillationCycle + FIBRILLATION_PATHWAY_STARTS.findLast(start => start <= now - fibrillationCycle) : null;
    wpwAccessory.group.style.display = simulation.preexcitation || wpwFibrillation ? "" : "none";
    pulsePath(wpwAccessory.impulse, wpwBeat ? wpwBeat.time + accessoryStart : fibrillationStart,
      wpwBeat ? wpwBeat.pr - accessoryStart : FIBRILLATION_PATHWAY_DURATION, true);
    const accessoryActivation = simulation.events.findLast(event => event.type === "accessory-ventricular");
    const accessoryAge = accessoryActivation ? now - accessoryActivation.time : Infinity;
    const accessoryDuration = accessoryActivation ? Math.min(110, accessoryActivation.ventricular.qrsMs) : 0;
    const accessoryProgress = accessoryAge > 0 && accessoryAge < accessoryDuration ?
      accessoryAge / accessoryDuration : 0;
    setAttribute(wpwDepolarization, "r", 8 + 50 * accessoryProgress);
    setAttribute(wpwDepolarization, "fill-opacity", Math.sin(Math.PI * accessoryProgress));
    for (const item of anatomyItems) {
      if (item.type === "path") {
        const bundle = item.name === "Right Bundle" ? "rbbb" : item.name === "Left Bundle" ? "lbbb" : null;
        const beat = bundle ? ventricular : settings.rhythm === "flutter" ? sinus : atrial;
        const duration = bundle ? Math.min(90, simulation.timing.qrsMs) :
          beat?.pWave?.duration || simulation.morphology.waves[0].duration;
        const blocked = bundle && settings.bundle === bundle;
        const directVentricular = bundle && ["PVC", "VT"].includes(ventricular?.origin);
        const ectopic = !bundle && beat?.focus && beat.focus !== "sinus";
        const accessoryAtrial = !bundle && beat?.retrograde && beat.origin === "avrt";
        pulsePath(item.impulse, blocked || directVentricular || !beat || ectopic || accessoryAtrial ?
          null : beat.time, duration, !!beat?.retrograde);
      } else {
        const chamber = item.name.includes("Atrium") ? "atria" :
          item.name === "Right Ventricle" ? "rv" : item.name === "Left Ventricle" ? "lv" : null;
        if (chamber) setAttribute(item.path, "fill-opacity", simulation.chamberOpacity(now, chamber) * 2);
      }
    }
    const sinusDriven = ["sinus", "flutter"].includes(settings.rhythm) ||
      (settings.rhythm === "pac" && atrial?.origin !== "PAC");
    nodeOpacity(sinusDots, sinusDriven && sinus && !sinus.retrograde && sinusTime < 55 ? 1 - sinusTime / 55 : 0);
    const focusPattern = atrialFocusPatterns[settings.rhythm];
    const visibleFoci = focusPattern?.sequence || rhythms[settings.rhythm].atrialFoci || [];
    for (const [id, marker] of focusMarkers) {
      const visible = visibleFoci.includes(id);
      const current = visible && atrial?.focus === id;
      updateFocusMarker(marker, visible, current, aTime, atrial?.pWave?.duration || 0);
    }
    const junctionalRhythm = rhythms[settings.rhythm].junctional;
    const avAtrial = simulation.atria.findLast(beat => {
      const age = now - beat.time;
      const pr = beat.avPr === undefined ? beat.pr : beat.avPr;
      const end = pr === null ? 110 : pr - 35;
      return !beat.retrograde && !(simulation.preexcitation && simulation.settings.av === "third") &&
        age >= 80 && age <= end &&
        !simulation.events.some(event => event.type === "block" && event.site === "av" && event.beat === beat);
    });
    const tachy = rhythms[settings.rhythm].avReentry ?
      simulation.events.findLast(event => event.type === "tachy") : null;
    const reentryAtAv = tachy && now - tachy.time < 55;
    const afibTransit = simulation.events.findLast(event => event.type === "afib" && event.conducted);
    const afibAtAv = afibTransit && now - afibTransit.time < 80;
    const retrogradeAtAv = settings.rhythm !== "avrt" && atrial?.retrograde && aTime >= 0 && aTime <= 55;
    const delayedAtAv = avAtrial?.conducted &&
      (simulation.settings.av === "first" || (simulation.settings.av === "mobitz1" && avAtrial.pr > settings.wenckebachPr)) &&
      !simulation.preexcitation;
    const delayDisplay = delayedAtAv && !mobitzMarker ? "" : "none";
    if (avDelayMarker.style.display !== delayDisplay) avDelayMarker.style.display = delayDisplay;
    nodeOpacity(avDots, reentryAtAv || retrogradeAtAv || avAtrial || afibAtAv ? 1 : 0);
    const escapeFocus = simulation.events.findLast(event => event.type === "escape" ||
      (event.type === "tachy" && junctionalRhythm));
    const escapeAge = escapeFocus ? now - escapeFocus.time : Infinity;
    const junctionalVisible = junctionalRhythm ||
      (simulation.settings.av === "third" && !simulation.preexcitation && !simulation.ventricularFibrillation);
    updateFocusMarker(junctionalMarker, junctionalVisible, !!escapeFocus, escapeAge, 80);
    const ventricularFocus = simulation.events.findLast(event =>
      event.type === "ventricular" && event.origin === "PVC");
    const ventricularFocusAge = ventricularFocus ? now - ventricularFocus.time : Infinity;
    const focusPosition = VENTRICULAR_FOCI[settings.pvcFocus];
    setAttribute(ventricularFocusMarker.group, "transform",
      `translate(${focusPosition[0] * 822} ${focusPosition[1] * 566})`);
    updateFocusMarker(ventricularFocusMarker, settings.rhythm === "pvc",
      !!ventricularFocus, ventricularFocusAge, 80);
    const crossVisible = ventricular && ventricular.bundle !== "none" && vTime >= 35 && vTime <= 105;
    const crossDisplay = crossVisible ? "" : "none";
    if (crossPath.path.style.display !== crossDisplay) crossPath.path.style.display = crossDisplay;
    pulsePath(crossPath, crossVisible ? ventricular.time + 35 : null, 70, settings.bundle === "lbbb");
    for (const marker of blockMarkers.filter(item => item.bundle === "av" || item.bundle === "his")) {
      const conductedDuringBlock = marker.bundle === "av" && latestBlock &&
        ((afibAtAv && afibTransit.time >= latestBlock.time) || simulation.atria.some(beat =>
          ((beat.avConducted ?? beat.conducted) || beat.blockSite === "his") && !beat.retrograde && beat.time + 80 <= now &&
          beat.time + (beat.avPr ?? beat.pr) - 35 >= latestBlock.time));
      const visible = mobitz ? marker.bundle === "av" && mobitzMarker :
        (simulation.settings.av === "third" && marker.bundle === "av") ||
          (latestBlock && latestBlock.site === marker.bundle && !conductedDuringBlock &&
            now - latestBlock.time < (marker.bundle === "av" ? AV_BLOCK_MARKER_MS : 350));
      const display = visible ? "" : "none";
      if (marker.node.style.display !== display) marker.node.style.display = display;
    }
    updateSourceHighlights(atrial);
    drawAutomaticity();
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
    const flutterRatio = simulation.preexcitation ? 1 : Math.max(1, Math.ceil(s.avRefractory * s.atrialRate / 60000 - 0.000000001));
    const fallbackVRate = s.rhythm === "afib" ? null :
      s.av === "third" && !rhythms[s.rhythm].junctional && !simulation.preexcitation ? s.escapeRate :
      s.rhythm === "flutter" ? s.atrialRate / flutterRatio : s.atrialRate;
    const ventricularRate = measuredRate(simulation.ventricles, fallbackVRate);
    const atrialRate = s.rhythm === "afib" ? "Fib" :
      rhythms[s.rhythm].independentVentricular ? "—" :
      (rhythms[s.rhythm].avReentry || rhythms[s.rhythm].junctional) ? "retrograde" :
      Math.round(measuredRate(simulation.atria.filter(beat => !beat.retrograde), s.atrialRate));
    const meanRate = (!simulation.preexcitation && ["mobitz1", "mobitz2"].includes(s.av)) ||
      ["wandering", "pac", "pvc", "afib", "multifocal_atrial_tachy"].includes(s.rhythm);
    setReadout("readout", simulation.ventricularFibrillation ?
      `${s.rhythm === "afib" ? "A Fib · " : ""}V Fib` :
      `A ${atrialRate} · V ${ventricularRate === null ? "—" : Math.round(ventricularRate)} bpm${meanRate ? " (mean)" : ""}${s.rhythm === "flutter" ? ` · ${flutterRatio}:1` : ""}`);
    const lastAtrial = simulation.atria[simulation.atria.length - 1];
    setReadout("pr-readout", s.rhythm === "afib" || rhythms[s.rhythm].independentVentricular ? "No P waves" :
      (rhythms[s.rhythm].avReentry || rhythms[s.rhythm].junctional) ? "Retrograde" :
      s.av === "third" && !simulation.preexcitation ? "Dissociated" :
      lastAtrial && !lastAtrial.conducted ? "Blocked" : `${lastAtrial.pr} ms`);
    const latestVentricular = simulation.ventricles.at(-1);
    setReadout("qrs-readout", simulation.ventricularFibrillation ? "Not measurable" :
      `${latestVentricular?.qrsMs || simulation.expectedQrsMs} ms`);
    setReadout("time-readout", `${((ecgOffset + simulation.now) / 1000).toFixed(2)} s`);
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
    $("#presenter-mode").onclick = openPresenter;
    $("#highlight-source").addEventListener("change", () => {
      if (simulation) drawAnatomy();
    });
    $("#show-automaticity").addEventListener("change", () => {
      if (simulation) drawAutomaticity();
    });
    $("#wpw-enabled").addEventListener("change", event => {
      const input = event.target;
      try {
        new Simulation(scenarioSettings({ wpw: input.checked }), currentMorphology());
        settings.wpw = input.checked;
        queueScenarioChange();
      } catch (error) {
        input.checked = settings.wpw;
        reportError(error);
      }
    });
    const bindings = [
      ["av-pattern", "av"], ["bundle-pattern", "bundle"], ["pvc-focus", "pvcFocus"], ["heart-rate", "atrialRate"],
      ["pr-interval", "pr"], ["wenckebach-pr", "wenckebachPr"], ["pr-step", "prStep"],
      ["conducted-beats", "conductedBeats"], ["escape-rate", "escapeRate"], ["av-refractory", "avRefractory"]
    ];
    for (const [id, key] of bindings) {
      $(`#${id}`).addEventListener(key === "avRefractory" ? "input" : "change", event => {
        const input = event.target;
        const value = ["av", "bundle", "pvcFocus"].includes(key) ? input.value : Number(input.value);
        const previous = settings[key];
        try {
          if (!input.checkValidity() || input.value === "") throw new Error(`Please enter a valid ${input.closest("label").firstChild.textContent.trim()}.`);
          new Simulation(scenarioSettings({ [key]: value }), activeId === "automatic" ? undefined : currentMorphology());
          settings[key] = value;
          queueScenarioChange();
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
        queueScenarioChange();
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
    document.addEventListener("visibilitychange", updateVisibility);
    window.addEventListener("pagehide", () => {
      const popup = presenterWindow;
      if (popup) {
        restorePresentation();
        popup.close();
      }
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
      queueScenarioChange();
    };
    $("#duplicate-waveform").onclick = () => {
      const item = clone(currentMorphology());
      item.id = uid();
      item.name = `${item.name.slice(0, 70)} copy`;
      library.push(item);
      activeId = item.id;
      populateLibrary();
      buildEditor();
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
      queueScenarioChange();
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
      queueScenarioChange();
    };
    for (const segment of ["pr", "st"]) {
      $(`#${segment}-offset`).oninput = event => {
        const morphology = currentMorphology();
        morphology.segments = { ...morphology.segments, [segment]: Number(event.target.value) };
        syncEditor();
        queueScenarioChange();
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
      queueScenarioChange();
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
        queueScenarioChange();
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
    observeViewport();
    window.addEventListener("resize", resize);
    resize();
    restart();
    $("#pause-button").disabled = false;
    $("#presenter-mode").disabled = false;
    setPaused(false);
  }

  initialize().catch(error => {
    reportError(new Error(`Could not start Conduction Lab: ${error.message} Serve this folder over HTTP (see README) rather than opening it as a file.`));
    $("#monitor-status").textContent = "ERROR";
  });
})();
