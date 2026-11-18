"use strict";

(() => {
  const { Simulation } = window.Conduction;
  const TILE_MS = 5000;
  const TILE_COUNT = 3;
  const VIEW_WINDOW_MS = 3000;

  class EcgStrip {
    static windowMs = TILE_MS;

    constructor(model) {
      this.model = model;
      this.image = null;
      this.firstTile = 0;
      this.layoutKey = "";
    }

    paintTile(context, tile, offset, geometry) {
      const { tileWidth, height, ratio, baseline, amplitude } = geometry;
      const pixelsPerMs = tileWidth / TILE_MS;
      const padding = Math.ceil(4 * ratio);
      this.model.advanceTo((tile + 1) * TILE_MS + padding / pixelsPerMs);
      context.save();
      context.beginPath();
      context.rect(offset, 0, tileWidth, height);
      context.clip();
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
        if (!started) { context.moveTo(offset + x, y); started = true; }
        else context.lineTo(offset + x, y);
      }
      context.stroke();
      context.restore();
    }

    rebuild(firstTile, geometry) {
      const { tileWidth, height } = geometry;
      const image = document.createElement("canvas");
      image.width = tileWidth * TILE_COUNT;
      image.height = height;
      const context = image.getContext("2d");
      if (!context) throw new Error("Offscreen ECG rendering requires a 2D canvas.");
      for (let i = 0; i < TILE_COUNT; i++) {
        const tile = firstTile + i;
        if (tile < 0) continue;
        const offset = i * tileWidth;
        if (this.image && tile >= this.firstTile && tile < this.firstTile + TILE_COUNT) {
          // Copy retained pixels exactly; only the newly exposed end is generated.
          context.drawImage(this.image,
            (tile - this.firstTile) * tileWidth, 0, tileWidth, height,
            offset, 0, tileWidth, height);
        } else {
          this.paintTile(context, tile, offset, geometry);
        }
      }
      this.image = image;
      this.firstTile = firstTile;
    }

    prepare(time, viewport, ratio) {
      const { left, right, baseline, amplitude, height } = viewport;
      const geometry = {
        tileWidth: Math.round((right - left) * TILE_MS / VIEW_WINDOW_MS * ratio),
        height: Math.round(height * ratio), ratio,
        baseline: baseline * ratio, amplitude: amplitude * ratio
      };
      if (geometry.tileWidth <= 0 || geometry.height <= 0) {
        throw new Error("The ECG viewport must have positive dimensions.");
      }
      const key = Object.values(geometry).join(":");
      if (key !== this.layoutKey) {
        this.image = null;
        this.model = new Simulation(this.model.settings, this.model.morphology);
        this.layoutKey = key;
      }
      const firstTile = Math.floor((time - TILE_MS / 2) / TILE_MS);
      if (!this.image || firstTile !== this.firstTile) this.rebuild(firstTile, geometry);
      this.viewport = viewport;
      this.geometry = geometry;
      return this.image;
    }

    positionAt(time) {
      return (this.viewport.left + this.viewport.right) / 2 +
        (this.firstTile * TILE_MS - time) * this.geometry.tileWidth / TILE_MS / this.geometry.ratio;
    }
  }

  window.EcgStrip = EcgStrip;
})();
