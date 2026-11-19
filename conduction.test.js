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

  function drawTile(strip, image, index, context, time, viewport) {
    const ratio = context.getTransform().a;
    const left = (viewport.left + viewport.right) / 2 +
      (index - time / window.EcgStrip.tileMs) * strip.tileWidth;
    context.save();
    context.beginPath();
    context.rect(viewport.left, 0, viewport.right - viewport.left, viewport.height);
    context.clip();
    context.drawImage(image, left, 0, strip.tileWidth, image.height / ratio);
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

  test("Wandering pacemaker and PACs have variable atrial timing and P-wave shape", () => {
    const wandering = new Simulation({ rhythm: "wandering" });
    wandering.advanceTo(3000);
    const wanderingIntervals = wandering.atria.slice(1, 4).map((beat, i) => beat.time - wandering.atria[i].time);
    assert(new Set(wanderingIntervals).size === 3, "Wandering pacemaker intervals did not vary");
    assert(new Set(wandering.atria.slice(0, 3).map(beat => beat.pWave.amplitude)).size === 3,
      "Wandering pacemaker P-wave morphologies did not vary");

    const pac = new Simulation({ rhythm: "pac", atrialRate: 60 });
    pac.advanceTo(5000);
    const ectopic = pac.atria.findIndex(beat => beat.origin === "PAC");
    assert(ectopic > 0, "No premature atrial beat was generated");
    const coupling = pac.atria[ectopic].time - pac.atria[ectopic - 1].time;
    const pause = pac.atria[ectopic + 1].time - pac.atria[ectopic].time;
    assert(coupling < 1000 && pause > 1000, "PAC coupling interval and pause were not premature");
    assert(pac.atria[ectopic].pWave.amplitude < 0, "PAC did not use an ectopic P-wave shape");
  });

  test("Tachycardia, pre-excitation, flutter, and fibrillation have distinct timing", () => {
    const psvt = new Simulation({ rhythm: "psvt" });
    psvt.advanceTo(1100);
    close(psvt.ventricles[1].time - psvt.ventricles[0].time, 60000 / 180, "PSVT interval");
    assert(psvt.atria[0].retrograde, "PSVT did not produce a retrograde P wave");

    const wpw = new Simulation({ rhythm: "wpw" });
    wpw.advanceTo(500);
    close(wpw.ventricles[0].time - wpw.atria[0].time, 100, "WPW PR interval");
    assert(wpw.ventricles[0].preexcited && wpw.ventricles[0].qrsMs > wpw.timing.qrsMs,
      "WPW did not produce pre-excitation and a widened QRS");
    const bypass = new Simulation({ rhythm: "wpw", av: "third" });
    bypass.advanceTo(150);
    assert(bypass.ventricles.some(beat => beat.origin === "preexcited"),
      "WPW did not bypass complete AV block");

    const atrialTachy = new Simulation({ rhythm: "atrial_tachy" });
    atrialTachy.advanceTo(900);
    close(atrialTachy.atria[1].time - atrialTachy.atria[0].time, 400, "Atrial tachycardia interval");

    const flutter = new Simulation({ rhythm: "flutter" });
    flutter.advanceTo(1000);
    assert(flutter.atria.length === 6 && flutter.atria[0].conducted && !flutter.atria[1].conducted,
      "Atrial flutter did not use a 2:1 conduction pattern");
    close(flutter.signalAt(0), 0.08, "Atrial flutter sawtooth height");
    assert(Math.abs(flutter.signalAt(20) - flutter.signalAt(120)) > 0.05,
      "Atrial flutter lacks a repeating sawtooth baseline");

    const afib = new Simulation({ rhythm: "afib" });
    afib.advanceTo(3000);
    assert(afib.atria.length === 0, "A Fib generated organized P waves");
    assert(new Set(afib.ventricles.slice(1).map((beat, i) =>
      beat.time - afib.ventricles[i].time)).size > 1, "A Fib ventricular response was regular");
    assert(afib.chamberOpacity(1000, "atria") > 0, "A Fib did not animate atrial activity");
    const phase = 1000 / 37;
    const expectedOpacity = 0.06 + 0.44 *
      (1 + Math.sin(phase * 0.73) * Math.sin(phase * 1.17)) / 2;
    close(afib.chamberOpacity(1000, "atria"), expectedOpacity, "A Fib opacity fluctuation pattern");
    let peakOpacity = 0;
    for (let time = 0; time < 30000; time += 25) {
      peakOpacity = Math.max(peakOpacity, afib.chamberOpacity(time, "atria"));
    }
    assert(peakOpacity > 0.49 && peakOpacity <= 0.5, "A Fib atrial opacity did not reach 50%");
  });

  test("Junctional tachycardia has regular QRS complexes and retrograde atrial activation", () => {
    const simulation = new Simulation({ rhythm: "junctional_tachy" });
    simulation.advanceTo(1200);
    close(simulation.ventricles[1].time - simulation.ventricles[0].time, 60000 / 130, "Junctional interval");
    assert(simulation.atria[0].retrograde, "Junctional tachycardia lacks retrograde atrial activation");
  });

  test("Every rhythm composes with each bundle morphology", () => {
    for (const rhythm of Object.keys(window.Conduction.rhythms)) {
      for (const bundle of ["none", "rbbb", "lbbb"]) {
        const simulation = new Simulation({ rhythm, bundle });
        simulation.advanceTo(3000);
        assert(simulation.ventricles.length > 0, `${rhythm}/${bundle} produced no ventricular activity`);
        for (let time = 0; time <= 3000; time += 37) {
          assert(Number.isFinite(simulation.signalAt(time)), `${rhythm}/${bundle} produced a non-finite ECG`);
        }
      }
    }
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

  test("His bundle activation follows AV-nodal release and precedes the QRS", () => {
    const simulation = new Simulation();
    simulation.advanceTo(200);
    const release = simulation.events.find(event => event.type === "av-release");
    const his = simulation.events.find(event => event.type === "his" && event.beat?.conducted);
    const qrs = simulation.events.find(event => event.type === "ventricular" && event.origin === "conducted");
    assert(release && his && qrs, "The conduction sequence is incomplete");
    assert(release.time < his.time && his.time < qrs.time, "His activation is in the wrong conduction order");
    close(qrs.time - his.time, 20, "His-to-QRS conduction time");
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
      () => new Simulation({ rhythm: "unknown" }),
      () => new Simulation({ rhythm: "flutter", atrialRate: 70 }),
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

  test("The centered three-second strip places events at the correct horizontal positions", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 140;
    const context = canvas.getContext("2d");
    const viewport = { left: 44, right: 256, baseline: 74, amplitude: 68, height: 140 };
    const strip = new window.EcgStrip(new Simulation());
    const original = Simulation.prototype.signalAt;
    Simulation.prototype.signalAt = time =>
      Math.max(...[8500, 9250, 10000, 10750, 11500].map(event => Math.max(0, 1 - Math.abs(time - event) / 30)));
    try {
      strip.configure(viewport, 1);
      for (const index of [1, 2]) drawTile(strip, strip.renderTile(index), index, context, 10000, viewport);
      for (const x of [44, 97, 150, 203, 255]) {
        const pixels = context.getImageData(x, 3, 1, 8).data;
        assert(pixels.some((value, index) => index % 4 === 3 && value > 0),
          `An event was not drawn at its expected three-second-window position (${x})`);
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
      strip.configure(viewport, 2);
      const image = strip.renderTile(0);
      drawTile(strip, image, 0, context, 2000, viewport);
      const sampled = samples;
      assert(sampled > 0, "Offscreen strip was not generated");
      const before = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, 300, 140);
      drawTile(strip, image, 0, context, 2000 + 5000 / image.width, viewport);
      const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
      assert(samples === sampled, "Scrolling regenerated waveform geometry");
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
      for (let t = 2100; t < 2400; t += 33) drawTile(strip, image, 0, context, t, viewport);
      assert(samples === sampled, "Ordinary animation frames sampled the signal");
    } finally {
      Simulation.prototype.signalAt = original;
    }
  });

  test("Resizing rebuilds the strip from complete history rather than a pruned preview", () => {
    const viewport = { left: 44, right: 356, baseline: 74, amplitude: 68, height: 140 };
    const settings = { av: "mobitz2", bundle: "lbbb" };
    const strip = new window.EcgStrip(new Simulation(settings));
    strip.configure({ ...viewport, right: 256 }, 1);
    strip.renderTile(7);
    strip.configure(viewport, 1);
    const reference = new window.EcgStrip(new Simulation(settings));
    reference.configure(viewport, 1);
    const pixels = image => image.getContext("2d").getImageData(0, 0, image.width, image.height).data;
    const actual = pixels(strip.renderTile(6));
    const expected = pixels(reference.renderTile(6));
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
    Object.defineProperty(doc, "hidden", { configurable: true, value: false });
    doc.dispatchEvent(new win.Event("visibilitychange"));
    if (pause.textContent === "Pause") pause.click();
    doc.querySelector("#av-pattern").dispatchEvent(new win.Event("change", { bubbles: true }));
    test("Rhythm selector updates the rate control for the selected rhythm", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      rhythm.value = "flutter";
      rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
      assert(doc.querySelector("#heart-rate").value === "300", "Flutter did not select its representative atrial rate");
      assert(doc.querySelector("#heart-rate").max === "360", "Flutter rate range is incorrect");
      assert(doc.querySelector("#rate-label").textContent === "Atrial rate", "Flutter rate label is incorrect");
      rhythm.value = "sinus";
      rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
    });
    test("His bundle animation and pathway-highlighting control are omitted", () => {
      assert(!doc.querySelector("#highlight-pathways"), "Pathway-highlighting checkbox is still shown");
      assert(!doc.querySelector("#pathway-legend"), "Pathway color legend is still shown");
      assert(!doc.querySelector('[data-conduction-path="His bundle"]'), "His bundle path is still shown");
      assert(!doc.querySelector('[data-path="His bundle"]'), "His bundle activation dots are still shown");
    });
    const trace = doc.querySelector("#ecg-trace");
    const initialTile = trace.querySelector("canvas");
    const animation = initialTile.getAnimations()[0];

    test("Native ECG scrolling interpolates at subframe positions across the three-second window", () => {
      const originalTime = animation.currentTime;
      const width = doc.querySelector("#ecg-waveform").getBoundingClientRect().width;
      try {
        animation.currentTime = 5000;
        const first = new win.DOMMatrix(win.getComputedStyle(initialTile).transform).m41;
        animation.currentTime = 5012.5;
        const second = new win.DOMMatrix(win.getComputedStyle(initialTile).transform).m41;
        assert(Math.abs(second - first + width * 12.5 / 3000) < 0.002, "Native scroll does not track fractional simulation time");
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

    test("ECG handoff mounts the next tile early without replacing the visible animation", () => {
      let frameCallback, idleCallback;
      const start = doc.timeline.currentTime;
      let now = start;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = callback => { frameCallback = callback; return 1; };
      win.requestIdleCallback = callback => { idleCallback = callback; return 1; };
      try {
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        pause.click();
        const getTile = index => trace.querySelector(`[data-ecg-tile="${index}"]`);
        const runFrame = elapsed => frameCallback(now = start + elapsed);
        runFrame(1800);
        assert(!getTile(1) && idleCallback, "An offscreen tile was not deferred to idle time");
        idleCallback();
        const nextTile = getTile(1);
        assert(nextTile, "The next tile was not ready before entering the viewport");
        const nextAnimation = nextTile.getAnimations()[0];
        runFrame(5000);
        assert(getTile(0) === initialTile && initialTile.getAnimations()[0] === animation,
          "Adding a tile replaced or restarted the visible waveform");
        assert(getTile(1) === nextTile && nextTile.getAnimations()[0] === nextAnimation,
          "Entering the viewport replaced the prefetched tile");
        close(nextAnimation.startTime - animation.startTime, 5000, "Tile animations are not on the same clock");
        runFrame(8800); // Skip idle time at this handoff.
        assert(!getTile(0) && getTile(1) === nextTile && getTile(2), "Tiles were not recycled safely when idle time was unavailable");
        assert(trace.childElementCount === 2, "Retired ECG tiles remained mounted");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        delete doc.timeline.currentTime;
      }
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
