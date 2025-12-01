# Conduction Simulator

This repository contains a p5.js-based Conduction Simulator (single-lead/12-lead ECG renderer with a conduction path/shape editor).

Quick start

- Open `index.html` in a browser (double-click or serve with a static server).
- The `libraries/` directory includes `p5.min.js` and `p5.sound.min.js` so the sketch runs without fetching external dependencies.

Notes

- The p5 runtime builds are bundled in `libraries/`. The full p5 source is not included in this repository (not a submodule); this keeps the project lightweight and easy to share.
- Conduction overlays and user data are persisted — by default the sketch uses a file-backed JSON store when available. Use the right-side "Conduction Paths/Shapes" panel to create/edit animations.

Saving and restoring data:

- In modern Chromium/Edge browsers you can choose a file to store sketch data and save directly into that file. From the browser console run `promptSaveAsDataFile()` to create or pick a `sketch-data.json` file and save current state, and `promptOpenDataFile()` to load it.
- If the browser doesn't support file-writing, the sketch falls back to `localStorage` and offers a download fallback when needed.
- The primary sketch is `script.js`.

Repository

- GitHub: https://github.com/oblongflight/Conduction-Simulator

If you want me to add a CONTRIBUTING guide, CI, or package the project for deployment, tell me which platform or hosting you'd like to use (GitHub Pages, Netlify, etc.).
