"use strict";

(() => {
  const { Simulation } = window.Conduction;
  const TILE_MS = 5000;
  const VIEW_WINDOW_MS = 3000;

  class EcgStrip {
    static tileMs = TILE_MS;

    constructor(model) {
      this.model = model;
      this.layoutKey = "";
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
      this.model.advanceTo((tile + 1) * TILE_MS + padding / pixelsPerMs);
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
        const y = baseline - this.model.signalAt(time) * amplitude;
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
      if (this.layoutKey) this.model = new Simulation(this.model.settings, this.model.morphology);
      this.layoutKey = key;
      this.geometry = geometry;
      this.tileWidth = geometry.tileWidth / ratio;
      this.halfWindowMs = viewportWidth * TILE_MS / (2 * this.tileWidth);
      return true;
    }
  }

  window.EcgStrip = EcgStrip;
})();
