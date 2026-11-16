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
  const defaults = {
    av: "normal", bundle: "none", atrialRate: 70, escapeRate: 40,
    pr: 260, wenckebachPr: 160, prStep: 40, conductedBeats: 3
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const clone = value => JSON.parse(JSON.stringify(value));

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

  class Simulation {
    constructor(settings = {}, morphology) {
      this.settings = { ...defaults, ...settings };
      const s = this.settings;
      if (!["normal", "first", "mobitz1", "mobitz2", "third"].includes(s.av) ||
          !["none", "rbbb", "lbbb"].includes(s.bundle)) {
        throw new Error("Unknown AV or bundle conduction pattern.");
      }
      for (const [key, min, max] of [
        ["atrialRate", 40, 120], ["escapeRate", 20, 60], ["pr", 220, 380],
        ["wenckebachPr", 120, 200], ["prStep", 20, 60], ["conductedBeats", 2, 5]
      ]) {
        if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max ||
            (key === "conductedBeats" && !Number.isInteger(s[key]))) {
          throw new Error(`Invalid ${key}: expected ${min} to ${max}.`);
        }
      }
      this.morphology = clone(validateMorphology(morphology || templates[s.bundle]));
      this.timing = morphologyTiming(this.morphology);
      this.now = 0;
      this.queue = [];
      this.events = [];
      this.atria = [];
      this.ventricles = [];
      this.serial = 0;
      this.beatIndex = 0;
      this.schedule(0, "sinus");
      if (s.av === "third") this.schedule(350, "escape");
      this.advanceTo(0);
    }

    schedule(time, type, data = {}) {
      this.queue.push({ time, type, ...data, serial: this.serial++ });
      this.queue.sort((a, b) => a.time - b.time || a.serial - b.serial);
    }

    process(event) {
      const s = this.settings;
      const t = event.time;
      if (event.type === "sinus") {
        const index = this.beatIndex++;
        const position = index % (s.conductedBeats + 1);
        const dropped = (s.av === "mobitz1" || s.av === "mobitz2") && position === s.conductedBeats;
        const pr = s.av === "first" ? s.pr :
          s.av === "mobitz1" ? Math.round(s.wenckebachPr + 2 * s.prStep * (1 - 0.5 ** position)) : 160;
        const beat = {
          time: t, pr: s.av === "third" ? null : pr,
          conducted: s.av !== "third" && !dropped,
          blockSite: s.av === "mobitz2" ? "his" : "av"
        };
        this.atria.push(beat);
        this.schedule(t + 60000 / s.atrialRate, "sinus");
        this.schedule(t + 80, "av-arrival", { beat });
        if (s.av === "third") {
          this.schedule(t + 110, "block", { beat, site: "av" });
        } else if (dropped && s.av === "mobitz1") {
          this.schedule(t + pr - 35, "block", { beat, site: "av" });
        } else {
          this.schedule(t + pr - 35, "av-release", { beat });
          this.schedule(t + pr - 20, "his", { beat });
          if (dropped) this.schedule(t + pr - 10, "block", { beat, site: "his" });
          else this.schedule(t + pr, "ventricular", { origin: "conducted", beat });
        }
      } else if (event.type === "escape") {
        this.schedule(t + 60000 / s.escapeRate, "escape");
        this.schedule(t, "his", { origin: "escape" });
        this.schedule(t + 20, "ventricular", { origin: "escape" });
      } else if (event.type === "ventricular") {
        const beat = { time: t, origin: event.origin, bundle: s.bundle };
        this.ventricles.push(beat);
        this.schedule(t + 15, "rv", { ventricular: beat, delayed: s.bundle === "rbbb" });
        this.schedule(t + 15, "lv", { ventricular: beat, delayed: s.bundle === "lbbb" });
        if (s.bundle !== "none") {
          this.schedule(t + 95, "myocardial", { ventricular: beat, side: s.bundle === "rbbb" ? "rv" : "lv" });
        }
        this.schedule(t + this.timing.tStart, "repolarization", { ventricular: beat });
      }
      this.events.push(event);
    }

    advanceTo(time) {
      if (!Number.isFinite(time) || time < this.now) throw new Error("Simulation time must move forward.");
      while (this.queue.length && this.queue[0].time <= time) this.process(this.queue.shift());
      this.now = time;
      const cutoff = time - 11000 - Math.max(this.timing.qtMs, this.morphology.waves[0].duration, 500);
      this.events = this.events.filter(event => event.time >= cutoff);
      this.atria = this.atria.filter(beat => beat.time >= cutoff);
      this.ventricles = this.ventricles.filter(beat => beat.time >= cutoff);
    }

    step() {
      this.advanceTo(this.queue[0].time);
    }

    chamberOpacity(time, chamber) {
      if (chamber === "atria") {
        const pEnd = this.morphology.waves[0].duration;
        // Atrial recovery is schematic and remains independent of AV conduction.
        return this.atria.reduce((alpha, beat) =>
          Math.max(alpha, activationOpacity(time - beat.time, 0, pEnd, pEnd + 200)), 0);
      }
      if (chamber !== "rv" && chamber !== "lv") throw new Error(`Unknown chamber: ${chamber}`);
      const { qrsMs, qtMs } = this.timing;
      return this.ventricles.reduce((alpha, beat) => {
        const delayed = (chamber === "rv" && beat.bundle === "rbbb") ||
          (chamber === "lv" && beat.bundle === "lbbb");
        const onset = Math.min(delayed ? 95 : 15, qrsMs - 1);
        return Math.max(alpha, activationOpacity(time - beat.time, onset, qrsMs, qtMs));
      }, 0);
    }

    signalAt(time) {
      let value = 0;
      const waves = this.morphology.waves;
      for (const beat of this.atria) {
        value += sampleWave(time - beat.time, waves[0]);
        if (beat.conducted) {
          value += segmentOffset(time - beat.time, waves[0].duration, beat.pr,
            this.morphology.segments?.pr);
        }
      }
      for (const beat of this.ventricles) {
        let cursor = beat.time;
        for (const item of waves.slice(1)) {
          value += sampleWave(time - cursor, item);
          cursor += item.duration + item.gap;
        }
        value += segmentOffset(time - beat.time, this.timing.qrsMs, this.timing.tStart,
          this.morphology.segments?.st);
      }
      return value;
    }
  }

  window.Conduction = { Simulation, templates, defaults, morphologyTiming, validateMorphology, clone };
})();
