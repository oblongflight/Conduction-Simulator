"use strict";

(async () => {
  const { Simulation, templates, atrialFoci, clone, validateMorphology } = window.Conduction;
  const { AutomaticityIllustration } = window;
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
    pac.advanceTo(8500);
    const ectopic = pac.atria.findIndex(beat => beat.origin === "PAC");
    assert(ectopic > 0, "No premature atrial beat was generated");
    const coupling = pac.atria[ectopic].time - pac.atria[ectopic - 1].time;
    const pause = pac.atria[ectopic + 1].time - pac.atria[ectopic].time;
    assert(coupling < 1000 && pause > 1000, "PAC coupling interval and pause were not premature");
    assert(pac.atria[ectopic].pWave.amplitude < 0, "PAC did not use an ectopic P-wave shape");
    assert(pac.atria[ectopic].focus === "left" && pac.atria.filter(beat => beat.origin !== "PAC").every(beat => !beat.focus),
      "PAC focus was not associated only with the premature beat");
    close(pac.atria[ectopic].pr, 160, "PAC PR timing changed");
  });

  test("PAC and focal atrial tachycardia share their focus and P-wave morphology", () => {
    for (const amplitude of [0.2, -0.15, 0]) {
      const morphology = clone(templates.none);
      morphology.waves[0].amplitude = amplitude;
      morphology.waves[0].duration = 180;
      morphology.waves.slice(1).forEach(item => { item.amplitude = 0; });
      const pac = new Simulation({ rhythm: "pac", atrialRate: 60 }, morphology);
      const tachy = new Simulation({ rhythm: "atrial_tachy" }, morphology);
      pac.advanceTo(8500);
      tachy.advanceTo(400);
      const premature = pac.atria.find(beat => beat.origin === "PAC");
      const focal = tachy.atria[0];
      assert(premature.focus === focal.focus && JSON.stringify(premature.pWave) === JSON.stringify(focal.pWave),
        "PAC and focal tachycardia do not share the same focus and P wave");
      for (let elapsed = 0; elapsed <= focal.pWave.duration; elapsed += 5) {
        close(pac.signalAt(premature.time + elapsed), tachy.signalAt(focal.time + elapsed),
          "PAC and focal tachycardia ECG P-wave samples differ");
      }
    }
  });

  test("Seeded PACs vary their placement, coupling, and recovery while remaining premature", () => {
    const signatures = new Set();
    const couplings = new Set();
    const recoveries = new Set();
    for (const randomSeed of [1, 2, 3, 4]) {
      const simulation = new Simulation({ rhythm: "pac", atrialRate: 60, randomSeed });
      simulation.advanceTo(11000);
      signatures.add(JSON.stringify(simulation.atria.map(beat => [beat.time, beat.origin])));
      let sinusCount = 0;
      for (let i = 0; i < simulation.atria.length - 1; i++) {
        const beat = simulation.atria[i];
        if (beat.origin !== "PAC") {
          sinusCount++;
          continue;
        }
        assert(sinusCount >= 2 && sinusCount <= 6, "Wrong number of sinus beats before PAC");
        const coupling = beat.time - simulation.atria[i - 1].time;
        const recovery = simulation.atria[i + 1].time - beat.time;
        assert(coupling >= 500 && coupling < 750, "PAC coupling interval is not premature");
        assert(recovery >= 1100 && recovery < 1400, "PAC recovery interval is outside its range");
        couplings.add(coupling);
        recoveries.add(recovery);
        sinusCount = 0;
      }
    }
    assert(signatures.size === 4, "Different seeds produced the same PAC sequence");
    assert(couplings.size > 1 && recoveries.size > 1, "PAC coupling or recovery did not vary");
  });

  test("Wandering and MAT randomize intervals and focus order without adjacent repeats", () => {
    for (const rhythm of ["wandering", "multifocal_atrial_tachy"]) {
      const signatures = new Set();
      const focusSequences = new Set();
      for (const randomSeed of [1, 2, 3, 4]) {
        const simulation = new Simulation({ rhythm, randomSeed });
        simulation.advanceTo(11000);
        const beats = simulation.atria;
        signatures.add(JSON.stringify(beats.map(beat => [beat.time, beat.focus])));
        focusSequences.add(beats.map(beat => beat.focus).join(","));
        for (let i = 1; i < beats.length; i++) {
          assert(beats[i].focus !== beats[i - 1].focus, `${rhythm} repeated an adjacent focus`);
        }
        for (let i = 0; i + 2 < beats.length; i += 3) {
          assert(new Set(beats.slice(i, i + 3).map(beat => beat.focus)).size === 3,
            `${rhythm} did not use each focus in a shuffle`);
        }
      }
      assert(signatures.size === 4, `${rhythm} did not vary with the seed`);
      assert(focusSequences.size > 1, `${rhythm} focus order did not vary with the seed`);
    }
  });

  test("Randomized rhythms reproduce event and ECG history regardless of advance partition", () => {
    for (const rhythm of ["pac", "wandering", "multifocal_atrial_tachy"]) {
      const settings = { rhythm, randomSeed: 123456789, av: "mobitz2" };
      const live = new Simulation(settings);
      const preview = new Simulation(settings);
      preview.advanceTo(10000);
      for (let time = 25; time <= 9000; time += 25) live.advanceTo(time);
      assert(JSON.stringify(live.atria) === JSON.stringify(preview.atria.filter(beat => beat.time <= 9000)),
        `${rhythm} preview and live atrial beats differ`);
      assert(JSON.stringify(live.events) === JSON.stringify(preview.events.filter(event => event.time <= 9000)),
        `${rhythm} event timing depends on advance partition`);
      for (let time = 0; time <= 9000; time += 37) {
        close(live.signalAt(time), preview.signalAt(time), `${rhythm} preview ECG differs`);
      }
    }
    for (const randomSeed of [-1, 1.5, 4294967296, NaN]) {
      let threw = false;
      try { new Simulation({ randomSeed }); } catch (error) { threw = /randomSeed/.test(error.message); }
      assert(threw, `Invalid random seed ${randomSeed} was accepted`);
    }
  });

  test("Tachycardia, pre-excitation, flutter, and fibrillation have distinct timing", () => {
    const wpw = new Simulation({ rhythm: "sinus", wpw: true });
    wpw.advanceTo(500);
    close(wpw.ventricles[0].time - wpw.atria[0].time, 100, "WPW PR interval");
    assert(wpw.ventricles[0].preexcited && wpw.ventricles[0].qrsMs > wpw.timing.qrsMs,
      "WPW did not produce pre-excitation and a widened QRS");
    const bypass = new Simulation({ rhythm: "sinus", wpw: true, av: "third" });
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

  test("Ventricular tachycardia starts in the ventricles with a regular wide-complex rhythm", () => {
    const simulation = new Simulation({ rhythm: "vt", atrialRate: 180, bundle: "rbbb" });
    simulation.advanceTo(2000);
    assert(simulation.atria.length === 0, "VT generated organized atrial activity");
    assert(simulation.ventricles.length === 7 &&
      simulation.ventricles.every(beat => beat.origin === "VT" && beat.qrsMs >= 160 && beat.bundle === "none"),
    "VT did not produce regular, wide, direct ventricular activations");
    simulation.ventricles.slice(1).forEach((beat, index) =>
      close(beat.time - simulation.ventricles[index].time, 60000 / 180, "VT interval"));
    assert(!simulation.events.some(event => ["av-arrival", "his", "block"].includes(event.type)),
      "VT used the atrioventricular conduction system");
    assert(Math.abs(simulation.signalAt(480)) > 0.01, "Wide VT waveform lost its extended repolarization");
  });

  test("PVCs interrupt but do not reset the sinus clock and have wide ventricular complexes", () => {
    for (const [focus, expectedBundle, delayedSide, earlySide] of [
      ["lv", "rbbb", "rv", "lv"], ["rv", "lbbb", "lv", "rv"]
    ]) {
      const simulation = new Simulation({ rhythm: "pvc", pvcFocus: focus, randomSeed: 123 });
      simulation.advanceTo(12000);
      const ectopic = simulation.ventricles.filter(beat => beat.origin === "PVC");
      assert(ectopic.length > 0, `${focus}: no PVCs were generated`);
      assert(simulation.atria.length > 1 && simulation.atria.every(beat => beat.origin === "pvc"),
        `${focus}: PVCs changed or replaced the underlying sinus rhythm`);
      assert(ectopic.every(beat => beat.qrsMs >= 160 && beat.bundle === expectedBundle),
        `${focus}: PVC did not produce a wide complex with contralateral delay`);
      const first = ectopic[0];
      const precedingAtrial = simulation.atria.findLast(beat => beat.time < first.time);
      const followingAtrial = simulation.atria.find(beat => beat.time > first.time);
      const period = 60000 / simulation.settings.atrialRate;
      close(first.time - precedingAtrial.time, period * 0.55, `${focus}: PVC coupling interval`);
      close(followingAtrial.time - precedingAtrial.time, period, `${focus}: PVC sinus pause`);
      assert(simulation.chamberOpacity(first.time + 94, earlySide) > 0 &&
        simulation.chamberOpacity(first.time + 94, delayedSide) === 0,
      `${focus}: focus-side depolarization did not precede the opposite ventricle`);
      assert(simulation.chamberOpacity(first.time + 100, delayedSide) > 0 &&
        simulation.events.some(event => event.type === "myocardial" &&
          event.ventricular === first && event.side === delayedSide && event.time === first.time + 95),
      `${focus}: depolarization did not propagate through the myocardium with bundle-block timing`);
    }
  });

  test("Ventricular fibrillation has continuous activity without organized beats", () => {
    const simulation = new Simulation({ rhythm: "vfib" });
    simulation.advanceTo(1000);
    assert(simulation.ventricularFibrillation && !simulation.events.length &&
      !simulation.atria.length && !simulation.ventricles.length,
    "VF generated discrete atrial or ventricular beats");
    assert(simulation.signalAt(0) !== simulation.signalAt(100) &&
      simulation.chamberOpacity(500, "rv") > 0 && simulation.chamberOpacity(500, "lv") > 0 &&
      simulation.chamberOpacity(500, "atria") === 0,
    "VF did not show continuous ventricular activity without atrial fibrillation");
  });

  test("WPW has one continuous slurred R upstroke and preserves QRS timing", () => {
    const simulation = new Simulation({ rhythm: "sinus", wpw: true });
    simulation.advanceTo(600);
    const beat = simulation.ventricles[0];
    const [q, r] = simulation.ventricularWaves;
    const peak = q.duration + 40 + r.duration * r.orientation;
    close(beat.qrsMs - simulation.timing.qrsMs, 40, "WPW QRS widening");
    close(beat.tStart - simulation.timing.tStart, 40, "WPW T-wave timing");
    close(beat.qtMs - simulation.timing.qtMs, 40, "WPW QT timing");
    close(simulation.signalAt(beat.time), 0, "QRS onset");
    let previous = 0;
    for (let elapsed = 0.5; elapsed < peak; elapsed += 0.5) {
      const current = simulation.signalAt(beat.time + elapsed);
      assert(current > previous, "WPW R upstroke has a separate peak or returns to baseline");
      previous = current;
    }
    close(simulation.signalAt(beat.time + peak), r.amplitude, "WPW R peak amplitude");
    let previousSlope = Infinity;
    for (let elapsed = 1; elapsed < peak; elapsed++) {
      const slope = simulation.signalAt(beat.time + elapsed) - simulation.signalAt(beat.time + elapsed - 1);
      assert(slope > 0 && slope <= previousSlope + 0.0000001, "The slurred upstroke ends before the R peak");
      previousSlope = slope;
    }
    assert(simulation.signalAt(beat.time + peak + 5) < r.amplitude, "R wave does not descend after its peak");

    for (const bundle of ["none", "rbbb", "lbbb"]) {
      const normal = new Simulation({ bundle });
      const wpw = new Simulation({ rhythm: "sinus", wpw: true, bundle });
      normal.advanceTo(700);
      wpw.advanceTo(700);
      const [qWave, rWave] = normal.ventricularWaves;
      const afterR = qWave.duration + qWave.gap + rWave.duration + rWave.gap;
      for (let elapsed = afterR; elapsed <= normal.timing.qtMs; elapsed += 7) {
        close(wpw.signalAt(wpw.ventricles[0].time + elapsed + 40),
          normal.signalAt(normal.ventricles[0].time + elapsed), `${bundle} waves after R changed`);
      }
    }
  });

  test("WPW preserves a nonzero Q and follows custom R amplitude and polarity", () => {
    for (const amplitude of [0.6, -0.6, 0]) {
      const custom = clone(templates.none);
      custom.waves[0].amplitude = 0;
      custom.waves[1].amplitude = -0.2;
      custom.waves[1].duration = 20;
      custom.waves[2].amplitude = amplitude;
      const simulation = new Simulation({ rhythm: "sinus", wpw: true }, custom);
      simulation.advanceTo(400);
      const start = simulation.ventricles[0].time;
      close(simulation.signalAt(start + 10), -0.2, "Custom Q wave changed or has an extra delta deflection");
      close(simulation.signalAt(start + 20), 0, "Q did not lead directly into the R wave");
      const earlyR = simulation.signalAt(start + 40);
      assert(amplitude === 0 ? earlyR === 0 : Math.sign(earlyR) === Math.sign(amplitude),
        "WPW slur did not follow custom R polarity");
      close(simulation.signalAt(start + 20 + 40 + custom.waves[2].duration * custom.waves[2].orientation),
        amplitude, "Custom WPW R peak");
    }
  });

  test("WPW pre-excites the left ventricle at QRS onset, even with AV or left bundle block", () => {
    for (const av of ["normal", "third"]) {
      for (const bundle of ["none", "rbbb", "lbbb"]) {
        const simulation = new Simulation({ rhythm: "sinus", wpw: true, av, bundle });
        simulation.advanceTo(120);
        const beat = simulation.ventricles[0];
        const activation = simulation.events.find(event => event.type === "accessory-ventricular");
        assert(activation?.ventricular === beat && activation.time === beat.time,
          `${av}/${bundle} lacks accessory-mediated ventricular activation`);
        close(beat.time, 100, "Accessory ventricular activation time");
        if (bundle !== "lbbb") {
          assert(simulation.chamberOpacity(beat.time + 10, "lv") > 0,
            `${av}/${bundle} did not begin left ventricular depolarization at QRS onset`);
        }
        close(simulation.chamberOpacity(beat.time + 10, "rv"), 0, "Right ventricle activated before its modeled onset");
      }
    }
    const sinus = new Simulation();
    sinus.advanceTo(200);
    assert(!sinus.events.some(event => event.type === "accessory-ventricular"), "Accessory activation leaked into sinus rhythm");
  });

  test("WPW conducts each flutter beat 1:1 while retaining the independent sinus clock", () => {
    for (const av of ["normal", "first", "mobitz1", "mobitz2", "third"]) {
      const simulation = new Simulation({ rhythm: "flutter", wpw: true, av });
      simulation.advanceTo(1100);
      assert(simulation.atria.length === 6 && simulation.ventricles.length === 6,
        `${av}: flutter did not conduct every atrial beat`);
      simulation.atria.forEach((beat, i) => {
        assert(beat.conducted && beat.pWave === null && simulation.ventricles[i].preexcited,
          `${av}: flutter beat was not preexcited`);
        close(simulation.ventricles[i].time - beat.time, 100, `${av}: flutter accessory delay`);
      });
      assert(simulation.events.filter(event => event.type === "sinus-firing").map(event => event.time).join(",") === "0,1000",
        `${av}: flutter sinus clock changed`);
      assert(!simulation.events.some(event => event.type === "escape"),
        `${av}: bypass produced extra escape beats`);
      const nodal = new Simulation({ rhythm: "flutter", av });
      nodal.advanceTo(1100);
      const nodeEvents = model => model.events.filter(event =>
        event.beat && ["av-arrival", "av-release", "his", "block"].includes(event.type))
        .map(event => [event.time, event.type, event.site]);
      assert(JSON.stringify(nodeEvents(simulation)) === JSON.stringify(nodeEvents(nodal)),
        `${av}: WPW changed AV nodal transit or blocking`);
    }
  });

  test("Flutter AV refractoriness determines the conduction ratio at and between thresholds", () => {
    for (const [avRefractory, ratio] of [[100, 1], [200, 1], [210, 2], [400, 2], [410, 3], [800, 4]]) {
      const simulation = new Simulation({ rhythm: "flutter", avRefractory });
      simulation.advanceTo(6000);
      simulation.atria.forEach((beat, i) => {
        assert(beat.conducted === (i % ratio === 0), `${avRefractory} ms: incorrect flutter conduction`);
      });
      simulation.ventricles.slice(1).forEach((beat, i) =>
        close(beat.time - simulation.ventricles[i].time, ratio * 200, "Flutter R-R interval"));
      assert(simulation.events.filter(event => event.type === "sinus-firing").length === 7,
        "Refractoriness changed flutter's independent sinus clock");
      const wpw = new Simulation({ rhythm: "flutter", avRefractory, wpw: true });
      wpw.advanceTo(6000);
      wpw.atria.forEach((beat, i) => {
        assert(beat.avConducted === simulation.atria[i].conducted && beat.conducted,
          `${avRefractory} ms: WPW lost AV nodal filtering or accessory conduction`);
      });
      assert(wpw.ventricles.length === wpw.atria.filter(beat => beat.time + 100 <= wpw.now).length,
        `${avRefractory} ms: WPW produced missing or duplicate ventricular beats`);
    }
    const boundary = new Simulation({ rhythm: "flutter", atrialRate: 320, avRefractory: 375 });
    boundary.advanceTo(3000);
    assert(boundary.atria.every((beat, i) => beat.conducted === (i % 2 === 0)),
      "A flutter impulse arriving exactly at recovery was blocked");
  });

  test("AF refractoriness filters a fixed irregular atrial input into ventricular responses", () => {
    const results = [150, 350, 600, 800].map(avRefractory => {
      const simulation = new Simulation({ rhythm: "afib", avRefractory });
      simulation.advanceTo(10000);
      const inputs = simulation.events.filter(event => event.type === "afib");
      const accepted = inputs.filter(event => event.conducted);
      const rejected = inputs.filter(event => !event.conducted);
      assert(rejected.length > 0 && accepted.length > 2, "AF did not filter its atrial input");
      assert(simulation.atria.length === 0 &&
        simulation.ventricles.length === accepted.filter(event => event.time + 80 <= 10000).length,
      "AF generated organized atrial waves or mismatched ventricular beats");
      accepted.slice(1).forEach((event, i) => {
        assert(event.time - accepted[i].time >= avRefractory - 0.000001,
          "AF conducted while the AV node was refractory");
      });
      const intervals = simulation.ventricles.slice(1).map((beat, i) => beat.time - simulation.ventricles[i].time);
      assert(new Set(intervals.map(interval => Math.round(interval))).size > 1, "AF response is not irregular");
      return { inputs: inputs.map(event => event.time), count: accepted.length };
    });
    for (let i = 1; i < results.length; i++) {
      assert(JSON.stringify(results[i].inputs) === JSON.stringify(results[0].inputs),
        "Refractoriness changed the AF atrial input");
      assert(results[i].count < results[i - 1].count, "Longer refractoriness did not reduce the AF response");
    }
  });

  test("WPW bypasses AV refractoriness in flutter and AF", () => {
    for (const rhythm of ["flutter", "afib"]) {
      const fast = new Simulation({ rhythm, wpw: true, avRefractory: 100 });
      const slow = new Simulation({ rhythm, wpw: true, avRefractory: 800 });
      fast.advanceTo(4000);
      slow.advanceTo(4000);
      assert(JSON.stringify(fast.ventricles) === JSON.stringify(slow.ventricles),
        `${rhythm}: AV refractoriness changed the WPW ventricular response`);
      if (rhythm === "afib") {
        assert(JSON.stringify(fast.events) === JSON.stringify(slow.events),
          "AF with WPW unexpectedly modeled discrete AV nodal events");
      } else {
        assert(fast.atria.every(beat => beat.avConducted) &&
          slow.atria.some(beat => !beat.avConducted),
        "Flutter with WPW did not independently model AV refractoriness");
      }
      for (let time = 0; time <= 4000; time += 37) {
        close(fast.signalAt(time), slow.signalAt(time), `${rhythm}: WPW waveform changed`);
      }
    }
  });

  test("AF and flutter refractory filtering is frame-independent and matches ECG preview", () => {
    for (const [rhythm, wpw] of [["afib", false], ["flutter", false], ["flutter", true]]) {
      const live = new Simulation({ rhythm, wpw, avRefractory: 410 });
      const preview = new Simulation({ rhythm, wpw, avRefractory: 410 });
      preview.advanceTo(6000);
      for (let time = 25; time <= 4000; time += 25) live.advanceTo(time);
      for (let time = 0; time <= 4000; time += 17) {
        close(live.signalAt(time), preview.signalAt(time), `${rhythm}: ECG preview differs from live model`);
      }
      assert(JSON.stringify(live.ventricles) === JSON.stringify(preview.ventricles.filter(beat => beat.time <= 4000)),
        `${rhythm}: preview and live ventricular activations differ`);
      assert(JSON.stringify(live.events) === JSON.stringify(preview.events.filter(event => event.time <= 4000)),
        `${rhythm}: preview and live nodal events differ`);
    }
  });

  test("WPW preserves focal P-wave identities and bypasses AV block in atrial tachycardias", () => {
    for (const rhythm of ["atrial_tachy", "multifocal_atrial_tachy"]) {
      const ordinary = new Simulation({ rhythm, av: "third" });
      const bypass = new Simulation({ rhythm, av: "third", wpw: true });
      ordinary.advanceTo(2000);
      bypass.advanceTo(2000);
      assert(bypass.atria.length === ordinary.atria.length, `${rhythm}: atrial timing changed`);
      bypass.atria.forEach((beat, i) => {
        assert(beat.time === ordinary.atria[i].time && beat.focus === ordinary.atria[i].focus &&
          JSON.stringify(beat.pWave) === JSON.stringify(ordinary.atria[i].pWave),
        `${rhythm}: WPW changed the atrial focus or P morphology`);
      });
      assert(bypass.ventricles.length === bypass.atria.filter(beat => beat.time + 100 <= 2000).length &&
        bypass.ventricles.every(beat => beat.preexcited), `${rhythm}: missing or extra ventricular beats`);
      assert(!bypass.events.some(event => event.type === "escape"), `${rhythm}: unexpected escape rhythm`);
    }
  });

  test("WPW leaves orthodromic AVRT unchanged and rejects unsupported settings", () => {
    const avrt = new Simulation({ rhythm: "avrt" });
    const enabled = new Simulation({ rhythm: "avrt", wpw: true });
    avrt.advanceTo(2000);
    enabled.advanceTo(2000);
    assert(JSON.stringify(avrt.events) === JSON.stringify(enabled.events) &&
      enabled.ventricles.every(beat => !beat.preexcited && beat.qrsMs === enabled.timing.qrsMs),
    "WPW changed orthodromic AVRT conduction");
    for (const settings of [
      { rhythm: "wpw" }, { rhythm: "avnrt", wpw: true },
      { rhythm: "junctional_tachy", wpw: true }, { wpw: "true" }
    ]) {
      let threw = false;
      try { new Simulation(settings); } catch (error) { threw = true; }
      assert(threw, `Invalid WPW setting accepted: ${JSON.stringify(settings)}`);
    }
  });

  test("AF with WPW produces continuous ventricular fibrillation without organized beats", () => {
    for (const av of ["normal", "third"]) {
      const settings = { rhythm: "afib", wpw: true, av };
      const live = new Simulation(settings);
      const preview = new Simulation(settings);
      live.advanceTo(5000);
      for (let time = 0; time <= 5000; time += 25) preview.advanceTo(time);
      assert(live.ventricularFibrillation && !live.events.length && !live.atria.length &&
        !live.ventricles.length && !live.queue.length, `${av}: VF generated organized events`);
      const samples = [];
      for (let time = 0; time < 2000; time += 13) {
        const signal = live.signalAt(time);
        samples.push(signal);
        close(signal, preview.signalAt(time), "VF preview differs from live signal");
        for (const chamber of ["atria", "rv", "lv"]) {
          const opacity = live.chamberOpacity(time, chamber);
          assert(opacity >= 0.06 && opacity <= 0.5, `${av}: invalid ${chamber} fibrillation opacity`);
        }
      }
      assert(Math.max(...samples) > 0.3 && Math.min(...samples) < -0.3,
        `${av}: VF waveform does not fluctuate around baseline`);
      assert(live.chamberOpacity(500, "rv") !== live.chamberOpacity(500, "lv"),
        "Ventricles did not fibrillate independently");
      let threw = false;
      try { live.step(); } catch (error) { threw = /no discrete events/i.test(error.message); }
      assert(threw, "Stepping an eventless VF model did not report the condition");
    }
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

  test("AVRT accessory conduction spans ventricular to retrograde atrial activation", () => {
    for (const bundle of ["none", "rbbb", "lbbb"]) {
      const simulation = new Simulation({ rhythm: "avrt", bundle });
      simulation.advanceTo(1200);
      const impulses = simulation.events.filter(event => event.type === "accessory-retrograde");
      assert(impulses.length === simulation.ventricles.length && impulses.length === simulation.atria.length,
        `${bundle}: AVRT pathway impulses do not match beats`);
      impulses.forEach((event, i) => {
        close(event.time, simulation.ventricles[i].time, "Accessory conduction onset");
        close(event.endTime, simulation.atria[i].time, "Accessory conduction end");
        assert(event.endTime <= simulation.ventricles[i].time + simulation.ventricles[i].qrsMs,
          `${bundle}: accessory conduction continued past ventricular depolarization`);
      });
    }
    const avnrt = new Simulation({ rhythm: "avnrt" });
    avnrt.advanceTo(1200);
    assert(!avnrt.events.some(event => event.type === "accessory-retrograde"),
      "AVRT accessory events leaked into AVNRT");
  });

  test("Every rhythm composes with each bundle morphology", () => {
    for (const rhythm of Object.keys(window.Conduction.rhythms)) {
      for (const bundle of ["none", "rbbb", "lbbb"]) {
        const simulation = new Simulation({ rhythm, bundle });
        simulation.advanceTo(3000);
        if (rhythm === "vfib") {
          assert(simulation.ventricularFibrillation && !simulation.ventricles.length,
            `${rhythm}/${bundle} generated organized ventricular beats`);
        } else {
          assert(simulation.ventricles.length > 0, `${rhythm}/${bundle} produced no ventricular activity`);
        }
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
      () => new Simulation({ avRefractory: 99 }),
      () => new Simulation({ avRefractory: 801 }),
      () => new Simulation({ avRefractory: NaN }),
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

  test("Resizing preserves the seeded randomized ECG history", () => {
    const viewport = { left: 44, right: 356, baseline: 74, amplitude: 68, height: 140 };
    const pixels = image => image.getContext("2d").getImageData(0, 0, image.width, image.height).data;
    for (const rhythm of ["pac", "wandering", "multifocal_atrial_tachy"]) {
      const settings = { rhythm, randomSeed: 123456789 };
      const strip = new window.EcgStrip(new Simulation(settings));
      strip.configure({ ...viewport, right: 256 }, 1);
      strip.renderTile(7);
      strip.configure(viewport, 1);
      const reference = new window.EcgStrip(new Simulation(settings));
      reference.configure(viewport, 1);
      const actual = pixels(strip.renderTile(6));
      const expected = pixels(reference.renderTile(6));
      assert(actual.some(value => value > 0) && actual.every((value, i) => value === expected[i]),
        `${rhythm} changed its randomized waveform on resize`);
    }
  });

  test("Rhythm transitions retain ECG history, join continuously, and survive resize", () => {
    const viewport = { left: 44, right: 356, baseline: 74, amplitude: 68, height: 140 };
    const strip = new window.EcgStrip(new Simulation({ rhythm: "sinus", atrialRate: 60 }));
    strip.configure(viewport, 1);
    strip.renderTile(0);
    const transition = 3180;
    const times = [1000, 2500, transition - 0.001];
    const history = times.map(time => strip.signalAt(time));
    const seam = strip.signalAt(transition);
    strip.append(new Simulation({ rhythm: "flutter" }), transition);
    close(strip.signalAt(transition), seam, "Rhythm transition broke the trace");
    strip.renderTile(0);
    times.forEach((time, index) => close(strip.signalAt(time), history[index], "Rhythm transition changed ECG history"));
    close(strip.signalAt(transition + 100), strip.model.signalAt(100), "New rhythm did not take over after the join");
    const secondSeam = strip.signalAt(transition + 40);
    strip.append(new Simulation({ rhythm: "afib" }), transition + 40);
    close(strip.signalAt(transition + 40), secondSeam, "Rapid rhythm changes broke the trace");
    strip.renderTile(0);
    const samples = [1000, transition - 1, transition + 20, transition + 40, transition + 150]
      .map(time => strip.signalAt(time));
    strip.configure({ ...viewport, right: 300 }, 1);
    strip.renderTile(0);
    [1000, transition - 1, transition + 20, transition + 40, transition + 150]
      .forEach((time, index) => close(strip.signalAt(time), samples[index], "Resize changed a transition"));
  });

  test("Pacemaker counters charge and reset on independent chamber activations", () => {
    const live = new Simulation({ atrialRate: 60 });
    const before = JSON.stringify(live);
    const counters = new AutomaticityIllustration(live);
    let state = counters.sample(0);
    assert(state.atria.phase === "activation" && state.atria.digit === 9 &&
      state.rv.phase === "charging" && state.rv.charges.muscle === 0 &&
      state.lv.phase === "charging" && state.av.phase === "charging",
    "Initial atrial activation reset the ventricles");
    state = counters.sample(60);
    assert(state.atria.digit === 4 && state.atria.phase === "activation", "Atrial red countdown did not decrease");
    state = counters.sample(80);
    assert(state.av.phase === "activation" && state.av.digit === 9 &&
      state.rv.phase === "charging" && state.lv.phase === "charging",
    "AV node did not activate separately at atrial impulse arrival");
    state = counters.sample(120);
    assert(state.atria.phase === "charging" && state.atria.charges.sinus === 0,
      "Atrial countdown did not end at zero");
    state = counters.sample(160);
    assert(state.av.phase === "charging" && state.av.charges.av === 0 &&
      state.rv.phase === "charging" && state.lv.phase === "charging",
    "AV countdown did not end independently before ventricular muscle activation");
    state = counters.sample(175);
    assert(state.atria.phase === "charging" && state.rv.phase === "activation" &&
      state.rv.digit === 9 && state.lv.phase === "activation" && state.lv.digit === 9,
    "Normal conduction did not reset both ventricular counters at muscle activation");
    state = counters.sample(335);
    assert(state.rv.phase === "charging" && state.rv.charges.muscle === 0 &&
      state.lv.phase === "charging" && state.lv.charges.muscle === 0,
      "Ventricular countdown did not end at zero");
    state = counters.sample(999);
    assert(Math.floor(state.atria.charges.sinus) === 9 &&
      state.atria.charges.sinus > state.atria.charges.left &&
      state.atria.charges.sinus > state.rv.charges.muscle &&
      state.atria.charges.sinus > state.av.charges.av,
    "SA counters did not outpace myocardial counters before a sinus beat");
    state = counters.sample(1000);
    assert(state.atria.phase === "activation" && state.atria.digit === 9 &&
      state.rv.phase === "charging" && state.lv.phase === "charging" &&
      state.av.phase === "charging", "P wave reset downstream counters before conduction");
    assert(JSON.stringify(live) === before, "Counter sampling mutated the live electrical model");
    const blocked = new AutomaticityIllustration(new Simulation({ atrialRate: 60, av: "third" }));
    assert(blocked.sample(80).av.phase === "charging" &&
      blocked.sample(160).rv.phase === "charging" &&
      Math.floor(blocked.sample(349).av.charges.av) === 9 &&
      blocked.sample(350).av.phase === "activation" &&
      blocked.sample(385).rv.phase === "activation" &&
      blocked.sample(1080).av.phase === "charging" && blocked.sample(1080).av.charges.av > 4,
    "Complete block counters did not follow the independent escape beat");
  });

  test("Resting ventricular and AV counters charge on intrinsic timelines before local reset", () => {
    const live = new Simulation({ atrialRate: 60 });
    const before = JSON.stringify(live);
    const counters = new AutomaticityIllustration(live);
    const slowerSinus = new AutomaticityIllustration(new Simulation({ atrialRate: 40 }));
    const early = counters.sample(700);
    const later = counters.sample(1074);
    for (const chamber of ["rv", "lv", "av"]) {
      const site = chamber === "av" ? "av" : "muscle";
      assert(early[chamber].phase === "charging" && later[chamber].phase === "charging" &&
        later[chamber].charges[site] > early[chamber].charges[site],
      `${chamber}: resting charge did not increase before the next activation`);
      close(early[chamber].charges[site], slowerSinus.sample(700)[chamber].charges[site],
        `${chamber}: resting charge depended on the next sinus beat`);
    }
    const ventricularDigits = [0.8, 0.9, 1, 1.1, 1.2]
      .map(scale => Math.floor(later.rv.charges.muscle * scale));
    assert(new Set(ventricularDigits).size >= 3 && Math.min(...ventricularDigits) >= 2,
      "Ventricular resting counters did not visibly increase at varied speeds");
    close(early.rv.charges.muscle, (700 - 335) * 30 / 6000, "Ventricular escape-like charge");
    close(early.av.charges.av, (700 - 160) * 50 / 6000, "Independent junctional escape-like charge");
    assert(early.av.charges.av > early.rv.charges.muscle, "Junctional charging did not outpace ventricular charging");
    assert(counters.sample(1080).av.phase === "activation" &&
      counters.sample(1080).rv.phase === "charging" &&
      counters.sample(1175).rv.phase === "activation",
    "AV and ventricular counters no longer reset on their separate local activations");
    assert(JSON.stringify(live) === before, "Resting counters generated beats or advanced the live clock");
  });

  test("Flutter counters follow reentry and AV filtering rather than a winning SA pacemaker", () => {
    const live = new Simulation({ rhythm: "flutter", atrialRate: 300 });
    const before = JSON.stringify(live);
    const counters = new AutomaticityIllustration(live);
    assert(counters.sample(0).atria.phase === "activation", "Flutter atrial activation is missing");
    const charged = counters.sample(199).atria;
    assert(Math.floor(charged.charges.muscle) === 9 && charged.charges.sinus < 9,
      "Flutter did not charge atrial tissue ahead of the suppressed SA node");
    assert(counters.sample(200).atria.phase === "activation", "Flutter counters missed the next circuit cycle");
    assert(counters.sample(280).av.phase === "activation", "Blocked flutter input did not reach the AV counter");
    assert(counters.sample(375).rv.phase === "charging", "Blocked flutter input reset ventricular counters");
    assert(counters.sample(575).rv.phase === "activation", "Conducted flutter input missed ventricular activation");
    assert(JSON.stringify(live) === before, "Flutter counters advanced the live model");
  });

  test("AF counters vary locally while downstream counters follow modeled AV and ventricular activations", () => {
    const live = new Simulation({ rhythm: "afib" });
    const before = JSON.stringify(live);
    const counters = new AutomaticityIllustration(live);
    const sampleCells = time => {
      const states = counters.sample(time);
      return Array.from({ length: 24 }, (_, index) =>
        counters.cellState(time, "atria", "muscle", index, states.atria));
    };
    const states = sampleCells(100);
    assert(states.some(state => state.phase === "activation") && states.some(state => state.phase === "charging"),
      "AF atrial counters reset synchronously");
    assert(JSON.stringify(states) !== JSON.stringify(sampleCells(125)), "AF local counters do not fluctuate");
    assert(JSON.stringify(states) === JSON.stringify(sampleCells(100)), "AF local counters are not repeatable when paused");
    for (let time = 0; time < 1000; time += 17) {
      for (const state of sampleCells(time)) {
        const digit = state.phase === "activation" ? state.digit : Math.floor(state.charges.muscle);
        assert(Number.isInteger(digit) && digit >= 0 && digit <= 9, "AF counter exceeded its digit range");
      }
    }
    assert(counters.sample(0).av.phase === "activation", "AF input did not reset the AV counter");
    assert(counters.sample(95).rv.phase === "activation", "AF ventricular activation missed its counter");
    const blocked = new AutomaticityIllustration(new Simulation({ rhythm: "afib", av: "third" }));
    assert(blocked.sample(0).av.phase === "charging" && blocked.sample(95).rv.phase === "charging",
      "Complete block AF inputs reset downstream counters");
    const preexcited = new AutomaticityIllustration(new Simulation({ rhythm: "afib", wpw: true }));
    const preexcitedStates = preexcited.sample(100);
    const ventricularCells = Array.from({ length: 24 }, (_, index) =>
      preexcited.cellState(100, "rv", "muscle", index, preexcitedStates.rv));
    assert(ventricularCells.some(state => state.phase === "activation") &&
      ventricularCells.some(state => state.phase === "charging"),
    "AF with WPW displayed organized or inactive ventricular counters during VF");
    assert(JSON.stringify(live) === before, "AF counters advanced the live model");
  });

  test("Pacemaker counters anticipate the seeded ectopic focus without changing beat generation", () => {
    for (const settings of [
      { rhythm: "pac" }, { rhythm: "atrial_tachy" }, { rhythm: "wandering" },
      { rhythm: "multifocal_atrial_tachy" }, { rhythm: "pvc", pvcFocus: "lv" },
      { rhythm: "pvc", pvcFocus: "rv" }
    ]) {
      const live = new Simulation({ ...settings, randomSeed: 123 });
      const expected = new Simulation(live.settings);
      expected.advanceTo(8500);
      const counters = new AutomaticityIllustration(live);
      const beats = [
        ...expected.atria.filter(beat => beat.time > 0).map(beat => ({
          beat, chamber: "atria", focus: beat.focus || (beat.origin === "PAC" ? "left" : "sinus")
        })),
        ...expected.ventricles.filter(beat => beat.origin === "PVC").map(beat => ({
          beat: { ...beat, time: expected.ventricularActivationTime(beat, settings.pvcFocus) },
          chamber: settings.pvcFocus, focus: settings.pvcFocus
        }))
      ].sort((a, b) => a.beat.time - b.beat.time);
      for (const { beat, chamber, focus } of beats) {
        const before = counters.sample(beat.time - 1)[chamber];
        assert(before.phase === "charging" && Math.floor(before.charges[focus]) === 9,
          `${settings.rhythm}: ${focus} did not reach 9 just before its beat`);
        assert(Object.entries(before.charges).every(([id, value]) => id === focus || value < 9),
          `${settings.rhythm}: a suppressed site reached threshold before the winning focus`);
        const after = counters.sample(beat.time)[chamber];
        assert(after.phase === "activation" && after.digit === 9,
          `${settings.rhythm}: activation did not start its red countdown`);
        if (chamber === "lv" || chamber === "rv") {
          assert(counters.sample(beat.time).atria.phase === "charging",
            "A PVC reset the independent atrial counters");
        }
      }
      assert(live.now === 0 && live.randomState === new Simulation(live.settings).randomState,
        "Counter preview advanced the live clock or random sequence");
    }
    const single = new AutomaticityIllustration(new Simulation({ rhythm: "multifocal_atrial_tachy", randomSeed: 123 }));
    const partitioned = new AutomaticityIllustration(new Simulation(single.source.settings));
    for (let time = 0; time < 8000; time += 37) partitioned.sample(time);
    assert(JSON.stringify(single.sample(8000)) === JSON.stringify(partitioned.sample(8000)),
      "Counter state depends on animation frame partitioning");
  });

  test("Ventricular counter timing matches each ventricle's depolarization in bundle blocks", () => {
    for (const [bundle, first, delayed] of [["rbbb", "lv", "rv"], ["lbbb", "rv", "lv"]]) {
      const live = new Simulation({ atrialRate: 60, bundle });
      const counters = new AutomaticityIllustration(live);
      let state = counters.sample(174.999);
      assert(state.lv.phase === "charging" && state.rv.phase === "charging",
        `${bundle}: counters activated before ventricular muscle depolarization`);
      state = counters.sample(175);
      assert(state[first].phase === "activation" && state[first].digit === 9 &&
        state[delayed].phase === "charging", `${bundle}: blocked ventricle did not activate later`);
      state = counters.sample(254.999);
      assert(state[delayed].phase === "charging", `${bundle}: delayed counters started before transseptal conduction`);
      state = counters.sample(255);
      assert(state[delayed].phase === "activation" && state[delayed].digit === 9 &&
        state[first].phase === "activation" && state[first].digit === 4,
      `${bundle}: ventricular countdowns do not reflect their 80 ms activation difference`);
      state = counters.sample(335);
      assert(state[first].phase === "charging" && state[delayed].phase === "activation",
        `${bundle}: both ventricular regions finished their countdown together`);
      state = counters.sample(415);
      assert(state[delayed].phase === "charging" && state[delayed].charges.muscle === 0,
        `${bundle}: delayed ventricle did not restart from zero`);
      assert(live.now === 0 && live.ventricles.length === 0, "Regional counter timing advanced the live ECG");
    }
    const wpw = new AutomaticityIllustration(new Simulation({ wpw: true }));
    assert(wpw.sample(100).lv.phase === "activation" && wpw.sample(100).rv.phase === "charging" &&
      wpw.sample(115).rv.phase === "activation", "WPW counters ignored early left ventricular activation");
  });

  test("Junctional counters follow AV firing without predicting a sinus beat", () => {
    for (const [rhythm, atrialRate] of [["junctional", 60], ["junctional_tachy", 120]]) {
      const live = new Simulation({ rhythm, atrialRate });
      const before = JSON.stringify(live);
      const counters = new AutomaticityIllustration(live);
      const cycle = 60000 / atrialRate;
      for (const time of [0, cycle, cycle * 2]) {
        let state = counters.sample(time);
        assert(state.av.phase === "activation" && state.av.digit === 9 &&
          state.atria.phase === "charging" && state.rv.phase === "charging",
        `${rhythm}: firing did not begin at the AV node`);
        state = counters.sample(time + 50);
        assert(state.rv.phase === "activation" && state.lv.phase === "activation" &&
          state.rv.digit === 9 && state.atria.phase === "charging",
        `${rhythm}: ventricular activation did not follow nodal firing`);
        state = counters.sample(time + 65);
        assert(state.atria.phase === "activation" && state.atria.digit === 9,
          `${rhythm}: retrograde activation did not reset atrial counters`);
        state = counters.sample(time + cycle - 1);
        assert(state.av.phase === "charging" && Math.floor(state.av.charges.av) === 9 &&
          state.atria.phase === "charging" &&
          Object.values(state.atria.charges).every(charge => charge < 9),
        `${rhythm}: AV counter did not reach threshold ahead of suppressed atrial sites`);
        state = counters.sample(time + cycle + 64);
        assert(state.atria.phase === "charging" &&
          Object.values(state.atria.charges).every(charge => charge < 9),
        `${rhythm}: retrograde atrial activation was incorrectly predicted as a sinus beat`);
      }
      assert(JSON.stringify(live) === before, `${rhythm}: counter preview changed the live ECG`);
    }
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
    win.Math.random = () => 0;
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
    const rhythmControl = doc.querySelector("#rhythm-pattern");
    const queuedControls = [rhythmControl, doc.querySelector("#av-pattern"),
      doc.querySelector("#bundle-pattern"), doc.querySelector("#wpw-enabled"),
      doc.querySelector("#heart-rate"), doc.querySelector("#av-refractory")];
    const resetAfterSelection = () => {
      const currentTime = doc.timeline.currentTime;
      const descriptor = Object.getOwnPropertyDescriptor(doc.timeline, "currentTime");
      const request = win.requestAnimationFrame;
      let callback;
      let time = currentTime;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => time });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      if (pause.textContent === "Pause") pause.click();
      const tile = doc.querySelector("#ecg-trace canvas");
      const ratio = doc.querySelector("#ecg-canvas").getContext("2d").getTransform().a;
      const width = tile.width / ratio;
      const viewport = Math.round((doc.querySelector("#ecg-plot").getBoundingClientRect().width - 88) * ratio) / ratio;
      const delay = viewport * 5000 / (2 * width) + Math.ceil(4 * ratio) * 5000 / tile.width;
      pause.click();
      callback(time += delay / Number(doc.querySelector("#speed").value));
      pause.click();
      if (descriptor) Object.defineProperty(doc.timeline, "currentTime", descriptor);
      else delete doc.timeline.currentTime;
      win.requestAnimationFrame = request;
      doc.querySelector("#speed").dispatchEvent(new win.Event("input", { bubbles: true }));
    };
    const resetSelectionsImmediately = enabled => {
      for (const control of queuedControls) {
        const event = control.id === "av-refractory" ? "input" : "change";
        if (enabled) control.addEventListener(event, resetAfterSelection);
        else control.removeEventListener(event, resetAfterSelection);
      }
    };
    const assertArrowDirection = (arrow, path, fraction, reverse = false) => {
      const length = path.getTotalLength();
      const before = path.getPointAtLength(length * fraction - 0.1);
      const after = path.getPointAtLength(length * fraction + 0.1);
      const start = new win.DOMPoint(before.x, before.y).matrixTransform(path.getCTM());
      const end = new win.DOMPoint(after.x, after.y).matrixTransform(path.getCTM());
      const matrix = arrow.getCTM();
      const tangentX = (end.x - start.x) * (reverse ? -1 : 1);
      const tangentY = (end.y - start.y) * (reverse ? -1 : 1);
      const alignment = (matrix.a * tangentX + matrix.b * tangentY) /
        (Math.hypot(matrix.a, matrix.b) * Math.hypot(tangentX, tangentY));
      assert(alignment > 0.99, "Arrow does not point in the direction of conduction");
    };
    resetSelectionsImmediately(true);
    test("Rhythm changes enter from offscreen and reach the synchronized anatomy at the playhead", () => {
      resetSelectionsImmediately(false);
      const rate = doc.querySelector("#heart-rate");
      const speed = doc.querySelector("#speed");
      const trace = doc.querySelector("#ecg-trace");
      const flutter = doc.querySelector('[data-reentry-circuit="flutter"]');
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const change = value => {
        rhythmControl.value = value;
        rhythmControl.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const step = elapsed => {
        pause.click();
        callback(now += elapsed);
        pause.click();
      };
      try {
        change("sinus");
        rate.dispatchEvent(new win.Event("change", { bubbles: true }));
        step(1800);
        const oldTile = trace.querySelector('[data-ecg-tile="0"]');
        const before = oldTile.getContext("2d").getImageData(0, 0, oldTile.width, oldTile.height).data;
        const oldTime = doc.querySelector("#time-readout").textContent;
        change("flutter");
        assert(doc.querySelector("#time-readout").textContent === oldTime &&
          flutter.style.display === "none" && doc.querySelector("#monitor-status").textContent.includes("QUEUED"),
        "Rhythm changed at the playhead instead of being queued");
        const newTile = trace.querySelector('[data-ecg-tile="0"]');
        const after = newTile.getContext("2d").getImageData(0, 0, newTile.width, newTile.height).data;
        const visibleEnd = Math.floor(newTile.width * 3300 / 5000) - 2;
        let maxDifference = 0;
        let changedAt = "";
        for (let y = 0; y < newTile.height; y++) {
          for (let x = 0; x < visibleEnd; x++) {
            const i = (y * newTile.width + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
              const difference = Math.abs(before[i + channel] - after[i + channel]);
              if (difference > maxDifference) { maxDifference = difference; changedAt = `${x},${y}`; }
            }
          }
        }
        assert(maxDifference <= 4, `A queued rhythm changed the visible ECG (${changedAt}, sizes ${oldTile.width}x${oldTile.height}/${newTile.width}x${newTile.height}, maximum pixel difference ${maxDifference})`);
        const tileAnimation = newTile.getAnimations()[0];
        const frozenTime = tileAnimation.currentTime;
        speed.value = "0.5";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        assert(tileAnimation.currentTime === frozenTime, "Changing speed moved the paused queued trace");
        step(2000);
        assert(flutter.style.display === "none" && doc.querySelector("#monitor-status").textContent.includes("QUEUED"),
          "Anatomy changed before the new trace reached the playhead");
        step(1200);
        assert(flutter.style.display !== "none" && !doc.querySelector("#monitor-status").textContent.includes("QUEUED") &&
          doc.querySelector("#readout").textContent.includes("A 300"),
        "Queued rhythm did not reach anatomy at the playhead");
        close(parseFloat(doc.querySelector("#time-readout").textContent) - parseFloat(oldTime), 1.6,
          "Queued rhythm changed the playback clock");
        assert(newTile.getAnimations()[0] === tileAnimation,
          "The visible trace restarted when the rhythm reached the playhead");
        close(tileAnimation.currentTime - frozenTime, 1600, "ECG scroll diverged from the playback clock");
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        change("afib");
        change("junctional");
        step(1600);
        assert(flutter.style.display === "none" &&
          doc.querySelector('[data-junctional-focus="junctional"]').style.display !== "none" &&
          !doc.querySelector("#monitor-status").textContent.includes("QUEUED"),
        "Repeated selections while paused did not apply the latest queued rhythm");
        change("flutter");
        step(200);
        change("afib");
        step(1400);
        assert(flutter.style.display !== "none" && doc.querySelector("#monitor-status").textContent.includes("QUEUED"),
          "A later selection replaced a rhythm already entering the strip");
        step(250);
        assert(doc.querySelector("#readout").textContent.includes("A Fib") &&
          !doc.querySelector("#monitor-status").textContent.includes("QUEUED"),
        "A later queued rhythm did not reach the playhead");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        change("sinus");
        rate.dispatchEvent(new win.Event("change", { bubbles: true }));
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
        resetSelectionsImmediately(true);
      }
    });
    test("AV, bundle, and WPW changes enter offscreen and follow the playhead", () => {
      resetSelectionsImmediately(false);
      const av = doc.querySelector("#av-pattern");
      const bundle = doc.querySelector("#bundle-pattern");
      const wpw = doc.querySelector("#wpw-enabled");
      const rate = doc.querySelector("#heart-rate");
      const rightBundle = doc.querySelector('[data-conduction-path="Right Bundle"]');
      const accessory = doc.querySelector("[data-wpw-accessory]");
      const pr = doc.querySelector("#pr-readout");
      const qrs = doc.querySelector("#qrs-readout");
      const status = doc.querySelector("#monitor-status");
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const change = (input, value) => {
        input.value = value;
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const toggleWpw = value => {
        wpw.checked = value;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const step = elapsed => {
        pause.click();
        callback(now += elapsed);
        pause.click();
      };
      try {
        change(rhythmControl, "sinus");
        change(av, "normal");
        change(bundle, "none");
        toggleWpw(false);
        rate.dispatchEvent(new win.Event("change", { bubbles: true }));
        step(1700);
        const oldTime = doc.querySelector("#time-readout").textContent;
        change(av, "first");
        assert(pr.textContent === "160 ms" && status.textContent.includes("QUEUED") &&
          doc.querySelector("#time-readout").textContent === oldTime,
        "AV change altered the active recording before reaching the playhead");
        step(1400);
        assert(pr.textContent === "160 ms", "AV conduction changed before the playhead");
        step(200);
        assert(pr.textContent === "260 ms" && !status.textContent.includes("QUEUED"),
          "Queued AV conduction did not reach the playhead");

        change(bundle, "rbbb");
        assert(qrs.textContent === "90 ms" && rightBundle.getAttribute("stroke") !== "#b42318",
          "Bundle block appeared before reaching the playhead");
        step(1600);
        assert(qrs.textContent === "150 ms" && rightBundle.getAttribute("stroke") === "#b42318",
          "Queued bundle block did not reach the playhead");

        toggleWpw(true);
        assert(accessory.style.display === "none" && pr.textContent === "260 ms",
          "WPW appeared before reaching the playhead");
        step(1600);
        assert(accessory.style.display !== "none" && pr.textContent === "100 ms" && qrs.textContent === "190 ms",
          "Queued WPW pathway did not reach the playhead");
        toggleWpw(false);
        assert(accessory.style.display !== "none", "WPW disappeared before reaching the playhead");
        step(1600);
        assert(accessory.style.display === "none" && pr.textContent === "260 ms" && qrs.textContent === "150 ms",
          "Disabling WPW did not reach the playhead");

        change(av, "normal");
        change(bundle, "none");
        toggleWpw(true);
        assert(pr.textContent === "260 ms" && rightBundle.getAttribute("stroke") === "#b42318" &&
          accessory.style.display === "none", "Paused selections changed the active scenario");
        step(1600);
        assert(pr.textContent === "100 ms" && qrs.textContent === "130 ms" &&
          rightBundle.getAttribute("stroke") !== "#b42318" && accessory.style.display !== "none" &&
          !status.textContent.includes("QUEUED"), "Paused selections did not combine in the queued scenario");

        toggleWpw(false);
        pause.click();
        callback(now += 200);
        change(bundle, "rbbb");
        callback(now += 1400);
        assert(accessory.style.display === "none" && rightBundle.getAttribute("stroke") !== "#b42318" &&
          status.textContent.includes("QUEUED"), "A later selection replaced a change already entering the strip");
        callback(now += 250);
        assert(rightBundle.getAttribute("stroke") === "#b42318" && qrs.textContent === "150 ms" &&
          !status.textContent.includes("QUEUED"), "Successive changes did not reach the playhead in order");
        pause.click();
      } finally {
        if (pause.textContent === "Pause") pause.click();
        change(rhythmControl, "sinus");
        change(av, "normal");
        change(bundle, "none");
        toggleWpw(false);
        rate.dispatchEvent(new win.Event("change", { bubbles: true }));
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
        resetSelectionsImmediately(true);
      }
    });
    test("Rate, refractoriness, and waveform edits preserve and queue the recording", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const rate = doc.querySelector("#heart-rate");
      const slider = doc.querySelector("#av-refractory");
      const readout = doc.querySelector("#readout");
      const status = doc.querySelector("#monitor-status");
      const qrs = doc.querySelector("#qrs-readout");
      const timeReadout = doc.querySelector("#time-readout");
      const change = (input, value, type = "change") => {
        input.value = value;
        input.dispatchEvent(new win.Event(type, { bubbles: true }));
      };
      change(rhythm, "flutter");
      resetSelectionsImmediately(false);
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const step = elapsed => {
        pause.click();
        callback(now += elapsed);
        pause.click();
      };
      const captureVisible = () => [...doc.querySelectorAll("#ecg-trace canvas")].map(tile => ({
        index: tile.dataset.ecgTile, width: tile.width, height: tile.height,
        visible: Math.max(0, Math.min(tile.width,
          Math.floor(tile.width * tile.getAnimations()[0].currentTime / 5000) - 2)),
        pixels: tile.getContext("2d").getImageData(0, 0, tile.width, tile.height).data
      }));
      const assertVisiblePreserved = snapshots => {
        for (const snapshot of snapshots) {
          const tile = doc.querySelector(`#ecg-trace canvas[data-ecg-tile="${snapshot.index}"]`);
          assert(tile && tile.width === snapshot.width && tile.height === snapshot.height,
            "A visible ECG tile disappeared after an edit");
          const pixels = tile.getContext("2d").getImageData(0, 0, tile.width, tile.height).data;
          for (let y = 0; y < snapshot.height; y++) {
            for (let x = 0; x < snapshot.visible; x++) {
              const offset = (y * snapshot.width + x) * 4;
              for (let channel = 0; channel < 4; channel++) {
                assert(Math.abs(snapshot.pixels[offset + channel] - pixels[offset + channel]) <= 4,
                  "An edit changed pixels already visible on the ECG");
              }
            }
          }
        }
      };
      try {
        const oldTime = timeReadout.textContent;
        const oldReadout = readout.textContent;
        const beforeScenario = captureVisible();
        change(slider, "410", "input");
        change(rate, "320");
        assert(timeReadout.textContent === oldTime && readout.textContent === oldReadout &&
          status.textContent.includes("QUEUED") && doc.querySelector("#refractory-value").textContent === "410 ms",
        "Paused scenario edits changed the active recording");
        assertVisiblePreserved(beforeScenario);
        step(400);
        change(slider, "610", "input");
        step(1200);
        assert(readout.textContent.includes("A 320") && readout.textContent.includes("3:1") &&
          status.textContent.includes("QUEUED"), "First scenario did not reach the playhead in order");
        step(400);
        assert(readout.textContent.includes("4:1") && !status.textContent.includes("QUEUED"),
          "Later refractory change did not reach the playhead");

        doc.querySelector("#duplicate-waveform").click();
        const qDuration = doc.querySelector('#wave-editor input[data-index="1"][data-key="duration"][type="number"]');
        const beforeEdit = timeReadout.textContent;
        const oldQrs = qrs.textContent;
        const beforeWaveform = captureVisible();
        change(qDuration, "30", "input");
        assert(timeReadout.textContent === beforeEdit && qrs.textContent === oldQrs &&
          status.textContent.includes("QUEUED"), "Morphology edit rewrote the current recording");
        assertVisiblePreserved(beforeWaveform);
        step(1600);
        assert(qrs.textContent === "110 ms" && !status.textContent.includes("QUEUED"),
          "Queued waveform edit did not reach the playhead");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        change(doc.querySelector("#waveform-select"), "automatic");
        change(slider, "350", "input");
        change(rhythm, "sinus");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
        resetSelectionsImmediately(true);
        resetAfterSelection();
      }
    });
    test("Scenario controls reserve a stable height across rhythms and AV options", () => {
      resetSelectionsImmediately(false);
      const av = doc.querySelector("#av-pattern");
      const wpw = doc.querySelector("#wpw-enabled");
      const change = (input, value) => {
        input.value = value;
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      try {
        for (const width of [320, 375, 600, 1024, 1280]) {
          fixture.style.width = `${width}px`;
          const positions = new Set();
          for (const rhythm of ["sinus", "avnrt", "flutter", "afib", "junctional"]) {
            change(rhythmControl, rhythm);
            for (const pattern of ["normal", "first", "mobitz1", "mobitz2", "third"]) {
              change(av, pattern);
              for (const enabled of [false, true]) {
                wpw.checked = enabled;
                wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
                const grid = doc.querySelector(".teaching-grid").getBoundingClientRect();
                const plot = doc.querySelector("#ecg-plot").getBoundingClientRect();
                positions.add(JSON.stringify([grid.top, plot.top, plot.height]));
              }
            }
          }
          assert(positions.size === 1, `Scenario controls moved the diagram at ${width}px`);
        }
        fixture.style.width = "320px";
        const plotTop = doc.querySelector("#ecg-plot").getBoundingClientRect().top;
        resetSelectionsImmediately(false);
        pause.click();
        change(rhythmControl, "flutter");
        assert(doc.querySelector("#ecg-plot").getBoundingClientRect().top === plotTop,
          "Queued status moved the ECG on a narrow screen");
        pause.click();
        resetSelectionsImmediately(true);
      } finally {
        if (pause.textContent === "Pause") pause.click();
        resetSelectionsImmediately(false);
        resetSelectionsImmediately(true);
        fixture.style.width = "1280px";
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(rhythmControl, "sinus");
        change(av, "normal");
      }
    });
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
    test("Ventricular rhythm controls distinguish VT, PVCs, and VF", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const av = doc.querySelector("#av-field");
      const rate = doc.querySelector("#rate-field");
      const wpw = doc.querySelector("#wpw-field");
      const pvcFocusField = doc.querySelector("#pvc-focus-field");
      const pvcFocus = doc.querySelector("#pvc-focus");
      const focusMarker = doc.querySelector("[data-ventricular-focus]");
      const chamber = name => [...doc.querySelectorAll("#anatomy-overlays path")]
        .find(node => node.querySelector("title")?.textContent === name);
      const markerInside = name => {
        const [x, y] = focusMarker.getAttribute("transform").match(/[\d.]+/g).map(Number);
        return chamber(name).isPointInFill(new win.DOMPoint(x, y));
      };
      const change = value => {
        rhythm.value = value;
        rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const step = elapsed => {
        if (pause.textContent === "Pause") pause.click();
        pause.click();
        callback(now += elapsed);
        pause.click();
      };
      resetSelectionsImmediately(true);
      try {
        change("vt");
        assert(doc.querySelector("#rate-label").textContent === "Ventricular rate" &&
          doc.querySelector("#heart-rate").value === "180" && av.hidden && !rate.hidden && wpw.hidden &&
          focusMarker.style.display === "none",
        "VT controls do not reflect independent ventricular activation");
        assert(doc.querySelector("#readout").textContent === "A — · V 180 bpm" &&
          doc.querySelector("#pr-readout").textContent === "No P waves" &&
          doc.querySelector("#qrs-readout").textContent === "160 ms",
        "VT readouts do not show absent atrial activity and a wide QRS");
        change("pvc");
        assert(doc.querySelector("#rate-label").textContent === "Sinus rate" &&
          doc.querySelector("#heart-rate").value === "70" && !av.hidden && !rate.hidden && wpw.hidden &&
          !pvcFocusField.hidden && pvcFocus.value === "lv" && markerInside("Left Ventricle"),
        "PVC controls do not preserve the underlying sinus rhythm");
        pvcFocus.value = "rv";
        pvcFocus.dispatchEvent(new win.Event("change", { bubbles: true }));
        step(5000);
        assert(markerInside("Right Ventricle"), "Right-ventricular PVC focus is not in the right ventricle");
        change("vfib");
        assert(av.hidden && rate.hidden && wpw.hidden &&
          pvcFocusField.hidden &&
          doc.querySelector("#readout").textContent === "V Fib" &&
          doc.querySelector("#qrs-readout").textContent === "Not measurable",
        "VF controls or readouts show organized rhythm measurements");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        change("sinus");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("AF and flutter expose refractoriness instead of AV-block controls", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const av = doc.querySelector("#av-pattern");
      const wpw = doc.querySelector("#wpw-enabled");
      const slider = doc.querySelector("#av-refractory");
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const change = (input, value) => {
        input.value = value;
        input.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const setRefractory = value => {
        slider.value = value;
        slider.dispatchEvent(new win.Event("input", { bubbles: true }));
      };
      const step = time => {
        pause.click();
        callback(now = time);
        pause.click();
      };
      try {
        change(av, "third");
        change(rhythm, "flutter");
        assert(doc.querySelector("#av-field").hidden && !doc.querySelector("#refractory-field").hidden &&
          !slider.disabled && !doc.querySelector("#rate-field").hidden, "Flutter controls are incorrect");
        assert(doc.querySelector("#readout").textContent.includes("2:1"), "Default flutter ratio is not shown");
        setRefractory("410");
        assert(doc.querySelector("#refractory-value").textContent === "410 ms" &&
          doc.querySelector("#readout").textContent.includes("3:1"), "Flutter slider did not change the ratio");
        const start = now;
        step(start + 800);
        assert(doc.querySelector("#readout").textContent.includes("V 100 bpm"),
          "Flutter ventricular response does not match the refractory period");
        change(rhythm, "afib");
        assert(doc.querySelector("#av-field").hidden && !doc.querySelector("#refractory-field").hidden &&
          doc.querySelector("#rate-field").hidden && slider.value === "410",
        "AF controls did not retain the refractory period or hide the ventricular-rate control");
        setRefractory("150");
        step(now + 4000);
        const fastResponse = Number(doc.querySelector("#readout").textContent.match(/V (\d+) bpm/)?.[1]);
        setRefractory("600");
        assert(doc.querySelector("#refractory-value").textContent === "600 ms", "AF slider did not update");
        step(now + 4000);
        const slowResponse = Number(doc.querySelector("#readout").textContent.match(/V (\d+) bpm/)?.[1]);
        assert(Number.isFinite(fastResponse) && Number.isFinite(slowResponse) && fastResponse > slowResponse,
          "AF slider did not reduce the displayed ventricular response");
        wpw.checked = true;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        assert(slider.disabled && !doc.querySelector("#refractory-field").hidden &&
          doc.querySelector("#refractory-note").textContent.includes("bypasses"),
        "WPW did not explain why AV refractoriness is unavailable");
        change(rhythm, "flutter");
        assert(!slider.disabled && doc.querySelector("#readout").textContent.includes("1:1"),
          "WPW flutter did not allow AV refractoriness adjustment or bypass the AV node");
        setRefractory("210");
        assert(doc.querySelector("#refractory-value").textContent === "210 ms" &&
          doc.querySelector("#readout").textContent.includes("1:1"),
        "WPW flutter slider changed the accessory-pathway response");
        change(rhythm, "sinus");
        assert(doc.querySelector("#refractory-field").hidden && !doc.querySelector("#av-field").hidden &&
          av.value === "third", "Previous AV-block selection was not restored");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(rhythm, "flutter");
        setRefractory("350");
        change(rhythm, "sinus");
        change(av, "normal");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("Atrial focus markers follow each beat and match the atrial anatomy", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const pathwayDots = [...doc.querySelectorAll('[data-path^="Atria"] polygon')];
      const markers = Object.fromEntries(Object.keys(atrialFoci).map(id =>
        [id, doc.querySelector(`[data-atrial-focus="${id}"]`)]));
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
        }
        assert(!doc.querySelector("[data-atrial-focus-route]"), "Ectopic atrial pathway routes are still drawn");
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
            if (beat.focus !== "sinus") {
              assert(pathwayDots.every(dot => dot.getAnimations().length === 0),
                `${name} ectopic beat activated an atrial conduction pathway`);
            } else {
              assert(pathwayDots.some(dot => dot.getAnimations().length > 0),
                `${name} sinus beat did not activate its atrial pathways`);
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
      } finally {
        if (pause.textContent === "Pause") pause.click();
        change("sinus");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("A queued scenario uses one fresh seed for live anatomy and preview", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const values = [0.1, 0.9];
      let calls = 0;
      win.Math.random = () => values[calls++];
      try {
        for (const value of [0.1, 0.9]) {
          rhythm.value = "wandering";
          rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
          const expected = new win.Conduction.Simulation({
            rhythm: "wandering", randomSeed: Math.floor(value * 4294967296)
          });
          const marker = doc.querySelector(`[data-atrial-focus="${expected.atria[0].focus}"]`);
          assert(marker.dataset.current === "true", "Live anatomy did not use the recording seed");
        }
        assert(calls === 2, "A queued rhythm did not select exactly one seed for both models");
      } finally {
        win.Math.random = () => 0;
        rhythm.value = "sinus";
        rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
      }
    });
    test("Junctional rhythm controls and focus match their selected rates", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const av = doc.querySelector("#av-pattern");
      const junctionalFocus = doc.querySelector('[data-junctional-focus="junctional"]');
      const avNode = doc.querySelector('[data-node="AV nodal transit"] circle');
      try {
        assert(!rhythm.querySelector('option[value="psvt"]'), "Generic PSVT remains selectable");
        const [focusX, focusY] = junctionalFocus.getAttribute("transform").match(/[\d.]+/g).map(Number);
        close(focusX, Number(avNode.getAttribute("cx")), "Junctional focus is not centered on the AV node");
        close(focusY, Number(avNode.getAttribute("cy")), "Junctional focus is not centered on the AV node");
        for (const [name, rate] of [["junctional", "50"], ["junctional_tachy", "130"]]) {
          rhythm.value = name;
          rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
          assert(doc.querySelector("#heart-rate").value === rate, `${name} selected the wrong rate`);
          assert(doc.querySelector("#rate-label").textContent === "Junctional rate", "Wrong junctional rate label");
          assert(doc.querySelector("#pr-readout").textContent === "Retrograde", "Wrong junctional PR readout");
          assert(junctionalFocus.style.display !== "none" && junctionalFocus.dataset.activating === "true",
            "Junctional focus did not fire");
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
    test("PAC focus pulses without atrial pathway propagation and preserves AV conduction", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const rate = doc.querySelector("#heart-rate");
      const av = doc.querySelector("#av-pattern");
      const marker = doc.querySelector('[data-atrial-focus="left"]');
      const sinusNode = doc.querySelector('[data-node="SA node firing"]');
      const pathwayDots = [...doc.querySelectorAll('[data-path^="Atria"] polygon')];
      const avNode = doc.querySelector('[data-node="AV nodal transit"]');
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
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
        change(rhythm, "atrial_tachy");
        assert(marker.style.display !== "none", "Focal atrial tachycardia does not show the shared focus");
        change(rhythm, "pac");
        change(rate, "60");
        for (const block of ["normal", "third"]) {
          change(av, block);
          const expected = new win.Conduction.Simulation({ rhythm: "pac", atrialRate: 60, av: block });
          expected.advanceTo(8500);
          const beat = expected.atria.find(item => item.origin === "PAC");
          const next = expected.atria.find(item => item.time > beat.time);
          const start = now;
          step(start + 10);
          assert(marker.style.display !== "none" && marker.dataset.activating === "false" &&
            sinusNode.style.display !== "none",
          `${block}: PAC focus fired during a sinus beat`);
          step(start + beat.time + 10);
          assert(marker.dataset.activating === "true" && marker.dataset.current === "true" &&
            Number(marker.querySelector("circle").getAttribute("opacity")) > 0,
          `${block}: PAC focus did not pulse`);
          assert(doc.querySelector(".section-heading").textContent.trim() === "CONDUCTION MAP",
            "A focus label appeared in the map header");
          assert(sinusNode.style.display === "none" && pathwayDots.every(dot => dot.getAnimations().length === 0),
            `${block}: PAC falsely activated the sinus pathways`);
          step(start + beat.time + 85);
          assert(avNode.style.display !== "none", `${block}: PAC did not reach the AV node`);
          step(start + beat.time + beat.pWave.duration + 1);
          assert(marker.dataset.activating === "false", `${block}: PAC focus remained active after its P wave`);
          step(start + next.time + 10);
          assert(marker.dataset.current === "false" &&
            sinusNode.style.display !== "none", `${block}: normal sinus activation did not return after PAC`);
        }
      } finally {
        if (pause.textContent === "Pause") pause.click();
        change(av, "normal");
        change(rhythm, "sinus");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("Junctional and escape beats use the shared focus marker and pulse with playback", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const av = doc.querySelector("#av-pattern");
      const marker = doc.querySelector('[data-junctional-focus="junctional"]');
      const atrialMarker = doc.querySelector('[data-atrial-focus="left"]');
      const ring = marker.querySelector("circle");
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
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
        assert(!marker.querySelector("text") &&
          ring.getAttribute("stroke") === atrialMarker.querySelector("circle").getAttribute("stroke"),
        "Junctional marker does not use the unnumbered atrial focus design");
        for (const name of ["junctional", "junctional_tachy"]) {
          change(rhythm, name);
          const period = 60000 / Number(doc.querySelector("#heart-rate").value);
          const start = now;
          step(start + 10);
          assert(marker.style.display !== "none" && marker.dataset.activating === "true",
          `${name}: focus did not fire`);
          assert(doc.querySelector(".section-heading").textContent.trim() === "CONDUCTION MAP",
            "A junctional focus label appeared in the map header");
          const initialRadius = Number(ring.getAttribute("r"));
          step(start + 40);
          assert(Number(ring.getAttribute("r")) > initialRadius, `${name}: focus pulse did not expand`);
          step(start + 81);
          assert(marker.dataset.activating === "false", `${name}: focus pulse did not end`);
          step(start + period + 10);
          assert(marker.dataset.activating === "true", `${name}: focus did not fire with the next beat`);
        }
        change(rhythm, "sinus");
        change(av, "third");
        const start = now;
        assert(marker.style.display !== "none" && marker.dataset.activating === "false",
          "Independent escape focus was not shown before its first firing");
        step(start + 360);
        assert(marker.dataset.activating === "true", "Independent escape beat did not pulse its focus");
        step(start + 431);
        assert(marker.dataset.activating === "false", "Independent escape focus did not stop pulsing");
        change(av, "normal");
        assert(marker.style.display === "none", "Junctional focus leaked into normal sinus rhythm");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        change(rhythm, "sinus");
        change(av, "normal");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
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
          const movement = circuits[name].querySelector("polygon").getAnimations()[0];
          if (name === "avnrt") {
            close(movement.effect.getTiming().duration, 60000 / 180, `${name} circuit period`);
            assert(movement.effect.getTiming().iterations === Infinity, `${name} circuit does not repeat`);
            const nodalPath = circuits.avnrt.querySelector("path");
            const avNode = [...doc.querySelectorAll("#anatomy-overlays path")]
              .find(node => node.querySelector("title")?.textContent === "AV Node");
            const nodalArrow = circuits.avnrt.querySelector("polygon");
            const originalTime = movement.currentTime;
            try {
              for (let i = 0; i <= 100; i++) {
                const point = nodalPath.getPointAtLength(nodalPath.getTotalLength() * i / 100);
                assert(avNode.isPointInFill(point), "AVNRT loop extends outside the AV node");
                movement.currentTime = movement.effect.getTiming().duration * i / 100;
                const transform = avNode.getCTM().inverse().multiply(nodalArrow.getCTM());
                for (const vertex of nodalArrow.points) {
                  const position = new win.DOMPoint(vertex.x, vertex.y).matrixTransform(transform);
                  assert(avNode.isPointInFill(position), "AVNRT circulating arrow extends outside the AV node");
                }
              }
            } finally {
              movement.currentTime = originalTime;
            }
          } else {
            assert(!movement, "AVRT accessory pathway is active before ventricular depolarization");
          }
          change(rate, "200");
          if (name === "avnrt") {
            close(circuits[name].querySelector("polygon").getAnimations()[0].effect.getTiming().duration,
              300, `${name} circuit did not follow the rate`);
          }
        }
        const chamber = name => [...doc.querySelectorAll("#anatomy-overlays path")]
          .find(node => node.querySelector("title")?.textContent === name);
        const leftVentricle = chamber("Left Ventricle");
        const leftAtrium = chamber("Left Atrium");
        const accessory = circuits.avrt.querySelector('[data-accessory-path="avrt"]');
        assert(circuits.avrt.querySelectorAll("path").length === 1 &&
          accessory.getAttribute("d") === doc.querySelector('[data-accessory-path="wpw"]').getAttribute("d"),
        "AVRT retained explicit loop connections or changed its accessory pathway");
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
    test("Retrograde AVRT depolarizes the atria without activating nodal atrial pathways", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const accessory = doc.querySelector('[data-reentry-circuit="avrt"] polygon');
      const atrialPaths = ["Atria1", "Atria2", "Atria3", "Atria4"]
        .map(name => doc.querySelector(`[data-path="${name}"] polygon`));
      const atria = ["Right Atrium", "Left Atrium"].map(name =>
        [...doc.querySelectorAll("#anatomy-overlays path")].find(path => path.querySelector("title")?.textContent === name));
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
        assert(atrialPaths.every(Boolean) && atria.every(Boolean), "Atrial pathways or chambers are missing");
        select("avrt");
        const start = now;
        step(start + 40);
        assert(Number(win.getComputedStyle(accessory).opacity) > 0, "AVRT accessory conduction was suppressed");
        step(start + 80);
        assert(atria.every(path => Number(path.getAttribute("fill-opacity")) > 0), "AVRT did not depolarize both atria");
        assert(atrialPaths.every(arrow => arrow.getAnimations().length === 0),
          "AVRT incorrectly activated AV-node atrial pathways");
        step(start + 60000 / 180 + 80);
        assert(atria.every(path => Number(path.getAttribute("fill-opacity")) > 0) &&
          atrialPaths.every(arrow => arrow.getAnimations().length === 0),
        "AVRT atrial pathway arrows returned on the next beat");
        for (const name of ["avnrt", "junctional"]) {
          select(name);
          const nextStart = now;
          step(nextStart + 80);
          assert(atria.every(path => Number(path.getAttribute("fill-opacity")) > 0),
            `${name} did not depolarize the atria`);
          assert(atrialPaths.every(arrow => Number(win.getComputedStyle(arrow).opacity) > 0 &&
            win.getComputedStyle(arrow).offsetRotate.includes("180deg")),
          `${name} did not retain reverse atrial pathway conduction`);
        }
      } finally {
        if (pause.textContent === "Pause") pause.click();
        select("sinus");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("AVRT accessory dots appear only during each retrograde impulse", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const rate = doc.querySelector("#heart-rate");
      const wpw = doc.querySelector("#wpw-enabled");
      const speed = doc.querySelector("#speed");
      const group = doc.querySelector('[data-reentry-circuit="avrt"]');
      const path = group.querySelector("path");
      const dot = group.querySelector("polygon");
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
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
        change(rhythm, "avrt");
        change(rate, "200");
        for (const enabled of [false, true]) {
          speed.value = "1";
          speed.dispatchEvent(new win.Event("input", { bubbles: true }));
          wpw.checked = enabled;
          wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
          const start = now;
          step(start + 34);
          assert(Number(win.getComputedStyle(dot).opacity) === 0, "Accessory dots appeared before ventricular activation");
          step(start + 40);
          let movement = dot.getAnimations()[0];
          assert(movement?.playState === "paused" && Number(win.getComputedStyle(dot).opacity) > 0,
            "Accessory impulse is not visible during ventricular depolarization");
          close(movement.currentTime, 5, "Accessory impulse timing");
          close(movement.effect.getTiming().duration, 30, "Accessory impulse duration");
          for (const fraction of [0, 0.5]) {
            movement.currentTime = fraction * movement.effect.getTiming().duration;
            const actual = new win.DOMPoint(0, 0).matrixTransform(dot.getCTM());
            const point = path.getPointAtLength(path.getTotalLength() * fraction);
            const expected = new win.DOMPoint(point.x, point.y).matrixTransform(path.getCTM());
            assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.5,
              "Accessory impulse did not travel from ventricle to atrium");
            if (fraction === 0.5) assertArrowDirection(dot, path, fraction);
          }
          movement.currentTime = 5;
          step(start + 70);
          assert(Number(win.getComputedStyle(dot).opacity) === 0, "Accessory dots persisted after atrial activation");
          step(start + 200);
          assert(Number(win.getComputedStyle(dot).opacity) === 0, "Accessory dots remained visible between beats");
          step(start + 340);
          movement = dot.getAnimations()[0];
          close(movement.currentTime, 5, "Next accessory impulse did not follow the tachycardia cycle");
          speed.value = "0.5";
          speed.dispatchEvent(new win.Event("input", { bubbles: true }));
          close(movement.currentTime, 5, "Changing speed moved a paused accessory impulse");
          step(now + 20);
          close(dot.getAnimations()[0].currentTime, 15, "Accessory impulse did not follow playback speed");
          step(now + 40);
          assert(Number(win.getComputedStyle(dot).opacity) === 0, "Slowed accessory impulse did not end");
        }
      } finally {
        if (pause.textContent === "Pause") pause.click();
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(rhythm, "sinus");
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("WPW accessory pathway conducts antegradely to the left ventricle at QRS onset", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const wpw = doc.querySelector("#wpw-enabled");
      const av = doc.querySelector("#av-pattern");
      const bundle = doc.querySelector("#bundle-pattern");
      const group = doc.querySelector("[data-wpw-accessory]");
      const path = group.querySelector('[data-accessory-path="wpw"]');
      const dot = group.querySelector("polygon");
      const depolarization = doc.querySelector("[data-wpw-depolarization]");
      const chamber = name => [...doc.querySelectorAll("#anatomy-overlays path")]
        .find(node => node.querySelector("title")?.textContent === name);
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
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
        assert(group.style.display === "none", "WPW pathway is visible in sinus rhythm");
        assert(path.getAttribute("d") === doc.querySelector('[data-accessory-path="avrt"]').getAttribute("d"),
          "WPW does not use the existing left-sided pathway");
        const ventricle = path.getPointAtLength(0);
        const atrium = path.getPointAtLength(path.getTotalLength());
        assert(chamber("Left Ventricle").isPointInFill(ventricle) && chamber("Left Atrium").isPointInFill(atrium),
          "WPW pathway does not connect the left atrium and ventricle");
        close(Number(depolarization.getAttribute("cx")), ventricle.x, "Accessory depolarization x coordinate");
        close(Number(depolarization.getAttribute("cy")), ventricle.y, "Accessory depolarization y coordinate");
        assert(doc.querySelector("#wpw-left-ventricle-clip path").getAttribute("d") ===
          chamber("Left Ventricle").getAttribute("d"), "Accessory depolarization is not clipped to the left ventricle");
        wpw.checked = true;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        assert(group.style.display !== "none" && dot.getAnimations().length > 0,
          "WPW pathway is not active with normal AV conduction");
        change(av, "third");
        const start = now;
        assert(group.style.display !== "none", "WPW accessory pathway is hidden");
        step(start + 70);
        close(Number(depolarization.getAttribute("fill-opacity")), 0, "Ventricle activated before the impulse arrived");
        let movement = dot.getAnimations()[0];
        assert(movement?.playState === "paused", "Accessory impulse did not follow playback");
        close(movement.currentTime, 25, "Accessory impulse is not synchronized to the atrial beat");
        close(movement.effect.getTiming().duration + 45, 100, "Accessory impulse does not reach QRS onset");
        const originalTime = movement.currentTime;
        movement.currentTime = 0;
        const first = new win.DOMPoint(0, 0).matrixTransform(dot.getCTM());
        const expected = new win.DOMPoint(atrium.x, atrium.y).matrixTransform(path.getCTM());
        assert(Math.hypot(first.x - expected.x, first.y - expected.y) < 0.05, "WPW impulse did not start in the atrium");
        movement.currentTime = movement.effect.getTiming().duration / 2;
        const middle = new win.DOMPoint(0, 0).matrixTransform(dot.getCTM());
        const halfway = path.getPointAtLength(path.getTotalLength() / 2);
        const expectedMiddle = new win.DOMPoint(halfway.x, halfway.y).matrixTransform(path.getCTM());
        assert(Math.hypot(middle.x - expectedMiddle.x, middle.y - expectedMiddle.y) < 0.5,
          "WPW impulse left the accessory pathway");
        assertArrowDirection(dot, path, 0.5, true);
        movement.currentTime = originalTime;
        step(start + 110);
        assert(Number(depolarization.getAttribute("fill-opacity")) > 0 &&
          Number(depolarization.getAttribute("r")) > 8, "Accessory arrival did not depolarize the left ventricle");
        step(start + 211);
        close(Number(depolarization.getAttribute("fill-opacity")), 0, "Accessory depolarization did not fade");
        step(start + 60000 / 70 + 70);
        movement = dot.getAnimations()[0];
        close(movement.currentTime, 25, "Accessory impulse did not repeat with the next atrial beat");
        step(start + 60000 / 70 + 110);
        assert(Number(depolarization.getAttribute("fill-opacity")) > 0, "Accessory depolarization did not repeat");
        change(bundle, "lbbb");
        const blockedStart = now;
        step(blockedStart + 110);
        assert(Number(depolarization.getAttribute("fill-opacity")) > 0 &&
          Number(chamber("Left Ventricle").getAttribute("fill-opacity")) === 0,
        "Left bundle block suppressed early accessory-mediated depolarization");
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        assert(group.style.display === "none" && dot.getAnimations().length === 0,
          "WPW pathway remained active after switching rhythms");
        close(Number(depolarization.getAttribute("fill-opacity")), 0, "WPW depolarization remained in sinus rhythm");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(rhythm, "sinus");
        change(av, "normal");
        change(bundle, "none");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("WPW controls compose with rhythms, preserve selection, and display fibrillation", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const wpw = doc.querySelector("#wpw-enabled");
      const av = doc.querySelector("#av-pattern");
      const speed = doc.querySelector("#speed");
      const group = doc.querySelector("[data-wpw-accessory]");
      const avrt = doc.querySelector('[data-reentry-circuit="avrt"]');
      const chamber = name => [...doc.querySelectorAll("#anatomy-overlays path")]
        .find(node => node.querySelector("title")?.textContent === name);
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
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
        assert(!rhythm.querySelector('option[value="wpw"]'), "WPW remains a selectable rhythm");
        wpw.checked = true;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(av, "third");
        assert(doc.querySelector("#escape-field").hidden, "Unused escape control is visible with pre-excitation");
        change(rhythm, "flutter");
        assert(group.style.display !== "none" && !doc.querySelector("#wpw-field").hidden,
          "WPW is unavailable in flutter");
        const start = now;
        step(start + 670);
        assert(doc.querySelector("#readout").textContent.includes("V 300 bpm"),
          "Flutter with WPW does not show 1:1 ventricular rate");
        assert(group.querySelector("polygon").getAnimations().length > 0,
          "Flutter accessory pathway does not animate");
        change(rhythm, "avnrt");
        assert(doc.querySelector("#wpw-field").hidden && wpw.checked && group.style.display === "none",
          "Unsupported rhythm did not retain but suppress WPW");
        change(rhythm, "avrt");
        assert(!doc.querySelector("#wpw-field").hidden && wpw.checked && group.style.display === "none" &&
          avrt.style.display !== "none" && doc.querySelector("#qrs-readout").textContent === "90 ms" &&
          doc.querySelector("#wpw-note").textContent.includes("without a delta wave"),
        "AVRT did not retain its orthodromic loop and morphology");
        change(rhythm, "afib");
        assert(group.style.display !== "none" && group.querySelector("polygon").getAnimations().length > 0 &&
          doc.querySelector("#rate-field").hidden && doc.querySelector("#escape-field").hidden,
        "AF with WPW does not show pathway activity or shows unused controls");
        assert(doc.querySelector("#readout").textContent === "A Fib · V Fib" &&
          doc.querySelector("#qrs-readout").textContent === "Not measurable" &&
          doc.querySelector("#pr-readout").textContent === "No P waves", "VF measurements are misleading");
        const vfStart = now;
        step(vfStart + 123);
        const rv = chamber("Right Ventricle");
        const lv = chamber("Left Ventricle");
        assert(Number(rv.getAttribute("fill-opacity")) > 0 && Number(lv.getAttribute("fill-opacity")) > 0 &&
          rv.getAttribute("fill-opacity") !== lv.getAttribute("fill-opacity"), "VF ventricular overlays are missing");
        const frozen = [rv.getAttribute("fill-opacity"), lv.getAttribute("fill-opacity"), doc.querySelector("#time-readout").textContent];
        const tileAnimation = doc.querySelector("#ecg-trace canvas").getAnimations()[0];
        const tileTime = tileAnimation.currentTime;
        speed.value = "0.5";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        assert(tileAnimation.currentTime === tileTime &&
          JSON.stringify(frozen) === JSON.stringify([rv.getAttribute("fill-opacity"), lv.getAttribute("fill-opacity"),
            doc.querySelector("#time-readout").textContent]), "Paused VF changed on speed adjustment");
        step(now + 200);
        const vf = new win.Conduction.Simulation({ rhythm: "afib", wpw: true, av: "third" });
        close(Number(rv.getAttribute("fill-opacity")), 2 * vf.chamberOpacity(223, "rv"),
          "VF ventricular opacity is out of sync after speed change");
        close(Number(lv.getAttribute("fill-opacity")), 2 * vf.chamberOpacity(223, "lv"),
          "VF ventricular opacity is out of sync after speed change");
        close(Number.parseFloat(doc.querySelector("#time-readout").textContent) -
          Number.parseFloat(frozen[2]), 0.1, "VF simulation clock did not follow playback speed");
        change(rhythm, "junctional_tachy");
        assert(doc.querySelector("#wpw-field").hidden && wpw.checked, "WPW was not suppressed for junctional tachycardia");
        change(rhythm, "sinus");
        assert(wpw.checked && !doc.querySelector("#wpw-field").hidden && group.style.display !== "none" &&
          av.value === "third", "WPW or AV selection was not restored");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(rhythm, "sinus");
        change(av, "normal");
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
      }
    });
    test("AF with WPW sends irregular antegrade pathway impulses on the playback clock", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const wpw = doc.querySelector("#wpw-enabled");
      const speed = doc.querySelector("#speed");
      const group = doc.querySelector("[data-wpw-accessory]");
      const path = group.querySelector("path");
      const dot = group.querySelector("polygon");
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const step = time => {
        pause.click();
        callback(now = time);
        pause.click();
      };
      try {
        wpw.checked = true;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        rhythm.value = "afib";
        rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
        const start = now;
        step(start + 20);
        let movement = dot.getAnimations()[0];
        assert(movement?.playState === "paused", "Fibrillation pathway impulse is not paused with playback");
        close(movement.currentTime, 20, "First fibrillation impulse timing");
        movement.currentTime = 0;
        const actual = new win.DOMPoint(0, 0).matrixTransform(dot.getCTM());
        const atrium = path.getPointAtLength(path.getTotalLength());
        const expected = new win.DOMPoint(atrium.x, atrium.y).matrixTransform(path.getCTM());
        assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.05,
          "Fibrillation impulse does not start in the atrium");
        movement.currentTime = 20;
        const first = movement;
        step(start + 170);
        movement = dot.getAnimations()[0];
        assert(movement && movement !== first, "A second pathway impulse was not generated");
        close(movement.currentTime, 20, "Second fibrillation impulse timing");
        const second = movement;
        step(start + 380);
        movement = dot.getAnimations()[0];
        assert(movement && movement !== second, "An irregularly spaced pathway impulse was not generated");
        close(movement.currentTime, 20, "Third fibrillation impulse timing");
        speed.value = "0.5";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        assert(movement.currentTime === 20 && movement.playbackRate === 0.5,
          "Changing speed moved a paused fibrillation impulse");
        step(now + 40);
        close(dot.getAnimations()[0].currentTime, 40, "Fibrillation impulse did not follow playback speed");
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        assert(group.style.display === "none" && dot.getAnimations().length === 0,
          "Accessory pathway impulses persisted after WPW was disabled");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        rhythm.value = "sinus";
        rhythm.dispatchEvent(new win.Event("change", { bubbles: true }));
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
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
        const dots = circuit.querySelectorAll("polygon");
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
        movement.currentTime = 50;
        assertArrowDirection(dots[0], path, 0.25);
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
      const dot = doc.querySelector('[data-path="Atria1"] polygon');
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
    test("Mobitz markers bracket dropped P waves at the AV node", () => {
      let callback;
      let now = doc.timeline.currentTime;
      const originalRequest = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      const rhythm = doc.querySelector("#rhythm-pattern");
      const av = doc.querySelector("#av-pattern");
      const rate = doc.querySelector("#heart-rate");
      const wpw = doc.querySelector("#wpw-enabled");
      const markers = [...doc.querySelectorAll('[data-conduction-marker="block"]')];
      const block = markers.find(node => node.querySelector("title").textContent === "Atrial impulse fails to conduct");
      const hisBlock = markers.find(node => node.querySelector("title").textContent === "His-Purkinje conduction fails");
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
        for (const [name, pattern, bypass] of [
          ["sinus", "mobitz1", false], ["sinus", "mobitz2", false],
          ["wandering", "mobitz1", false], ["pac", "mobitz2", false],
          ["sinus", "mobitz2", true]
        ]) {
          change(rhythm, name);
          change(av, pattern);
          change(rate, "60");
          wpw.checked = bypass;
          wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
          const expected = new win.Conduction.Simulation({
            rhythm: name, av: pattern, atrialRate: 60, wpw: bypass, randomSeed: 0
          });
          expected.advanceTo(9000);
          const dropped = expected.atria[3];
          const next = expected.atria[4];
          const start = now;
          step(start + dropped.time - 30.1);
          assert(!visible(block) && !visible(hisBlock), `${name}/${pattern}: marker appeared too early`);
          step(start + dropped.time - 29.9);
          assert(visible(block) && !visible(hisBlock), `${name}/${pattern}: marker did not precede the dropped P wave`);
          step(start + dropped.time + 80);
          if (bypass) {
            const dot = doc.querySelector("[data-wpw-accessory] polygon");
            assert(visible(block) && Number(win.getComputedStyle(dot).opacity) > 0,
              "Mobitz marker suppressed accessory-pathway conduction");
            assert(expected.ventricles.some(beat => beat.time === dropped.time + 100 && beat.preexcited),
              "WPW did not conduct the Mobitz-pattern beat");
          } else {
            assert(expected.events.some(event => event.type === "block" && event.beat === dropped &&
              event.site === (pattern === "mobitz2" ? "his" : "av")),
              `${name}/${pattern}: modeled block site changed`);
          }
          step(start + dropped.time + 200);
          assert(visible(block) && !visible(hisBlock), `${name}/${pattern}: marker did not remain at the AV node`);
          step(start + next.time - 30.1);
          assert(visible(block) && !visible(hisBlock), `${name}/${pattern}: marker ended too early`);
          step(start + next.time - 29.9);
          assert(!visible(block) && !visible(hisBlock), `${name}/${pattern}: marker did not clear before the next P wave`);
          step(start + next.time + 100);
          assert(!visible(block) && !visible(hisBlock), `${name}/${pattern}: marker covered the next P wave`);
        }

        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(rhythm, "sinus");
        change(av, "mobitz1");
        change(rate, "60");
        const start = now;
        step(start + 1700);
        const tile = doc.querySelector("#ecg-trace canvas");
        const width = doc.querySelector("#ecg-waveform").getBoundingClientRect().width;
        const half = width * 5000 / (2 * parseFloat(tile.style.width));
        const padding = Math.ceil(4 * Math.min(win.devicePixelRatio || 1, 2)) * 5000 / tile.width;
        const transition = 1700 + half + padding;
        resetSelectionsImmediately(false);
        change(rhythm, "atrial_tachy");
        step(start + 3000);
        assert(visible(block), "Queued transition hid the dropped-beat marker too early");
        step(start + transition - 30.1);
        assert(visible(block), "Marker did not persist until just before the queued P wave");
        step(start + transition - 29.9);
        assert(!visible(block), "Marker did not clear before the queued P wave");
        step(start + transition + 100);
        assert(!visible(block), "Marker leaked into the next scenario");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        resetSelectionsImmediately(false);
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(rhythm, "sinus");
        change(av, "normal");
        change(rate, "70");
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = originalRequest;
        resetSelectionsImmediately(true);
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
      const wpw = doc.querySelector("#wpw-enabled");
      const block = [...doc.querySelectorAll('[data-conduction-marker="block"]')]
        .find(node => node.querySelector("title").textContent === "Atrial impulse fails to conduct");
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

        wpw.checked = true;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        const slider = doc.querySelector("#av-refractory");
        slider.value = "410";
        slider.dispatchEvent(new win.Event("input", { bubbles: true }));
        start = now;
        step(start + 81);
        assert(!visible(block) && visible(avNode), "WPW hid a conducted AV nodal impulse");
        step(start + 281);
        assert(visible(block) && !visible(avNode), "WPW hid a refractory AV nodal impulse");
        step(start + 481);
        assert(visible(block) && !visible(avNode), "Longer refractoriness did not block the next impulse");
        step(start + 681);
        assert(!visible(block) && visible(avNode), "WPW AV node did not recover at the expected beat");
        assert(doc.querySelector("#readout").textContent.includes("1:1"),
          "Refractory AV node blocked accessory-pathway conduction");
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        slider.value = "350";
        slider.dispatchEvent(new win.Event("input", { bubbles: true }));
        change(rhythm, "sinus");
        change(av, "third");
        start = now;
        step(start + 1600);
        assert(visible(block), "Complete AV block did not retain its marker");
        wpw.checked = true;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        start = now;
        step(start + 90);
        assert(visible(block) && !visible(avNode), "Pre-excitation appeared to cross the completely blocked AV node");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        wpw.checked = false;
        wpw.dispatchEvent(new win.Event("change", { bubbles: true }));
        change(av, "normal");
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

    test("Conduction arrows follow and point along the saved path at subframe positions", () => {
      const group = doc.querySelector('[data-path="Atria1"]');
      const dot = group.querySelector("polygon");
      const movement = dot.getAnimations()[0];
      const path = group.previousElementSibling;
      const root = doc.querySelector("#anatomy").getCTM();
      const originalTime = movement.currentTime;
      try {
        assert(!doc.querySelector(".arrow-controls") && !doc.querySelector("[data-arrow-setting]"),
          "Temporary arrow controls are still visible");
        assert(group.querySelectorAll("polygon").length > 1, "Arrow trail is missing");
        const trailing = group.querySelectorAll("polygon")[1];
        close(dot.getBBox().width, 23, "Leading arrow length");
        close(dot.getBBox().height, 20, "Leading arrow width");
        close(trailing.getBBox().width, 11.5, "Trailing arrow length");
        close(trailing.getBBox().height, 10, "Trailing arrow width");
        close(Number(dot.getAttribute("stroke-width")), 0.9, "Arrow outline thickness");
        assert(dot.points.numberOfItems === 3, "Arrow tail is not flat");
        assert(group.querySelectorAll("polygon").length === Math.min(14, Math.ceil(path.getTotalLength() / 7)),
          "Arrow trail length or spacing is incorrect");
        close(trailing.getAnimations()[0].effect.getTiming().delay, 90 * 7 / path.getTotalLength(), "Arrow spacing");
        for (const time of [12.5, 37.5, 62.5]) {
          movement.currentTime = time;
          const actual = new win.DOMPoint(0, 0).matrixTransform(dot.getCTM());
          const point = path.getPointAtLength(path.getTotalLength() * time / 90);
          const expected = new win.DOMPoint(point.x, point.y).matrixTransform(root);
          assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.05, "Native dot left its saved conduction path");
          assertArrowDirection(dot, path, time / 90);
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
        const ratio = doc.querySelector("#ecg-canvas").getContext("2d").getTransform().a;
        const viewport = Math.round((doc.querySelector("#ecg-plot").getBoundingClientRect().width - 88) * ratio) / ratio;
        const half = viewport * 5000 / (2 * (initialTile.width / ratio));
        const currentTime = Number(initialTile.dataset.ecgTile) * 5000 - half + animation.currentTime;
        const index = Math.max(...[...trace.querySelectorAll("canvas")].map(tile => Number(tile.dataset.ecgTile))) + 1;
        pause.click();
        const getTile = index => trace.querySelector(`[data-ecg-tile="${index}"]`);
        const runFrame = elapsed => frameCallback(now = start + elapsed);
        runFrame(index * 5000 - currentTime);
        const currentTile = getTile(index);
        const currentAnimation = currentTile.getAnimations()[0];
        idleCallback = null;
        runFrame(index * 5000 + 1800 - currentTime);
        assert(!getTile(index + 1) && idleCallback,
          `An offscreen tile was not deferred to idle time (tile: ${!!getTile(index + 1)}, callback: ${!!idleCallback}, clock: ${doc.querySelector("#time-readout").textContent})`);
        idleCallback();
        const nextTile = getTile(index + 1);
        assert(nextTile, "The next tile was not ready before entering the viewport");
        const nextAnimation = nextTile.getAnimations()[0];
        runFrame((index + 1) * 5000 - currentTime);
        assert(getTile(index) === currentTile && currentTile.getAnimations()[0] === currentAnimation,
          "Adding a tile replaced or restarted the visible waveform");
        assert(getTile(index + 1) === nextTile && nextTile.getAnimations()[0] === nextAnimation,
          "Entering the viewport replaced the prefetched tile");
        close(nextAnimation.startTime - currentAnimation.startTime, 5000, "Tile animations are not on the same clock");
        runFrame(index * 5000 + 8800 - currentTime);
        assert(!getTile(index) && getTile(index + 1) === nextTile && getTile(index + 2), "Tiles were not recycled safely when idle time was unavailable");
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
    test("Focal atrial tachycardia loops locally at its focus and follows queued playback", () => {
      const rhythm = doc.querySelector("#rhythm-pattern");
      const rate = doc.querySelector("#heart-rate");
      const speedControl = doc.querySelector("#speed");
      const circuit = doc.querySelector('[data-reentry-circuit="atrial_tachy"]');
      const change = (control, value) => {
        control.value = value;
        control.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      try {
        change(rhythm, "sinus");
        assert(circuit.style.display === "none", "Focal loop is visible during sinus rhythm");
        resetSelectionsImmediately(false);
        change(rhythm, "atrial_tachy");
        assert(circuit.style.display === "none", "Focal loop appeared before the queued rhythm reached the playhead");
        resetAfterSelection();
        resetSelectionsImmediately(true);
        assert(circuit.style.display !== "none", "Focal atrial tachycardia loop is hidden");
        const path = circuit.querySelector("path");
        const focus = atrialFoci.left;
        const box = path.getBBox();
        close(box.x + box.width / 2, focus.x * 822, "Focal loop horizontal center");
        close(box.y + box.height / 2, focus.y * 566, "Focal loop vertical center");
        assert(box.width <= 40 && box.height <= 40, "Focal loop is not miniature");
        const dot = circuit.querySelector("polygon");
        const movement = dot.getAnimations()[0];
        assert(movement?.playState === "paused", "Focal loop does not follow paused playback");
        const originalTime = movement.currentTime;
        close(movement.effect.getTiming().duration, 400, "Focal loop lap duration");
        assert(movement.effect.getTiming().iterations === Infinity, "Focal loop does not repeat");
        const position = time => {
          movement.currentTime = time;
          return new win.DOMPoint(0, 0).matrixTransform(dot.getCTM());
        };
        const start = position(0);
        const quarter = position(100);
        const point = path.getPointAtLength(path.getTotalLength() / 4);
        const expected = new win.DOMPoint(point.x, point.y).matrixTransform(path.getCTM());
        assert(Math.hypot(quarter.x - expected.x, quarter.y - expected.y) < 0.05, "Focal impulse left its loop");
        assertArrowDirection(dot, path, 0.25);
        const lap = position(400);
        assert(Math.hypot(start.x - lap.x, start.y - lap.y) < 0.05, "Focal circuit does not close after one beat");
        movement.currentTime = originalTime;
        speedControl.value = "0.5";
        speedControl.dispatchEvent(new win.Event("input", { bubbles: true }));
        close(movement.currentTime, originalTime, "Speed change moved the paused focal loop");
        assert(movement.playbackRate === 0.5 &&
          movement.playState === "paused", "Speed change moved the paused focal loop");
        change(rate, "200");
        close(dot.getAnimations()[0].effect.getTiming().duration, 300, "Updated focal loop lap duration");
        change(rhythm, "pac");
        assert(circuit.style.display === "none" && !dot.getAnimations().length, "Focal loop leaked into PACs");
      } finally {
        resetSelectionsImmediately(true);
        speedControl.value = "1";
        speedControl.dispatchEvent(new win.Event("input", { bubbles: true }));
        change(rhythm, "sinus");
      }
    });
    test("Rhythm source highlighting follows the playhead and modeled sources", () => {
      const toggle = doc.querySelector("#highlight-source");
      const trace = doc.querySelector("#ecg-trace");
      const av = doc.querySelector("#av-pattern");
      const pvcFocus = doc.querySelector("#pvc-focus");
      const speed = doc.querySelector("#speed");
      const visibleSources = () => [...doc.querySelectorAll("[data-source-highlight]")]
        .filter(node => node.style.display !== "none").map(node => node.dataset.sourceHighlight).sort().join(",");
      const change = (control, value) => {
        control.value = value;
        control.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      let callback;
      let now = doc.timeline.currentTime;
      const request = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      resetSelectionsImmediately(false);
      const step = () => {
        pause.click();
        callback(now += 2000);
        pause.click();
      };
      const expect = (value, sources) => {
        change(rhythmControl, value);
        step();
        assert(visibleSources() === sources, `${value}: expected ${sources || "no source"}, got ${visibleSources()}`);
      };
      try {
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        change(av, "normal");
        expect("sinus", "");
        assert(!toggle.checked && doc.querySelector("#source-description").textContent === "Highlighting off",
          "Source highlighting should be off by default");
        const tile = trace.querySelector("canvas");
        const animation = tile.getAnimations()[0];
        const animationTime = animation.currentTime;
        const time = doc.querySelector("#time-readout").textContent;
        toggle.click();
        assert(visibleSources() === "sinus" && doc.querySelector("#source-description").textContent.includes("SA node"),
          "Sinus source was not highlighted");
        assert(trace.contains(tile) && animation.currentTime === animationTime &&
          doc.querySelector("#time-readout").textContent === time, "Highlight toggle changed ECG playback");
        change(rhythmControl, "flutter");
        assert(visibleSources() === "sinus", "Queued rhythm highlighted before reaching the playhead");
        step();
        assert(visibleSources() === "flutter", "Highlight did not follow the rhythm at the playhead");
        toggle.click();
        assert(!visibleSources() && doc.querySelector("#source-description").textContent === "Highlighting off",
          "Turning highlighting off left the source visible");
        toggle.click();
        expect("pac", "left,sinus");
        expect("atrial_tachy", "atrial_tachy");
        expect("junctional", "junctional");
        expect("junctional_tachy", "junctional");
        expect("avnrt", "avnrt");
        expect("avrt", "avrt,junctional");
        change(pvcFocus, "lv");
        step();
        expect("pvc", "sinus,ventricular");
        const ventricular = doc.querySelector('[data-source-highlight="ventricular"]');
        const leftX = ventricular.getAttribute("cx");
        change(pvcFocus, "rv");
        assert(ventricular.getAttribute("cx") === leftX, "PVC focus moved before its queued change reached the playhead");
        step();
        assert(ventricular.getAttribute("cx") !== leftX &&
          doc.querySelector("#source-description").textContent.includes("Right ventricular"),
        "PVC source did not follow the selected ventricular focus");
        expect("sinus", "sinus");
        change(av, "third");
        step();
        assert(visibleSources() === "junctional,sinus", "Complete block omitted an independent pacemaker");
        change(av, "normal");
        step();
        for (const rhythm of ["wandering", "multifocal_atrial_tachy"]) {
          change(rhythmControl, rhythm);
          step();
          const seen = new Set();
          for (let i = 0; i < 4; i++) {
            const current = doc.querySelector('[data-atrial-focus][data-current="true"]');
            assert(current && visibleSources() === current.dataset.atrialFocus,
              `${rhythm}: highlight does not match the current atrial focus`);
            seen.add(visibleSources());
            step();
          }
          assert(seen.size > 1, `${rhythm}: highlight did not follow changing foci`);
        }
        for (const rhythm of ["afib", "vfib", "vt"]) {
          expect(rhythm, "");
          assert(doc.querySelector("#source-description").textContent === "No discrete source modeled",
            `${rhythm}: missing no-source explanation`);
        }
        toggle.click();
        assert(!visibleSources() && doc.querySelector("#source-description").textContent === "Highlighting off",
          "Turning highlighting off left the source visible");
      } finally {
        if (pause.textContent === "Pause") pause.click();
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = request;
      }
    });
    test("Pacemaker overlay stays inside the heart and follows ECG playback without changing it", () => {
      const toggle = doc.querySelector("#show-automaticity");
      const layer = doc.querySelector("[data-automaticity-layer]");
      const cells = [...layer.querySelectorAll("text")];
      const atria = cells.filter(cell => cell.dataset.counterChamber === "atria");
      const ventricles = cells.filter(cell => ["rv", "lv"].includes(cell.dataset.counterChamber));
      const avNode = cells.find(cell => cell.dataset.counterSite === "av");
      const sinus = cells.find(cell => cell.dataset.counterSite === "sinus");
      const left = cells.find(cell => cell.dataset.counterSite === "left");
      const trace = doc.querySelector("#ecg-trace");
      const speed = doc.querySelector("#speed");
      const change = (id, value) => {
        const control = doc.querySelector(id);
        control.value = value;
        control.dispatchEvent(new win.Event("change", { bubbles: true }));
      };
      const snapshot = () => cells.map(cell => `${cell.textContent}:${cell.getAttribute("fill")}`).join(",");
      const phase = (nodes, value) => nodes.every(node => node.dataset.counterPhase === value);
      let callback;
      let now = doc.timeline.currentTime;
      const request = win.requestAnimationFrame;
      Object.defineProperty(doc.timeline, "currentTime", { configurable: true, get: () => now });
      win.requestAnimationFrame = fn => { callback = fn; return 1; };
      resetSelectionsImmediately(false);
      const step = elapsed => {
        pause.click();
        callback(now += elapsed);
        pause.click();
      };
      try {
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        change("#av-pattern", "normal");
        change("#bundle-pattern", "none");
        change("#rhythm-pattern", "sinus");
        change("#heart-rate", "60");
        resetAfterSelection();
        assert(!toggle.checked && layer.style.display === "none", "Counters were not off by default");
        const tiles = [...trace.querySelectorAll("canvas")];
        const animationTimes = tiles.map(tile => tile.getAnimations()[0].currentTime);
        const time = doc.querySelector("#time-readout").textContent;
        const height = doc.querySelector("#ecg-plot").getBoundingClientRect().height;
        toggle.click();
        assert(layer.style.display !== "none" && cells.length > 30 && atria.length > 10 && ventricles.length > 10,
          "Counter grid does not cover both atria and ventricles");
        assert(tiles.every((tile, i) => trace.contains(tile) && tile.getAnimations()[0].currentTime === animationTimes[i]) &&
          doc.querySelector("#time-readout").textContent === time &&
          doc.querySelector("#ecg-plot").getBoundingClientRect().height === height,
        "Enabling the counter overlay changed the ECG trace or viewport");
        for (const cell of cells) {
          const region = [...doc.querySelectorAll("#anatomy-overlays path")]
            .find(path => path.querySelector("title")?.textContent === cell.dataset.counterRegion);
          if (cell === sinus || cell === avNode) {
            assert(region.isPointInFill(new win.DOMPoint(Number(cell.getAttribute("x")), Number(cell.getAttribute("y")))),
              "An enlarged nodal counter is not centered on its node");
            assert(cells.filter(other => other !== sinus && other !== avNode)
              .every(other => parseFloat(win.getComputedStyle(cell).fontSize) >
                parseFloat(win.getComputedStyle(other).fontSize)),
            "SA and AV counters are not larger than the other counters");
            const box = cell.getBBox();
            assert(cells.filter(other => other !== cell).every(other => {
              const bounds = other.getBBox();
              return box.x + box.width <= bounds.x || bounds.x + bounds.width <= box.x ||
                box.y + box.height <= bounds.y || bounds.y + bounds.height <= box.y;
            }), "An enlarged nodal counter overlaps another digit");
            continue;
          }
          const box = cell.getBBox();
          assert([[box.x, box.y], [box.x + box.width, box.y],
            [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
            .every(([x, y]) => region.isPointInFill(new win.DOMPoint(x, y))),
          "A counter glyph is outside its anatomical region");
        }
        assert(phase(atria, "activation") && atria.every(node => node.textContent === "9" &&
          node.getAttribute("fill") === "#d7191c") && phase(ventricles, "charging"),
        "P wave did not reset just the atrial grid to red 9");
        step(60);
        assert(atria.every(node => node.textContent === "4"), "Red digits did not count down quickly");
        step(25);
        assert(avNode.dataset.counterPhase === "activation" && avNode.textContent === "9" &&
          avNode.getAttribute("fill") === "#d7191c" && phase(ventricles, "charging"),
        "AV node counter did not activate on its own conduction clock");
        step(45);
        assert(sinus.textContent === "0" && sinus.getAttribute("fill") === "rgb(0, 0, 0)",
          "Counter did not restart from black zero");
        step(55);
        assert(phase(atria, "charging") && phase(ventricles, "activation") &&
          ventricles.every(node => node.textContent === "9"), "QRS did not independently reset the ventricular grid");
        step(165);
        assert(phase(ventricles, "charging") && ventricles.every(node => node.textContent === "0"),
          "Ventricular red countdown did not return to zero");
        step(649);
        assert(sinus.textContent === "9" && sinus.getAttribute("fill") === "rgb(255, 230, 0)" &&
          Number(left.textContent) < 9, "SA node did not charge fastest to bright yellow 9");
        const restingDigits = ventricles.map(node => Number(node.textContent));
        assert(phase(ventricles, "charging") && new Set(restingDigits).size >= 2 &&
          Math.min(...restingDigits) >= 2,
        "Rendered ventricular counters did not visibly charge at varied resting speeds");
        assert(avNode.dataset.counterPhase === "charging" &&
          Number(avNode.textContent) > Math.max(...restingDigits) && Number(avNode.textContent) < 9,
        "Rendered AV counter did not charge on its faster independent junctional timeline");
        const pausedState = snapshot();
        toggle.click();
        assert(layer.style.display === "none", "Counter overlay did not turn off");
        toggle.click();
        speed.value = "0.5";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        assert(snapshot() === pausedState, "Pause, speed, or toggling changed the counter phase");
        step(4);
        assert(phase(atria, "activation") && sinus.textContent === "9", "Counters did not follow half-speed playback");
        speed.value = "1";
        speed.dispatchEvent(new win.Event("input", { bubbles: true }));
        const oldState = snapshot();
        change("#rhythm-pattern", "atrial_tachy");
        assert(snapshot() === oldState, "Queued rhythm changed counters ahead of the ECG playhead");
        resetAfterSelection();
        step(399);
        assert(left.textContent === "9" && Number(sinus.textContent) < 9,
          "Focal atrial tachycardia did not accelerate the left atrial counter");
        change("#rhythm-pattern", "sinus");
        change("#heart-rate", "60");
        for (const [bundle, first, delayed] of [["rbbb", "lv", "rv"], ["lbbb", "rv", "lv"]]) {
          const queuedState = snapshot();
          change("#bundle-pattern", bundle);
          assert(snapshot() === queuedState, `${bundle}: counters changed before the queued bundle block reached the playhead`);
          resetAfterSelection();
          const earlyCells = cells.filter(cell => cell.dataset.counterChamber === first);
          const lateCells = cells.filter(cell => cell.dataset.counterChamber === delayed);
          step(200);
          assert(phase(earlyCells, "activation") && phase(lateCells, "charging"),
            `${bundle}: numeric grid does not distinguish early and delayed ventricular depolarization`);
          step(65);
          assert(lateCells.every(cell => cell.dataset.counterPhase === "activation" &&
            cell.textContent === "9" && cell.getAttribute("fill") === "#d7191c") &&
            earlyCells.every(cell => cell.textContent === "4"),
          `${bundle}: ventricular grids reset or counted down together`);
        }
        change("#bundle-pattern", "none");
        for (const [rhythm, rate] of [["junctional", 60], ["junctional_tachy", 120]]) {
          const queuedState = snapshot();
          change("#rhythm-pattern", rhythm);
          change("#heart-rate", String(rate));
          assert(snapshot() === queuedState && layer.style.display !== "none",
            `${rhythm}: queued selection changed counters before reaching the playhead`);
          resetAfterSelection();
          assert(layer.style.display !== "none" && avNode.dataset.counterPhase === "activation" &&
            avNode.textContent === "9" && avNode.getAttribute("fill") === "#d7191c" &&
            phase(atria, "charging"),
          `${rhythm}: overlay did not show AV-node firing`);
          step(60);
          assert(phase(ventricles, "activation") && phase(atria, "charging"),
            `${rhythm}: counters did not follow ventricular conduction`);
          step(5);
          assert(phase(atria, "activation"), `${rhythm}: counters missed retrograde atrial activation`);
          step(60000 / rate - 66);
          assert(avNode.dataset.counterPhase === "charging" && avNode.textContent === "9" &&
            avNode.getAttribute("fill") === "rgb(255, 230, 0)" && Number(sinus.textContent) < 9,
          `${rhythm}: AV counter did not charge faster than the suppressed SA counter`);
        }
        change("#rhythm-pattern", "afib");
        assert(layer.style.display !== "none", "Pending AF hid counters before the playhead transition");
        resetAfterSelection();
        assert(layer.style.display !== "none" && toggle.checked &&
          atria.some(cell => cell.dataset.counterPhase === "activation") &&
          atria.some(cell => cell.dataset.counterPhase === "charging"),
        "AF did not display asynchronous local atrial counters");
        const afState = snapshot();
        step(25);
        assert(snapshot() !== afState, "AF counters did not fluctuate with playback");
        change("#rhythm-pattern", "flutter");
        resetAfterSelection();
        assert(layer.style.display !== "none" && phase(atria, "activation"),
          "Flutter counters did not display atrial activation");
        change("#rhythm-pattern", "sinus");
        resetAfterSelection();
        assert(layer.style.display !== "none", "Counter mode did not resume on a supported rhythm");
        assert(cells.every(cell => /^[0-9]$/.test(cell.textContent)), "A counter displayed 10 or an invalid value");
      } finally {
        if (toggle.checked) toggle.click();
        if (pause.textContent === "Pause") pause.click();
        delete doc.timeline.currentTime;
        win.requestAnimationFrame = request;
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
