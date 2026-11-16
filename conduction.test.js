"use strict";

(async () => {
  const { Simulation, templates, clone, validateMorphology } = window.Conduction;
  const results = [];
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function close(actual, expected, message) {
    assert(Math.abs(actual - expected) < 0.00001, `${message}: ${actual} != ${expected}`);
  }
  function test(name, fn) {
    try { fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  }

  function renderStrip(strip, context, time, viewport) {
    const ratio = context.getTransform().a;
    const image = strip.prepare(time, viewport, ratio);
    context.save();
    context.beginPath();
    context.rect(viewport.left, 0, viewport.right - viewport.left, viewport.height);
    context.clip();
    context.drawImage(image, strip.positionAt(time), 0, image.width / ratio, image.height / ratio);
    context.restore();
  }

  for (const av of ["normal", "first", "mobitz1", "mobitz2", "third"]) {
    for (const bundle of ["none", "rbbb", "lbbb"]) {
      test(`${av} + ${bundle}: ventricular events follow conduction rules`, () => {
        const simulation = new Simulation({ av, bundle, atrialRate: 60, escapeRate: 40 });
        simulation.advanceTo(6100);
        const conducted = simulation.ventricles.filter(beat => beat.origin === "conducted");
        const expected = av === "third" ? 0 : av === "normal" || av === "first" ? 6 : 5;
        assert(conducted.length === expected, `Expected ${expected} conducted beats, got ${conducted.length}`);
        const blocks = simulation.events.filter(event => event.type === "block");
        assert(blocks.length === (av === "third" ? 6 : av.startsWith("mobitz") ? 1 : 0), "Wrong number of blocked atrial impulses");
        if (av === "third") {
          assert(simulation.ventricles.length === 4, "Expected independent escape beats");
          assert(simulation.ventricles.every(beat => beat.origin === "escape"), "Atrial impulse crossed complete block");
        }
        for (const event of simulation.events.filter(event => event.type === "ventricular" && event.origin === "conducted")) {
          assert(event.beat.conducted, "A blocked impulse produced a QRS");
          close(event.time - event.beat.time, event.beat.pr, "P-to-QRS interval");
        }
        const myocardial = simulation.events.filter(event => event.type === "myocardial");
        const activated = simulation.ventricles.filter(beat => beat.time + 95 <= simulation.now);
        assert(myocardial.length === (bundle === "none" ? 0 : activated.length), "Delayed myocardial activation missing or spurious");
        if (bundle !== "none") {
          assert(myocardial.every(event => event.side === (bundle === "rbbb" ? "rv" : "lv")), "Wrong ventricle activated late");
          assert(simulation.events.filter(event => event.type === (bundle === "rbbb" ? "rv" : "lv")).every(event => event.delayed), "Blocked bundle conducts normally");
        }
      });
    }
  }

  test("Wenckebach lengthens PR, blocks, and resets without stopping the atrial clock", () => {
    const simulation = new Simulation({ av: "mobitz1", atrialRate: 60 });
    simulation.advanceTo(4500);
    const beats = simulation.atria;
    assert(beats.map(beat => beat.conducted ? beat.pr : "blocked").join(",") === "160,200,220,blocked,160", "PR progression/reset failed");
    assert(simulation.ventricles[2].time - simulation.ventricles[1].time <
      simulation.ventricles[1].time - simulation.ventricles[0].time, "Conducted R-R intervals should shorten");
    beats.slice(1).forEach((beat, i) => close(beat.time - beats[i].time, 1000, "Atrial interval"));
    const dropped = beats[3];
    assert(!simulation.ventricles.some(beat => beat.time > dropped.time && beat.time < dropped.time + 700), "Dropped beat generated ventricular activity");
    close(simulation.signalAt(dropped.time + 190), 0, "Dropped beat should have no QRS");
    assert(simulation.signalAt(dropped.time + 45) > 0, "Dropped impulse should retain its P wave");
  });

  test("Mobitz II keeps conducted PR constant and blocks below the AV node", () => {
    const simulation = new Simulation({ av: "mobitz2", conductedBeats: 2, atrialRate: 60 });
    simulation.advanceTo(3500);
    assert(simulation.atria.map(beat => beat.conducted ? beat.pr : "blocked").join(",") === "160,160,blocked,160", "Mobitz II changed PR");
    assert(simulation.events.find(event => event.type === "block").site === "his", "Block site is not infranodal");
  });

  test("Complete block escape clock is independent of atrial rate", () => {
    const a = new Simulation({ av: "third", atrialRate: 60, escapeRate: 40 });
    const b = new Simulation({ av: "third", atrialRate: 95, escapeRate: 40 });
    a.advanceTo(6000);
    b.advanceTo(6000);
    assert(JSON.stringify(a.ventricles) === JSON.stringify(b.ventricles), "Atrial rate reset the escape clock");
    assert(a.atria.length !== b.atria.length, "Atrial clocks did not differ");
    a.ventricles.slice(1).forEach((beat, i) => close(beat.time - a.ventricles[i].time, 1500, "Escape interval"));
    const intervals = a.ventricles.map(beat => beat.time - a.atria.filter(p => p.time <= beat.time).at(-1).time);
    assert(new Set(intervals).size > 1, "P and QRS were locked together");
  });

  test("Frame partition and playback rate do not change electrical timing or ECG history", () => {
    const direct = new Simulation({ av: "mobitz1", bundle: "rbbb" });
    const stepped = new Simulation({ av: "mobitz1", bundle: "rbbb" });
    direct.advanceTo(9000);
    for (let t = 25; t <= 9000; t += 25) stepped.advanceTo(t);
    assert(JSON.stringify(direct.events) === JSON.stringify(stepped.events), "Frame-dependent event scheduling");
    for (let t = 0; t <= 9000; t += 37) close(direct.signalAt(t), stepped.signalAt(t), "Historical ECG changed");
    const unchanged = direct.signalAt(1200);
    direct.advanceTo(11000);
    close(direct.signalAt(1200), unchanged, "Advancing time rewrote an old beat");
  });

  test("Step visits the next timestamp and processes simultaneous chamber events together", () => {
    const simulation = new Simulation();
    assert(simulation.now === 0, "Initial time");
    simulation.step();
    close(simulation.now, 80, "AV arrival step");
    while (simulation.now < 175) simulation.step();
    const events = simulation.events.filter(event => event.time === 175);
    assert(events.some(event => event.type === "rv") && events.some(event => event.type === "lv"), "Simultaneous chamber activations split");
  });

  test("V1 bundle templates produce a delayed positive R prime for RBBB and broad negative LBBB", () => {
    const right = new Simulation({ bundle: "rbbb", atrialRate: 60 });
    const left = new Simulation({ bundle: "lbbb", atrialRate: 60 });
    right.advanceTo(600);
    left.advanceTo(600);
    assert(right.signalAt(160 + 112) > 0.5, "RBBB lacks terminal R prime");
    assert(left.signalAt(160 + 100) < -0.5, "LBBB lacks broad negative complex");
    assert(right.signalAt(160 + 320) < 0, "RBBB recovery should be discordant");
    assert(left.signalAt(160 + 330) > 0, "LBBB recovery should be discordant");
  });

  test("Custom ST offsets affect the ECG without changing conduction event times", () => {
    const custom = clone(templates.none);
    custom.segments = { st: 0.3 };
    const normal = new Simulation();
    const edited = new Simulation({}, custom);
    normal.advanceTo(600);
    edited.advanceTo(600);
    close(edited.signalAt(290) - normal.signalAt(290), 0.3, "ST offset");
    assert(JSON.stringify(normal.events) === JSON.stringify(edited.events), "Morphology offset changed electrical timing");
  });

  test("Invalid scenarios and malformed waveform data are rejected explicitly", () => {
    const invalid = [
      () => new Simulation({ conductedBeats: 2.5 }),
      () => new Simulation({ atrialRate: NaN }),
      () => new Simulation({ bundle: "unknown" }),
      () => validateMorphology({ name: "bad", waves: [] }),
      () => validateMorphology({ ...clone(templates.none), waves: templates.none.waves.map(w => ({ ...w, duration: -1 })) })
    ];
    for (const fn of invalid) {
      let threw = false;
      try { fn(); } catch { threw = true; }
      assert(threw, "Invalid input was accepted");
    }
  });

  test("Long playback keeps a bounded history without losing the visible strip", () => {
    const simulation = new Simulation({ av: "third", bundle: "lbbb" });
    simulation.advanceTo(120000);
    assert(simulation.events.length < 200, "Event history grows without bound");
    assert(simulation.atria.length < 20 && simulation.ventricles.length < 15, "Beat history grows without bound");
    assert(simulation.atria[0].time <= 110000, "Visible atrial history was pruned");
    assert(simulation.ventricles[0].time <= 110000, "Visible ventricular history was pruned");
    const morphology = clone(templates.rbbb);
    morphology.waves.forEach(item => { item.duration = 400; item.gap = 600; });
    const extended = new Simulation({ atrialRate: 60 }, morphology);
    extended.advanceTo(110500);
    const previous = extended.signalAt(110360);
    extended.advanceTo(120300);
    close(extended.signalAt(110360), previous, "A long custom waveform was pruned while still visible");
  });

  test("Centered ECG preview matches actual activity without advancing the anatomy clock", () => {
    for (const av of ["normal", "first", "mobitz1", "mobitz2", "third"]) {
      for (const bundle of ["none", "rbbb", "lbbb"]) {
        const actual = new Simulation({ av, bundle });
        const preview = new Simulation({ av, bundle });
        preview.advanceTo(2500);
        assert(actual.now === 0 && actual.ventricles.length === 0, "Preview advanced the live model");
        for (const now of [6000, 120000]) {
          actual.advanceTo(now);
          preview.advanceTo(now + 2500);
          for (let t = now - 2500; t <= now; t += 31) {
            close(preview.signalAt(t), actual.signalAt(t), `${av}/${bundle}: forecast changed history`);
          }
          const predicted = preview.signalAt(now + 2500);
          actual.advanceTo(now + 2500);
          close(actual.signalAt(now + 2500), predicted, "Upcoming waveform did not match actual activity");
        }
      }
    }
  });

  test("Ventricular overlays smoothly reach exactly 50% at QRS end and vanish at T end", () => {
    for (const bundle of ["none", "rbbb", "lbbb"]) {
      const simulation = new Simulation({ bundle, atrialRate: 60 });
      simulation.advanceTo(700);
      const start = simulation.ventricles[0].time;
      const { qrsMs, qtMs } = simulation.timing;
      for (const chamber of ["rv", "lv"]) {
        const delayed = (chamber === "rv" && bundle === "rbbb") || (chamber === "lv" && bundle === "lbbb");
        const onset = delayed ? 95 : 15;
        close(simulation.chamberOpacity(start + onset, chamber), 0, "Depolarization onset");
        close(simulation.chamberOpacity(start + (onset + qrsMs) / 2, chamber), 0.25, "Depolarization midpoint");
        close(simulation.chamberOpacity(start + qrsMs, chamber), 0.5, "QRS-end opacity");
        close(simulation.chamberOpacity(start + (qrsMs + qtMs) / 2, chamber), 0.25, "Repolarization midpoint");
        close(simulation.chamberOpacity(start + qtMs, chamber), 0, "T-end opacity");
        const before = simulation.chamberOpacity(start + qrsMs - 0.01, chamber);
        const after = simulation.chamberOpacity(start + qrsMs + 0.01, chamber);
        assert(Math.abs(before - after) < 0.00001, "Overlay jumps at QRS end");
      }
    }
  });

  test("Atrial overlay follows P timing and recovers even when its impulse is blocked", () => {
    for (const av of ["normal", "mobitz1", "mobitz2", "third"]) {
      const simulation = new Simulation({ av, atrialRate: 60 });
      simulation.advanceTo(3500);
      const start = 3000;
      close(simulation.chamberOpacity(start, "atria"), 0, "P onset");
      close(simulation.chamberOpacity(start + 45, "atria"), 0.25, "Atrial depolarization midpoint");
      close(simulation.chamberOpacity(start + 90, "atria"), 0.5, "P-end opacity");
      close(simulation.chamberOpacity(start + 190, "atria"), 0.25, "Atrial recovery midpoint");
      close(simulation.chamberOpacity(start + 290, "atria"), 0, "Atrial recovery end");
    }
  });

  test("The centered five-second strip places events at the correct horizontal positions", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 140;
    const context = canvas.getContext("2d");
    const viewport = { left: 44, right: 256, baseline: 74, amplitude: 68, height: 140 };
    const strip = new window.EcgStrip(new Simulation());
    const original = Simulation.prototype.signalAt;
    Simulation.prototype.signalAt = time =>
      Math.max(...[7500, 8750, 10000, 11250, 12500].map(event => Math.max(0, 1 - Math.abs(time - event) / 30)));
    try {
      renderStrip(strip, context, 10000, viewport);
      for (const x of [44, 97, 150, 203, 255]) {
        const pixels = context.getImageData(x, 3, 1, 8).data;
        assert(pixels.some((value, index) => index % 4 === 3 && value > 0),
          `An event was not drawn at its expected five-second-window position (${x})`);
      }
      const gap = context.getImageData(123, 3, 1, 8).data;
      assert(!gap.some(value => value > 0), "Events are compressed into a longer time window");
    } finally {
      Simulation.prototype.signalAt = original;
    }
  });

  test("Offscreen scrolling preserves pixel geometry without resampling the waveform", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 280;
    const context = canvas.getContext("2d");
    context.setTransform(2, 0, 0, 2, 0, 0);
    const viewport = { left: 44, right: 256, baseline: 74, amplitude: 68, height: 140 };
    const strip = new window.EcgStrip(new Simulation({ av: "mobitz1", bundle: "rbbb" }));
    const original = Simulation.prototype.signalAt;
    let samples = 0;
    Simulation.prototype.signalAt = function(time) { samples++; return original.call(this, time); };
    try {
      renderStrip(strip, context, 2000, viewport);
      const image = strip.image;
      const sampled = samples;
      assert(sampled > 0, "Offscreen strip was not generated");
      const before = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, 300, 140);
      renderStrip(strip, context, 2000 + 5000 / 424, viewport);
      const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
      assert(samples === sampled && strip.image === image, "Scrolling regenerated waveform geometry");
      let visiblePixels = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 92; x < 508; x++) {
          const a = (y * canvas.width + x + 1) * 4;
          const b = (y * canvas.width + x) * 4;
          if (after[b + 3]) visiblePixels++;
          for (let channel = 0; channel < 4; channel++) {
            // GPU readback can round premultiplied channels by one intensity level.
            assert(Math.abs(before[a + channel] - after[b + channel]) <= 1,
              "A one-pixel scroll changed the waveform's shape");
          }
        }
      }
      assert(visiblePixels > 100, "Pixel comparison did not include a visible waveform");
      for (let t = 2100; t < 2400; t += 33) renderStrip(strip, context, t, viewport);
      assert(samples === sampled, "Ordinary animation frames sampled the signal");
    } finally {
      Simulation.prototype.signalAt = original;
    }
  });

  test("Offscreen cache rollover preserves old pixels and only paints the new segment", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 375;
    canvas.height = 175;
    const context = canvas.getContext("2d");
    context.setTransform(1.25, 0, 0, 1.25, 0, 0);
    const viewport = { left: 44, right: 256, baseline: 74, amplitude: 68, height: 140 };
    const strip = new window.EcgStrip(new Simulation({ av: "third", bundle: "lbbb" }));
    renderStrip(strip, context, 2490, viewport);
    const previous = strip.image.getContext("2d").getImageData(265, 0, 530, 175).data;
    const paint = strip.paintTile;
    const painted = [];
    strip.paintTile = function(ctx, tile, offset, geometry) {
      painted.push(tile);
      return paint.call(this, ctx, tile, offset, geometry);
    };
    renderStrip(strip, context, 2510, viewport);
    assert(painted.length === 1 && painted[0] === 2, "Cache rollover repainted retained segments");
    const retained = strip.image.getContext("2d").getImageData(0, 0, 530, 175).data;
    assert(previous.every((value, i) => value === retained[i]), "Retained pixels changed at a cache boundary");
    assert(strip.image.width === 795 && strip.image.height === 175, "Cache grew beyond its fixed 15-second buffer");
  });

  test("Resizing rebuilds the strip from complete history rather than a pruned preview", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 140;
    const context = canvas.getContext("2d");
    const viewport = { left: 44, right: 356, baseline: 74, amplitude: 68, height: 140 };
    const settings = { av: "mobitz2", bundle: "lbbb" };
    const strip = new window.EcgStrip(new Simulation(settings));
    renderStrip(strip, context, 25000, { ...viewport, right: 256 });
    renderStrip(strip, context, 25000, viewport);
    const reference = new window.EcgStrip(new Simulation(settings));
    renderStrip(reference, context, 25000, viewport);
    const actual = strip.image.getContext("2d").getImageData(0, 0, 936, 140).data;
    const expected = reference.image.getContext("2d").getImageData(0, 0, 936, 140).data;
    assert(actual.some(value => value > 0), "Resized waveform is blank");
    assert(actual.every((value, i) => value === expected[i]), "Resize lost or changed historical beats");
  });

  const fixture = document.createElement("iframe");
  fixture.title = "Playback regression fixture";
  fixture.tabIndex = -1;
  fixture.setAttribute("aria-hidden", "true");
  fixture.style.cssText = "position:fixed;left:-2000px;top:0;width:1280px;height:900px;visibility:hidden;border:0";
  try {
    await new Promise((resolve, reject) => {
      fixture.onload = resolve;
      fixture.onerror = () => reject(new Error("Could not load playback fixture"));
      fixture.src = "index.html";
      document.body.append(fixture);
    });
    const win = fixture.contentWindow;
    const doc = win.document;
    const pause = doc.querySelector("#pause-button");
    const deadline = performance.now() + 5000;
    while (pause.disabled) {
      const error = doc.querySelector("#error-message");
      if (!error.hidden || performance.now() > deadline) throw new Error(error.textContent || "Playback initialization timed out");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (pause.textContent === "Pause") pause.click();
    doc.querySelector("#av-pattern").dispatchEvent(new win.Event("change", { bubbles: true }));
    const trace = doc.querySelector("#ecg-trace");
    const animation = trace.getAnimations()[0];

    test("Native ECG scrolling interpolates at subframe positions across the five-second window", () => {
      const originalTime = animation.currentTime;
      const width = doc.querySelector("#ecg-waveform").getBoundingClientRect().width;
      try {
        animation.currentTime = 5000;
        const first = new win.DOMMatrix(win.getComputedStyle(trace).transform).m41;
        animation.currentTime = 5012.5;
        const second = new win.DOMMatrix(win.getComputedStyle(trace).transform).m41;
        assert(Math.abs(second - first + width * 12.5 / 5000) < 0.001, "Native scroll does not track fractional simulation time");
      } finally {
        animation.currentTime = originalTime;
      }
    });

    test("Electrical dots follow the saved path continuously at subframe positions", () => {
      const group = doc.querySelector('[data-path="Atria1"]');
      const dot = group.querySelector("circle");
      const movement = dot.getAnimations()[0];
      const path = group.previousElementSibling;
      const root = doc.querySelector("#anatomy").getCTM();
      const originalTime = movement.currentTime;
      try {
        assert(group.querySelectorAll("circle").length === 24, "Dense dot trail is missing");
        for (const time of [12.5, 37.5, 62.5]) {
          movement.currentTime = time;
          const actual = new win.DOMPoint(0, 0).matrixTransform(dot.getCTM());
          const point = path.getPointAtLength(path.getTotalLength() * time / 90);
          const expected = new win.DOMPoint(point.x, point.y).matrixTransform(root);
          assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.05, "Native dot left its saved conduction path");
        }
      } finally {
        movement.currentTime = originalTime;
      }
    });

    test("Playback controls sit beside the scenario fields with no lower transport row", () => {
      assert(doc.querySelector(".scenario-bar").contains(doc.querySelector(".transport")), "Playback controls are not in the top bar");
      assert(doc.querySelector(".teaching-grid").nextElementSibling.id === "developer-panel", "Lower playback row still occupies space");
    });

    const originalRequest = win.requestAnimationFrame;
    let requests = 0;
    win.requestAnimationFrame = callback => { requests++; return originalRequest.call(win, callback); };
    const before = animation.currentTime;
    const speed = doc.querySelector("#speed");
    speed.value = "0.5";
    speed.dispatchEvent(new win.Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 100));
    win.requestAnimationFrame = originalRequest;
    test("Paused playback and speed changes preserve phase without requesting animation frames", () => {
      assert(animation.playState === "paused" && animation.currentTime === before, "Changing speed moved a paused waveform");
      assert(animation.playbackRate === 0.5, "Native animation did not adopt the new playback speed");
      assert(requests === 0, "Paused playback still requests frames");
    });
  } catch (error) {
    test("Playback regression fixture initializes", () => { throw error; });
  } finally {
    fixture.remove();
  }

  for (const result of results) {
    const item = document.createElement("li");
    item.textContent = `${result.passed ? "PASS" : "FAIL"}: ${result.name}${result.error ? `: ${result.error}` : ""}`;
    document.querySelector("#results").append(item);
  }
  const failures = results.filter(result => !result.passed);
  document.querySelector("#result").textContent = `${results.length - failures.length}/${results.length} passed`;
  document.body.dataset.failures = failures.length;
  window.testResults = results;
})();
