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
  const rhythms = {
    sinus: { rateLabel: "Atrial rate", defaultRate: 70, minRate: 40, maxRate: 120 },
    wandering: { rateLabel: "Atrial rate", defaultRate: 80, minRate: 40, maxRate: 90 },
    pac: { rateLabel: "Atrial rate", defaultRate: 70, minRate: 40, maxRate: 120 },
    avnrt: { rateLabel: "Tachycardia rate", defaultRate: 180, minRate: 140, maxRate: 250, avReentry: true },
    avrt: { rateLabel: "Tachycardia rate", defaultRate: 180, minRate: 140, maxRate: 250, avReentry: true },
    wpw: { rateLabel: "Atrial rate", defaultRate: 70, minRate: 40, maxRate: 120 },
    atrial_tachy: { rateLabel: "Atrial rate", defaultRate: 150, minRate: 100, maxRate: 250 },
    multifocal_atrial_tachy: { rateLabel: "Atrial rate", defaultRate: 120, minRate: 100, maxRate: 180 },
    flutter: { rateLabel: "Atrial rate", defaultRate: 300, minRate: 240, maxRate: 360 },
    afib: { rateLabel: "Ventricular response", defaultRate: 90, minRate: 50, maxRate: 200 },
    junctional: { rateLabel: "Junctional rate", defaultRate: 50, minRate: 40, maxRate: 60, junctional: true },
    junctional_tachy: { rateLabel: "Junctional rate", defaultRate: 130, minRate: 100, maxRate: 180, junctional: true }
  };
  const atrialFoci = {
    sinus: { label: "SA node", x: 0.347, y: 0.414, amplitude: 1, duration: 75, orientation: 0.5, pr: 130 },
    rightHigh: { label: "High right atrium", x: 265 / 822, y: 286 / 566, amplitude: 0.8, duration: 75, orientation: 0.38, pr: 140 },
    rightLow: { label: "Low right atrium", x: 276 / 822, y: 342 / 566, amplitude: 0.55, duration: 110, orientation: 0.68, pr: 180 },
    left: { label: "Left atrium", x: 450 / 822, y: 245 / 566, amplitude: -0.65, duration: 95, orientation: 0.34, pr: 160 }
  };
  const atrialFocusPatterns = {
    wandering: {
      sequence: ["sinus", "rightHigh", "left", "rightHigh", "sinus", "left", "rightHigh", "left"],
      intervals: [0.9, 1.08, 1.02]
    },
    atrial_tachy: { sequence: ["left"], intervals: [1] },
    multifocal_atrial_tachy: {
      sequence: ["rightHigh", "left", "rightLow", "left", "rightHigh", "rightLow", "rightHigh", "left"],
      intervals: [0.86, 1.14, 0.96, 1.21, 0.78, 1.07, 0.91, 1.07]
    }
  };
  const defaults = {
    rhythm: "sinus", av: "normal", bundle: "none", atrialRate: 70, escapeRate: 40,
    pr: 260, wenckebachPr: 160, prStep: 40, conductedBeats: 3
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const clone = value => JSON.parse(JSON.stringify(value));
  const deltaWave = { amplitude: 0.18, duration: 40, orientation: 0.78, topRadius: 8 };
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

  function sampleWave(ms, item) {
    if (ms < 0 || ms > item.duration) return 0;
    const x = ms / item.duration;
    const distance = x < item.orientation ? x / item.orientation : (1 - x) / (1 - item.orientation);
    return item.amplitude * (1 - Math.pow(1 - distance, 1 + item.topRadius * 0.03));
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
      for (const [key, min, max] of [
        ["atrialRate", rhythms[s.rhythm].minRate, rhythms[s.rhythm].maxRate],
        ["escapeRate", 20, 60], ["pr", 220, 380],
        ["wenckebachPr", 120, 200], ["prStep", 20, 60], ["conductedBeats", 2, 5]
      ]) {
        if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max ||
            (key === "conductedBeats" && !Number.isInteger(s[key]))) {
          throw new Error(`Invalid ${key}: expected ${min} to ${max}.`);
        }
      }
      this.morphology = clone(validateMorphology(morphology || templates[s.bundle]));
      this.timing = morphologyTiming(this.morphology);
      this.ventricularWaves = this.morphology.waves.slice(1);
      this.now = 0;
      this.queue = [];
      this.events = [];
      this.atria = [];
      this.ventricles = [];
      this.serial = 0;
      this.beatIndex = 0;
      if (rhythms[s.rhythm].junctional || rhythms[s.rhythm].avReentry) {
        this.schedule(0, "tachy");
      } else if (s.rhythm === "afib") {
        this.schedule(0, "afib");
      } else {
        this.schedule(0, "atrial");
      }
      if (s.rhythm === "flutter") this.schedule(0, "sinus-firing");
      if (s.av === "third" && !rhythms[s.rhythm].junctional) this.schedule(350, "escape");
      this.advanceTo(0);
    }

    schedule(time, type, data = {}) {
      this.queue.push({ time, type, ...data, serial: this.serial++ });
      this.queue.sort((a, b) => a.time - b.time || a.serial - b.serial);
    }

    process(event) {
      const s = this.settings;
      const t = event.time;
      if (event.type === "atrial" || event.type === "pac") {
        const index = this.beatIndex++;
        const position = index % (s.conductedBeats + 1);
        const droppedByAv = (s.av === "mobitz1" || s.av === "mobitz2") && position === s.conductedBeats;
        const droppedByFlutter = s.rhythm === "flutter" && index % 2 === 1;
        const dropped = droppedByAv || droppedByFlutter;
        const focusPattern = atrialFocusPatterns[s.rhythm];
        const focusId = focusPattern?.sequence[index % focusPattern.sequence.length];
        const focus = focusId ? atrialFoci[focusId] : null;
        const basePr = s.rhythm === "wpw" ? 100 :
          s.av === "first" ? s.pr :
          s.av === "mobitz1" ? Math.round(s.wenckebachPr + 2 * s.prStep * (1 - 0.5 ** position)) :
          s.av === "mobitz2" ? 160 : focus?.pr ?? 160;
        const pWave = { ...this.morphology.waves[0] };
        if (focus) {
          pWave.amplitude = Math.abs(pWave.amplitude) * focus.amplitude;
          pWave.orientation = focus.orientation;
          pWave.duration = focus.duration;
        } else if (event.type === "pac") {
          pWave.amplitude *= -1.35;
          pWave.orientation = 0.36;
          pWave.duration = Math.max(50, pWave.duration - 15);
        }
        const beat = {
          time: t, pr: s.av === "third" && s.rhythm !== "wpw" ? null : basePr,
          conducted: s.rhythm === "wpw" || (s.av !== "third" && !dropped),
          origin: event.type === "pac" ? "PAC" : s.rhythm,
          ...(focusId ? { focus: focusId } : {}),
          pWave: s.rhythm === "flutter" ? null : pWave,
          blockSite: !droppedByFlutter && s.av === "mobitz2" ? "his" : "av"
        };
        this.atria.push(beat);
        const period = 60000 / s.atrialRate;
        let nextInterval = period;
        let nextType = "atrial";
        if (focusPattern) {
          nextInterval *= focusPattern.intervals[index % focusPattern.intervals.length];
        } else if (s.rhythm === "pac") {
          if (event.type === "pac") nextInterval *= 1.2;
          else if ((index + 1) % 4 === 0) {
            nextInterval *= 0.55;
            nextType = "pac";
          }
        }
        this.schedule(t + nextInterval, nextType);
        if (s.rhythm === "wpw") {
          this.schedule(t + 100, "ventricular", { origin: "preexcited", preexcited: true, beat });
        } else if (s.av === "third") {
          this.schedule(t + 80, "av-arrival", { beat });
          this.schedule(t + 110, "block", { beat, site: "av" });
        } else if (dropped && beat.blockSite === "av") {
          this.schedule(t + 80, "av-arrival", { beat });
          const blockDelay = s.av === "mobitz1" && !droppedByFlutter ? basePr - 35 : 80;
          this.schedule(t + blockDelay, "block", { beat, site: "av" });
        } else {
          this.schedule(t + 80, "av-arrival", { beat });
          this.schedule(t + basePr - 35, "av-release", { beat });
          this.schedule(t + basePr - 20, "his", { beat });
          if (dropped) this.schedule(t + basePr - 10, "block", { beat, site: beat.blockSite });
          else this.schedule(t + basePr, "ventricular", { origin: "conducted", beat });
        }
      } else if (event.type === "sinus-firing") {
        this.schedule(t + flutterSinusInterval, "sinus-firing");
      } else if (event.type === "tachy") {
        const origin = rhythms[s.rhythm].junctional ? "junctional" : s.rhythm;
        const interval = 60000 / s.atrialRate;
        const beat = { time: t, origin, bundle: s.bundle };
        this.schedule(t + 20, "his", { origin });
        this.schedule(t + 35, "ventricular", { origin, beat });
        this.schedule(t + 65, "retrograde-atria", { origin });
        this.schedule(t + interval, "tachy");
      } else if (event.type === "retrograde-atria") {
        this.atria.push({
          time: t, pr: null, conducted: false, retrograde: true, origin: event.origin,
          pWave: { ...this.morphology.waves[0], amplitude: -Math.abs(this.morphology.waves[0].amplitude) }
        });
      } else if (event.type === "afib") {
        const variation = [0.68, 1.24, 0.82, 1.31, 0.74, 1.16, 0.93, 1.12][this.beatIndex++ % 8];
        if (s.av === "third") this.schedule(t, "block", { site: "av" });
        else this.schedule(t, "ventricular", { origin: "afib" });
        this.schedule(t + (60000 / s.atrialRate) * variation, "afib");
      } else if (event.type === "escape") {
        this.schedule(t + 60000 / s.escapeRate, "escape");
        this.schedule(t, "his", { origin: "escape" });
        this.schedule(t + 20, "ventricular", { origin: "escape" });
      } else if (event.type === "ventricular") {
        const preexcitedOffset = event.preexcited ? deltaWave.duration : 0;
        const beat = {
          time: t, origin: event.origin, bundle: s.bundle, preexcited: !!event.preexcited,
          qrsMs: this.timing.qrsMs + preexcitedOffset,
          tStart: this.timing.tStart + preexcitedOffset,
          qtMs: this.timing.qtMs + preexcitedOffset
        };
        this.ventricles.push(beat);
        this.schedule(t + 15, "rv", { ventricular: beat, delayed: s.bundle === "rbbb" });
        this.schedule(t + 15, "lv", { ventricular: beat, delayed: s.bundle === "lbbb" });
        if (s.bundle !== "none") {
          this.schedule(t + 95, "myocardial", { ventricular: beat, side: s.bundle === "rbbb" ? "rv" : "lv" });
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
      this.advanceTo(this.queue[0].time);
    }

    chamberOpacity(time, chamber) {
      if (chamber === "atria") {
        if (this.settings.rhythm === "afib") {
          const phase = time / 37;
          const modulation = (1 + Math.sin(phase * 0.73) * Math.sin(phase * 1.17)) / 2;
          return 0.06 + 0.44 * modulation;
        }
        return this.atria.reduce((alpha, beat) => {
          const pEnd = beat.pWave?.duration || this.morphology.waves[0].duration;
          return Math.max(alpha, activationOpacity(time - beat.time, 0, pEnd, pEnd + 200));
        }, 0);
      }
      if (chamber !== "rv" && chamber !== "lv") throw new Error(`Unknown chamber: ${chamber}`);
      return this.ventricles.reduce((alpha, beat) => {
        const delayed = (chamber === "rv" && beat.bundle === "rbbb") ||
          (chamber === "lv" && beat.bundle === "lbbb");
        const onset = Math.min(delayed ? 95 : 15, beat.qrsMs - 1);
        return Math.max(alpha, activationOpacity(time - beat.time, onset, beat.qrsMs, beat.qtMs));
      }, 0);
    }

    signalAt(time) {
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
      const maxVentricularAge = this.timing.qtMs + deltaWave.duration + 12;
      for (let i = firstBeatInRange(ventricles, time, maxVentricularAge); i < ventricles.length; i++) {
        const beat = ventricles[i];
        const elapsed = time - beat.time;
        if (elapsed < 0) break;
        if (elapsed > beat.qtMs + 12) continue;
        if (beat.preexcited) value += sampleWave(elapsed, deltaWave);
        let cursor = beat.time + (beat.preexcited ? deltaWave.duration : 0);
        for (const item of ventricularWaves) {
          value += sampleWave(time - cursor, item);
          cursor += item.duration + item.gap;
        }
        value += segmentOffset(elapsed, beat.qrsMs, beat.tStart, segments?.st);
      }
      return value;
    }
  }

  window.Conduction = { Simulation, templates, rhythms, defaults, atrialFoci, atrialFocusPatterns, morphologyTiming, validateMorphology, clone };
})();
