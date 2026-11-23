"use strict";

(() => {
  const wave = (id, label, amplitude, duration, gap, color) => ({
    id, label, amplitude, duration, gap, color, topRadius: 12, orientation: 0.5
  });
  const templates = {
    none: {
      name: "V1 · normal conduction",
      waves: [
        wave("p", "P wave", 0.1, 90, 70, "#d97706"),
        wave("q", "Q wave", 0, 10, 0, "#be123c"),
        wave("r", "R wave", 0.25, 25, 0, "#00805d"),
        wave("s", "S wave", -0.8, 55, 90, "#7c3aed"),
        wave("t", "T wave", 0.16, 170, 0, "#0369a1")
      ]
    },
    rbbb: {
      name: "V1 · RBBB",
      waves: [
        wave("p", "P wave", 0.1, 90, 70, "#d97706"),
        wave("q", "Q wave", 0, 10, 0, "#be123c"),
        wave("r", "Initial R", 0.45, 30, 0, "#00805d"),
        wave("s", "S wave", -0.4, 35, 0, "#7c3aed"),
        wave("r2", "Terminal R prime", 0.95, 75, 80, "#00805d"),
        wave("t", "T wave", -0.24, 180, 0, "#0369a1")
      ]
    },
    lbbb: {
      name: "V1 · LBBB",
      waves: [
        wave("p", "P wave", 0.1, 90, 70, "#d97706"),
        wave("q", "Q wave", -0.18, 20, 0, "#be123c"),
        wave("r", "Small R", 0.06, 20, 0, "#00805d"),
        wave("s", "Broad S", -1.1, 120, 80, "#7c3aed"),
        wave("t", "T wave", 0.36, 180, 0, "#0369a1")
      ]
    }
  };
  const sharedLeftAtrialFocus = "left";
  const rhythms = {
    sinus: { rateLabel: "Atrial rate", defaultRate: 70, minRate: 40, maxRate: 120, wpw: true },
    wandering: { rateLabel: "Atrial rate", defaultRate: 80, minRate: 40, maxRate: 90 },
    pac: { rateLabel: "Atrial rate", defaultRate: 70, minRate: 40, maxRate: 120, atrialFoci: [sharedLeftAtrialFocus] },
    avnrt: { rateLabel: "Tachycardia rate", defaultRate: 180, minRate: 140, maxRate: 250, avReentry: true },
    avrt: { rateLabel: "Tachycardia rate", defaultRate: 180, minRate: 140, maxRate: 250, avReentry: true, wpw: true },
    atrial_tachy: { rateLabel: "Atrial rate", defaultRate: 150, minRate: 100, maxRate: 250, wpw: true },
    multifocal_atrial_tachy: { rateLabel: "Atrial rate", defaultRate: 120, minRate: 100, maxRate: 180, wpw: true },
    flutter: { rateLabel: "Atrial rate", defaultRate: 300, minRate: 240, maxRate: 360, wpw: true },
    afib: { rateLabel: "Atrial rate", defaultRate: 400, minRate: 400, maxRate: 400, wpw: true },
    junctional: { rateLabel: "Junctional rate", defaultRate: 50, minRate: 40, maxRate: 60, junctional: true },
    junctional_tachy: { rateLabel: "Junctional rate", defaultRate: 130, minRate: 100, maxRate: 180, junctional: true },
    vt: { rateLabel: "Ventricular rate", defaultRate: 180, minRate: 100, maxRate: 250, independentVentricular: true },
    pvc: { rateLabel: "Sinus rate", defaultRate: 70, minRate: 40, maxRate: 120 },
    vfib: { rateLabel: "Ventricular rate", defaultRate: 180, minRate: 100, maxRate: 250, independentVentricular: true }
  };
  const atrialFoci = {
    sinus: { label: "SA node", x: 0.347, y: 0.414, amplitude: 1, duration: 75, orientation: 0.5, pr: 130 },
    rightHigh: { label: "High right atrium", x: 265 / 822, y: 286 / 566, amplitude: 0.8, duration: 75, orientation: 0.38, pr: 140 },
    rightLow: { label: "Low right atrium", x: 276 / 822, y: 342 / 566, amplitude: 0.55, duration: 110, orientation: 0.68, pr: 180 },
    left: { label: "Left atrium", x: 450 / 822, y: 245 / 566, amplitude: -0.65, duration: 95, orientation: 0.34, pr: 160 }
  };
  const atrialFocusPatterns = {
    wandering: {
      sequence: ["sinus", "rightHigh", "left"],
      intervalRange: [0.9, 1.08]
    },
    atrial_tachy: { sequence: [sharedLeftAtrialFocus], intervals: [1] },
    multifocal_atrial_tachy: {
      sequence: ["rightHigh", "left", "rightLow"],
      intervalRange: [0.78, 1.21]
    }
  };
  const defaults = {
    rhythm: "sinus", av: "normal", bundle: "none", wpw: false, atrialRate: 70, escapeRate: 40,
    pr: 260, wenckebachPr: 160, prStep: 40, conductedBeats: 3, avRefractory: 350,
    pvcFocus: "lv", randomSeed: 0
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const clone = value => JSON.parse(JSON.stringify(value));
  const preexcitationWidening = 40;
  const fibrillationAmplitudes = [0.038, 0.027, 0.019, 0.013];
  const fibrillationFrequencies = [7.1, 9.7, 12.4, 15.3];
  const flutterSinusInterval = 1000;

  function validateMorphology(value) {
    if (!value || typeof value.name !== "string" || !value.name.trim() ||
        value.name.length > 80 || !Array.isArray(value.waves)) {
      throw new Error("Each waveform needs a name and a wave array.");
    }
    const ids = value.waves.map(item => item && item.id).join(",");
    if (ids !== "p,q,r,s,t" && ids !== "p,q,r,s,r2,t") {
      throw new Error("Waves must be ordered P, Q, R, S, optional terminal R, T.");
    }
    for (const item of value.waves) {
      for (const [key, min, max] of [
        ["amplitude", -2, 2], ["duration", 10, 400], ["gap", 0, 600],
        ["topRadius", 1, 50], ["orientation", 0.15, 0.85]
      ]) {
        if (!Number.isFinite(item[key]) || item[key] < min || item[key] > max) {
          throw new Error(`Invalid ${key} for ${item.id}. Expected ${min} to ${max}.`);
        }
      }
    }
    for (const key of ["pr", "st"]) {
      const offset = value.segments?.[key];
      if (offset !== undefined && (!Number.isFinite(offset) || Math.abs(offset) > 0.5)) {
        throw new Error(`Invalid ${key.toUpperCase()} segment offset.`);
      }
    }
    return value;
  }

  function morphologyTiming(morphology) {
    const waves = morphology.waves;
    const ventricular = waves.slice(1);
    const qrs = ventricular.slice(0, -1);
    const qrsMs = qrs.reduce((sum, item, i) =>
      sum + item.duration + (i < qrs.length - 1 ? item.gap : 0), 0);
    const tStart = qrsMs + qrs[qrs.length - 1].gap;
    return { qrsMs, tStart, qtMs: tStart + ventricular[ventricular.length - 1].duration };
  }

  function sampleWave(ms, item, duration = item.duration, orientation = item.orientation) {
    if (ms < 0 || ms > duration) return 0;
    const x = ms / duration;
    const distance = x < orientation ? x / orientation : (1 - x) / (1 - orientation);
    return item.amplitude * (1 - Math.pow(1 - distance, 1 + item.topRadius * 0.03));
  }

  function samplePreexcitedR(ms, item, extension) {
    const duration = item.duration + extension;
    const orientation = (extension + item.duration * item.orientation) / duration;
    return sampleWave(ms, item, duration, orientation);
  }

  function smoothStep(x) {
    const t = clamp(x, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function segmentOffset(ms, start, end, amount) {
    if (!amount || end <= start || ms < start - 12 || ms > end + 12) return 0;
    return amount * smoothStep((ms - start + 12) / 12) * (1 - smoothStep((ms - end) / 12));
  }

  function activationOpacity(elapsed, onset, peak, end) {
    if (elapsed <= onset || elapsed >= end) return 0;
    if (elapsed <= peak) return 0.5 * smoothStep((elapsed - onset) / (peak - onset));
    return 0.5 * (1 - smoothStep((elapsed - peak) / (end - peak)));
  }

  function fibrillationOpacity(time) {
    const phase = time / 37;
    const modulation = (1 + Math.sin(phase * 0.73) * Math.sin(phase * 1.17)) / 2;
    return 0.06 + 0.44 * modulation;
  }

  function ventricularFibrillationSignal(time) {
    const seconds = time / 1000;
    return 0.42 * Math.sin(2 * Math.PI * 4.13 * seconds + 0.7 * Math.sin(2 * Math.PI * 0.71 * seconds)) +
      0.2 * Math.sin(2 * Math.PI * 6.37 * seconds + 1.4) +
      0.11 * Math.sin(2 * Math.PI * 3.17 * seconds + 0.7);
  }

  function firstBeatInRange(beats, time, maxAge) {
    let low = 0;
    let high = beats.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (time - beats[mid].time > maxAge) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  class Simulation {
    constructor(settings = {}, morphology) {
      this.settings = { ...defaults, ...settings };
      const s = this.settings;
      if (!Object.hasOwn(settings, "atrialRate") && rhythms[s.rhythm]) {
        s.atrialRate = rhythms[s.rhythm].defaultRate;
      }
      if (!rhythms[s.rhythm] ||
          !["normal", "first", "mobitz1", "mobitz2", "third"].includes(s.av) ||
          !["none", "rbbb", "lbbb"].includes(s.bundle)) {
        throw new Error("Unknown rhythm, AV, or bundle conduction pattern.");
      }
      if (rhythms[s.rhythm].avReentry && s.av !== "normal") {
        throw new Error("AVNRT and AVRT require normal AV conduction in this simplified model.");
      }
      if (typeof s.wpw !== "boolean" || (s.wpw && !rhythms[s.rhythm].wpw)) {
        throw new Error("WPW must be a boolean and is unavailable for this rhythm.");
      }
      if (!["lv", "rv"].includes(s.pvcFocus)) {
        throw new Error("PVC focus must be the left or right ventricle.");
      }
      for (const [key, min, max] of [
        ["atrialRate", rhythms[s.rhythm].minRate, rhythms[s.rhythm].maxRate],
        ["escapeRate", 20, 60], ["pr", 220, 380],
        ["wenckebachPr", 120, 200], ["prStep", 20, 60], ["conductedBeats", 2, 5],
        ["avRefractory", 100, 800], ["randomSeed", 0, 4294967295]
      ]) {
        if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max ||
            (["conductedBeats", "randomSeed"].includes(key) && !Number.isInteger(s[key]))) {
          throw new Error(`Invalid ${key}: expected ${min} to ${max}.`);
        }
      }
      this.morphology = clone(validateMorphology(morphology || templates[s.bundle]));
      this.timing = morphologyTiming(this.morphology);
      this.ventricularWaves = this.morphology.waves.slice(1);
      this.ventricularFibrillation = s.rhythm === "vfib" || (s.wpw && s.rhythm === "afib");
      this.preexcitation = s.wpw && s.rhythm !== "afib" && s.rhythm !== "avrt";
      this.expectedQrsMs = this.timing.qrsMs + (this.preexcitation ? preexcitationWidening : 0);
      this.now = 0;
      this.queue = [];
      this.events = [];
      this.atria = [];
      this.ventricles = [];
      this.serial = 0;
      this.beatIndex = 0;
      this.avReadyAt = -Infinity;
      this.randomState = s.randomSeed;
      this.focusBag = [];
      this.lastFocus = null;
      this.sinusBeatsUntilPac = s.rhythm === "pac" ? 2 + Math.floor(this.random() * 5) : 0;
      this.sinusBeatsUntilPvc = s.rhythm === "pvc" ? 2 + Math.floor(this.random() * 5) : 0;
      if (!this.ventricularFibrillation) {
        if (rhythms[s.rhythm].junctional || rhythms[s.rhythm].avReentry) {
          this.schedule(0, "tachy");
        } else if (s.rhythm === "vt") {
          this.schedule(0, "ventricular-tachy");
        } else if (s.rhythm === "afib") {
          this.schedule(0, "afib");
        } else {
          this.schedule(0, "atrial");
        }
      }
      if (s.rhythm === "flutter") this.schedule(0, "sinus-firing");
      if (s.av === "third" && !rhythms[s.rhythm].junctional &&
          !rhythms[s.rhythm].independentVentricular && !this.preexcitation && !this.ventricularFibrillation) {
        this.schedule(350, "escape");
      }
      this.advanceTo(0);
    }

    schedule(time, type, data = {}) {
      this.queue.push({ time, type, ...data, serial: this.serial++ });
      this.queue.sort((a, b) => a.time - b.time || a.serial - b.serial);
    }

    random() {
      this.randomState = (this.randomState + 0x6d2b79f5) >>> 0;
      let value = this.randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }

    nextFocus(pattern) {
      if (!this.focusBag.length) {
        this.focusBag = pattern.sequence.slice();
        for (let i = this.focusBag.length - 1; i > 0; i--) {
          const j = Math.floor(this.random() * (i + 1));
          [this.focusBag[i], this.focusBag[j]] = [this.focusBag[j], this.focusBag[i]];
        }
        if (this.focusBag[0] === this.lastFocus) {
          [this.focusBag[0], this.focusBag[1]] = [this.focusBag[1], this.focusBag[0]];
        }
      }
      this.lastFocus = this.focusBag.shift();
      return this.lastFocus;
    }

    isAvPatternDrop(index) {
      const { av, conductedBeats } = this.settings;
      return index >= 0 && (av === "mobitz1" || av === "mobitz2") &&
        index % (conductedBeats + 1) === conductedBeats;
    }

    process(event) {
      const s = this.settings;
      const t = event.time;
      if (event.type === "atrial" || event.type === "pac") {
        const index = this.beatIndex++;
        const position = index % (s.conductedBeats + 1);
        const droppedByAv = this.isAvPatternDrop(index);
        const droppedByFlutter = s.rhythm === "flutter" && t + 0.0000001 < this.avReadyAt;
        const dropped = droppedByAv || droppedByFlutter;
        if (s.rhythm === "flutter" && s.av !== "third" && !droppedByFlutter &&
            (!droppedByAv || s.av === "mobitz2")) {
          this.avReadyAt = t + s.avRefractory;
        }
        const focusPattern = atrialFocusPatterns[s.rhythm];
        const focusId = event.type === "pac" ? sharedLeftAtrialFocus :
          focusPattern?.intervalRange ? this.nextFocus(focusPattern) :
          focusPattern?.sequence[index % focusPattern.sequence.length];
        const focus = focusId ? atrialFoci[focusId] : null;
        const avPr = s.av === "first" ? s.pr :
          s.av === "mobitz1" ? Math.round(s.wenckebachPr + 2 * s.prStep * (1 - 0.5 ** position)) :
          s.av === "mobitz2" ? 160 : focus?.pr ?? 160;
        const basePr = this.preexcitation ? 100 : avPr;
        const pWave = { ...this.morphology.waves[0] };
        if (focus) {
          pWave.amplitude = Math.abs(pWave.amplitude) * focus.amplitude;
          pWave.orientation = focus.orientation;
          pWave.duration = focus.duration;
        }
        const beat = {
          time: t, pr: s.av === "third" && !this.preexcitation ? null : basePr,
          conducted: this.preexcitation || (s.av !== "third" && !dropped),
          ...(this.preexcitation ? { preexcited: true } : {}),
          ...(this.preexcitation && s.rhythm === "flutter" ? {
            avPr: s.av === "third" ? null : avPr,
            avConducted: s.av !== "third" && !dropped
          } : {}),
          origin: event.type === "pac" ? "PAC" : s.rhythm,
          ...(focusId ? { focus: focusId } : {}),
          pWave: s.rhythm === "flutter" ? null : pWave,
          blockSite: !droppedByFlutter && s.av === "mobitz2" ? "his" : "av"
        };
        this.atria.push(beat);
        const period = 60000 / s.atrialRate;
        let nextInterval = period;
        let nextType = "atrial";
        if (focusPattern?.intervalRange) {
          const [min, max] = focusPattern.intervalRange;
          nextInterval *= min + this.random() * (max - min);
        } else if (focusPattern) {
          nextInterval *= focusPattern.intervals[index % focusPattern.intervals.length];
        } else if (s.rhythm === "pac") {
          if (event.type === "pac") {
            nextInterval *= 1.1 + this.random() * 0.3;
            this.sinusBeatsUntilPac = 2 + Math.floor(this.random() * 5);
          } else if (--this.sinusBeatsUntilPac === 0) {
            nextInterval *= 0.5 + this.random() * 0.25;
            nextType = "pac";
          }
        }
        if (s.rhythm === "pvc" && event.type === "atrial" && --this.sinusBeatsUntilPvc === 0) {
          this.schedule(t + period * 0.55, "pvc");
          this.sinusBeatsUntilPvc = 2 + Math.floor(this.random() * 5);
        }
        this.schedule(t + nextInterval, nextType);
        if (this.preexcitation) {
          this.schedule(t + 100, "ventricular", { origin: "preexcited", preexcited: true, beat });
        }
        if (!this.preexcitation || s.rhythm === "flutter") {
          if (s.av === "third") {
            this.schedule(t + 80, "av-arrival", { beat });
            this.schedule(t + 110, "block", { beat, site: "av" });
          } else if (dropped && beat.blockSite === "av") {
            this.schedule(t + 80, "av-arrival", { beat });
            const blockDelay = s.av === "mobitz1" && !droppedByFlutter ? avPr - 35 : 80;
            this.schedule(t + blockDelay, "block", { beat, site: "av" });
          } else {
            this.schedule(t + 80, "av-arrival", { beat });
            this.schedule(t + avPr - 35, "av-release", { beat });
            this.schedule(t + avPr - 20, "his", { beat });
            if (dropped) this.schedule(t + avPr - 10, "block", { beat, site: beat.blockSite });
            else if (!this.preexcitation) this.schedule(t + avPr, "ventricular", { origin: "conducted", beat });
          }
        }
      } else if (event.type === "sinus-firing") {
        this.schedule(t + flutterSinusInterval, "sinus-firing");
      } else if (event.type === "tachy") {
        const origin = rhythms[s.rhythm].junctional ? "junctional" : s.rhythm;
        const interval = 60000 / s.atrialRate;
        const beat = { time: t, origin, bundle: s.bundle };
        const ventricularTime = t + 35;
        const atrialTime = t + 65;
        this.schedule(t + 20, "his", { origin });
        this.schedule(ventricularTime, "ventricular", { origin, beat });
        if (origin === "avrt") this.schedule(ventricularTime, "accessory-retrograde", { endTime: atrialTime });
        this.schedule(atrialTime, "retrograde-atria", { origin });
        this.schedule(t + interval, "tachy");
      } else if (event.type === "ventricular-tachy") {
        this.schedule(t, "ventricular", { origin: "VT" });
        this.schedule(t + 60000 / s.atrialRate, "ventricular-tachy");
      } else if (event.type === "pvc") {
        this.schedule(t, "ventricular", { origin: "PVC" });
      } else if (event.type === "retrograde-atria") {
        this.atria.push({
          time: t, pr: null, conducted: false, retrograde: true, origin: event.origin,
          pWave: { ...this.morphology.waves[0], amplitude: -Math.abs(this.morphology.waves[0].amplitude) }
        });
      } else if (event.type === "afib") {
        const variation = [0.68, 1.24, 0.82, 1.31, 0.74, 1.16, 0.93, 1.12][this.beatIndex++ % 8];
        event.conducted = s.av !== "third" && t + 0.0000001 >= this.avReadyAt;
        if (event.conducted) {
          this.avReadyAt = t + s.avRefractory;
          this.schedule(t + 80, "ventricular", { origin: "afib" });
        } else {
          this.schedule(t, "block", { site: "av" });
        }
        this.schedule(t + (60000 / s.atrialRate) * variation, "afib");
      } else if (event.type === "escape") {
        this.schedule(t + 60000 / s.escapeRate, "escape");
        this.schedule(t, "his", { origin: "escape" });
        this.schedule(t + 20, "ventricular", { origin: "escape" });
      } else if (event.type === "ventricular") {
        const preexcitedOffset = event.preexcited ? preexcitationWidening : 0;
        const directVentricular = ["PVC", "VT"].includes(event.origin);
        const qrsMs = directVentricular ? Math.max(this.timing.qrsMs, 160) : this.timing.qrsMs + preexcitedOffset;
        const waveScale = directVentricular ? qrsMs / this.timing.qrsMs : 1;
        const ventricularFocusBundle = s.pvcFocus === "lv" ? "rbbb" : "lbbb";
        const beat = {
          time: t, origin: event.origin,
          bundle: event.origin === "PVC" ? ventricularFocusBundle : directVentricular ? "none" : s.bundle,
          preexcited: !!event.preexcited, waveScale,
          qrsMs,
          tStart: this.timing.tStart * waveScale + preexcitedOffset,
          qtMs: this.timing.qtMs + this.timing.tStart * (waveScale - 1) + preexcitedOffset
        };
        this.ventricles.push(beat);
        if (beat.preexcited) this.schedule(t, "accessory-ventricular", { ventricular: beat });
        this.schedule(t + 15, "rv", { ventricular: beat, delayed: beat.bundle === "rbbb" });
        this.schedule(t + (beat.preexcited && beat.bundle !== "lbbb" ? 0 : 15), "lv",
          { ventricular: beat, delayed: beat.bundle === "lbbb" });
        if (beat.bundle !== "none") {
          this.schedule(t + 95, "myocardial", { ventricular: beat, side: beat.bundle === "rbbb" ? "rv" : "lv" });
        }
        this.schedule(t + beat.tStart, "repolarization", { ventricular: beat });
      }
      this.events.push(event);
    }

    advanceTo(time) {
      if (!Number.isFinite(time) || time < this.now) throw new Error("Simulation time must move forward.");
      while (this.queue.length && this.queue[0].time <= time) this.process(this.queue.shift());
      this.now = time;
      const cutoff = time - 11000 - Math.max(this.timing.qtMs, this.morphology.waves[0].duration, 500);
      if (this.events[0]?.time < cutoff) this.events = this.events.filter(event => event.time >= cutoff);
      if (this.atria[0]?.time < cutoff) this.atria = this.atria.filter(beat => beat.time >= cutoff);
      if (this.ventricles[0]?.time < cutoff) this.ventricles = this.ventricles.filter(beat => beat.time >= cutoff);
    }

    step() {
      if (!this.queue.length) throw new Error("Continuous ventricular fibrillation has no discrete events to step through.");
      this.advanceTo(this.queue[0].time);
    }

    chamberOpacity(time, chamber) {
      if (chamber === "atria") {
        if (this.settings.rhythm === "afib") {
          return fibrillationOpacity(time);
        }
        return this.atria.reduce((alpha, beat) => {
          const pEnd = beat.pWave?.duration || this.morphology.waves[0].duration;
          return Math.max(alpha, activationOpacity(time - beat.time, 0, pEnd, pEnd + 200));
        }, 0);
      }
      if (chamber !== "rv" && chamber !== "lv") throw new Error(`Unknown chamber: ${chamber}`);
      if (this.ventricularFibrillation) return fibrillationOpacity(time + (chamber === "rv" ? 193 : 487));
      return this.ventricles.reduce((alpha, beat) => {
        const delayed = (chamber === "rv" && beat.bundle === "rbbb") ||
          (chamber === "lv" && beat.bundle === "lbbb");
        const onset = Math.min(delayed ? 95 : beat.preexcited && chamber === "lv" ? 0 : 15, beat.qrsMs - 1);
        return Math.max(alpha, activationOpacity(time - beat.time, onset, beat.qrsMs, beat.qtMs));
      }, 0);
    }

    signalAt(time) {
      if (this.ventricularFibrillation) return ventricularFibrillationSignal(time);
      let value = 0;
      const { atria, ventricles, ventricularWaves } = this;
      const segments = this.morphology.segments;
      if (this.settings.rhythm === "flutter") {
        const phase = ((time * this.settings.atrialRate / 60000) % 1 + 1) % 1;
        value += 0.08 * (1 - 2 * phase);
      } else if (this.settings.rhythm === "afib") {
        const seconds = time / 1000;
        for (let i = 0; i < fibrillationAmplitudes.length; i++) {
          value += fibrillationAmplitudes[i] * Math.sin(seconds * fibrillationFrequencies[i] + i * 1.7);
        }
      }
      // Include the longest legal P/PR interval and the 12 ms segment taper.
      for (let i = firstBeatInRange(atria, time, 400 + 12); i < atria.length; i++) {
        const beat = atria[i];
        const elapsed = time - beat.time;
        if (elapsed < 0) break;
        if (!beat.pWave) continue;
        value += sampleWave(elapsed, beat.pWave);
        if (beat.conducted) value += segmentOffset(elapsed, beat.pWave.duration, beat.pr, segments?.pr);
      }
      const maxVentricularAge = this.timing.qtMs +
        this.timing.tStart * Math.max(0, 160 / this.timing.qrsMs - 1) + preexcitationWidening + 12;
      for (let i = firstBeatInRange(ventricles, time, maxVentricularAge); i < ventricles.length; i++) {
        const beat = ventricles[i];
        const elapsed = time - beat.time;
        if (elapsed < 0) break;
        if (elapsed > beat.qtMs + 12) continue;
        // Fold a silent Q into the R upstroke so pre-excitation begins at QRS onset.
        const silentQ = beat.preexcited && ventricularWaves[0].amplitude === 0 ?
          ventricularWaves[0].duration * beat.waveScale : 0;
        let cursor = beat.time;
        for (const item of ventricularWaves) {
          const scale = item.id === "t" ? 1 : beat.waveScale;
          if (item.id === "q" && silentQ) {
            cursor += item.gap * scale;
            continue;
          }
          const extension = beat.preexcited && item.id === "r" ? preexcitationWidening + silentQ : 0;
          value += extension ? samplePreexcitedR(time - cursor, item, extension) :
            sampleWave(time - cursor, item, item.duration * scale);
          cursor += item.duration * scale + extension + item.gap * scale;
        }
        value += segmentOffset(elapsed, beat.qrsMs, beat.tStart, segments?.st);
      }
      return value;
    }
  }

  window.Conduction = { Simulation, templates, rhythms, defaults, atrialFoci, atrialFocusPatterns, morphologyTiming, validateMorphology, clone };
})();
