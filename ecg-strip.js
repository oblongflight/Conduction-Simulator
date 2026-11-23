"use strict";

(() => {
  const { Simulation } = window.Conduction;
  const TILE_MS = 5000;
  const VIEW_WINDOW_MS = 3000;
  const TRANSITION_MS = 80;

  class EcgStrip {
    static tileMs = TILE_MS;

    constructor(model) {
      this.model = model;
      this.segments = [{ start: 0, model, offset: 0 }];
      this.layoutKey = "";
    }

    signalAt(time) {
      const segment = this.segments.findLast(item => item.start <= time);
      if (!segment) throw new Error("ECG history is unavailable at the requested time.");
      const elapsed = time - segment.start;
      const fade = Math.max(0, 1 - elapsed / TRANSITION_MS);
      return segment.model.signalAt(elapsed) + segment.offset * fade * fade * (3 - 2 * fade);
    }

    append(model, time) {
      if (!Number.isFinite(time) || time < this.segments.at(-1).start) {
        throw new Error("A rhythm transition must follow the recording timeline.");
      }
      const current = this.segments.at(-1);
      if (time - current.start > current.model.now) current.model.advanceTo(time - current.start);
      const offset = this.signalAt(time) - model.signalAt(0);
      while (this.segments.length > 1 && this.segments.at(-1).start === time) this.segments.pop();
      this.segments.push({ start: time, model, offset });
      this.model = model;
    }

    discardBefore(time) {
      while (this.segments.length > 1 && this.segments[1].start <= time) this.segments.shift();
    }

    renderTile(tile) {
      const { tileWidth, height, ratio, baseline, amplitude } = this.geometry;
      const image = document.createElement("canvas");
      image.width = tileWidth;
      image.height = height;
      const context = image.getContext("2d");
      if (!context) throw new Error("Offscreen ECG rendering requires a 2D canvas.");
      const pixelsPerMs = tileWidth / TILE_MS;
      const padding = Math.ceil(4 * ratio);
      const from = Math.max(0, tile * TILE_MS - padding / pixelsPerMs);
      const to = (tile + 1) * TILE_MS + padding / pixelsPerMs;
      this.segments.forEach((segment, index) => {
        const end = Math.min(to, this.segments[index + 1]?.start ?? Infinity);
        if (end >= from && end >= segment.start && end - segment.start > segment.model.now) {
          segment.model.advanceTo(end - segment.start);
        }
      });
      context.strokeStyle = "#6df1a8";
      context.lineWidth = 2 * ratio;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      let started = false;
      const step = Math.min(0.25, pixelsPerMs * 2);
      // Sampling is anchored to the strip, never to the moving viewport.
      for (let x = -padding; x <= tileWidth + padding; x += step) {
        const time = tile * TILE_MS + x / pixelsPerMs;
        if (time < 0) continue;
        const y = baseline - this.signalAt(time) * amplitude;
        if (!started) { context.moveTo(x, y); started = true; }
        else context.lineTo(x, y);
      }
      context.stroke();
      return image;
    }

    configure(viewport, ratio) {
      const { left, right, baseline, amplitude, height } = viewport;
      const viewportWidth = right - left;
      const geometry = {
        tileWidth: Math.round(viewportWidth * TILE_MS / VIEW_WINDOW_MS * ratio),
        height: Math.round(height * ratio), ratio,
        baseline: baseline * ratio, amplitude: amplitude * ratio
      };
      if (geometry.tileWidth <= 0 || geometry.height <= 0) {
        throw new Error("The ECG viewport must have positive dimensions.");
      }
      const key = [viewportWidth, ...Object.values(geometry)].join(":");
      if (key === this.layoutKey) return false;
      if (this.layoutKey) {
        this.segments.forEach(segment => {
          segment.model = new Simulation(segment.model.settings, segment.model.morphology);
        });
        this.model = this.segments.at(-1).model;
      }
      this.layoutKey = key;
      this.geometry = geometry;
      this.tileWidth = geometry.tileWidth / ratio;
      this.halfWindowMs = viewportWidth * TILE_MS / (2 * this.tileWidth);
      return true;
    }
  }

  window.EcgStrip = EcgStrip;
})();
