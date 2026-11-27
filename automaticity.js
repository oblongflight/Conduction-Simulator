"use strict";

(() => {
  const { Simulation, atrialFoci, atrialFocusPatterns, rhythms } = window.Conduction;

  class AutomaticityIllustration {
    static supports(rhythm) {
      return Boolean(rhythms[rhythm]?.junctional) ||
        ["sinus", "pac", "pvc", "atrial_tachy", "multifocal_atrial_tachy", "wandering"].includes(rhythm);
    }

    constructor(model) {
      if (!AutomaticityIllustration.supports(model.settings.rhythm)) {
        throw new Error("Pacemaker counters are unavailable for this rhythm.");
      }
      this.source = model;
      this.preview = new Simulation(model.settings, model.morphology);
    }

    sample(time) {
      if (!Number.isFinite(time) || time < 0) throw new Error("Counter time must be finite and nonnegative.");
      // Reconstruct the existing seeded beats; never advance the live ECG model.
      this.preview.advanceTo(Math.max(this.preview.now, time + 4000));
      return {
        atria: this.chamberState(time, "atria"),
        av: this.chamberState(time, "av"),
        rv: this.chamberState(time, "rv"),
        lv: this.chamberState(time, "lv")
      };
    }

    chamberState(time, chamber) {
      const { settings } = this.source;
      const atrial = chamber === "atria";
      const nodal = chamber === "av";
      const junctional = rhythms[settings.rhythm].junctional;
      const beats = atrial ? this.preview.atria : nodal ?
        this.preview.events.filter(event => event.type === "escape" ||
          (junctional ? event.type === "tachy" : event.type === "av-arrival" && settings.av !== "third")) :
        this.preview.ventricles.map(beat => ({
          ...beat, time: this.preview.ventricularActivationTime(beat, chamber)
        }));
      const last = beats.findLast(beat => beat.time <= time);
      const next = beats.find(beat => beat.time > time);
      const resetMs = last ? Math.min(atrial ? 120 : nodal ? 80 : 160,
        next ? (next.time - last.time) / 3 : Infinity) : 0;
      const readyAt = last ? last.time + resetMs : 0;
      const elapsed = Math.max(0, time - readyAt);
      const cycleRate = next ? 60000 / (next.time - readyAt) : Infinity;
      const backgroundRate = Math.min(atrial ? 18 : 12, cycleRate * 0.4);
      const rates = { muscle: backgroundRate };
      let focus = null;
      if (atrial) {
        focus = next && !next.retrograde ? next.focus || (next.origin === "PAC" ? "left" : "sinus") : null;
        const ectopicSites = atrialFocusPatterns[settings.rhythm]?.sequence ||
          (settings.rhythm === "pac" ? ["left"] : []);
        for (const id of Object.keys(atrialFoci)) {
          const rate = id === "sinus" ? Math.min(70, settings.atrialRate) :
            ectopicSites.includes(id) ? settings.atrialRate * 0.75 : backgroundRate;
          rates[id] = Math.min(rate, cycleRate * 0.8);
        }
      } else if (nodal) {
        focus = next && (junctional || next.type === "escape") ? "av" : null;
        rates.av = Math.min(40, cycleRate * 0.8);
      } else {
        focus = next?.origin === "PVC" && chamber === settings.pvcFocus ? settings.pvcFocus : null;
        rates.lv = backgroundRate;
        rates.rv = backgroundRate;
      }
      if (focus) rates[focus] = cycleRate;
      const activating = last && time < readyAt;
      const charges = Object.fromEntries(Object.entries(rates).map(([id, rate]) => [id, elapsed * rate / 6000]));
      // Bypassed AV conduction must not imply a spontaneous escape beat.
      if (nodal && !focus) charges.av = Math.min(8, charges.av);
      return {
        phase: activating ? "activation" : "charging",
        digit: activating ? 9 - Math.min(9, Math.floor((time - last.time) * 10 / resetMs)) : 0,
        charges
      };
    }
  }

  window.AutomaticityIllustration = AutomaticityIllustration;
})();
