"use strict";

(() => {
  const { Simulation, atrialFoci, atrialFocusPatterns, rhythms } = window.Conduction;

  class AutomaticityIllustration {
    static supports(rhythm) {
      return Boolean(rhythms[rhythm]?.junctional) ||
        ["sinus", "pac", "pvc", "atrial_tachy", "multifocal_atrial_tachy", "wandering", "afib", "flutter"].includes(rhythm);
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
        sinus: this.source.settings.rhythm === "flutter" ? this.chamberState(time, "sinus") : null,
        av: this.chamberState(time, "av"),
        rv: this.chamberState(time, "rv"),
        lv: this.chamberState(time, "lv")
      };
    }

    cellState(time, chamber, site, index, state) {
      const fibrillating = this.source.settings.rhythm === "afib" && chamber === "atria" ||
        this.source.ventricularFibrillation && ["rv", "lv"].includes(chamber);
      if (!fibrillating) return state;
      // Independent schematic local cycles, not a discrete fibrillation pacemaker.
      const period = 130 + (index * 37 % 91);
      const age = (time + index * 53) % period;
      const resetMs = period / 3;
      return {
        phase: age < resetMs ? "activation" : "charging",
        digit: age < resetMs ? 9 - Math.min(9, Math.floor(age * 10 / resetMs)) : 0,
        charges: { [site]: Math.max(0, age - resetMs) * 10 / (period - resetMs) }
      };
    }

    activationBeats(chamber) {
      const { settings } = this.source;
      if (chamber === "sinus") return this.preview.events.filter(event => event.type === "sinus-firing");
      if (chamber === "atria") {
        return this.preview.atria;
      }
      if (chamber === "av") {
        return this.preview.events.filter(event => {
          if (event.type === "escape") return true;
          if (settings.rhythm === "afib") return event.type === "afib" && event.conducted;
          if (rhythms[settings.rhythm].junctional) return event.type === "tachy";
          if (event.type !== "av-arrival" || settings.av === "third") return false;
          return settings.rhythm !== "flutter" ||
            (event.beat.avConducted ?? event.beat.conducted) || event.beat.blockSite === "his";
        });
      }
      return this.preview.ventricles.map(beat => ({
        ...beat, time: this.preview.ventricularActivationTime(beat, chamber)
      }));
    }

    chamberState(time, chamber) {
      const { settings } = this.source;
      const atrial = chamber === "atria" || chamber === "sinus";
      const nodal = chamber === "av";
      const junctional = rhythms[settings.rhythm].junctional;
      const beats = this.activationBeats(chamber);
      const last = beats.findLast(beat => beat.time <= time);
      const next = beats.find(beat => beat.time > time);
      const refractory = nodal && ["afib", "flutter"].includes(settings.rhythm) && last?.type !== "escape";
      const resetMs = last ? refractory ? settings.avRefractory : Math.min(atrial ? 120 : nodal ? 80 : 160,
        next ? (next.time - last.time) / 3 : Infinity) : 0;
      const readyAt = last ? last.time + resetMs : 0;
      const elapsed = Math.max(0, time - readyAt);
      const cycleRate = next && next.time > readyAt ? 60000 / (next.time - readyAt) : Infinity;
      const backgroundRate = atrial || nodal ? Math.min(atrial ? 18 : 12, cycleRate * 0.4) : 30;
      const rates = { muscle: backgroundRate };
      let focus = null;
      if (atrial) {
        focus = chamber === "sinus" ? "sinus" :
          next && !next.retrograde && !["afib", "flutter"].includes(settings.rhythm) ?
            next.focus || (next.origin === "PAC" ? "left" : "sinus") : null;
        const ectopicSites = atrialFocusPatterns[settings.rhythm]?.sequence ||
          (settings.rhythm === "pac" ? ["left"] : []);
        for (const id of Object.keys(atrialFoci)) {
          const rate = id === "sinus" ? Math.min(70, settings.atrialRate) :
            ectopicSites.includes(id) ? settings.atrialRate * 0.75 : backgroundRate;
          rates[id] = Math.min(rate, cycleRate * 0.8);
        }
        if (settings.rhythm === "flutter" && chamber === "atria") {
          rates.muscle = cycleRate;
          for (const id of Object.keys(atrialFoci)) {
            if (id !== "sinus") rates[id] = cycleRate;
          }
        }
      } else if (nodal) {
        focus = next && (junctional || next.type === "escape") ? "av" : null;
        rates.av = 50;
      } else {
        focus = next?.origin === "PVC" && chamber === settings.pvcFocus ? settings.pvcFocus : null;
        rates.lv = backgroundRate;
        rates.rv = backgroundRate;
      }
      if (focus) rates[focus] = cycleRate;
      const activating = last && time < readyAt;
      let digit = 0;
      if (activating) {
        digit = 9;
        // Compare absolute boundaries to avoid rounding fractional timestamps backward.
        for (let step = 1; step <= 9; step++) {
          if (time >= last.time + resetMs * step / 10) digit--;
        }
      }
      const charges = Object.fromEntries(Object.entries(rates).map(([id, rate]) => [id, elapsed * rate / 6000]));
      // Resting automaticity approaches threshold without inventing escape beats.
      if (nodal || !atrial) {
        for (const id of Object.keys(charges)) {
          if (id !== focus) charges[id] = Math.min(8, charges[id]);
        }
      }
      return {
        phase: activating ? refractory ? "refractory" : "activation" : "charging",
        digit,
        charges
      };
    }
  }

  window.AutomaticityIllustration = AutomaticityIllustration;
})();
