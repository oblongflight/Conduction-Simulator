"use strict";

(async () => {
  const { Simulation, templates, atrialFoci, clone, validateMorphology } = window.Conduction;
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

  test("Blocked impulses stop at their modeled AV or His-Purkinje site", () => {
    for (const av of ["normal", "first", "mobitz1", "mobitz2"]) {
      const simulation = new Simulation({ rhythm: "flutter", av });
      simulation.advanceTo(600);
      const beat = simulation.atria[1];
      const events = simulation.events.filter(event => event.beat === beat);
      assert(events.some(event => event.type === "block" && event.site === "av" && event.time === 280),
        `${av}: flutter impulse did not block on arrival at the AV node`);
      assert(!events.some(event => ["av-release", "his", "ventricular"].includes(event.type)),
        `${av}: AV-blocked flutter impulse traveled beyond the node`);
      assert(simulation.ventricles.some(ventricle => ventricle.time === simulation.atria[0].pr),
        `${av}: a conducted flutter impulse was lost`);
    }
    for (const av of ["mobitz1", "mobitz2", "third"]) {
      const simulation = new Simulation({ av, atrialRate: 60, conductedBeats: 2 });
      simulation.advanceTo(2500);
      const beat = simulation.atria[av === "third" ? 0 : 2];
      const events = simulation.events.filter(event => event.beat === beat);
      const block = events.find(event => event.type === "block");
      assert(block?.site === (av === "mobitz2" ? "his" : "av"), `${av}: wrong block site`);
      assert(events.some(event => event.type === "av-arrival"), `${av}: AV arrival is missing`);
      const release = events.find(event => event.type === "av-release");
      const his = events.find(event => event.type === "his");
      assert(av === "mobitz2" ? release && his && his.time < block.time : !release && !his,
        `${av}: blocked impulse crossed the wrong structure`);
      assert(!events.some(event => event.type === "ventricular"), `${av}: blocked impulse produced a QRS`);
    }
    const mixed = new Simulation({ rhythm: "flutter", av: "mobitz2", conductedBeats: 2 });
    mixed.advanceTo(600);
    const flutterBlock = mixed.events.find(event => event.type === "block" && event.beat === mixed.atria[1]);
    const hisBlock = mixed.events.find(event => event.type === "block" && event.beat === mixed.atria[2]);
    assert(flutterBlock?.site === "av" && hisBlock?.site === "his",
      "Flutter and Mobitz II drops were not attributed to their respective sites");
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

  test("Atrial foci consistently determine the sampled P wave across rhythms", () => {
    const morphology = clone(templates.none);
    morphology.waves[0].amplitude = 0.2;
    morphology.waves.slice(1).forEach(item => { item.amplitude = 0; });
    const shapes = new Map();
    for (const rhythm of ["wandering", "atrial_tachy", "multifocal_atrial_tachy"]) {
      const actual = new Simulation({ rhythm }, morphology);
      const preview = new Simulation({ rhythm }, morphology);
      preview.advanceTo(5000);
      actual.advanceTo(3000);
      for (const beat of actual.atria) {
        const focus = atrialFoci[beat.focus];
        assert(focus, `${rhythm} beat has no mapped focus`);
        const shape = JSON.stringify(beat.pWave);
        if (shapes.has(beat.focus)) assert(shapes.get(beat.focus) === shape, "A focus changed its P-wave shape");
        shapes.set(beat.focus, shape);
        const peak = beat.time + beat.pWave.duration * beat.pWave.orientation;
        close(actual.signalAt(peak), 0.2 * focus.amplitude, "P-wave peak does not match the firing focus");
        close(preview.signalAt(peak), actual.signalAt(peak), "ECG preview differs from live focus activation");
      }
      if (rhythm === "atrial_tachy") {
        assert(actual.atria.every(beat => beat.focus === "left" && beat.pWave.amplitude < 0),
          "Focal atrial tachycardia is not consistently left atrial with an ectopic P wave");
      } else {
        assert(new Set(actual.atria.map(beat => beat.focus)).size === 3, `${rhythm} did not use three sites`);
        const intervals = actual.atria.slice(1).map((beat, i) => beat.time - actual.atria[i].time);
        assert(new Set(intervals.map(interval => interval.toFixed(3))).size >= 3, `${rhythm} is not irregular`);
      }
    }
    assert(new Set(["rightHigh", "rightLow", "left"].map(id => shapes.get(id))).size === 3,
      "MAT foci do not have three distinct P-wave morphologies");
  });

  test("Focal atrial rhythms retain AV-block conduction rules", () => {
    for (const rhythm of ["wandering", "atrial_tachy", "multifocal_atrial_tachy"]) {
      for (const av of ["normal", "first", "mobitz1", "mobitz2", "third"]) {
        const simulation = new Simulation({ rhythm, av, conductedBeats: 2 });
        simulation.advanceTo(3500);
        assert(simulation.atria.every(beat => beat.focus && beat.pWave), `${rhythm}/${av} lost atrial foci`);
        for (const beat of simulation.atria) {
          const events = simulation.events.filter(event => event.beat === beat);
          if (beat.time + (beat.pr ?? 110) <= simulation.now) {
            assert(events.some(event => event.type === "ventricular") === beat.conducted,
              `${rhythm}/${av} conducted a blocked beat or lost a conducted beat`);
          }
        }
        if (av === "mobitz2") {
          assert(simulation.atria.every(beat => beat.pr === 160), `${rhythm} changed Mobitz II PR`);
        }
      }
    }
  });

  test("Flutter maintains independent sinus and reentry clocks without extra beats", () => {
    for (const atrialRate of [300, 320]) {
      const simulation = new Simulation({ rhythm: "flutter", atrialRate });
      simulation.advanceTo(2100);
      const sinus = simulation.events.filter(event => event.type === "sinus-firing");
      assert(sinus.map(event => event.time).join(",") === "0,1000,2000", "Sinus clock did not fire at 60 bpm");
      simulation.atria.forEach((beat, index) => {
        close(beat.time, index * 60000 / atrialRate, "Flutter activation time");
        assert(beat.origin === "flutter", "Sinus firing added a separate atrial beat");
      });
      const expectedVentricles = simulation.atria.filter(beat => beat.conducted && beat.time + beat.pr <= 2100);
      assert(simulation.ventricles.length === expectedVentricles.length, "Sinus firing added a ventricular beat");
    }
    const sinus = new Simulation({ rhythm: "sinus", atrialRate: 60 });
    sinus.advanceTo(2100);
    assert(!sinus.events.some(event => event.type === "sinus-firing"), "Flutter sinus clock leaked into another rhythm");
  });

  test("Junctional rhythms have rate-appropriate QRS complexes and retrograde atrial activation", () => {
    for (const [rhythm, rate] of [["junctional", 50], ["junctional_tachy", 130]]) {
      for (const av of ["normal", "first", "mobitz1", "mobitz2", "third"]) {
        const simulation = new Simulation({ rhythm, av });
        simulation.advanceTo(3000);
        close(simulation.ventricles[1].time - simulation.ventricles[0].time, 60000 / rate, "Junctional interval");
        assert(simulation.ventricles.every(beat => beat.origin === "junctional"), "Wrong junctional origin");
        assert(simulation.atria.every(beat => beat.retrograde && beat.origin === "junctional"),
          `${rhythm}/${av} lacks its modeled retrograde atrial activation`);
        close(simulation.atria[0].time - simulation.ventricles[0].time, 30, "Retrograde timing");
      }
    }
  });

  test("AVNRT and AVRT use regular reentry timing without pre-excitation", () => {
    for (const rhythm of ["avnrt", "avrt"]) {
      const simulation = new Simulation({ rhythm });
      simulation.advanceTo(1100);
      close(simulation.ventricles[1].time - simulation.ventricles[0].time, 60000 / 180, `${rhythm} interval`);
      assert(simulation.ventricles.every(beat => beat.origin === rhythm && !beat.preexcited),
        `${rhythm} did not use an orthodromic ventricular response`);
      assert(simulation.atria.every(beat => beat.retrograde && beat.origin === rhythm),
        `${rhythm} did not produce retrograde atrial activations`);
      close(simulation.atria[0].time - simulation.ventricles[0].time, 30, `${rhythm} retrograde timing`);
    }
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
      () => new Simulation({ rhythm: "psvt" }),
      () => new Simulation({ rhythm: "flutter", atrialRate: 70 }),
      () => new Simulation({ rhythm: "avnrt", av: "third" }),
      () => new Simulation({ rhythm: "avrt", av: "mobitz2" }),
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
    test("Atrial focus markers follow each beat and match the atrial anatomy", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const pathwayDot = doc.querySelector('[data-path="Atria1"] circle');
      const markers = Object.fromEntries(Object.keys(atrialFoci).map(id =>
        [id, doc.querySelector(`[data-atrial-focus="${id}"]`)]));
      const routes = Object.fromEntries(["rightHigh", "rightLow", "left"].map(id =>
        [id, doc.querySelector(`[data-atrial-focus-route="${id}"]`)]));
      const chamber = name => [...doc.querySelectorAll("#anatomy-overlays path")]
        .find(node => node.querySelector("title")?.textContent === name);
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const change = value => {
        rhythm.value = value;
        rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const step = time => {
        pause.click();
        callback(now = time);
        pause.click();
      };
      try {
        for (const [id, chamberName] of [["rightHigh", "Right Atrium"], ["rightLow", "Right Atrium"], ["left", "Left Atrium"]]) {
          const focus = atrialFoci[id];
          assert(chamber(chamberName).isPointInFill(new win.DOMPoint(focus.x * 822, focus.y * 566)),
            `${id} marker is outside its atrium`);
          assert(!markers[id].querySelector("text"), `${id} focus is still numbered`);
          const route = routes[id];
          const path = route.querySelector("path");
          const first = path.getPointAtLength(0);
          const last = path.getPointAtLength(path.getTotalLength());
          assert(Math.hypot(first.x - focus.x * 822, first.y - focus.y * 566) < 0.01,
            `${id} route does not start at the focus`);
          assert(Math.hypot(last.x - 0.451 * 822, last.y - 0.53 * 566) < 0.01,
            `${id} route does not end at the AV node`);
          const atrialPaths = [...doc.querySelectorAll('[data-conduction-path^="Atria"]')];
          const distance = candidate => {
            let nearest = Infinity;
            const length = candidate.getTotalLength();
            for (let i = 0; i <= Math.ceil(length); i++) {
              const point = candidate.getPointAtLength(Math.min(i, length));
              nearest = Math.min(nearest, Math.hypot(first.x - point.x, first.y - point.y));
            }
            return nearest;
          };
          const closest = atrialPaths.reduce((best, candidate) =>
            distance(candidate) < distance(best) ? candidate : best);
          assert(route.dataset.viaPath === closest.dataset.conductionPath, `${id} does not use its nearest atrial pathway`);
          const entry = path.getPointAtLength(distance(closest));
          assert(distanceToPath(entry, closest) < 1, `${id} route does not join that pathway`);
        }
        function distanceToPath(point, path) {
          let nearest = Infinity;
          const length = path.getTotalLength();
          for (let i = 0; i <= Math.ceil(length); i++) {
            const candidate = path.getPointAtLength(Math.min(i, length));
            nearest = Math.min(nearest, Math.hypot(point.x - candidate.x, point.y - candidate.y));
          }
          return nearest;
        }
        for (const name of ["wandering", "atrial_tachy", "multifocal_atrial_tachy"]) {
          change(name);
          const start = now;
          const expected = new win.Conduction.Simulation({ rhythm: name });
          expected.advanceTo(2000);
          const focusIds = new Set(win.Conduction.atrialFocusPatterns[name].sequence);
          for (const [id, marker] of Object.entries(markers)) {
            assert((marker.style.display !== "none") === focusIds.has(id), `${name} shows the wrong focus markers`);
          }
          for (const beat of expected.atria.slice(0, 3)) {
            step(start + beat.time + 10);
            assert(markers[beat.focus].getAttribute("data-current") === "true", `${name} did not highlight its firing focus`);
            assert(markers[beat.focus].getAttribute("data-activating") === "true" &&
              Number(markers[beat.focus].querySelector("circle").getAttribute("opacity")) > 0,
            `${name} focus did not visibly pulse during depolarization`);
            assert(doc.querySelector("#atrial-focus-readout").textContent.includes(atrialFoci[beat.focus].label),
              `${name} focus readout disagrees with the beat`);
            if (beat.focus !== "sinus") {
              assert(pathwayDot.getAnimations().length === 0, `${name} ectopic beat activated a sinus pathway`);
              const route = routes[beat.focus];
              assert(route.style.display !== "none", `${name} did not show the firing focus route`);
              const movement = route.querySelector("circle").getAnimations()[0];
              assert(movement?.playState === "paused", `${name} route did not follow paused playback`);
              close(movement.effect.getTiming().duration, 80, `${name} route does not reach the AV node at AV arrival`);
              close(movement.currentTime, 10, `${name} route is not synchronized to the atrial beat`);
              const originalTime = movement.currentTime;
              movement.currentTime = 40;
              const dot = route.querySelector("circle");
              const path = route.querySelector("path");
              const point = path.getPointAtLength(path.getTotalLength() / 2);
              const actual = new win.DOMPoint(0, 0).matrixTransform(dot.getCTM());
              const expected = new win.DOMPoint(point.x, point.y).matrixTransform(doc.querySelector("#anatomy").getCTM());
              assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.05, "Focus impulse left its route");
              movement.currentTime = originalTime;
            }
            for (const [id, route] of Object.entries(routes)) {
              assert((route.style.display !== "none") === (beat.focus === id), `${name} showed a route for the wrong focus`);
            }
            const ring = markers[beat.focus].querySelector("circle");
            const initialRadius = Number(ring.getAttribute("r"));
            step(start + beat.time + beat.pWave.duration / 2);
            assert(Number(ring.getAttribute("r")) > initialRadius, "Focus pulse did not expand during depolarization");
            step(start + beat.time + beat.pWave.duration + 1);
            assert(markers[beat.focus].getAttribute("data-activating") === "false", "Focus pulse outlasted the P wave");
          }
        }
        change("sinus");
        assert(Object.values(markers).every(marker => marker.style.display === "none"), "Focus markers leaked into sinus rhythm");
        assert(Object.values(routes).every(route => route.style.display === "none"), "Focus routes leaked into sinus rhythm");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        change("sinus");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("Junctional rhythm controls and focus match their selected rates", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const av = doc.querySelector("#av-pattern");
      const junctionalFocus = doc.querySelector('[data-node="Independent junctional/His escape focus"]');
      try {
        assert(!rhythm.querySelector('option[value="psvt"]'), "Generic PSVT remains selectable");
        for (const [name, rate] of [["junctional", "50"], ["junctional_tachy", "130"]]) {
          rhythm.value = name;
          rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
          assert(doc.querySelector("#heart-rate").value === rate, `${name} selected the wrong rate`);
          assert(doc.querySelector("#rate-label").textContent === "Junctional rate", "Wrong junctional rate label");
          assert(doc.querySelector("#pr-readout").textContent === "Retrograde", "Wrong junctional PR readout");
          assert(junctionalFocus.style.display !== "none", "Junctional focus did not fire");
          av.value = "third";
          av.dispatchEvent(new win.Event("change", { bubbles: true }));
          assert(!av.disabled && !doc.querySelector("#junctional-av-note").hidden,
            "Junctional AV-block simplification was not disclosed");
          av.value = "normal";
          av.dispatchEvent(new win.Event("change", { bubbles: true }));
        }
      } finally {
        av.value = "normal";
        av.dispatchEvent(new win.Event("change", { bubbles: true }));
        rhythm.value = "sinus";
        rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
      }
    });
    test("AVNRT and AVRT show distinct synchronized circuits and preserve AV settings", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const av = doc.querySelector("#av-pattern");
      const rate = doc.querySelector("#heart-rate");
      const note = doc.querySelector("#av-reentry-note");
      const circuits = Object.fromEntries(["flutter", "avnrt", "avrt"].map(name =>
        [name, doc.querySelector(`[data-reentry-circuit="${name}"]`)]));
      const avBlock = [...doc.querySelectorAll('[data-conduction-marker="block"]')]
        .find(node => node.querySelector("title").textContent === "Atrial impulse fails to conduct");
      const change = (input, value) => {
        input.value = value;
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      try {
        change(av, "third");
        for (const name of ["avnrt", "avrt"]) {
          change(rhythm, name);
          assert(!note.hidden && av.disabled && av.value === "normal", `${name} did not disclose its AV restriction`);
          assert(avBlock.style.display === "none", `${name} displayed a complete AV block`);
          assert(rate.value === "180" && doc.querySelector("#pr-readout").textContent === "Retrograde",
            `${name} did not select tachycardia timing`);
          for (const [other, circuit] of Object.entries(circuits)) {
            assert((circuit.style.display !== "none") === (other === name), `${name} showed the wrong circuit`);
          }
          const movement = circuits[name].querySelector("circle").getAnimations()[0];
          close(movement.effect.getTiming().duration, 60000 / 180, `${name} circuit period`);
          assert(movement.effect.getTiming().iterations === Infinity, `${name} circuit does not repeat`);
          change(rate, "200");
          close(circuits[name].querySelector("circle").getAnimations()[0].effect.getTiming().duration,
            300, `${name} circuit did not follow the rate`);
        }
        assert(circuits.avrt.querySelector("path").getTotalLength() >
          2 * circuits.avnrt.querySelector("path").getTotalLength(), "AVRT and AVNRT circuits are not anatomically distinct");
        const nodalPath = circuits.avnrt.querySelector("path");
        const nodalBounds = nodalPath.getBBox();
        const nodalStart = nodalPath.getPointAtLength(0);
        const nodalOutbound = nodalPath.getPointAtLength(nodalPath.getTotalLength() * 0.1);
        assert(nodalStart.x > 365 && nodalStart.x < 380 && nodalBounds.y + nodalBounds.height > 355 &&
          nodalOutbound.y > nodalStart.y && nodalOutbound.x < nodalStart.x,
        "AVNRT loop does not descend below the AV node");
        const avrtPath = circuits.avrt.querySelector("path");
        const avrtStart = avrtPath.getPointAtLength(0);
        assert(Math.hypot(avrtStart.x - 372, avrtStart.y - 302) < 3, "AVRT does not start at the AV node");
        const chamber = name => [...doc.querySelectorAll("#anatomy-overlays path")]
          .find(node => node.querySelector("title")?.textContent === name);
        const leftVentricle = chamber("Left Ventricle");
        const leftAtrium = chamber("Left Atrium");
        const accessory = circuits.avrt.querySelector('[data-accessory-path="avrt"]');
        const accessoryStart = accessory.getPointAtLength(0);
        const accessoryEnd = accessory.getPointAtLength(accessory.getTotalLength());
        assert(leftVentricle.isPointInFill(accessoryStart) && leftAtrium.isPointInFill(accessoryEnd),
          "AVRT accessory pathway does not ascend from the left ventricle to the left atrium");
        change(rhythm, "sinus");
        assert(!av.disabled && av.value === "third" && note.hidden && avBlock.style.display !== "none",
          "Previous AV block selection was not restored");
      } finally {
        change(rhythm, "sinus");
        change(av, "normal");
      }
    });
    test("Flutter reentry loops at the atrial rate and follows playback controls", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const rate = doc.querySelector("#heart-rate");
      const speedControl = doc.querySelector("#speed");
      const circuit = doc.querySelector('[data-reentry-circuit="flutter"]');
      const selectRhythm = value => {
        rhythm.value = value;
        rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      try {
        assert(circuit.style.display === "none", "Flutter circuit appears in sinus rhythm");
        selectRhythm("flutter");
        assert(circuit.style.display !== "none", "Flutter circuit is hidden");
        const path = circuit.querySelector("path");
        const length = path.getTotalLength();
        const first = path.getPointAtLength(0);
        const opposite = path.getPointAtLength(length / 2);
        const angle = Math.atan2(first.y - opposite.y, first.x - opposite.x) * 180 / Math.PI;
        assert(Math.abs(angle + 48) < 0.2, "Circuit was not rotated 10 degrees counterclockwise");
        const atrium = [...doc.querySelectorAll("#anatomy-overlays path")]
          .find(node => node.querySelector("title")?.textContent === "Right Atrium");
        const boundary = [];
        for (let i = 0; i <= 500; i++) {
          const point = atrium.getPointAtLength(atrium.getTotalLength() * i / 500);
          if (point.x > 285 && point.x < 305 && point.y > 345 && point.y < 370) boundary.push(point);
        }
        let nearest = Infinity;
        let inside = 0;
        for (let i = 0; i < 500; i++) {
          const point = path.getPointAtLength(length * i / 500);
          if (atrium.isPointInFill(point)) inside++;
          for (const edge of boundary) nearest = Math.min(nearest, Math.hypot(point.x - edge.x, point.y - edge.y));
        }
        assert(nearest < 1 && inside >= 490, "Circuit's southeast edge is not aligned inside the right atrium");
        const dots = circuit.querySelectorAll("circle");
        assert(dots.length > 1, "Circuit has no circulating dot trail");
        const movement = dots[0].getAnimations()[0];
        const trailing = dots[1].getAnimations()[0];
        close(movement.effect.getTiming().duration, 200, "Flutter lap duration");
        assert(movement.effect.getTiming().iterations === Infinity, "Circuit does not repeat");
        assert(trailing.effect.getTiming().delay < 0, "Trail does not wrap around the closed loop");
        const position = time => {
          movement.currentTime = time;
          return new win.DOMPoint(0, 0).matrixTransform(dots[0].getCTM());
        };
        const start = position(0);
        const quarter = position(50);
        const lap = position(200);
        assert(Math.hypot(start.x - quarter.x, start.y - quarter.y) > 5, "Circuit dot does not move");
        const pathPoint = path.getPointAtLength(path.getTotalLength() / 4);
        const expected = new win.DOMPoint(pathPoint.x, pathPoint.y).matrixTransform(path.getCTM());
        assert(Math.hypot(quarter.x - expected.x, quarter.y - expected.y) < 0.05, "Circuit dot left the loop");
        assert(Math.hypot(start.x - lap.x, start.y - lap.y) < 0.05, "Circuit does not close after one beat");
        movement.currentTime = 0;
        speedControl.value = "0.5";
        speedControl.dispatchEvent(new win.Event("input", { bubbles: true }));
        assert(movement.playState === "paused" && movement.currentTime === 0 && movement.playbackRate === 0.5,
          "Paused circuit did not preserve its phase or playback speed");
        rate.value = "360";
        rate.dispatchEvent(new win.Event("change", { bubbles: true }));
        close(dots[0].getAnimations()[0].effect.getTiming().duration, 60000 / 360, "Updated flutter lap duration");
        selectRhythm("sinus");
        assert(circuit.style.display === "none" && dots[0].getAnimations().length === 0,
          "Circuit remains active after leaving flutter");
      } finally {
        speedControl.value = "1";
        speedControl.dispatchEvent(new win.Event("input", { bubbles: true }));
        selectRhythm("sinus");
      }
    });
    test("Flutter pathway dots follow the independent sinus clock, not flutter beats", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const rate = doc.querySelector("#heart-rate");
      const dot = doc.querySelector('[data-path="Atria1"] circle');
      const sinusNode = doc.querySelector('[data-node="SA node firing"]');
      const atrium = doc.querySelector('#anatomy-overlays path[fill="#ff0000"]');
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const select = value => {
        rhythm.value = value;
        rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const step = time => {
        pause.click();
        callback(now = time);
        pause.click();
      };
      try {
        select("flutter");
        const start = now;
        assert(sinusNode.style.display !== "none", "Sinus node did not fire at startup");
        step(start + 50);
        assert(Number(win.getComputedStyle(dot).opacity) > 0, "Sinus firing did not activate atrial pathways");
        const firstOpacity = Number(atrium.getAttribute("fill-opacity"));
        step(start + 250);
        assert(sinusNode.style.display === "none", "Flutter beat fired the sinus node");
        assert(Number(win.getComputedStyle(dot).opacity) === 0, "Flutter beat activated atrial pathways");
        close(Number(atrium.getAttribute("fill-opacity")), firstOpacity, "Atrial activation did not repeat with flutter");
        step(start + 1001);
        assert(sinusNode.style.display !== "none" && Number(win.getComputedStyle(dot).opacity) > 0,
          "Sinus firing did not recur at 60 bpm");
        rate.value = "320";
        rate.dispatchEvent(new win.Event("change", { bubbles: true }));
        const newStart = now;
        step(newStart + 1001);
        assert(sinusNode.style.display !== "none" && Number(win.getComputedStyle(dot).opacity) > 0,
          "Changing the flutter rate changed the sinus clock");
        step(newStart + 1125);
        assert(sinusNode.style.display === "none" && Number(win.getComputedStyle(dot).opacity) === 0,
          "A noncoincident flutter activation fired the sinus pathways");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        select("sinus");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("AV block marker follows failed impulses without covering conducted transit", () => {
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const rhythm = doc.querySelector("#rhythm-pattern");
      const av = doc.querySelector("#av-pattern");
      const rate = doc.querySelector("#heart-rate");
      const pr = doc.querySelector("#pr-interval");
      const originalPr = pr.value;
      const block = [...doc.querySelectorAll('[data-conduction-marker="block"]')]
        .find(node => node.querySelector("title").textContent === "Atrial impulse fails to conduct");
      const delay = doc.querySelector('[data-conduction-marker="delay"]');
      const avNode = doc.querySelector('[data-node="AV nodal transit"]');
      const visible = node => node.style.display !== "none";
      const change = (input, value) => {
        input.value = value;
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const step = time => {
        pause.click();
        callback(now = time);
        pause.click();
      };
      try {
        change(rhythm, "flutter");
        let start = now;
        step(start + 279);
        assert(!visible(block), "Block appeared before the flutter impulse reached the AV node");
        step(start + 281);
        assert(visible(block) && !visible(avNode), "Blocked flutter impulse did not stop at the AV node");
        step(start + 350);
        assert(visible(block), "Blocked impulse was not marked");
        step(start + 381);
        assert(!visible(block), "Intermittent block marker did not expire");
        step(start + 481);
        assert(!visible(block) && visible(avNode), "AV block marker covered the next conducted impulse");
        step(start + 560);
        assert(!visible(block), "Block marker remained during the conducted QRS");
        step(start + 681);
        assert(visible(block), "Next blocked flutter impulse was not marked");

        change(av, "first");
        change(pr, "380");
        change(rate, "360");
        start = now;
        step(start + 250);
        assert(!visible(block) && visible(avNode) && visible(delay),
          "A blocked impulse obscured overlapping conducted AV transit");
        step(start + 330);
        assert(!visible(block) && visible(avNode), "AV block marker reappeared during conducted transit");

        change(av, "third");
        start = now;
        step(start + 1600);
        assert(visible(block), "Complete AV block did not retain its marker");
        change(rhythm, "wpw");
        start = now;
        step(start + 90);
        assert(visible(block) && !visible(avNode), "Pre-excitation appeared to cross the completely blocked AV node");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        change(av, "normal");
        change(pr, originalPr);
        change(rhythm, "sinus");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
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
    test("Hourglass distinguishes delayed AV transit from failed conduction", () => {
      let callback;
      let now = doc.timeline.currentTime;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const hourglass = doc.querySelector('[data-conduction-marker="delay"]');
      const avBlock = [...doc.querySelectorAll('[data-conduction-marker="block"]')]
        .find(node => node.querySelector("title").textContent === "Atrial impulse fails to conduct");
      const visible = node => node.style.display !== "none";
      const setScenario = av => {
        if (pause.textContent === "Pause") pause.click();
        const select = doc.querySelector("#av-pattern");
        select.value = av;
        select.dispatchEvent(new win.Event("change", { bubbles: true }));
        pause.click();
        return now;
      };
      const step = time => callback(now = time);
      try {
        let start = setScenario("normal");
        step(start + 100);
        assert(!visible(hourglass) && !visible(avBlock), "Normal AV transit shows a delay or block");
        start = setScenario("first");
        step(start + 100);
        assert(visible(hourglass) && !visible(avBlock), "First-degree delay is not marked with an hourglass");
        step(start + 300);
        assert(!visible(hourglass), "Hourglass remains after the impulse leaves the AV node");
        start = setScenario("mobitz1");
        step(start + 100);
        assert(!visible(hourglass), "Initial Wenckebach beat is marked as progressively delayed");
        step(start + 60000 / Number(doc.querySelector("#heart-rate").value) + 100);
        assert(visible(hourglass) && !visible(avBlock), "Progressive Wenckebach delay is not marked");
        step(start + 3 * 60000 / Number(doc.querySelector("#heart-rate").value) + 250);
        assert(!visible(hourglass) && visible(avBlock), "Dropped Wenckebach impulse is not marked with X");
        start = setScenario("third");
        step(start + 100);
        assert(!visible(hourglass) && visible(avBlock), "Complete block shows an hourglass instead of X");
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
