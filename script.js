// Time dilation factor (slider controlled)
let timeDilation = 1.0;
const TIME_DILATION_KEY = 'ecg.timeDilation.v1';
function saveTimeDilation() {
  try { storageSetItem(TIME_DILATION_KEY, String(timeDilation)); } catch (e) {}
}
function loadTimeDilation() {
  try {
    const raw = storageGetItem(TIME_DILATION_KEY);
    if (raw !== null) {
      const v = parseFloat(raw);
      if (!Number.isNaN(v) && v > 0) timeDilation = v;
    }
  } catch (e) {}
}

// STORAGE ABSTRACTION: prefer a JSON file in the sketch folder (via
// File System Access API) but fall back to localStorage. We keep an
// in-memory cache `window._sketchDataCache` so reads are synchronous.
// Exposed helpers:
//  - storageSetItem(key, stringValue)
//  - storageGetItem(key) -> string|null
//  - promptOpenDataFile() / promptSaveAsDataFile() to let the user pick a file
// Note: writing to a file requires a user gesture in the browser.
window._sketchDataCache = window._sketchDataCache || {};
window._sketchDataHandle = window._sketchDataHandle || null;

function storageSetItem(key, valueStr) {
  try {
    // update cache
    try { window._sketchDataCache = window._sketchDataCache || {}; window._sketchDataCache[key] = valueStr; } catch (e) {}
    // If we have a writable file handle, write the whole cache asynchronously.
    if (window._sketchDataHandle && window._sketchDataHandle.createWritable) {
      (async () => {
        try {
          const writable = await window._sketchDataHandle.createWritable();
          await writable.write(JSON.stringify(window._sketchDataCache || {}, null, 2));
          await writable.close();
        } catch (e) { console.warn('write to sketch data file failed', e); }
      })();
    } else {
      // fallback: write the single item to localStorage so data remains available
      try { localStorage.setItem(key, valueStr); } catch (e) {}
    }
  } catch (e) { console.warn('storageSetItem error', e); }
}

function storageGetItem(key) {
  try {
    if (window._sketchDataCache && (key in window._sketchDataCache)) return window._sketchDataCache[key];
    try { return localStorage.getItem(key); } catch (e) { return null; }
  } catch (e) { return null; }
}

function storageRemoveItem(key) {
  try {
    try { if (window._sketchDataCache && (key in window._sketchDataCache)) { delete window._sketchDataCache[key]; } } catch (e) {}
    if (window._sketchDataHandle && window._sketchDataHandle.createWritable) {
      (async () => {
        try {
          const writable = await window._sketchDataHandle.createWritable();
          await writable.write(JSON.stringify(window._sketchDataCache || {}, null, 2));
          await writable.close();
        } catch (e) { console.warn('write during remove failed', e); }
      })();
    } else {
      try { localStorage.removeItem(key); } catch (e) {}
    }
  } catch (e) { console.warn('storageRemoveItem error', e); }
}

async function _loadFromFileHandle(handle) {
  try {
    window._sketchDataHandle = handle;
    const file = await handle.getFile();
    const txt = await file.text();
    const parsed = JSON.parse(txt || '{}');
    // normalize to string values like localStorage
    window._sketchDataCache = window._sketchDataCache || {};
    Object.keys(parsed).forEach(k => { try { window._sketchDataCache[k] = typeof parsed[k] === 'string' ? parsed[k] : JSON.stringify(parsed[k]); } catch (e) {} });
    return true;
  } catch (e) { console.warn('loadFromFileHandle failed', e); return false; }
}

function promptOpenDataFile() {
  if (!window.showOpenFilePicker) { alert('Open-file not supported in this browser.'); return; }
  (async () => {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Sketch data', accept: { 'application/json': ['.json'] } }], multiple: false });
      const ok = await _loadFromFileHandle(handle);
      if (ok) alert('Sketch data loaded from file.');
    } catch (e) { console.warn('open data file canceled/failed', e); }
  })();
}

function promptSaveAsDataFile() {
  if (!window.showSaveFilePicker) { alert('Save-as not supported in this browser. A download will be triggered instead.');
    // fallback: trigger download of current cache
    const blob = new Blob([JSON.stringify(window._sketchDataCache || {}, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sketch-data.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); return; }
  (async () => {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: 'sketch-data.json', types: [{ description: 'Sketch data', accept: { 'application/json': ['.json'] } }] });
      window._sketchDataHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(window._sketchDataCache || {}, null, 2));
      await writable.close();
      alert('Sketch data saved to file.');
    } catch (e) { console.warn('save-as canceled/failed', e); }
  })();
}

// Small on-screen controls so users can pick/save the sketch data file.
function _createDataFileControls() {
  try {
    // remove any previously injected highlight style so buttons don't pulse
    try {
      const existing = document.getElementById('ccs-highlight-style');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    } catch (e) {}

    const div = document.createElement('div');
    div.style.position = 'fixed'; div.style.left = '12px'; div.style.bottom = '12px'; div.style.zIndex = '9999'; div.style.background = 'rgba(255,255,255,0.9)'; div.style.border = '1px solid rgba(0,0,0,0.08)'; div.style.padding = '6px'; div.style.borderRadius = '6px'; div.style.fontSize = '12px'; div.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
    const open = document.createElement('button'); open.textContent = 'Open data file'; open.style.marginRight = '6px'; open.onclick = promptOpenDataFile;
    const save = document.createElement('button'); save.textContent = 'Save data file'; save.style.marginRight = '6px'; save.onclick = promptSaveAsDataFile;
    const newShapeBtn = document.createElement('button'); newShapeBtn.textContent = 'New Shape'; newShapeBtn.style.marginRight = '6px'; newShapeBtn.onclick = () => { try { createConductionItem('shape'); refreshConductionPanel(); highlightConductionPanel(2000); } catch (e) { console.warn('create shape failed', e); } };
    const newPathBtn = document.createElement('button'); newPathBtn.textContent = 'New Path'; newPathBtn.style.marginRight = '6px'; newPathBtn.onclick = () => { try { createConductionItem('path'); refreshConductionPanel(); highlightConductionPanel(2000); } catch (e) { console.warn('create path failed', e); } };
    const importBtn = document.createElement('button'); importBtn.textContent = 'Import CCS'; importBtn.style.marginRight = '6px'; importBtn.onclick = () => { promptImportCcsComponents(); };
    const status = document.createElement('span'); status.textContent = 'Data: local'; status.style.color = '#444';
    div.appendChild(open); div.appendChild(save); div.appendChild(newShapeBtn); div.appendChild(newPathBtn); div.appendChild(importBtn); div.appendChild(status);
    document.body.appendChild(div);
    window._sketchDataStatusSpan = status;
    // update status depending on whether a handle is present
    setInterval(() => { try { if (window._sketchDataHandle) window._sketchDataStatusSpan.textContent = 'Data: file'; else window._sketchDataStatusSpan.textContent = 'Data: local'; } catch (e) {} }, 1000);
    // set descriptive titles for accessibility only
    try {
      newShapeBtn.title = 'Create a new conduction Shape';
      newPathBtn.title = 'Create a new conduction Path';
      importBtn.title = 'Import shapes from ccs_components.json';
    } catch (e) {}
  } catch (e) { /* ignore UI creation failures */ }
}

setTimeout(() => { try { _createDataFileControls(); } catch (e) {} }, 1200);

// Import CCS components JSON (from `ccs_components.json` in the sketch folder)
async function importCcsComponents() {
  try {
    // Try fetching the file relative to the sketch root
    const resp = await fetch('ccs_components.json');
    if (!resp.ok) throw new Error('Fetch failed: ' + resp.status + ' ' + resp.statusText);
    const parsed = await resp.json();
    if (!parsed || typeof parsed !== 'object') { alert('CCS components file malformed'); return null; }
    const comps = parsed.components || parsed.components || {};
    const items = [];
    let counter = 0;
    Object.keys(comps).forEach((compName) => {
      const comp = comps[compName] || {};
      const color = comp.color || '#00aaee';
      const shapes = Array.isArray(comp.shapes) ? comp.shapes : [];
      shapes.forEach((shape, sidx) => {
        const pts = Array.isArray(shape.points) ? shape.points.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })) : [];
        const it = {
          id: Date.now() + (counter++),
          name: compName + (shapes.length > 1 ? (' #' + (sidx + 1)) : ''),
          type: 'shape',
          points: pts,
          color: color,
          fill: false,
          closed: !!(shape.type === 'oval' || shape.closed),
          mode: 'sequential',
          durationMs: 1200,
          step: conductionItems.length + items.length,
          rampUpMs: 200,
          sustainMs: 800,
          rampDownMs: 200,
          durationSource: null,
          rampUpSource: null,
          sustainSource: null,
          rampDownSource: null,
          startMode: 'after_previous',
          ecgEvent: '',
          startOffsetMs: 0,
          playbackStartTime: 0
        };
        items.push(it);
      });
    });
    return items;
  } catch (e) { console.warn('importCcsComponents error', e); alert('Import failed: ' + String(e)); return null; }
}

function promptImportCcsComponents() {
  (async () => {
    try {
      const items = await importCcsComponents();
      if (!items) return;
      // delegate to existing handler which will ask replace/merge
      handleImportedConduction(items);
    } catch (e) { console.warn('promptImportCcsComponents failed', e); }
  })();
}

// Pause / time-offset helpers for ECG and Conduction animations
let ecgTimeOffsetMs = 0; // subtract from millis() to get ECG effective time
let conductionTimeOffsetMs = 0; // subtract from millis() for conduction animations
let pausedEcg = false;
let pausedConduction = false;
let lastPStartMs = 0; // timestamp (effective ECG ms) when last P_start occurred
let ecgPausedAtMs = 0;
let conductionPausedAtMs = 0;
// reference to the global control panel DOM so draw() can update ms counter
let globalControlPanel = null;

// Conduction state and persistence keys
const CONDUCTION_EXPLICIT_STEPS_KEY = 'ecg.conductionExplicitSteps.v1';
const CONDUCTION_STEPS_KEY = 'ecg.conductionStepDurations.v1';

let conductionItems = [];
// Runtime UI/window refs and helper state
let conductionWindow = null;
let conductionPanelDiv = null;
let conductionPanelOriginalStyles = null;
let conductionDebugWindow = null;
let conductionDebugWinDiv = null;
// Default popout size for the conduction + ECG waveform editor
let conductionPopoutWidth = 1200;
let conductionPopoutHeight = 820;
let selectedConductionIndex = -1;
let conductionExplicitSteps = [];
let conductionStepDurations = {};

// --- ECG & Conduction top-level state (restored defaults) ---
let atheroPercent = 0;
let thrombusPercent = 0;
let METs = 1.0;

// Heart parameters
let heartRate = 70; // bpm (editable)

// Visual tuning
let amplitude = 60; // pixels per unit ECG amplitude
let timeWindow = 10.0; // seconds shown across the canvas
// Horizontal shift of ECG waveform (seconds). Positive moves waveform to the right.
let ecgWaveShift = 0.0;
// Whether overlay bands reflect dilated playback durations
let overlayUsesDilation = true;
// Whether to show conduction overlay on the CCS/ECG (can be toggled)
let showConductionOverlay = true;

// Adjustable waveform parameters (controlled by sliders)
let tWaveScale = 1.0; // multiplier for T wave amplitude (can be negative)
let qWaveScale = 1.0; // multiplier for Q wave magnitude
let stOffset = 0.0; // ST elevation/depression (in signal units)
// ST window placement (ms relative to the QRS R-peak at t=0). Defaults
// approximate the historical anchor of "end of R" -> "start of T".
let stStartMs = 30;  // start of ST plateau
let stEndMs   = 120; // end of ST plateau
let tDuration = 0.12; // T wave duration (seconds, approximate width)
let qtIntervalMs = 360; // QT interval in milliseconds (Q onset to T end)

// P-wave adjustable parameters
let pDuration = 0.05; // seconds (default ~50 ms)
let pAmp = 0.25; // amplitude multiplier (visible by default)
// Debug hooks for P-wave placement (seconds)
let __debug_pStart = null;
let __debug_pCenter = null;
let __debug_pEnd = null;
let __debug_pDur = null;
// Global QRS width multiplier (1.0 == normal)
let qrsWidth = 1.0;
// Overall conduction-dot density multiplier (1.0 = default)
let conductionDensityScale = 1.0;
// Individual Q/R/S duration controls (seconds)
let qDur = 0.02;
let rDur = 0.01;
let sDur = 0.02;
// Arrhythmia / morphology controls (global options)
let pBiphasic = false;
// Global amplitude multipliers for components
let gP = 1.0;
let gQ = 1.0;
let gR = 1.0;
let gS = 1.0;
let gT = 1.0;
// PR interval (seconds) - preferred delay from P peak to Q onset
let prDur = 0.16; // typical ~0.12-0.20

// CCS image (optional)
let ccsImg = null;

// View mode: true = single-lead (CCS left + ECG right), false = 12-lead grid
let singleLeadView = true;

// App mode: 'conduction' (default) shows heart + conduction overlay only.
// 'ischemia' reserves a strip at the top of the left half for the vessel
// cross-section and exposes athero/thrombus/METs controls.
let appMode = 'conduction';

// Diagnostic / UI state
let conductionDragging = { idx: -1, pt: -1 };
// whether the user is in edit mode for conduction shapes/paths
let conductionEditMode = false;

// Persistence for waveform settings
const ECG_WAVEFORM_KEY = 'ecg.waveform.v1';
const PRESETS_KEY = 'ecg.presets.v1';
// Sequence presets (named saved sequences of preset names)
const SEQUENCE_PRESETS_KEY = 'ecg.sequencePresets.v1';
const ACTIVE_SEQUENCE_KEY = 'ecg.activeSequence.v1';

function saveEcgWaveformSettings() {
  try {
    const payload = {
      atheroPercent: atheroPercent,
      thrombusPercent: thrombusPercent,
      METs: METs,
      heartRate: heartRate,
      amplitude: amplitude,
      timeWindow: timeWindow,
      tWaveScale: tWaveScale,
      qWaveScale: qWaveScale,
      stOffset: stOffset,
      stStartMs: stStartMs,
      stEndMs: stEndMs,
      tDuration: tDuration,
      qtIntervalMs: qtIntervalMs,
      pDuration: pDuration,
      pAmp: pAmp,
      qrsWidth: qrsWidth,
      qDur: qDur,
      rDur: rDur,
      sDur: sDur,
      pBiphasic: pBiphasic,
      gP: gP,
      gQ: gQ,
      gR: gR,
      gS: gS,
      gT: gT,
      prDur: prDur,
      ecgWaveShift: ecgWaveShift,
      overlayUsesDilation: !!overlayUsesDilation,
      showConductionOverlay: !!showConductionOverlay
    };
    storageSetItem(ECG_WAVEFORM_KEY, JSON.stringify(payload));
  } catch (e) { console.warn('saveEcgWaveformSettings error', e); }
}

// Visual helper: briefly highlight the conduction panel so users can locate it
function highlightConductionPanel(durationMs = 4000) {
  try {
    if (!conductionPanelDiv) return;
    const prevOutline = conductionPanelDiv.style.outline || '';
    const prevBox = conductionPanelDiv.style.boxShadow || '';
    conductionPanelDiv.style.outline = '4px solid rgba(255,165,0,0.95)';
    conductionPanelDiv.style.boxShadow = '0 0 12px 4px rgba(255,165,0,0.25)';
    // also highlight the embedded global panel if present
    try {
      const gp = conductionPanelDiv.querySelector && conductionPanelDiv.querySelector('div');
      if (gp && gp === globalControlPanel) {
        globalControlPanel.style.boxShadow = '0 0 8px 3px rgba(255,165,0,0.18)';
      }
    } catch (e) {}
    setTimeout(() => {
      try { conductionPanelDiv.style.outline = prevOutline; conductionPanelDiv.style.boxShadow = prevBox; } catch (e) {}
      try { if (globalControlPanel) globalControlPanel.style.boxShadow = ''; } catch (e) {}
    }, durationMs);
  } catch (e) { /* ignore highlight failures */ }
}

function loadEcgWaveformSettings() {
  try {
    const raw = storageGetItem(ECG_WAVEFORM_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return;
    if (typeof p.atheroPercent === 'number') atheroPercent = p.atheroPercent;
    if (typeof p.thrombusPercent === 'number') thrombusPercent = p.thrombusPercent;
    if (typeof p.METs === 'number') METs = p.METs;
    if (typeof p.heartRate === 'number') heartRate = p.heartRate;
    if (typeof p.amplitude === 'number') amplitude = p.amplitude;
    if (typeof p.timeWindow === 'number') timeWindow = p.timeWindow;
    if (typeof p.tWaveScale === 'number') tWaveScale = p.tWaveScale;
    if (typeof p.qWaveScale === 'number') qWaveScale = p.qWaveScale;
    if (typeof p.stOffset === 'number') stOffset = p.stOffset;
    if (typeof p.stStartMs === 'number') stStartMs = p.stStartMs;
    if (typeof p.stEndMs === 'number') stEndMs = p.stEndMs;
    if (typeof p.tDuration === 'number') tDuration = p.tDuration;
    if (typeof p.qtIntervalMs === 'number') qtIntervalMs = p.qtIntervalMs;
    if (typeof p.pDuration === 'number') pDuration = p.pDuration;
    if (typeof p.pAmp === 'number') pAmp = p.pAmp;
    if (typeof p.ecgWaveShift === 'number') ecgWaveShift = p.ecgWaveShift;
      if (typeof p.overlayUsesDilation === 'boolean') overlayUsesDilation = p.overlayUsesDilation;
      if (typeof p.showConductionOverlay === 'boolean') showConductionOverlay = p.showConductionOverlay;
    if (typeof p.qrsWidth === 'number') qrsWidth = p.qrsWidth;
    if (typeof p.qDur === 'number') qDur = p.qDur;
    if (typeof p.rDur === 'number') rDur = p.rDur;
    if (typeof p.sDur === 'number') sDur = p.sDur;
    if (typeof p.pBiphasic === 'boolean') pBiphasic = p.pBiphasic;
    if (typeof p.gP === 'number') gP = p.gP;
    if (typeof p.gQ === 'number') gQ = p.gQ;
    if (typeof p.gR === 'number') gR = p.gR;
    if (typeof p.gS === 'number') gS = p.gS;
    if (typeof p.gT === 'number') gT = p.gT;
    if (typeof p.prDur === 'number') prDur = p.prDur;
  } catch (e) { console.warn('loadEcgWaveformSettings error', e); }
}

// Preset management: save/load named presets combining waveform + conduction state
function _getAllPresets() {
  try {
    const raw = storageGetItem(PRESETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (e) { return {}; }
}

// Sequence preset helpers: store named arrays of preset keys (the sequence)
function _getAllSequencePresets() {
  try {
    const raw = storageGetItem(SEQUENCE_PRESETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (e) { return {}; }
}

function _saveAllSequencePresets(obj) {
  try { storageSetItem(SEQUENCE_PRESETS_KEY, JSON.stringify(obj)); return true; } catch (e) { console.warn('Failed to save sequence presets', e); return false; }
}

function saveNamedSequence(name) {
  if (!name || !String(name).trim()) { alert('Please provide a sequence name'); return false; }
  try {
    const key = String(name).trim();
    const presetList = Array.isArray(presetSequence) ? presetSequence.slice() : [];
    const obj = { name: key, savedAt: (new Date()).toISOString(), sequence: presetList, loop: !!presetSequenceLoop };
    const all = _getAllSequencePresets();
    all[key] = obj;
    const ok = _saveAllSequencePresets(all);
    if (!ok) { alert('Failed to save sequence to localStorage'); return false; }
    try { refreshSequenceSelectGlobal(); } catch (e) {}
    return true;
  } catch (e) { console.warn('saveNamedSequence error', e); return false; }
}

function loadNamedSequence(name) {
  try {
    const all = _getAllSequencePresets();
    if (!all || !all[name]) { alert('Sequence not found: ' + name); return false; }
    const p = all[name];
    if (!Array.isArray(p.sequence)) { alert('Sequence malformed'); return false; }
    presetSequence = p.sequence.slice();
    presetSequenceIndex = 0;
    presetSequenceLoop = !!p.loop;
    refreshPresetSequenceUI();
    try { saveActiveSequence(); } catch (e) {}
    return true;
  } catch (e) { console.warn('loadNamedSequence error', e); return false; }
}


function deleteNamedSequence(name) {
  try {
    const all = _getAllSequencePresets();
    if (!all || !all[name]) return false;
    delete all[name];
    _saveAllSequencePresets(all);
    try { refreshSequenceSelectGlobal(); } catch (e) {}
    // if the deleted sequence matches the active in-memory sequence name,
    // do not automatically clear the active sequence which may have been
    // created from the same named presets; but if you want to clear active
    // when a named sequence is removed, uncomment the next line.
    // clearActiveSequence();
    return true;
  } catch (e) { console.warn('deleteNamedSequence error', e); return false; }
}

// Persist the active (in-memory) sequence so it can be restored on reload
function saveActiveSequence() {
  try {
    const payload = { sequence: Array.isArray(presetSequence) ? presetSequence.slice() : [], index: Number(presetSequenceIndex) || 0, loop: !!presetSequenceLoop };
    storageSetItem(ACTIVE_SEQUENCE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) { console.warn('saveActiveSequence error', e); return false; }
}

function loadActiveSequence() {
  try {
    const raw = storageGetItem(ACTIVE_SEQUENCE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return false;
    if (Array.isArray(p.sequence)) presetSequence = p.sequence.slice();
    presetSequenceIndex = typeof p.index === 'number' ? p.index : 0;
    presetSequenceLoop = !!p.loop;
    seqPreviewNeedsUpdate = true;
    return true;
  } catch (e) { console.warn('loadActiveSequence error', e); return false; }
}

function clearActiveSequence() {
  try { storageRemoveItem(ACTIVE_SEQUENCE_KEY); return true; } catch (e) { return false; }
}

function refreshSequenceSelectGlobal() {
  try {
    const all = _getAllSequencePresets();
    const keys = Object.keys(all || {}).sort((a,b) => (all[b].savedAt||'').localeCompare(all[a].savedAt||''));
    const docs = [document];
    try { if (conductionWindow && conductionWindow.document) docs.push(conductionWindow.document); } catch (e) {}
    try { if (conductionPanelDiv && conductionPanelDiv.ownerDocument && docs.indexOf(conductionPanelDiv.ownerDocument) === -1) docs.push(conductionPanelDiv.ownerDocument); } catch (e) {}
    docs.forEach(doc => {
      try {
        const sel = doc.getElementById('sequenceSelect'); if (!sel) return;
        sel.innerHTML = '';
        const empty = doc.createElement('option'); empty.value = ''; empty.text = '-- sequences --'; sel.appendChild(empty);
        keys.forEach(k => { const o = doc.createElement('option'); o.value = k; o.text = k + (all[k].savedAt ? ('  (' + new Date(all[k].savedAt).toLocaleString() + ')') : ''); sel.appendChild(o); });
      } catch (e) {}
    });
  } catch (e) { /* ignore */ }
}

// Preset sequence runner state
let presetSequence = [];
let presetSequenceIndex = 0;
let presetSequenceTimer = null;
let presetSequencePlaying = false;
let presetSequenceLoop = false;

// Conduction pacer (constant pulsing) state
let conductionPacerTimer = null;
let conductionPacerHz = 2; // default 2 Hz
let conductionPacerRunning = false;
let conductionPacerEventKey = 'P_start';

function startConductionPacer(hz, eventKey) {
  try {
    if (conductionPacerTimer) clearInterval(conductionPacerTimer);
    conductionPacerHz = Number(hz) || 2;
    conductionPacerEventKey = eventKey || 'P_start';
    const intervalMs = Math.round(1000 / conductionPacerHz);
    conductionPacerTimer = setInterval(() => {
      try { triggerEcgEvent(conductionPacerEventKey); } catch (e) { console.warn('pacer trigger failed', e); }
    }, intervalMs);
    conductionPacerRunning = true;
    console.log('Conduction pacer started', conductionPacerHz, 'Hz, event', conductionPacerEventKey);
    return true;
  } catch (e) { console.warn('startConductionPacer error', e); return false; }
}

function stopConductionPacer() {
  try {
    if (conductionPacerTimer) { clearInterval(conductionPacerTimer); conductionPacerTimer = null; }
    conductionPacerRunning = false;
    console.log('Conduction pacer stopped');
    return true;
  } catch (e) { console.warn('stopConductionPacer error', e); return false; }
}
let presetSequenceDelayMs = 2000; // default delay between presets
// If true, sequence runner waits for the ECG position indicator to reach
// the end of the window before advancing to the next preset.
let presetSequenceWaitingForEcgEnd = false;
// last observed beat fraction (0..1) used to detect wrap-around (end of window)
let lastEcgBeatFrac = 0;
// Snapshot preview cache; only regenerate when sequence changes
let seqPreviewNeedsUpdate = true;
// Display full sequence on right half instead of a single ECG (up to MAX_SEQUENCE_DISPLAY)
let showSequenceOnRight = false;
const MAX_SEQUENCE_DISPLAY = 5;
let seqPreviewBuffers = [];

function refreshPresetSequenceUI() {
  try {
    const docs = [document];
    try { if (conductionWindow && conductionWindow.document) docs.push(conductionWindow.document); } catch (e) {}
    try { if (conductionPanelDiv && conductionPanelDiv.ownerDocument && docs.indexOf(conductionPanelDiv.ownerDocument) === -1) docs.push(conductionPanelDiv.ownerDocument); } catch (e) {}
    docs.forEach(doc => {
      try {
        const seqHolder = doc.getElementById('presetSequenceHolder');
        if (!seqHolder) return;
        seqHolder.innerHTML = '';
        presetSequence.forEach((name, idx) => {
          const row = doc.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='6px';
          const lbl = doc.createElement('div'); lbl.textContent = String(idx+1) + '. ' + name; lbl.style.flex='1';
          const up = doc.createElement('button'); up.textContent='↑'; up.onclick = () => { if (idx<=0) return; const a=presetSequence.splice(idx,1)[0]; presetSequence.splice(idx-1,0,a); refreshPresetSequenceUI(); };
          const down = doc.createElement('button'); down.textContent='↓'; down.onclick = () => { if (idx>=presetSequence.length-1) return; const a=presetSequence.splice(idx,1)[0]; presetSequence.splice(idx+1,0,a); refreshPresetSequenceUI(); };
          const del = doc.createElement('button'); del.textContent='Delete'; del.onclick = () => { presetSequence.splice(idx,1); refreshPresetSequenceUI(); };
          row.appendChild(lbl); row.appendChild(up); row.appendChild(down); row.appendChild(del);
          seqHolder.appendChild(row);
        });
        // highlight current
        Array.from(seqHolder.children).forEach((c,i)=>{ c.style.background = (i===presetSequenceIndex && presetSequencePlaying) ? 'rgba(200,255,200,0.6)' : ''; });
      } catch (e) { /* ignore per-doc errors */ }
    });
    // mark previews stale so they will be regenerated
    seqPreviewNeedsUpdate = true;
    // persist current active sequence
    try { saveActiveSequence(); } catch (e) {}
  } catch (e) {}
}

function startPresetSequence() {
  if (!presetSequence || presetSequence.length === 0) { alert('Sequence is empty'); return; }
  if (presetSequencePlaying) return;
  presetSequencePlaying = true;
  presetSequenceIndex = Math.max(0, Math.min(presetSequenceIndex, presetSequence.length-1));
  // ensure static previews are captured now so they remain unchanged during playback
  try { updateSeqPreviews(); } catch (e) {}
  playCurrentAndScheduleNext();
  refreshPresetSequenceUI();
}

function stopPresetSequence() {
  presetSequencePlaying = false;
  if (presetSequenceTimer) { clearTimeout(presetSequenceTimer); presetSequenceTimer = null; }
  refreshPresetSequenceUI();
}

function playCurrentAndScheduleNext() {
  try {
    if (!presetSequencePlaying) return;
    const name = presetSequence[presetSequenceIndex];
    if (!name) { stopPresetSequence(); return; }
    // load without confirmation
    loadNamedPreset(name);
    // Instead of using a fixed delay, wait until the ECG position indicator
    // reaches the end of the visible window (detected in draw()). Set a
    // waiting flag so draw() knows to advance the sequence on beat wrap.
    try { if (presetSequenceTimer) { clearTimeout(presetSequenceTimer); presetSequenceTimer = null; } } catch (e) {}
    presetSequenceWaitingForEcgEnd = true;
    refreshPresetSequenceUI();
  } catch (e) { console.warn('play sequence error', e); stopPresetSequence(); }
}


// Populate the preset select dropdown from localStorage (global helper)
function refreshPresetSelectGlobal() {
  try {
    const all = _getAllPresets();
    const keys = Object.keys(all || {}).sort((a,b) => (all[b].savedAt||'').localeCompare(all[a].savedAt||''));
    const docs = [document];
    try {
      if (conductionWindow && conductionWindow.document) docs.push(conductionWindow.document);
    } catch (e) {}
    try {
      if (conductionPanelDiv && conductionPanelDiv.ownerDocument && docs.indexOf(conductionPanelDiv.ownerDocument) === -1) docs.push(conductionPanelDiv.ownerDocument);
    } catch (e) {}
    docs.forEach(doc => {
      try {
        const sel = doc.getElementById('presetSelect');
        if (!sel) return;
        sel.innerHTML = '';
        const empty = doc.createElement('option'); empty.value = ''; empty.text = '-- presets --'; sel.appendChild(empty);
        keys.forEach(k => { const o = doc.createElement('option'); o.value = k; o.text = k + (all[k].savedAt ? ('  (' + new Date(all[k].savedAt).toLocaleString() + ')') : ''); sel.appendChild(o); });
      } catch (e) { /* ignore per-doc failures */ }
    });
  } catch (e) { /* ignore */ }
}

function _saveAllPresets(obj) {
  try { storageSetItem(PRESETS_KEY, JSON.stringify(obj)); return true; } catch (e) { console.warn('Failed to save presets', e); return false; }
}

function saveNamedPreset(name) {
  if (!name || !String(name).trim()) { alert('Please provide a preset name'); return false; }
  try {
    const key = String(name).trim();
    const wave = {
      atheroPercent, thrombusPercent, METs, heartRate, amplitude, timeWindow,
      tWaveScale, qWaveScale, stOffset, stStartMs, stEndMs, tDuration, qtIntervalMs,
      pDuration, pAmp, qrsWidth, qDur, rDur, sDur, pBiphasic,
      gP, gQ, gR, gS, gT, prDur, ecgWaveShift, overlayUsesDilation
    };
    const preset = {
      name: key,
      savedAt: (new Date()).toISOString(),
      waveform: wave,
      conductionItems: JSON.parse(JSON.stringify(conductionItems || [])),
      leadParams: JSON.parse(JSON.stringify(leadParams || [])),
      ecgTriggeringEnabled: !!ecgTriggeringEnabled
    };
    const all = _getAllPresets();
    all[key] = preset;
    const ok = _saveAllPresets(all);
    if (!ok) {
      console.warn('localStorage save failed for preset; offering download fallback');
      // fallback: offer the preset as a downloadable JSON file
      try {
        downloadJSON(preset, 'preset_' + key.replace(/\s+/g,'_') + '.json');
        alert('localStorage save failed; preset downloaded as file instead.');
      } catch (e) { alert('Failed to save preset to localStorage and failed to download fallback file. See console for details.'); }
      return false;
    }
    return true;
  } catch (e) { console.warn('saveNamedPreset error', e); return false; }
}

function loadNamedPreset(name) {
  try {
    const all = _getAllPresets();
    if (!all || !all[name]) { alert('Preset not found: ' + name); return false; }
    const p = all[name];
    // restore waveform values
    if (p.waveform) {
      try {
        if (typeof p.waveform.atheroPercent === 'number') atheroPercent = p.waveform.atheroPercent;
        if (typeof p.waveform.thrombusPercent === 'number') thrombusPercent = p.waveform.thrombusPercent;
        if (typeof p.waveform.METs === 'number') METs = p.waveform.METs;
        if (typeof p.waveform.heartRate === 'number') heartRate = p.waveform.heartRate;
        if (typeof p.waveform.amplitude === 'number') amplitude = p.waveform.amplitude;
        if (typeof p.waveform.timeWindow === 'number') timeWindow = p.waveform.timeWindow;
        if (typeof p.waveform.tWaveScale === 'number') tWaveScale = p.waveform.tWaveScale;
        if (typeof p.waveform.qWaveScale === 'number') qWaveScale = p.waveform.qWaveScale;
        if (typeof p.waveform.stOffset === 'number') stOffset = p.waveform.stOffset;
        if (typeof p.waveform.stStartMs === 'number') stStartMs = p.waveform.stStartMs;
        if (typeof p.waveform.stEndMs === 'number') stEndMs = p.waveform.stEndMs;
        if (typeof p.waveform.tDuration === 'number') tDuration = p.waveform.tDuration;
        if (typeof p.waveform.qtIntervalMs === 'number') qtIntervalMs = p.waveform.qtIntervalMs;
        if (typeof p.waveform.pDuration === 'number') pDuration = p.waveform.pDuration;
        if (typeof p.waveform.pAmp === 'number') pAmp = p.waveform.pAmp;
        if (typeof p.waveform.qrsWidth === 'number') qrsWidth = p.waveform.qrsWidth;
        if (typeof p.waveform.qDur === 'number') qDur = p.waveform.qDur;
        if (typeof p.waveform.rDur === 'number') rDur = p.waveform.rDur;
        if (typeof p.waveform.sDur === 'number') sDur = p.waveform.sDur;
        if (typeof p.waveform.pBiphasic === 'boolean') pBiphasic = p.waveform.pBiphasic;
        if (typeof p.waveform.gP === 'number') gP = p.waveform.gP;
        if (typeof p.waveform.gQ === 'number') gQ = p.waveform.gQ;
        if (typeof p.waveform.gR === 'number') gR = p.waveform.gR;
        if (typeof p.waveform.gS === 'number') gS = p.waveform.gS;
        if (typeof p.waveform.gT === 'number') gT = p.waveform.gT;
        if (typeof p.waveform.prDur === 'number') prDur = p.waveform.prDur;
        if (typeof p.waveform.ecgWaveShift === 'number') ecgWaveShift = p.waveform.ecgWaveShift;
        if (typeof p.waveform.overlayUsesDilation === 'boolean') overlayUsesDilation = p.waveform.overlayUsesDilation;
      } catch (e) { console.warn('apply waveform from preset failed', e); }
    }
    // restore conduction items and lead params
    if (Array.isArray(p.conductionItems)) {
      conductionItems = JSON.parse(JSON.stringify(p.conductionItems));
      saveConductionItems();
    }
    if (Array.isArray(p.leadParams)) {
      for (let i = 0; i < Math.min(12, p.leadParams.length); i++) {
        try { leadParams[i] = Object.assign({}, leadParams[i] || {}, p.leadParams[i]); } catch (e) {}
      }
      saveLeadParams();
    }
    // Do NOT restore timeDilation from presets: keep current playback speed
    // unchanged unless the user explicitly adjusts the Time Dilation slider.
    ecgTriggeringEnabled = !!p.ecgTriggeringEnabled;
    // persist waveform to localStorage and update UI/controls
    saveEcgWaveformSettings();
    refreshConductionPanel();
    try { refreshPresetSelectGlobal(); refreshSequenceSelectGlobal(); } catch (e) {}
    // update slider elements if present
    const mapIds = { qrsWidth: 'qrsInput', qDur: 'qdurInput', rDur: 'rdurInput', sDur: 'sdurInput', pDuration: 'pdurInput', heartRate: 'hrInput', tDuration: 'tdurInput', prDur: 'prInput', qtIntervalMs: 'qtInput' };
    Object.keys(mapIds).forEach(k => {
      try { const el = document.getElementById(mapIds[k]); if (el) el.value = String(window[k]); } catch (e) {}
    });
    return true;
  } catch (e) { console.warn('loadNamedPreset error', e); return false; }
}

function deleteNamedPreset(name) {
  try {
    const all = _getAllPresets();
    if (!all || !all[name]) return false;
    delete all[name];
    _saveAllPresets(all);
    return true;
  } catch (e) { console.warn('deleteNamedPreset error', e); return false; }
}

// Export current conduction data (items, explicit steps, step durations) as JSON file
function exportConductionData() {
  try {
    const payload = {
      conductionItems: conductionItems.map(it => ({ id: it.id, name: it.name, type: it.type, points: it.points, color: it.color, fill: it.fill, closed: it.closed, mode: it.mode, durationMs: it.durationMs, step: it.step, rampUpMs: it.rampUpMs, sustainMs: it.sustainMs, rampDownMs: it.rampDownMs, durationSource: it.durationSource || null, rampUpSource: it.rampUpSource || null, sustainSource: it.sustainSource || null, rampDownSource: it.rampDownSource || null, startMode: it.startMode || 'after_previous', ecgEvent: it.ecgEvent || '' })),
      conductionExplicitSteps: Array.isArray(conductionExplicitSteps) ? conductionExplicitSteps.slice() : [],
      conductionStepDurations: conductionStepDurations || {}
    };
    const filename = 'conduction_export_' + (new Date()).toISOString().replace(/[:.]/g,'-') + '.json';
    downloadJSON(payload, filename);
  } catch (e) { console.warn('exportConductionData error', e); alert('Export failed: ' + String(e)); }
}

function downloadJSON(obj, filename) {
  try {
    const data = JSON.stringify(obj, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) {} }, 500);
  } catch (e) { console.warn('downloadJSON error', e); alert('Download failed: ' + String(e)); }
}

// Handle parsed imported object; allow replace or merge
function handleImportedConduction(parsed) {
  try {
    if (!parsed) { alert('No data found in import'); return; }
    // support raw array of items or wrapped object
    let importedItems = null;
    if (Array.isArray(parsed)) importedItems = parsed;
    else if (parsed.conductionItems && Array.isArray(parsed.conductionItems)) importedItems = parsed.conductionItems;
    else { alert('Imported JSON does not contain conduction items'); return; }

    // simple validation: ensure items have points array
    for (const it of importedItems) {
      if (!it.points || !Array.isArray(it.points)) { alert('Imported items malformed (missing points)'); return; }
    }

    const choice = confirm('Replace existing conduction items with imported data? Cancel to merge (append) instead.');
    if (choice) {
      // replace
      conductionItems = importedItems.map((it, idx) => ({
        id: it.id || Date.now() + idx,
        name: it.name || ('Item ' + (idx+1)),
        type: it.type === 'shape' ? 'shape' : 'path',
        points: it.points.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        color: it.color || '#ff0000',
        fill: !!it.fill,
        closed: !!it.closed,
        mode: (it.mode === 'concurrent' ? 'concurrent' : 'sequential'),
        durationMs: Number(it.durationMs) || 1200,
        step: (typeof it.step === 'number') ? it.step : (typeof it.step === 'string' ? Number(it.step) || 0 : idx),
        rampUpMs: Number(it.rampUpMs) || 200,
        sustainMs: Number(it.sustainMs) || 800,
        rampDownMs: Number(it.rampDownMs) || 200,
        durationSource: it.durationSource || null,
        rampUpSource: it.rampUpSource || null,
        sustainSource: it.sustainSource || null,
        rampDownSource: it.rampDownSource || null,
        startMode: it.startMode || 'after_previous',
        ecgEvent: it.ecgEvent || ''
      }));
      // optionally import explicit steps and durations if present
      if (parsed.conductionExplicitSteps && Array.isArray(parsed.conductionExplicitSteps)) conductionExplicitSteps = parsed.conductionExplicitSteps.slice();
      if (parsed.conductionStepDurations && typeof parsed.conductionStepDurations === 'object') conductionStepDurations = Object.assign({}, parsed.conductionStepDurations);
      try { saveConductionItems(); } catch (e) { console.warn('save after import failed', e); }
      refreshConductionPanel();
      alert('Import successful: replaced existing items.');
      console.log('Imported conduction items (replace):', conductionItems);
      return;
    }

    // merge: append imported items but avoid id collisions
    const existingIds = new Set(conductionItems.map(it => it.id));
    const toAppend = importedItems.map((it, idx) => {
      let newId = it.id || (Date.now() + idx);
      while (existingIds.has(newId)) newId = newId + 1;
      existingIds.add(newId);
      return {
        id: newId,
        name: it.name || ('Imported ' + (idx+1)),
        type: it.type === 'shape' ? 'shape' : 'path',
        points: it.points.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        color: it.color || '#ff0000',
        fill: !!it.fill,
        closed: !!it.closed,
        mode: (it.mode === 'concurrent' ? 'concurrent' : 'sequential'),
        durationMs: Number(it.durationMs) || 1200,
        step: (typeof it.step === 'number') ? it.step : (typeof it.step === 'string' ? Number(it.step) || 0 : conductionItems.length),
        rampUpMs: Number(it.rampUpMs) || 200,
        sustainMs: Number(it.sustainMs) || 800,
        rampDownMs: Number(it.rampDownMs) || 200,
        durationSource: it.durationSource || null,
        rampUpSource: it.rampUpSource || null,
        sustainSource: it.sustainSource || null,
        rampDownSource: it.rampDownSource || null,
        startMode: it.startMode || 'after_previous',
        ecgEvent: it.ecgEvent || '',
        startOffsetMs: Number(it.startOffsetMs) || 0,
        playbackStartTime: 0
      };
    });
    conductionItems = conductionItems.concat(toAppend);
    try { saveConductionItems(); } catch (e) { console.warn('save after import merge failed', e); }
    refreshConductionPanel();
    alert('Import merged: appended ' + toAppend.length + ' items.');
    console.log('Imported conduction items (merged):', toAppend);
  } catch (e) { console.warn('handleImportedConduction error', e); alert('Import failed: ' + String(e)); }
}

// Persist / load conduction items
const CONDUCTION_ITEMS_KEY = 'ecg.conductionItems.v1';
const ECG_TRIGGER_KEY = 'ecg.triggering.v1';
let ecgTriggeringEnabled = true;
function saveConductionItems() {
  try {
    storageSetItem(CONDUCTION_ITEMS_KEY, JSON.stringify(conductionItems));
  } catch (e) { console.warn('saveConductionItems error', e); }
}

function loadConductionItems() {
  try {
    const raw = storageGetItem(CONDUCTION_ITEMS_KEY);
    if (!raw) { conductionItems = conductionItems || []; return; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { conductionItems = conductionItems || []; return; }
    // normalize items to expected shape
    conductionItems = parsed.map((it, idx) => {
      const pts = Array.isArray(it.points) ? it.points.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })) : [];
      return {
        id: it.id || (Date.now() + idx),
        name: it.name || ('Item ' + (idx + 1)),
        type: (it.type === 'shape' ? 'shape' : 'path'),
        points: pts,
        color: it.color || '#ff0000',
        fill: !!it.fill,
        closed: !!it.closed,
        mode: it.mode || 'sequential',
        durationMs: Number(it.durationMs) || 1200,
        step: (typeof it.step === 'number') ? it.step : idx,
        rampUpMs: Number(it.rampUpMs) || 200,
        sustainMs: Number(it.sustainMs) || 800,
        rampDownMs: Number(it.rampDownMs) || 200,
        durationSource: it.durationSource || null,
        rampUpSource: it.rampUpSource || null,
        sustainSource: it.sustainSource || null,
        rampDownSource: it.rampDownSource || null,
        startMode: it.startMode || 'after_previous',
        ecgEvent: it.ecgEvent || '',
        startOffsetMs: Number(it.startOffsetMs) || 0,
        playbackStartTime: 0
      };
    });
  } catch (e) { console.warn('loadConductionItems error', e); conductionItems = conductionItems || []; }
}

// Per-item undo history: keep up to 5 previous snapshots for each item.
function pushConductionHistory(idx) {
  try {
    if (typeof idx !== 'number' || idx < 0 || idx >= conductionItems.length) return;
    const it = conductionItems[idx];
    it.__history = it.__history || [];
    // snapshot current state (exclude __history)
    const snap = JSON.parse(JSON.stringify(it));
    delete snap.__history;
    it.__history.push(snap);
    if (it.__history.length > 5) it.__history.shift();
  } catch (e) { console.warn('pushConductionHistory error', e); }
}

function undoConductionEdit(idx) {
  try {
    if (typeof idx !== 'number' || idx < 0 || idx >= conductionItems.length) { alert('Select an item to undo'); return; }
    const it = conductionItems[idx];
    if (!it || !Array.isArray(it.__history) || it.__history.length === 0) { alert('Nothing to undo for this item'); return; }
    const prev = it.__history.pop();
    // preserve remaining history
    const remaining = it.__history || [];
    // restore snapshot (deep clone to avoid shared refs)
    const restored = JSON.parse(JSON.stringify(prev));
    restored.__history = remaining;
    // ensure playbackStartTime reset
    restored.playbackStartTime = 0;
    conductionItems[idx] = restored;
    saveConductionItems();
    // keep selection on restored item
    selectedConductionIndex = idx;
    conductionEditMode = true;
    refreshConductionPanel();
  } catch (e) { console.warn('undoConductionEdit error', e); alert('Undo failed: ' + String(e)); }
}

// Persist / load ECG-triggering toggle
function saveEcgTriggering() {
  try { storageSetItem(ECG_TRIGGER_KEY, JSON.stringify({ enabled: !!ecgTriggeringEnabled })); } catch (e) { console.warn('saveEcgTriggering error', e); }
}
function loadEcgTriggering() {
  try {
    const raw = storageGetItem(ECG_TRIGGER_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    ecgTriggeringEnabled = !!(parsed && parsed.enabled);
  } catch (e) { console.warn('loadEcgTriggering error', e); ecgTriggeringEnabled = false; }
}

// Create a new conduction item and refresh UI
function createConductionItem(type) {
  const idx = conductionItems.length;
  const newItem = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    name: (type === 'shape' ? 'Shape ' : 'Path ') + (idx + 1),
    type: type === 'shape' ? 'shape' : 'path',
    // start blank: no default points so user adds points explicitly
    points: [],
    color: '#ff0000',
    fill: false,
    closed: false,
    mode: 'sequential',
    durationMs: 1200,
    step: conductionItems.length,
    rampUpMs: 200,
    sustainMs: 800,
    rampDownMs: 200,
    durationSource: null,
    rampUpSource: null,
    sustainSource: null,
    rampDownSource: null,
    startMode: 'after_previous',
    ecgEvent: '',
    startOffsetMs: 0,
    playbackStartTime: 0
  };
  conductionItems.push(newItem);
  try { saveConductionItems(); } catch (e) { console.warn('save after create failed', e); }
  try { refreshConductionPanel(); } catch (e) { /* ignore */ }
  return newItem;
}

// Rebuild the conduction panel's list UI
function refreshConductionPanel() {
  try {
    if (!conductionPanelDiv) return;
    const holder = conductionPanelDiv.querySelector('.cond-list');
    if (!holder) return;
    // clear
    holder.innerHTML = '';

    const ecgOptions = ['', 'P','PR','QRS','QT','QT*','T','TP'];

    // build list with richer controls
    conductionItems.forEach((it, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.marginBottom = '6px'; row.style.padding = '6px';
      row.style.border = '1px solid rgba(0,0,0,0.04)'; row.style.borderRadius = '6px';

      // left: name and color
      const left = document.createElement('div'); left.style.display = 'flex'; left.style.alignItems = 'center'; left.style.gap = '8px'; left.style.flex = '1';
      const nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.value = it.name || ('Item ' + (idx+1)); nameInp.style.flex = '1';
      nameInp.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.name = nameInp.value; saveConductionItems(); };
      const color = document.createElement('input'); color.type = 'color'; color.value = it.color || '#ff0000'; color.onchange = () => { it.color = color.value; saveConductionItems(); };
      color.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.color = color.value; saveConductionItems(); };
      left.appendChild(nameInp); left.appendChild(color);

      // middle: playback and editing controls
      const middle = document.createElement('div'); middle.style.display = 'flex'; middle.style.alignItems = 'center'; middle.style.gap = '6px';
      const trig = document.createElement('button'); trig.textContent = 'Trigger'; trig.onclick = () => { try { it.playbackStartTime = (pausedConduction ? conductionPausedAtMs : (millis() - conductionTimeOffsetMs)); saveConductionItems(); refreshConductionPanel(); } catch (e) { console.warn('trigger error', e); } };
      // Edit toggle: enables point editing for this item
      const editBtn = document.createElement('button'); editBtn.textContent = (selectedConductionIndex === idx && conductionEditMode) ? 'Editing' : 'Edit';
      editBtn.style.background = (selectedConductionIndex === idx && conductionEditMode) ? '#ffe' : '';
      editBtn.onclick = () => {
        if (selectedConductionIndex === idx && conductionEditMode) {
          conductionEditMode = false; selectedConductionIndex = -1; editBtn.textContent = 'Edit';
        } else {
          conductionEditMode = true; selectedConductionIndex = idx; editBtn.textContent = 'Editing';
        }
        refreshConductionPanel();
      };
      middle.appendChild(trig); middle.appendChild(editBtn);

      // start mode selector
      const startSel = document.createElement('select');
      ['after_previous','on_ecg_event','manual'].forEach(opt => { const o = document.createElement('option'); o.value = opt; o.text = opt.replace('_',' '); if ((it.startMode||'after_previous')===opt) o.selected = true; startSel.appendChild(o); });
      startSel.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.startMode = startSel.value; saveConductionItems(); refreshConductionPanel(); };
      startSel.title = 'Start mode';
      middle.appendChild(startSel);

      // if start on ECG event, show event selector
      const evSel = document.createElement('select'); evSel.style.marginLeft = '4px';
      ['', 'P_start','P_end','Q_start','Q_end','R_start','R_end','S_start','S_end','T_start','T_end'].forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v === '' ? 'event...' : v; if ((it.ecgEvent||'') === v) o.selected = true; evSel.appendChild(o); });
      evSel.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.ecgEvent = evSel.value; saveConductionItems(); };
      if ((it.startMode||'after_previous') === 'on_ecg_event') middle.appendChild(evSel);

      // duration source selector (manual or ECG feature)
      const durSel = document.createElement('select'); ecgOptions.forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v === '' ? 'manual' : v; if ((it.durationSource||'') === v) o.selected = true; durSel.appendChild(o); });
      durSel.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.durationSource = durSel.value || null; saveConductionItems(); refreshConductionPanel(); };
      middle.appendChild(durSel);

      // manual duration input (ms) shown when manual selected
      const durInput = document.createElement('input'); durInput.type = 'number'; durInput.min = '10'; durInput.step = '10'; durInput.style.width = '90px'; durInput.value = Number(it.durationMs || 1200);
      durInput.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.durationMs = Math.max(10, Number(durInput.value) || 10); saveConductionItems(); };
      if (!it.durationSource) middle.appendChild(durInput);

      // per-item start offset (ms)
      const offsetIn = document.createElement('input'); offsetIn.type = 'number'; offsetIn.min = '-60000'; offsetIn.step = '10'; offsetIn.style.width = '90px'; offsetIn.value = Number(it.startOffsetMs || 0);
      offsetIn.title = 'Start offset in milliseconds (can be negative)';
      offsetIn.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.startOffsetMs = Number(offsetIn.value) || 0; saveConductionItems(); };
      const offsetLab = document.createElement('div'); offsetLab.textContent = 'offset ms'; offsetLab.style.fontSize = '11px'; offsetLab.style.marginLeft = '6px';
      middle.appendChild(offsetLab); middle.appendChild(offsetIn);

      // shape-specific ramp fields
      if (it.type === 'shape') {
        const rampRow = document.createElement('div'); rampRow.style.display='flex'; rampRow.style.alignItems='center'; rampRow.style.gap='6px';
        // Create source selects for Up / Sustain / Down (allow manual when empty)
        const makeSourceSelect = (prop) => {
          const sel = document.createElement('select');
          ecgOptions.forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v === '' ? 'manual' : v; if ((it[prop]||'') === v) o.selected = true; sel.appendChild(o); });
          sel.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it[prop] = sel.value || null; saveConductionItems(); refreshConductionPanel(); };
          sel.title = prop;
          return sel;
        };
        const upSel = makeSourceSelect('rampUpSource');
        const susSel = makeSourceSelect('sustainSource');
        const downSel = makeSourceSelect('rampDownSource');

        const upIn = document.createElement('input'); upIn.type='number'; upIn.min='0'; upIn.step='50'; upIn.style.width='80px'; upIn.value = Number(it.rampUpMs || 200); upIn.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.rampUpMs = Math.max(0, Number(upIn.value) || 0); saveConductionItems(); };
        const susIn = document.createElement('input'); susIn.type='number'; susIn.min='0'; susIn.step='50'; susIn.style.width='80px'; susIn.value = Number(it.sustainMs || 800); susIn.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.sustainMs = Math.max(0, Number(susIn.value) || 0); saveConductionItems(); };
        const downIn = document.createElement('input'); downIn.type='number'; downIn.min='0'; downIn.step='50'; downIn.style.width='80px'; downIn.value = Number(it.rampDownMs || 200); downIn.onchange = () => { try { pushConductionHistory(idx); } catch (e) {} it.rampDownMs = Math.max(0, Number(downIn.value) || 0); saveConductionItems(); };

        const labUp = document.createElement('div'); labUp.textContent='Up'; labUp.style.fontSize='11px';
        const labSus = document.createElement('div'); labSus.textContent='Sustain'; labSus.style.fontSize='11px';
        const labDown = document.createElement('div'); labDown.textContent='Down'; labDown.style.fontSize='11px';

        // For each segment: append select then either manual number input (if manual selected) or the selected label
        rampRow.appendChild(labUp); rampRow.appendChild(upSel); if (!it.rampUpSource) rampRow.appendChild(upIn);
        rampRow.appendChild(labSus); rampRow.appendChild(susSel); if (!it.sustainSource) rampRow.appendChild(susIn);
        rampRow.appendChild(labDown); rampRow.appendChild(downSel); if (!it.rampDownSource) rampRow.appendChild(downIn);
        middle.appendChild(rampRow);
      }

      // right: reorder and delete
      const right = document.createElement('div'); right.style.display='flex'; right.style.alignItems='center'; right.style.gap='6px';
      const up = document.createElement('button'); up.textContent = '↑'; up.title = 'Move up'; up.onclick = () => { if (idx <= 0) return; const a = conductionItems.splice(idx,1)[0]; conductionItems.splice(idx-1,0,a); saveConductionItems(); refreshConductionPanel(); };
      const down = document.createElement('button'); down.textContent = '↓'; down.title = 'Move down'; down.onclick = () => { if (idx >= conductionItems.length-1) return; const a = conductionItems.splice(idx,1)[0]; conductionItems.splice(idx+1,0,a); saveConductionItems(); refreshConductionPanel(); };
      const del = document.createElement('button'); del.textContent = 'Delete'; del.onclick = () => { if (!confirm('Delete "' + (it.name||'item') + '"?')) return; conductionItems.splice(idx,1); saveConductionItems(); refreshConductionPanel(); };
      // playing indicator
      const playDot = document.createElement('div'); playDot.style.width='10px'; playDot.style.height='10px'; playDot.style.borderRadius='50%'; playDot.style.marginLeft='6px';
      const baseStart = Number(it.playbackStartTime) || 0; const offsetMs = Number(it.startOffsetMs) || 0; const dilation = (typeof timeDilation === 'number' ? timeDilation : 1.0);
      const scheduledStart = baseStart + offsetMs * dilation;
      const nowMs = (pausedConduction ? conductionPausedAtMs : (millis() - conductionTimeOffsetMs));
      const effDur = computeItemEffectiveDurationMs(it, true) || 0;
      const playing = (scheduledStart > 0 && (nowMs - scheduledStart) >= 0 && (nowMs - scheduledStart) < effDur);
      playDot.style.background = playing ? 'limegreen' : 'transparent'; playDot.style.border = '1px solid ' + (playing ? 'green' : '#ccc');

      right.appendChild(up); right.appendChild(down); right.appendChild(del); right.appendChild(playDot);

      row.appendChild(left); row.appendChild(middle); row.appendChild(right);
      holder.appendChild(row);
    });

    // small footer showing count and a clear all button
    const footer = document.createElement('div'); footer.style.marginTop = '8px'; footer.style.fontSize = '12px'; footer.style.display='flex'; footer.style.justifyContent='space-between';
    const info = document.createElement('div'); info.textContent = 'Items: ' + conductionItems.length; footer.appendChild(info);
    const clearBtn = document.createElement('button'); clearBtn.textContent = 'Clear All'; clearBtn.onclick = () => { if (!confirm('Clear all conduction items?')) return; conductionItems = []; saveConductionItems(); refreshConductionPanel(); };
    footer.appendChild(clearBtn);
    holder.appendChild(footer);
  } catch (e) { console.warn('refreshConductionPanel error', e); }
}

function createConductionPanel() {
  conductionPanelDiv = document.createElement('div');
  conductionPanelDiv.style.position = 'fixed';
  conductionPanelDiv.style.right = '10px';
  conductionPanelDiv.style.top = '120px';
  conductionPanelDiv.style.width = '2000px';
  conductionPanelDiv.style.maxWidth = '80%';
  conductionPanelDiv.style.background = 'rgba(255,255,255,0.98)';
  conductionPanelDiv.style.border = '1px solid rgba(0,0,0,0.12)';
  conductionPanelDiv.style.borderRadius = '8px';
  conductionPanelDiv.style.padding = '10px';
  conductionPanelDiv.style.zIndex = 10003;
  conductionPanelDiv.style.fontFamily = 'Helvetica, Arial, sans-serif';
  conductionPanelDiv.style.display = 'none'; // hidden by default

  // Add show/hide button for constructor panel
  let toggleBtn = document.getElementById('toggleConstructorBtn');
  if (!toggleBtn) {
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'toggleConstructorBtn';
    toggleBtn.textContent = 'Hide Constructor';
    toggleBtn.style.position = 'fixed';
    toggleBtn.style.right = '10px';
    toggleBtn.style.top = '90px';
    toggleBtn.style.zIndex = 10004;
    toggleBtn.style.padding = '8px 10px';
    toggleBtn.style.fontSize = '13px';
    toggleBtn.style.borderRadius = '6px';
    toggleBtn.style.border = '1px solid rgba(0,0,0,0.12)';
    toggleBtn.style.background = 'white';
    toggleBtn.onclick = function() {
      if (conductionPanelDiv.style.display === 'none') {
        conductionPanelDiv.style.display = '';
        toggleBtn.textContent = 'Hide Constructor';
      } else {
        conductionPanelDiv.style.display = 'none';
        toggleBtn.textContent = 'Show Constructor';
      }
    };
    document.body.appendChild(toggleBtn);
  }

  const title = document.createElement('div'); title.textContent = 'Conduction Paths/Shapes'; title.style.fontWeight = '700'; title.style.marginBottom = '8px'; conductionPanelDiv.appendChild(title);

  // Button to return to Basic view (hides advanced panels)
  try {
    const basicViewBtn = document.createElement('button'); basicViewBtn.textContent = 'Basic View'; basicViewBtn.style.marginLeft = '8px'; basicViewBtn.onclick = () => { try { const bp = document.getElementById('basicPanel'); if (bp) bp.style.display = ''; conductionPanelDiv.style.display = 'none'; if (globalControlPanel) globalControlPanel.style.display = 'none'; } catch (e) {} };
    title.appendChild(basicViewBtn);
  } catch (e) {}

  const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='6px'; btnRow.style.marginBottom='8px';
  btnRow.style.flexWrap = 'wrap';
  const addPathBtn = document.createElement('button'); addPathBtn.textContent = 'Add Path'; addPathBtn.onclick = () => { createConductionItem('path'); };
  const addShapeBtn = document.createElement('button'); addShapeBtn.textContent = 'Add Shape'; addShapeBtn.onclick = () => { createConductionItem('shape'); };
  // Removed path/point constructor controls - simplified UI (soundboard style)
  const toggleEdit = document.createElement('div'); toggleEdit.textContent = '';
  // Test trigger: allow manual triggering of ECG events for debugging
  const testSel = document.createElement('select'); testSel.style.marginLeft = '8px';
  const evs = ['', 'P_start','P_end','Q_start','Q_end','R_start','R_end','S_start','S_end','T_start','T_end'];
  evs.forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v === '' ? 'Select event...' : v; testSel.appendChild(o); });
  const triggerBtn = document.createElement('button'); triggerBtn.textContent = 'Trigger ECG Event'; triggerBtn.onclick = () => { try { triggerEcgEvent(testSel.value); } catch (e) { console.warn('trigger error', e); } };
  btnRow.appendChild(testSel); btnRow.appendChild(triggerBtn);
  const undoBtn = document.createElement('button'); undoBtn.textContent = 'Undo'; undoBtn.title = 'Undo last edit for selected item'; undoBtn.onclick = () => { if (selectedConductionIndex < 0) { alert('Select an item to undo'); return; } undoConductionEdit(selectedConductionIndex); };
  btnRow.appendChild(undoBtn);
  // ECG-triggering toggle: when enabled, ECG crossings will auto-start bound items
  const ecgToggleBtn = document.createElement('button');
  ecgToggleBtn.textContent = ecgTriggeringEnabled ? 'Disable ECG Triggers' : 'Enable ECG Triggers';
  ecgToggleBtn.title = 'Toggle automatic triggering of conduction items on ECG events';
  ecgToggleBtn.style.marginLeft = '8px';
  ecgToggleBtn.onclick = () => {
    ecgTriggeringEnabled = !ecgTriggeringEnabled;
    ecgToggleBtn.textContent = ecgTriggeringEnabled ? 'Disable ECG Triggers' : 'Enable ECG Triggers';
    saveEcgTriggering();
  };
  btnRow.appendChild(ecgToggleBtn);
  // Conduction pacer controls: allow constant pulsing at 2Hz or 5Hz for a chosen ECG event
  const pacerEventSel = document.createElement('select'); pacerEventSel.id = 'pacerEventSel'; pacerEventSel.style.marginLeft = '8px';
  evs.forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v === '' ? 'Pacer event...' : v; pacerEventSel.appendChild(o); });
  pacerEventSel.value = 'P_start';
  const pacerRateSel = document.createElement('select'); pacerRateSel.id = 'pacerRateSel';
  const r2 = document.createElement('option'); r2.value = '2'; r2.text = '2 Hz'; pacerRateSel.appendChild(r2);
  const r5 = document.createElement('option'); r5.value = '5'; r5.text = '5 Hz'; pacerRateSel.appendChild(r5);
  pacerRateSel.value = String(conductionPacerHz || '2');
  const pacerBtn = document.createElement('button'); pacerBtn.id = 'pacerBtn'; pacerBtn.textContent = conductionPacerRunning ? 'Stop Pulse' : 'Start Pulse';
  pacerBtn.title = 'Start/Stop constant pulsing at selected rate';
  pacerBtn.onclick = () => {
    try {
      if (!conductionPacerRunning) {
        startConductionPacer(Number(pacerRateSel.value) || 2, pacerEventSel.value || 'P_start');
        pacerBtn.textContent = 'Stop Pulse';
      } else {
        stopConductionPacer();
        pacerBtn.textContent = 'Start Pulse';
      }
    } catch (e) { console.warn('pacer control error', e); }
  };
  btnRow.appendChild(pacerEventSel); btnRow.appendChild(pacerRateSel); btnRow.appendChild(pacerBtn);
  // removed explicit step controls (we'll keep ordering via up/down in the list below)

  // Export / Import controls
  const expBtn = document.createElement('button'); expBtn.textContent = 'Export Paths/Shapes';
  expBtn.title = 'Export conduction items to JSON file';
  expBtn.onclick = () => { try { exportConductionData(); } catch (e) { console.warn('export error', e); alert('Export failed: ' + String(e)); } };

  const importFileInput = document.createElement('input'); importFileInput.type = 'file'; importFileInput.accept = '.json,application/json'; importFileInput.style.display = 'none';
  importFileInput.onchange = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const reader = new FileReader(); reader.onload = (ev) => { try { const parsed = JSON.parse(ev.target.result); handleImportedConduction(parsed); } catch (err) { alert('Invalid JSON file'); console.warn('import parse error', err); } }; reader.readAsText(f); importFileInput.value = ''; };
  const impBtn = document.createElement('button'); impBtn.textContent = 'Import From File'; impBtn.title = 'Import conduction items from a JSON file'; impBtn.onclick = () => { importFileInput.click(); };

  // Paste area for JSON import
  const pasteArea = document.createElement('textarea'); pasteArea.placeholder = 'Or paste JSON here to import'; pasteArea.style.width = '420px'; pasteArea.style.height = '56px'; pasteArea.style.marginLeft = '8px';
  const pasteImpBtn = document.createElement('button'); pasteImpBtn.textContent = 'Import Pasted JSON'; pasteImpBtn.onclick = () => {
    const txt = pasteArea.value && pasteArea.value.trim(); if (!txt) { alert('Paste JSON into the box first'); return; }
    try { const parsed = JSON.parse(txt); handleImportedConduction(parsed); pasteArea.value = ''; } catch (err) { alert('Invalid JSON pasted'); console.warn('paste import error', err); }
  };

  btnRow.appendChild(expBtn); btnRow.appendChild(impBtn); btnRow.appendChild(pasteImpBtn);
  conductionPanelDiv.appendChild(btnRow);

  // Presets UI: save/load named disease states (waveform + conduction)
  const presetsRow = document.createElement('div'); presetsRow.style.display = 'flex'; presetsRow.style.alignItems = 'center'; presetsRow.style.gap = '8px'; presetsRow.style.marginTop = '8px';
  presetsRow.style.flexWrap = 'wrap';
  const presetNameInput = document.createElement('input'); presetNameInput.type = 'text'; presetNameInput.placeholder = 'Preset name (e.g. "MI lateral")'; presetNameInput.style.flex = '1'; presetNameInput.id = 'presetNameInput';
  const savePresetBtn = document.createElement('button'); savePresetBtn.textContent = 'Save Preset';
  savePresetBtn.id = 'savePresetBtn';
  savePresetBtn.onclick = () => {
    const n = presetNameInput.value && String(presetNameInput.value).trim();
    if (!n) { alert('Enter a preset name'); return; }
    if (saveNamedPreset(n)) { alert('Preset saved: ' + n); refreshPresetSelectGlobal(); presetNameInput.value = ''; }
    else alert('Failed to save preset');
  };
  const presetSelect = document.createElement('select'); presetSelect.style.width = '220px'; presetSelect.id = 'presetSelect';
  const loadPresetBtn = document.createElement('button'); loadPresetBtn.textContent = 'Load Preset'; loadPresetBtn.onclick = () => { const v = presetSelect.value; if (!v) { alert('Select a preset'); return; } if (confirm('Load preset "' + v + '"? This will overwrite current settings.')) { if (loadNamedPreset(v)) { alert('Loaded preset: ' + v); } else { alert('Failed to load preset: ' + v); } } };
  loadPresetBtn.id = 'loadPresetBtn';
  const delPresetBtn = document.createElement('button'); delPresetBtn.textContent = 'Delete Preset'; delPresetBtn.onclick = () => { const v = presetSelect.value; if (!v) { alert('Select a preset to delete'); return; } if (!confirm('Delete preset "' + v + '"?')) return; if (deleteNamedPreset(v)) { alert('Deleted: ' + v); refreshPresetSelectGlobal(); } else { alert('Failed to delete: ' + v); } };
  delPresetBtn.id = 'delPresetBtn';
  presetsRow.appendChild(presetNameInput); presetsRow.appendChild(savePresetBtn); presetsRow.appendChild(presetSelect); presetsRow.appendChild(loadPresetBtn); presetsRow.appendChild(delPresetBtn);
  conductionPanelDiv.appendChild(presetsRow);

  // Sequence runner UI
  const seqRow = document.createElement('div'); seqRow.style.display='flex'; seqRow.style.flexDirection='column'; seqRow.style.gap='6px'; seqRow.style.marginTop='8px';
  seqRow.style.flexWrap = 'wrap';
  const seqControls = document.createElement('div'); seqControls.style.display='flex'; seqControls.style.alignItems='center'; seqControls.style.gap='6px';
  const addSeqBtn = document.createElement('button'); addSeqBtn.textContent = 'Add to Sequence';
  addSeqBtn.onclick = () => {
    try {
      const v = presetSelect.value;
      if (!v) { alert('Select a preset to add'); return; }
      console.log('Add to Sequence clicked, adding preset:', v);
      presetSequence.push(v);
      // persist active sequence immediately and refresh UI
      try { saveActiveSequence(); } catch (e) { console.warn('saveActiveSequence failed', e); }
      refreshPresetSequenceUI();
      // brief visual flash to indicate change
      try {
        const seqHolderEl = document.getElementById('presetSequenceHolder');
        if (seqHolderEl) { seqHolderEl.style.boxShadow = '0 0 8px rgba(0,150,0,0.25)'; setTimeout(() => { try { seqHolderEl.style.boxShadow = ''; } catch (e) {} }, 300); }
      } catch (e) {}
    } catch (e) { console.warn('addSeqBtn.onclick error', e); alert('Failed to add preset to sequence: ' + String(e)); }
  };
  addSeqBtn.id = 'addSeqBtn';
  const playSeqBtn = document.createElement('button'); playSeqBtn.textContent = 'Play Sequence'; playSeqBtn.onclick = () => { if (!presetSequencePlaying) startPresetSequence(); else stopPresetSequence(); playSeqBtn.textContent = presetSequencePlaying ? 'Pause Sequence' : 'Play Sequence'; };
  playSeqBtn.id = 'playSeqBtn';
  const stopSeqBtn = document.createElement('button'); stopSeqBtn.textContent = 'Stop'; stopSeqBtn.onclick = () => { stopPresetSequence(); playSeqBtn.textContent = 'Play Sequence'; };
  stopSeqBtn.id = 'stopSeqBtn';
  const loopChk = document.createElement('input'); loopChk.type = 'checkbox'; loopChk.onchange = (e) => { presetSequenceLoop = !!e.target.checked; };
  const loopLab = document.createElement('div'); loopLab.textContent = 'Loop'; loopLab.style.marginRight = '6px';
  const delayIn = document.createElement('input'); delayIn.type = 'number'; delayIn.min = '200'; delayIn.step = '100'; delayIn.value = String(presetSequenceDelayMs); delayIn.style.width='100px'; delayIn.onchange = () => { presetSequenceDelayMs = Math.max(200, Number(delayIn.value) || 2000); };
  const delayLab = document.createElement('div'); delayLab.textContent = 'Delay ms'; delayLab.style.marginLeft = '6px';
  seqControls.appendChild(addSeqBtn); seqControls.appendChild(playSeqBtn); seqControls.appendChild(stopSeqBtn); seqControls.appendChild(loopLab); seqControls.appendChild(loopChk); seqControls.appendChild(delayLab); seqControls.appendChild(delayIn);
  // Toggle: show entire sequence on the right half (up to 5 waveforms)
  const showSeqChk = document.createElement('input'); showSeqChk.type = 'checkbox'; showSeqChk.id = 'showSequenceOnRightChk'; showSeqChk.style.marginLeft = '8px';
  showSeqChk.onchange = (e) => { showSequenceOnRight = !!e.target.checked; seqPreviewNeedsUpdate = true; };
  const showSeqLab = document.createElement('div'); showSeqLab.textContent = 'Show sequence on right'; showSeqLab.style.marginLeft = '4px'; showSeqLab.style.marginRight = '6px';
  seqControls.appendChild(showSeqLab); seqControls.appendChild(showSeqChk);
  // Sequence save/load controls (name, save, select, load, delete)
  const seqSaveRow = document.createElement('div'); seqSaveRow.style.display='flex'; seqSaveRow.style.alignItems='center'; seqSaveRow.style.gap='6px';
  const sequenceNameInput = document.createElement('input'); sequenceNameInput.type = 'text'; sequenceNameInput.placeholder = 'Sequence name (e.g. "A-B-C")'; sequenceNameInput.style.flex = '1'; sequenceNameInput.id = 'sequenceNameInput';
  const saveSeqBtn = document.createElement('button'); saveSeqBtn.textContent = 'Save Sequence'; saveSeqBtn.onclick = () => {
    const n = sequenceNameInput.value && String(sequenceNameInput.value).trim(); if (!n) { alert('Enter a sequence name'); return; }
    if (saveNamedSequence(n)) { alert('Sequence saved: ' + n); sequenceNameInput.value = ''; } else { alert('Failed to save sequence'); }
  };
  saveSeqBtn.id = 'saveSeqBtn';
  const seqSelect = document.createElement('select'); seqSelect.style.width = '220px'; seqSelect.id = 'sequenceSelect';
  const loadSeqBtn = document.createElement('button'); loadSeqBtn.textContent = 'Load Sequence'; loadSeqBtn.onclick = () => { const v = seqSelect.value; if (!v) { alert('Select a sequence to load'); return; } if (confirm('Load sequence "' + v + '"? This will replace the current sequence.')) { if (loadNamedSequence(v)) { alert('Loaded sequence: ' + v); refreshPresetSequenceUI(); } else alert('Failed to load sequence'); } };
  loadSeqBtn.id = 'loadSeqBtn';
  const delSeqBtn = document.createElement('button'); delSeqBtn.textContent = 'Delete Sequence'; delSeqBtn.onclick = () => { const v = seqSelect.value; if (!v) { alert('Select a sequence to delete'); return; } if (!confirm('Delete sequence "' + v + '"?')) return; if (deleteNamedSequence(v)) { alert('Deleted: ' + v); refreshSequenceSelectGlobal(); } else { alert('Failed to delete: ' + v); } };
  delSeqBtn.id = 'delSeqBtn';
  seqSaveRow.appendChild(sequenceNameInput); seqSaveRow.appendChild(saveSeqBtn); seqSaveRow.appendChild(seqSelect); seqSaveRow.appendChild(loadSeqBtn); seqSaveRow.appendChild(delSeqBtn);

  const seqHolder = document.createElement('div'); seqHolder.id = 'presetSequenceHolder'; seqHolder.style.display='flex'; seqHolder.style.flexDirection='column'; seqHolder.style.gap='4px'; seqHolder.style.maxHeight='160px'; seqHolder.style.overflow='auto'; seqHolder.style.border = '1px solid rgba(0,0,0,0.06)'; seqHolder.style.padding = '6px';
  seqRow.appendChild(seqControls); seqRow.appendChild(seqSaveRow); seqRow.appendChild(seqHolder);
  conductionPanelDiv.appendChild(seqRow);
  // ensure sequence UI initial state
  try { refreshPresetSequenceUI(); } catch (e) {}

  function refreshPresetSelect() {
    try {
      const sel = document.getElementById('presetSelect'); if (!sel) return;
      sel.innerHTML = '';
      const all = _getAllPresets();
      const keys = Object.keys(all || {}).sort((a,b) => (all[b].savedAt||'').localeCompare(all[a].savedAt||''));
      const empty = document.createElement('option'); empty.value = ''; empty.text = '-- presets --'; sel.appendChild(empty);
      keys.forEach(k => { const o = document.createElement('option'); o.value = k; o.text = k + (all[k].savedAt ? ('  (' + new Date(all[k].savedAt).toLocaleString() + ')') : ''); sel.appendChild(o); });
    } catch (e) { /* ignore */ }
  }
  // populate presets initially
  try { refreshPresetSelectGlobal(); } catch (e) {}
  try { refreshSequenceSelectGlobal(); } catch (e) {}

  // placeholder for list
  const listHolder = document.createElement('div'); listHolder.className = 'cond-list'; conductionPanelDiv.appendChild(listHolder);

  // constructor point-editing removed in simplified UI

  // Show constructor panel by default and append to body; panel will host
  // the ECG waveform controls (moved later) so it opens automatically
  conductionPanelDiv.style.display = '';
  // set a sane default size for the constructor window (wider so controls fit)
  conductionPanelDiv.style.width = '2000px';
  conductionPanelDiv.style.maxWidth = '96%';
  document.body.appendChild(conductionPanelDiv);
  refreshConductionPanel();
}

// Helper: return ECG feature duration in ms for binding keys
function getEcgFeatureMs(key) {
  if (!key) return null;
  switch (String(key)) {
    case 'P': return Math.max(1, Math.round((pDuration || 0) * 1000));
    case 'PR': return Math.max(1, Math.round((prDur || 0) * 1000));
    case 'QRS': {
      try {
        // Compute QRS as Q onset -> S end using same geometry as singleBeatSignal
        const qCenter = -0.03;
        const rCenter = 0.0;
        const qHalf = (qDur || 0) * (qrsWidth || 1) / 2.0;
        const rHalf = (rDur || 0) * (qrsWidth || 1) / 2.0;
        const sHalf = (sDur || 0) * (qrsWidth || 1) / 2.0;
        const qStart = qCenter - qHalf;
        const rEnd = rCenter + rHalf;
        const sGapLocal = typeof sGap !== 'undefined' ? sGap : 0.006;
        const sEnd = rEnd + sGapLocal + sHalf;
        const qrsSec = Math.max(0.001, sEnd - qStart);
        return Math.max(1, Math.round(qrsSec * 1000));
      } catch (e) {
        return Math.max(1, Math.round(((qDur || 0) + (rDur || 0) + (sDur || 0)) * (qrsWidth || 1) * 1000));
      }
    }
    case 'QT': return Math.max(1, Math.round(qtIntervalMs || 0));
    case 'QT*': {
      try {
        // Compute S end and T start similar to singleBeatSignal() internals
        const qCenter = -0.03;
        const rCenter = 0.0;
        const qHalf = (qDur || 0) * (qrsWidth || 1) / 2.0;
        const rHalf = (rDur || 0) * (qrsWidth || 1) / 2.0;
        const sHalf = (sDur || 0) * (qrsWidth || 1) / 2.0;
        const qStart = qCenter - qHalf;
        const rEnd = rCenter + rHalf;
        const sGapLocal = typeof sGap !== 'undefined' ? sGap : 0.006;
        const sEnd = rEnd + sGapLocal + sHalf;
        // desired T end from Q onset
        const desiredTEnd = qStart + (qtIntervalMs || 0) / 1000.0;
        const minTdur = Math.max(0.02, tDuration || 0.02);
        const tStart = Math.max(sEnd + (typeof sStOverlap !== 'undefined' ? sStOverlap : 0.085), desiredTEnd - minTdur);
        const qtStarMs = Math.round(Math.max(1, (tStart - sEnd) * 1000));
        return qtStarMs;
      } catch (e) { return Math.max(1, Math.round(qtIntervalMs || 0)); }
    }
    case 'T': return Math.max(1, Math.round((tDuration || 0) * 1000));
    case 'TP': {
      // TP = interval from end of T to next P. TP = RR - (PR + QT)
      const hr = (heartRate && Number.isFinite(heartRate)) ? Number(heartRate) : 60;
      const beatSec = 60.0 / hr;
      const prSec = (prDur || 0);
      const qtSec = (qtIntervalMs || 0) / 1000.0;
      const tpMs = Math.round((beatSec - (prSec + qtSec)) * 1000);
      return Math.max(1, tpMs);
    }
    default: return null;
  }
}

// Compute the effective duration (ms) for a conduction item using current ECG feature mappings.
function computeItemEffectiveDurationMs(it, includeDilation = true) {
  try {
    const dilation = (typeof timeDilation === 'number' ? timeDilation : 1.0);
    const mult = includeDilation ? dilation : 1.0;
    if (!it) return 0;
    if (it.durationSource) {
      return Math.max(1, (getEcgFeatureMs(it.durationSource) || 0)) * mult;
    }
    if (it.type === 'shape') {
      const rampUp = (it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : Math.max(0, Number(it.rampUpMs) || 0)) * mult;
      const sustain = (it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : Math.max(0, Number(it.sustainMs) || 0)) * mult;
      const rampDown = (it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : Math.max(0, Number(it.rampDownMs) || 0)) * mult;
      return Math.max(1, rampUp + sustain + rampDown);
    }
    return Math.max(1, Number(it.durationMs || 1200)) * mult;
  } catch (e) { console.warn('computeItemEffectiveDurationMs error', e); return 0; }
}

// Trigger conduction items for a given ECG event key (e.g. 'R_start')
function triggerEcgEvent(eventKey) {
  try {
    if (!eventKey) return;
    // In ischemia mode we suspend conduction animations entirely (placeholder
    // for a future ischemic-area visualization). Manual triggers and pacer
    // ticks all go through this function, so gating here is sufficient.
    if (typeof appMode !== 'undefined' && appMode === 'ischemia') return;
    const now = (pausedConduction ? conductionPausedAtMs : (millis() - conductionTimeOffsetMs));
    let triggered = 0;
    conductionItems.forEach(it => {
      if (!it) return;
      if ((it.startMode === 'on_ecg_event') && (it.ecgEvent === eventKey)) {
        it.playbackStartTime = now;
        // log computed durations to help debug mismatches between items
        try {
          const eff = computeItemEffectiveDurationMs(it, true);
          const effNoDil = computeItemEffectiveDurationMs(it, false);
          console.log('triggerEcgEvent:', eventKey, '->', it.name, 'start@', now, 'dur(ms,withDil/noDil)=', eff, '/', effNoDil, 'config=', { startMode: it.startMode, durationSource: it.durationSource, rampUpSource: it.rampUpSource, sustainSource: it.sustainSource, rampDownSource: it.rampDownSource, durationMs: it.durationMs });
          if (conductionDebugDiv) conductionDebugDiv.textContent = 'Triggered ' + it.name + ' for ' + eventKey + ' dur=' + Math.round(eff) + 'ms';
        } catch (e) { console.warn('trigger log error', e); }
        triggered++;
      }
    });
    if (triggered > 0 && conductionDebugDiv) {
      conductionDebugDiv.textContent = 'Triggered ' + triggered + ' items for ' + eventKey;
    }
  } catch (e) { console.warn('triggerEcgEvent error', e); }
}

// Open the conduction panel in a separate window (pop-out)
function openConductionWindow() {
  try {
    if (conductionWindow && !conductionWindow.closed) {
      conductionWindow.focus();
      return;
    }
    // remember current inline styles so we can restore when docking
    if (conductionPanelDiv) {
      conductionPanelOriginalStyles = {
        position: conductionPanelDiv.style.position || '',
        right: conductionPanelDiv.style.right || '',
        top: conductionPanelDiv.style.top || '',
        width: conductionPanelDiv.style.width || '',
        maxWidth: conductionPanelDiv.style.maxWidth || '',
        zIndex: conductionPanelDiv.style.zIndex || '',
        padding: conductionPanelDiv.style.padding || ''
      };
    }

    const features = 'width=' + (conductionPopoutWidth || 900) + ',height=' + (conductionPopoutHeight || 760) + ',left=80,top=80';
    const w = window.open('', 'ConductionPanel', features);
    if (!w) { alert('Popup blocked: please allow popups for this site to open the Conduction panel.'); return; }
    conductionWindow = w;
    // write a minimal document shell so appearance is decent
    try {
      w.document.title = 'Conduction Paths/Shapes';
      // inject basic styles to make the panel readable
      const style = w.document.createElement('style');
      style.textContent = `body{font-family:Helvetica,Arial,sans-serif;margin:8px;background:#fff;color:#111}`;
      w.document.head.appendChild(style);
      // move the existing panel into the new window
      // If the global waveform control panel exists and isn't already
      // a child of the conduction panel, move it into the conduction
      // panel so it travels with the popout window as the user requested.
      try {
        if (typeof globalControlPanel !== 'undefined' && globalControlPanel && globalControlPanel.parentNode !== conductionPanelDiv) {
          try { if (globalControlPanel.parentNode) globalControlPanel.parentNode.removeChild(globalControlPanel); } catch (e) {}
          conductionPanelDiv.appendChild(globalControlPanel);
          // clear inline fixed positioning so it flows inside the panel
          try { globalControlPanel.style.position = ''; globalControlPanel.style.left = ''; globalControlPanel.style.top = ''; globalControlPanel.style.margin = '8px'; } catch (e) {}
        }
      } catch (e) {}
      w.document.body.appendChild(conductionPanelDiv);
      // adjust positioning to flow in the new document
      conductionPanelDiv.style.position = '';
      conductionPanelDiv.style.right = '';
      conductionPanelDiv.style.top = '';
      conductionPanelDiv.style.zIndex = '';
      conductionPanelDiv.style.width = '100%';
      conductionPanelDiv.style.maxWidth = '100%';
      conductionPanelDiv.style.padding = '8px';
      // expose a dock function in the opened window so user can dock back manually
      const dockBtn = w.document.createElement('button');
      dockBtn.textContent = 'Dock';
      dockBtn.style.position = 'fixed'; dockBtn.style.right = '8px'; dockBtn.style.top = '8px'; dockBtn.style.zIndex = 9999;
      dockBtn.onclick = () => { try { window.dockConductionPanel(); } catch (e) { /* ignore */ } };
      w.document.body.appendChild(dockBtn);
        // regenerate the panel contents now that it lives in the popup so
        // inputs are recreated with the current attributes/handlers (10ms step/min)
        try { refreshConductionPanel(); refreshPresetSelectGlobal(); refreshSequenceSelectGlobal(); } catch (e) { /* ignore */ }
        // Rebind popup handlers to call back into the main window functions so
        // actions performed inside the popout affect the primary sketch.
        try {
          const main = window;
          const localRoot = conductionPanelDiv; // now owned by popup document
          const sel = (s) => { try { return localRoot.querySelector(s); } catch (e) { return null; } };
          const wrapAlert = (msg) => { try { w.alert(msg); } catch (e) { /* ignore */ } };
          const wrapConfirm = (msg) => { try { return w.confirm(msg); } catch (e) { return false; } };

          const loadBtn = sel('#loadPresetBtn');
          if (loadBtn) {
            loadBtn.onclick = function() {
              const ps = sel('#presetSelect'); const v = ps ? ps.value : '';
              if (!v) { wrapAlert('Select a preset'); return; }
              if (wrapConfirm('Load preset "' + v + '"? This will overwrite current settings.')) {
                try { main.loadNamedPreset(v); } catch (e) { console.warn('popup->main loadNamedPreset failed', e); }
                wrapAlert('Loaded preset: ' + v);
                try { main.refreshConductionPanel(); main.refreshPresetSelectGlobal(); } catch (e) {}
              }
            };
          }

          const saveBtn = sel('#savePresetBtn');
          if (saveBtn) {
            saveBtn.onclick = function() {
              const inEl = sel('#presetNameInput'); const name = inEl ? String(inEl.value || '').trim() : '';
              if (!name) { wrapAlert('Enter a preset name'); return; }
              try { if (main.saveNamedPreset(name)) { wrapAlert('Preset saved: ' + name); main.refreshPresetSelectGlobal(); if (inEl) inEl.value = ''; } else { wrapAlert('Failed to save preset'); } } catch (e) { console.warn('popup->main saveNamedPreset failed', e); }
            };
          }

          const delBtn = sel('#delPresetBtn');
          if (delBtn) {
            delBtn.onclick = function() {
              const ps = sel('#presetSelect'); const v = ps ? ps.value : '';
              if (!v) { wrapAlert('Select a preset to delete'); return; }
              if (!wrapConfirm('Delete preset "' + v + '"?')) return;
              try { if (main.deleteNamedPreset(v)) { wrapAlert('Deleted: ' + v); main.refreshPresetSelectGlobal(); } else { wrapAlert('Failed to delete: ' + v); } } catch (e) { console.warn('popup->main deleteNamedPreset failed', e); }
            };
          }

          // Sequence controls
          const addSeq = sel('#addSeqBtn'); if (addSeq) addSeq.onclick = function() { const ps = sel('#presetSelect'); const v = ps ? ps.value : ''; if (!v) { wrapAlert('Select a preset to add'); return; } try { main.presetSequence.push(v); main.refreshPresetSequenceUI(); } catch (e) { console.warn('popup->main addSeq failed', e); } };
          const playBtn = sel('#playSeqBtn'); if (playBtn) playBtn.onclick = function() { try { if (!main.presetSequencePlaying) main.startPresetSequence(); else main.stopPresetSequence(); playBtn.textContent = main.presetSequencePlaying ? 'Pause Sequence' : 'Play Sequence'; } catch (e) { console.warn('popup->main play/stop failed', e); } };
          const stopBtn = sel('#stopSeqBtn'); if (stopBtn) stopBtn.onclick = function() { try { main.stopPresetSequence(); const pb = sel('#playSeqBtn'); if (pb) pb.textContent = 'Play Sequence'; } catch (e) { console.warn('popup->main stopSeq failed', e); } };

          const saveSeq = sel('#saveSeqBtn'); if (saveSeq) saveSeq.onclick = function() { const inEl = sel('#sequenceNameInput'); const name = inEl ? String(inEl.value || '').trim() : ''; if (!name) { wrapAlert('Enter a sequence name'); return; } try { if (main.saveNamedSequence(name)) { wrapAlert('Sequence saved: ' + name); if (inEl) inEl.value = ''; } else { wrapAlert('Failed to save sequence'); } main.refreshSequenceSelectGlobal(); } catch (e) { console.warn('popup->main saveNamedSequence failed', e); } };

          const loadSeq = sel('#loadSeqBtn'); if (loadSeq) loadSeq.onclick = function() { const ssel = sel('#sequenceSelect'); const v = ssel ? ssel.value : ''; if (!v) { wrapAlert('Select a sequence to load'); return; } if (wrapConfirm('Load sequence "' + v + '"? This will replace the current sequence.')) { try { main.loadNamedSequence(v); main.refreshPresetSequenceUI(); wrapAlert('Loaded sequence: ' + v); } catch (e) { console.warn('popup->main loadNamedSequence failed', e); } } };

          const delSeq = sel('#delSeqBtn'); if (delSeq) delSeq.onclick = function() { const ssel = sel('#sequenceSelect'); const v = ssel ? ssel.value : ''; if (!v) { wrapAlert('Select a sequence to delete'); return; } if (!wrapConfirm('Delete sequence "' + v + '"?')) return; try { if (main.deleteNamedSequence(v)) { wrapAlert('Deleted: ' + v); main.refreshSequenceSelectGlobal(); } else { wrapAlert('Failed to delete: ' + v); } } catch (e) { console.warn('popup->main deleteNamedSequence failed', e); } };

          // checkbox toggle to show sequence on right: sync to main state
          const showChk = sel('#showSequenceOnRightChk'); if (showChk) showChk.onchange = function(e) { try { main.showSequenceOnRight = !!e.target.checked; main.seqPreviewNeedsUpdate = true; } catch (er) { console.warn('popup->main showSequenceOnRight failed', er); } };
          // Pacer controls in popup should call into main to start/stop the pacer
          try {
            const pacerBtn = sel('#pacerBtn'); const pacerRate = sel('#pacerRateSel'); const pacerEvent = sel('#pacerEventSel');
            if (pacerBtn) {
              pacerBtn.onclick = function() {
                try {
                  if (!main.conductionPacerRunning) {
                    main.startConductionPacer(Number(pacerRate ? pacerRate.value : 2) || 2, pacerEvent ? pacerEvent.value : 'P_start');
                    pacerBtn.textContent = 'Stop Pulse';
                  } else {
                    main.stopConductionPacer();
                    pacerBtn.textContent = 'Start Pulse';
                  }
                } catch (e) { console.warn('popup->main pacer failed', e); }
              };
            }
          } catch (e) { /* ignore pacer binding errors in popup */ }
        } catch (e) { console.warn('Failed to bind popup handlers', e); }
    } catch (e) {
      console.warn('Failed to populate conduction popout window', e);
      // fallback: if moving fails, close the window reference
      try { if (conductionWindow && !conductionWindow.closed) conductionWindow.close(); } catch (e) {}
      conductionWindow = null;
    }
    // when the popout is closed by the user, dock the panel back
    const hookDock = () => { try { dockConductionPanel(); } catch (e) {} };
    try { w.addEventListener('beforeunload', hookDock); } catch (e) { /* ignore */ }
  } catch (e) { console.warn('openConductionWindow error', e); }
}

// Dock the conduction panel back into the main window
function dockConductionPanel() {
  try {
    if (!conductionPanelDiv) return;
    // if panel already belongs to main document, ensure styles restored
    if (conductionPanelDiv.ownerDocument === document) {
      // restore original styles
      if (conductionPanelOriginalStyles) {
        conductionPanelDiv.style.position = conductionPanelOriginalStyles.position;
        conductionPanelDiv.style.right = conductionPanelOriginalStyles.right;
        conductionPanelDiv.style.top = conductionPanelOriginalStyles.top;
        conductionPanelDiv.style.width = conductionPanelOriginalStyles.width;
        conductionPanelDiv.style.maxWidth = conductionPanelOriginalStyles.maxWidth;
        conductionPanelDiv.style.zIndex = conductionPanelOriginalStyles.zIndex;
        conductionPanelDiv.style.padding = conductionPanelOriginalStyles.padding;
      }
      refreshConductionPanel(); refreshPresetSelectGlobal();
      if (conductionWindow && !conductionWindow.closed) { try { conductionWindow.close(); } catch (e) {} }
      conductionWindow = null;
      return;
    }
    // move panel back to main document body
    document.body.appendChild(conductionPanelDiv);
    // restore original styles
    if (conductionPanelOriginalStyles) {
      conductionPanelDiv.style.position = conductionPanelOriginalStyles.position || 'fixed';
      conductionPanelDiv.style.right = conductionPanelOriginalStyles.right || '10px';
      conductionPanelDiv.style.top = conductionPanelOriginalStyles.top || '120px';
      conductionPanelDiv.style.width = conductionPanelOriginalStyles.width || '2000px';
      conductionPanelDiv.style.maxWidth = conductionPanelOriginalStyles.maxWidth || '80%';
      conductionPanelDiv.style.zIndex = conductionPanelOriginalStyles.zIndex || 10003;
      conductionPanelDiv.style.padding = conductionPanelOriginalStyles.padding || '10px';
    }
    // Reattach local handlers for preset/sequence buttons to ensure
    // they operate in the main document context after docking.
    try {
      const sel = (s) => { try { return conductionPanelDiv.querySelector(s); } catch (e) { return null; } };
      const presetSel = sel('#presetSelect');
      const loadBtn = sel('#loadPresetBtn');
      if (loadBtn) {
        loadBtn.onclick = function() {
          const v = presetSel ? presetSel.value : '';
          if (!v) { alert('Select a preset'); return; }
          if (confirm('Load preset "' + v + '"? This will overwrite current settings.')) {
            try { if (loadNamedPreset(v)) { alert('Loaded preset: ' + v); } else { alert('Failed to load preset: ' + v); } } catch (e) { console.warn('loadNamedPreset failed on dock', e); alert('Failed to load preset: ' + String(e)); }
          }
        };
      }

      const addSeq = sel('#addSeqBtn');
      if (addSeq) {
        addSeq.onclick = function() {
          try {
            const v = presetSel ? presetSel.value : '';
            if (!v) { alert('Select a preset to add'); return; }
            console.log('Add to Sequence (docked) adding preset:', v);
            presetSequence.push(v);
            try { saveActiveSequence(); } catch (e) { console.warn('saveActiveSequence failed', e); }
            refreshPresetSequenceUI();
            const seqHolderEl = document.getElementById('presetSequenceHolder');
            if (seqHolderEl) { seqHolderEl.style.boxShadow = '0 0 8px rgba(0,150,0,0.25)'; setTimeout(() => { try { seqHolderEl.style.boxShadow = ''; } catch (e) {} }, 300); }
          } catch (e) { console.warn('add to sequence (docked) failed', e); alert('Failed to add preset to sequence: ' + String(e)); }
        };
      }
      // Reattach pacer controls for docked panel
      const pacerBtnDock = sel('#pacerBtn'); const pacerRateDock = sel('#pacerRateSel'); const pacerEventDock = sel('#pacerEventSel');
      if (pacerBtnDock) {
        pacerBtnDock.onclick = function() {
          try {
            if (!conductionPacerRunning) {
              startConductionPacer(Number(pacerRateDock ? pacerRateDock.value : 2) || 2, pacerEventDock ? pacerEventDock.value : 'P_start');
              pacerBtnDock.textContent = 'Stop Pulse';
            } else {
              stopConductionPacer();
              pacerBtnDock.textContent = 'Start Pulse';
            }
          } catch (e) { console.warn('pacer (docked) handler failed', e); }
        };
      }
    } catch (e) { console.warn('reattach dock handlers failed', e); }

    refreshConductionPanel();
    if (conductionWindow && !conductionWindow.closed) {
      try { conductionWindow.close(); } catch (e) { /* ignore */ }
    }
    conductionWindow = null;
  } catch (e) { console.warn('dockConductionPanel error', e); }
}

// expose docking function to other windows
window.dockConductionPanel = dockConductionPanel;

function preload() {
  // attempt to load CCS.png if it exists next to the sketch
  try { ccsImg = loadImage('CCS.png'); } catch (e) { ccsImg = null; }
}

// offscreen buffer for single-lead ECG (right half)
let ecgG = null;
// S-wave raise intensity (0=no effect, 1=full exponential raise)
// S-wave threshold and flatten amount
let sRaiseThreshold = 0.05; // mV where effect begins
let sFlattenAmount = 1.0; // 0=no flattening, 1=full exponential flattening
let sMaxOffset = 0.6; // maximum ST offset used for exponential mapping
let sMaxRaise = 0.0; // maximum positive raise applied to S (signal units)
const sStOverlap = 0.085; // seconds: fixed overlap between S end and ST start for smoothing
// ischemia control (0..100)
let ischemiaPercent = 0;

// DOM controls references
// (Controls and vessel UI removed — this sketch now draws a 12-lead grid)

// Per-lead morphology multipliers (P, Q, R, S, T). One object per lead (12 leads).
const leadParams = Array.from({length: 12}, () => ({p: 1.0, q: 1.0, r: 1.0, s: 1.0, t: 1.0}));
// DOM container for per-lead controls and cached rects for positioning
let leadControlsDiv = null;
let leadControlDivs = [];
let leadRects = new Array(12).fill(null);
// Offscreen buffers for each lead to stabilize rendering
let leadBuffers = new Array(12).fill(null);

// Zone ischemia (percent 0..100)
const zoneIschemia = { inferior: 0, anterior: 0, lateral: 0 };

// Reciprocal changes strength (0..100)
let reciprocalPercent = 0;

// BroadcastChannel for inter-window control messages
let bc = null;

// Persistence helpers: save/load leadParams to localStorage
const LEAD_PARAMS_KEY = 'ecg.leadParams.v1';
function saveLeadParams() {
  try {
    const toSave = leadParams.map(p => ({p: Number(p.p), q: Number(p.q), r: Number(p.r), s: Number(p.s), t: Number(p.t)}));
    storageSetItem(LEAD_PARAMS_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn('Failed to save lead params', e);
  }
}

function loadLeadParams() {
  try {
    const raw = storageGetItem(LEAD_PARAMS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (let i = 0; i < Math.min(12, parsed.length); i++) {
      const p = parsed[i];
      if (!p) continue;
      leadParams[i].p = typeof p.p === 'number' ? p.p : leadParams[i].p;
      leadParams[i].q = typeof p.q === 'number' ? p.q : leadParams[i].q;
      leadParams[i].r = typeof p.r === 'number' ? p.r : leadParams[i].r;
      leadParams[i].s = typeof p.s === 'number' ? p.s : leadParams[i].s;
      leadParams[i].t = typeof p.t === 'number' ? p.t : leadParams[i].t;
    }
  } catch (e) {
    console.warn('Failed to load lead params', e);
  }
}

function setup() {
        // Load waveform settings before any UI creation
        loadEcgWaveformSettings();
      // --- Ensure all ECG waveform sliders are set to loaded values and save changes ---
      setTimeout(() => {
        const sliderMap = [
          { id: 'qrsInput', var: 'qrsWidth' },
          { id: 'qdurInput', var: 'qDur' },
          { id: 'rdurInput', var: 'rDur' },
          { id: 'sdurInput', var: 'sDur' },
          { id: 'pdurInput', var: 'pDuration' },
          { id: 'hrInput', var: 'heartRate' },
          { id: 'tdurInput', var: 'tDuration' },
          { id: 'stInput', var: 'stOffset' },
          { id: 'prInput', var: 'prDur' },
          { id: 'qtInput', var: 'qtIntervalMs' }
        ];
        sliderMap.forEach(({id, var: v}) => {
          const el = document.getElementById(id);
          if (el) {
            el.value = String(window[v]);
            el.addEventListener('input', () => {
              window[v] = el.type === 'range' ? parseFloat(el.value) : el.value;
              saveEcgWaveformSettings();
            });
          }
        });
      }, 0);
    // After loading settings, update slider values to match persisted state
    const updateSliderValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = String(value);
    };
    updateSliderValue('qrsInput', qrsWidth);
    updateSliderValue('qdurInput', qDur);
    updateSliderValue('rdurInput', rDur);
    updateSliderValue('sdurInput', sDur);
    updateSliderValue('pdurInput', pDuration);
    updateSliderValue('hrInput', heartRate);
    updateSliderValue('tdurInput', tDuration);
    updateSliderValue('prInput', prDur);
    updateSliderValue('qtInput', qtIntervalMs);
    updateSliderValue('stInput', stOffset);
  try {
    // responsive canvas
    // match the device pixel ratio for crisp rendering when supported
    const dpr = window.devicePixelRatio || 1;
    if (typeof pixelDensity === 'function') {
      try { pixelDensity(dpr); } catch (e) { /* ignore */ }
    }
    createCanvas(windowWidth, windowHeight);
    // store for use when aligning coordinates to device pixels
    window._ecg_dpr = dpr;
    // try to disable smoothing on the underlying 2D context
    try { if (drawingContext && 'imageSmoothingEnabled' in drawingContext) drawingContext.imageSmoothingEnabled = false; } catch (e) {}
    strokeJoin(ROUND);
    strokeCap(ROUND);
    textFont('Helvetica');
  } catch (setupErr) {
    console.error('Error during setup:', setupErr);
    // ensure a minimal canvas so we can show an error message
    try { createCanvas(640, 240); } catch (e) {}
    background(240);
    fill(0);
    textSize(14);
    textAlign(LEFT, TOP);
    text('ECG setup error: ' + (setupErr && setupErr.message ? setupErr.message : String(setupErr)), 10, 10);
    // don't rethrow here so the on-canvas message is visible
  }

  // create per-lead controls container (absolute-positioned overlay)
  leadControlsDiv = document.createElement('div');
  leadControlsDiv.style.position = 'fixed';
  leadControlsDiv.style.left = '0px';
  leadControlsDiv.style.top = '0px';
  leadControlsDiv.style.pointerEvents = 'none'; // allow clicks to pass through canvas, we enable for control elements
  // start hidden; show when Advanced Settings is toggled
  leadControlsDiv.style.display = 'none';
  document.body.appendChild(leadControlsDiv);

  // Advanced/12-lead toggle buttons removed per user request.

  // The constructor panel is always visible; removed the hide/show toggle per request.

  // Pop-out button to open the Conduction panel in its own window
  const popoutBtn = document.createElement('button');
  popoutBtn.textContent = 'Pop Out Constructor';
  popoutBtn.style.position = 'fixed';
  popoutBtn.style.top = '84px';
  popoutBtn.style.right = '10px';
  popoutBtn.style.zIndex = 10002;
  popoutBtn.style.padding = '8px 10px';
  popoutBtn.style.fontSize = '13px';
  popoutBtn.style.borderRadius = '6px';
  popoutBtn.style.border = '1px solid rgba(0,0,0,0.12)';
  popoutBtn.style.background = 'white';
  popoutBtn.onclick = () => { openConductionWindow(); };
  document.body.appendChild(popoutBtn);

  // Global small control panel for QRS width (top-left)
  const globalPanel = document.createElement('div');
  globalPanel.style.position = 'fixed';
  globalPanel.style.top = '10px';
  globalPanel.style.zIndex = 10002;
  globalPanel.style.padding = '6px 8px';
  globalPanel.style.background = 'rgba(255,255,255,0.95)';
  globalPanel.style.border = '1px solid rgba(0,0,0,0.12)';
  globalPanel.style.borderRadius = '6px';
  globalPanel.style.fontFamily = 'Helvetica, Arial, sans-serif';
  globalPanel.style.fontSize = '13px';

  const qrsLabel = document.createElement('div');
  qrsLabel.textContent = 'QRS width';
  qrsLabel.style.marginBottom = '6px';
  globalPanel.appendChild(qrsLabel);
  const qrsRow = document.createElement('div');
  qrsRow.style.display = 'flex'; qrsRow.style.alignItems = 'center'; qrsRow.style.gap = '8px';
  const qrsInput = document.createElement('input');
  qrsInput.type = 'range'; qrsInput.min = '0.5'; qrsInput.max = '10.0'; qrsInput.step = '0.01'; qrsInput.value = String(qrsWidth);
  qrsInput.oninput = (e) => { qrsWidth = Number(e.target.value); qrsVal.textContent = qrsWidth.toFixed(2); saveEcgWaveformSettings(); };
  qrsInput.style.flex = '1';
  const qrsVal = document.createElement('div'); qrsVal.textContent = qrsWidth.toFixed(2); qrsVal.style.width = '44px'; qrsVal.style.textAlign = 'right';
  qrsRow.appendChild(qrsInput); qrsRow.appendChild(qrsVal); globalPanel.appendChild(qrsRow);
  // Q duration slider (seconds)
  const qdurRow = document.createElement('div');
  qdurRow.style.display = 'flex'; qdurRow.style.alignItems = 'center'; qdurRow.style.gap = '8px';
  const qdurInput = document.createElement('input');
  qdurInput.type = 'range'; qdurInput.min = '0.005'; qdurInput.max = '0.08'; qdurInput.step = '0.001'; qdurInput.value = String(qDur);
  qdurInput.oninput = (e) => { qDur = Number(e.target.value); qdurVal.textContent = String(Math.round(qDur * 1000)) + ' ms'; refreshConductionPanel(); saveEcgWaveformSettings(); };
  qdurInput.style.flex = '1';
  const qdurVal = document.createElement('div'); qdurVal.textContent = String(Math.round(qDur * 1000)) + ' ms'; qdurVal.style.width = '56px'; qdurVal.style.textAlign = 'right';
  qdurRow.appendChild(qdurInput); qdurRow.appendChild(qdurVal); globalPanel.appendChild(qdurRow);

  // R duration slider (seconds)
  const rdurRow = document.createElement('div');
  rdurRow.style.display = 'flex'; rdurRow.style.alignItems = 'center'; rdurRow.style.gap = '8px';
  const rdurInput = document.createElement('input');
  rdurInput.type = 'range'; rdurInput.min = '0.003'; rdurInput.max = '0.06'; rdurInput.step = '0.001'; rdurInput.value = String(rDur);
  rdurInput.oninput = (e) => { rDur = Number(e.target.value); rdurVal.textContent = String(Math.round(rDur * 1000)) + ' ms'; refreshConductionPanel(); saveEcgWaveformSettings(); };
  rdurInput.style.flex = '1';
  const rdurVal = document.createElement('div'); rdurVal.textContent = String(Math.round(rDur * 1000)) + ' ms'; rdurVal.style.width = '56px'; rdurVal.style.textAlign = 'right';
  rdurRow.appendChild(rdurInput); rdurRow.appendChild(rdurVal); globalPanel.appendChild(rdurRow);

  // S duration slider (seconds)
  const sdurRow = document.createElement('div');
  sdurRow.style.display = 'flex'; sdurRow.style.alignItems = 'center'; sdurRow.style.gap = '8px';
  const sdurInput = document.createElement('input');
  sdurInput.type = 'range'; sdurInput.min = '0.005'; sdurInput.max = '0.12'; sdurInput.step = '0.001'; sdurInput.value = String(sDur);
  sdurInput.oninput = (e) => { sDur = Number(e.target.value); sdurVal.textContent = String(Math.round(sDur * 1000)) + ' ms'; refreshConductionPanel(); saveEcgWaveformSettings(); };
  sdurInput.style.flex = '1';
  const sdurVal = document.createElement('div'); sdurVal.textContent = String(Math.round(sDur * 1000)) + ' ms'; sdurVal.style.width = '56px'; sdurVal.style.textAlign = 'right';
  sdurRow.appendChild(sdurInput); sdurRow.appendChild(sdurVal); globalPanel.appendChild(sdurRow);

  // P duration slider (seconds)
  const pdurRow = document.createElement('div');
  pdurRow.style.display = 'flex'; pdurRow.style.alignItems = 'center'; pdurRow.style.gap = '8px';
  const pdurInput = document.createElement('input');
  pdurInput.type = 'range'; pdurInput.min = '0.01'; pdurInput.max = '0.20'; pdurInput.step = '0.005'; pdurInput.value = String(pDuration);
  pdurInput.id = 'pdurInput';
  pdurInput.oninput = (e) => { pDuration = Number(e.target.value); pdurVal.textContent = String(Math.round(pDuration * 1000)) + ' ms'; refreshConductionPanel(); saveEcgWaveformSettings(); };
  pdurInput.style.flex = '1';
  const pdurVal = document.createElement('div'); pdurVal.textContent = String(Math.round(pDuration * 1000)) + ' ms'; pdurVal.style.width = '56px'; pdurVal.style.textAlign = 'right';
  const pdurLab = document.createElement('div'); pdurLab.textContent = 'P'; pdurLab.style.width = '18px'; pdurRow.appendChild(pdurLab);
  pdurRow.appendChild(pdurInput); pdurRow.appendChild(pdurVal); globalPanel.appendChild(pdurRow);

  

  // Heart rate slider (bpm)
  const hrRow = document.createElement('div');
  hrRow.style.display = 'flex'; hrRow.style.alignItems = 'center'; hrRow.style.gap = '8px';
  const hrInput = document.createElement('input');
  hrInput.type = 'range'; hrInput.min = '30'; hrInput.max = '180'; hrInput.step = '1'; hrInput.value = String(heartRate || 70);
  hrInput.style.flex = '1';
  const hrVal = document.createElement('div'); hrVal.textContent = String(Math.round(heartRate || 70)) + ' bpm'; hrVal.style.width = '80px'; hrVal.style.textAlign = 'right';
  const hrLab = document.createElement('div'); hrLab.textContent = 'HR'; hrLab.style.width = '18px';
  hrInput.oninput = (e) => { heartRate = Number(e.target.value) || 60; hrVal.textContent = String(Math.round(heartRate)) + ' bpm'; refreshConductionPanel(); saveEcgWaveformSettings(); };
  hrRow.appendChild(hrLab); hrRow.appendChild(hrInput); hrRow.appendChild(hrVal); globalPanel.appendChild(hrRow);

  // Global amplitude sliders for P/Q/R/S/T
  function addAmpRow(label, min, max, step, initial, oninput) {
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
    const lab = document.createElement('div'); lab.textContent = label; lab.style.width = '18px'; row.appendChild(lab);
    const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(initial); input.style.flex = '1';
    const val = document.createElement('div'); val.textContent = (typeof initial === 'number' ? initial.toFixed(2) : String(initial)); val.style.width = '48px'; val.style.textAlign = 'right';
    input.oninput = (e) => { const num = Number(e.target.value); val.textContent = num.toFixed(2); oninput(num); saveEcgWaveformSettings(); };
    row.appendChild(input); row.appendChild(val); globalPanel.appendChild(row);
    return {input, val, row};
  }

  addAmpRow('P', -3.0, 3.0, 0.01, gP, (v) => { gP = v; });
  addAmpRow('Q', -5.0, 5.0, 0.01, gQ, (v) => { gQ = v; });
  addAmpRow('R', -5.0, 5.0, 0.01, gR, (v) => { gR = v; });
  addAmpRow('S', -5.0, 5.0, 0.01, gS, (v) => { gS = v; });
  addAmpRow('T', -5.0, 5.0, 0.01, gT, (v) => { gT = v; });

  // PR interval (seconds) and QT interval (ms) controls
  // T duration slider (seconds)
  const tdurRow = document.createElement('div');
  tdurRow.style.display = 'flex'; tdurRow.style.alignItems = 'center'; tdurRow.style.gap = '8px';
  const tdurInput = document.createElement('input');
  tdurInput.type = 'range'; tdurInput.min = '0.02'; tdurInput.max = '0.50'; tdurInput.step = '0.01'; tdurInput.value = String(tDuration);
  tdurInput.oninput = (e) => { tDuration = Number(e.target.value); tdurVal.textContent = String(Math.round(tDuration * 1000)) + ' ms'; refreshConductionPanel(); };
  tdurInput.style.flex = '1';
  const tdurVal = document.createElement('div'); tdurVal.textContent = String(Math.round(tDuration * 1000)) + ' ms'; tdurVal.style.width = '56px'; tdurVal.style.textAlign = 'right';
  const tdurLab = document.createElement('div'); tdurLab.textContent = 'T'; tdurLab.style.width = '18px'; tdurRow.appendChild(tdurLab);
  tdurRow.appendChild(tdurInput); tdurRow.appendChild(tdurVal); globalPanel.appendChild(tdurRow);

  // ST elevation/depression slider (signal units)
  const stRow = document.createElement('div');
  stRow.style.display = 'flex'; stRow.style.alignItems = 'center'; stRow.style.gap = '8px';
  const stInput = document.createElement('input');
  stInput.type = 'range'; stInput.min = '-1.0'; stInput.max = '1.0'; stInput.step = '0.01'; stInput.value = String(stOffset);
  stInput.id = 'stInput';
  stInput.style.flex = '1';
  const stVal = document.createElement('div'); stVal.textContent = String((stOffset || 0).toFixed(2)); stVal.style.width = '56px'; stVal.style.textAlign = 'right';
  const stLab = document.createElement('div'); stLab.textContent = 'ST'; stLab.style.width = '18px';
  stInput.oninput = (e) => { stOffset = Number(e.target.value) || 0; stVal.textContent = stOffset.toFixed(2); refreshConductionPanel(); saveEcgWaveformSettings(); };
  stRow.appendChild(stLab); stRow.appendChild(stInput); stRow.appendChild(stVal); globalPanel.appendChild(stRow);

  // ST window start/end (ms relative to QRS R-peak). These define WHERE the
  // ST plateau sits along the beat. The ischemia curve can override per
  // breakpoint; these sliders are the baseline.
  const stStartRow = document.createElement('div');
  stStartRow.style.display = 'flex'; stStartRow.style.alignItems = 'center'; stStartRow.style.gap = '8px';
  const stStartInput = document.createElement('input');
  stStartInput.type = 'range'; stStartInput.min = '-20'; stStartInput.max = '300'; stStartInput.step = '1'; stStartInput.value = String(stStartMs);
  stStartInput.id = 'stStartInput'; stStartInput.style.flex = '1';
  stStartInput.title = 'Start of the ST plateau, in ms relative to the QRS R-peak';
  const stStartVal = document.createElement('div'); stStartVal.textContent = String(Math.round(stStartMs)) + ' ms'; stStartVal.style.width = '56px'; stStartVal.style.textAlign = 'right';
  const stStartLab = document.createElement('div'); stStartLab.textContent = 'ST start'; stStartLab.style.width = '56px'; stStartLab.style.fontSize = '11px';
  stStartInput.oninput = (e) => {
    let v = Number(e.target.value) || 0;
    if (v >= stEndMs - 5) v = stEndMs - 5;
    stStartMs = v; stStartInput.value = String(v); stStartVal.textContent = String(Math.round(v)) + ' ms';
    refreshConductionPanel(); saveEcgWaveformSettings();
  };
  stStartRow.appendChild(stStartLab); stStartRow.appendChild(stStartInput); stStartRow.appendChild(stStartVal);
  globalPanel.appendChild(stStartRow);

  const stEndRow = document.createElement('div');
  stEndRow.style.display = 'flex'; stEndRow.style.alignItems = 'center'; stEndRow.style.gap = '8px';
  const stEndInput = document.createElement('input');
  stEndInput.type = 'range'; stEndInput.min = '0'; stEndInput.max = '400'; stEndInput.step = '1'; stEndInput.value = String(stEndMs);
  stEndInput.id = 'stEndInput'; stEndInput.style.flex = '1';
  stEndInput.title = 'End of the ST plateau, in ms relative to the QRS R-peak';
  const stEndVal = document.createElement('div'); stEndVal.textContent = String(Math.round(stEndMs)) + ' ms'; stEndVal.style.width = '56px'; stEndVal.style.textAlign = 'right';
  const stEndLab = document.createElement('div'); stEndLab.textContent = 'ST end'; stEndLab.style.width = '56px'; stEndLab.style.fontSize = '11px';
  stEndInput.oninput = (e) => {
    let v = Number(e.target.value) || 0;
    if (v <= stStartMs + 5) v = stStartMs + 5;
    stEndMs = v; stEndInput.value = String(v); stEndVal.textContent = String(Math.round(v)) + ' ms';
    refreshConductionPanel(); saveEcgWaveformSettings();
  };
  stEndRow.appendChild(stEndLab); stEndRow.appendChild(stEndInput); stEndRow.appendChild(stEndVal);
  globalPanel.appendChild(stEndRow);

  const prRow = document.createElement('div'); prRow.style.display = 'flex'; prRow.style.alignItems = 'center'; prRow.style.gap = '8px';
  const prInput = document.createElement('input'); prInput.type = 'range'; prInput.min = '0.06'; prInput.max = '0.30'; prInput.step = '0.005'; prInput.value = String(prDur);
  prInput.id = 'prInput';
  prInput.style.flex = '1'; const prVal = document.createElement('div'); prVal.textContent = String(Math.round(prDur * 1000)) + ' ms'; prVal.style.width = '56px'; prVal.style.textAlign = 'right';
  prInput.oninput = (e) => { prDur = Number(e.target.value); prVal.textContent = String(Math.round(prDur * 1000)) + ' ms'; refreshConductionPanel(); saveEcgWaveformSettings(); };
  const prLab = document.createElement('div'); prLab.textContent = 'PR'; prLab.style.width = '18px'; prRow.appendChild(prLab); prRow.appendChild(prInput); prRow.appendChild(prVal); globalPanel.appendChild(prRow);

  const qtRow = document.createElement('div'); qtRow.style.display = 'flex'; qtRow.style.alignItems = 'center'; qtRow.style.gap = '8px';
  const qtInput = document.createElement('input'); qtInput.type = 'range'; qtInput.min = '200'; qtInput.max = '600'; qtInput.step = '1'; qtInput.value = String(qtIntervalMs);
  qtInput.style.flex = '1'; const qtVal = document.createElement('div'); qtVal.textContent = String(qtIntervalMs); qtVal.style.width = '56px'; qtVal.style.textAlign = 'right';
  qtInput.oninput = (e) => { qtIntervalMs = Number(e.target.value); qtVal.textContent = String(qtIntervalMs); refreshConductionPanel(); saveEcgWaveformSettings(); };
  const qtLab = document.createElement('div'); qtLab.textContent = 'QTms'; qtLab.style.width = '18px'; qtRow.appendChild(qtLab); qtRow.appendChild(qtInput); qtRow.appendChild(qtVal); globalPanel.appendChild(qtRow);

  // Time dilation slider (affects ECG/playback speed)
  const tdRow = document.createElement('div'); tdRow.style.display = 'flex'; tdRow.style.alignItems = 'center'; tdRow.style.gap = '8px';
  const tdLabel = document.createElement('div'); tdLabel.textContent = 'Time dilation'; tdLabel.style.width = '90px';
  const tdInput = document.createElement('input'); tdInput.type = 'range'; tdInput.min = '0.2'; tdInput.max = '10.0'; tdInput.step = '0.05'; tdInput.value = String(timeDilation); tdInput.style.flex = '1';
  tdInput.id = 'timeDilationInput';
  const tdVal = document.createElement('div'); tdVal.textContent = String(timeDilation.toFixed(2)); tdVal.style.width = '56px'; tdVal.style.textAlign = 'right';
  tdVal.id = 'timeDilationVal';
  tdRow.id = 'timeDilationRow';
  tdInput.oninput = (e) => { timeDilation = Number(e.target.value) || 1.0; tdVal.textContent = timeDilation.toFixed(2); saveTimeDilation(); refreshConductionPanel(); };
  tdRow.appendChild(tdLabel); tdRow.appendChild(tdInput); tdRow.appendChild(tdVal); globalPanel.appendChild(tdRow);
  // ECG horizontal shift slider
  const shiftRow = document.createElement('div'); shiftRow.style.display='flex'; shiftRow.style.alignItems='center'; shiftRow.style.gap='8px'; shiftRow.style.marginTop='6px';
  const shiftLab = document.createElement('div'); shiftLab.textContent = 'ECG shift'; shiftLab.style.width = '90px';
  const shiftInput = document.createElement('input'); shiftInput.type = 'range'; shiftInput.min = '-0.3'; shiftInput.max = '0.3'; shiftInput.step = '0.005'; shiftInput.value = String(ecgWaveShift || 0); shiftInput.style.flex = '1';
  const shiftVal = document.createElement('div'); shiftVal.textContent = String(((ecgWaveShift||0)*1000).toFixed(0)) + ' ms'; shiftVal.style.width = '56px'; shiftVal.style.textAlign = 'right';
  shiftInput.oninput = (e) => { ecgWaveShift = Number(e.target.value) || 0; shiftVal.textContent = String(Math.round(ecgWaveShift*1000)) + ' ms'; saveEcgWaveformSettings(); };
  shiftRow.appendChild(shiftLab); shiftRow.appendChild(shiftInput); shiftRow.appendChild(shiftVal); globalPanel.appendChild(shiftRow);
  // Conduction density scale slider
  const densRow = document.createElement('div'); densRow.style.display='flex'; densRow.style.alignItems='center'; densRow.style.gap='8px'; densRow.style.marginTop='6px';
  const densLab = document.createElement('div'); densLab.textContent = 'Conduction density'; densLab.style.width = '90px';
  const densInput = document.createElement('input'); densInput.type = 'range'; densInput.min = '0.2'; densInput.max = '5.0'; densInput.step = '0.05'; densInput.value = String(conductionDensityScale || 1.0); densInput.style.flex = '1';
  const densVal = document.createElement('div'); densVal.textContent = 'x' + (conductionDensityScale || 1.0).toFixed(2); densVal.style.width = '56px'; densVal.style.textAlign = 'right';
  densInput.oninput = (e) => { conductionDensityScale = Number(e.target.value) || 1.0; densVal.textContent = 'x' + conductionDensityScale.toFixed(2); };
  densRow.appendChild(densLab); densRow.appendChild(densInput); densRow.appendChild(densVal); globalPanel.appendChild(densRow);
    // Overlay dilation toggle
    const ovRow = document.createElement('div'); ovRow.style.display='flex'; ovRow.style.alignItems='center'; ovRow.style.gap='8px'; ovRow.style.marginTop='6px';
    const ovLabel = document.createElement('div'); ovLabel.textContent = 'Overlay uses dilation'; ovLabel.style.width = '140px';
    const ovChk = document.createElement('input'); ovChk.type = 'checkbox'; ovChk.checked = !!overlayUsesDilation; ovChk.onchange = (e) => { overlayUsesDilation = !!e.target.checked; saveEcgWaveformSettings(); };
    ovRow.appendChild(ovLabel); ovRow.appendChild(ovChk); globalPanel.appendChild(ovRow);
    // Button to toggle visibility of the conduction overlay on the ECG/CCS
    try {
      const overlayToggleBtn = document.createElement('button');
      const setOverlayBtnText = () => { overlayToggleBtn.textContent = showConductionOverlay ? 'Hide Overlay' : 'Show Overlay'; };
      setOverlayBtnText();
      overlayToggleBtn.style.marginLeft = '8px';
      overlayToggleBtn.style.padding = '6px 8px';
      overlayToggleBtn.onclick = () => {
        showConductionOverlay = !showConductionOverlay;
        setOverlayBtnText();
        saveEcgWaveformSettings();
        try { refreshConductionPanel(); } catch (e) {}
      };
      ovRow.appendChild(overlayToggleBtn);
    } catch (e) { /* ignore */ }
  // Reset time dilation to 1 (user requested) and persist immediately
  try {
    timeDilation = 1.0;
    saveTimeDilation();
    try { tdInput.value = String(timeDilation); } catch (e) {}
    try { tdVal.textContent = String(timeDilation.toFixed(2)); } catch (e) {}
  } catch (e) {}

  // MS counter and Pause/Resume controls for ECG and Conduction
  try {
    const msRow = document.createElement('div'); msRow.style.display = 'flex'; msRow.style.alignItems = 'center'; msRow.style.gap = '8px'; msRow.style.marginTop = '6px';
    const msCounter = document.createElement('div'); msCounter.textContent = 'ms since P: -'; msCounter.style.minWidth = '140px'; msCounter.style.fontSize = '13px'; msRow.appendChild(msCounter);
    const gameMsCounter = document.createElement('div'); gameMsCounter.textContent = 'game ms since P: -'; gameMsCounter.style.minWidth = '160px'; gameMsCounter.style.fontSize = '13px'; gameMsCounter.style.marginLeft = '6px'; msRow.appendChild(gameMsCounter);
    const ecgPauseBtn = document.createElement('button'); ecgPauseBtn.textContent = pausedEcg ? 'Resume ECG' : 'Pause ECG';
    ecgPauseBtn.onclick = () => {
      if (!pausedEcg) {
        ecgPausedAtMs = millis() - ecgTimeOffsetMs;
        pausedEcg = true;
      } else {
        pausedEcg = false;
        ecgTimeOffsetMs = millis() - ecgPausedAtMs;
      }
      ecgPauseBtn.textContent = pausedEcg ? 'Resume ECG' : 'Pause ECG';
    };
    msRow.appendChild(ecgPauseBtn);

    const conductionPauseBtn = document.createElement('button'); conductionPauseBtn.textContent = pausedConduction ? 'Resume Conduction' : 'Pause Conduction';
    conductionPauseBtn.onclick = () => {
      if (!pausedConduction) {
        conductionPausedAtMs = millis() - conductionTimeOffsetMs;
        pausedConduction = true;
      } else {
        pausedConduction = false;
        conductionTimeOffsetMs = millis() - conductionPausedAtMs;
      }
      conductionPauseBtn.textContent = pausedConduction ? 'Resume Conduction' : 'Pause Conduction';
    };
    msRow.appendChild(conductionPauseBtn);

    // Button to pause/resume BOTH ECG and Conduction simultaneously
    const pauseBothBtn = document.createElement('button'); pauseBothBtn.textContent = (pausedEcg && pausedConduction) ? 'Resume Both' : 'Pause Both';
    pauseBothBtn.title = 'Pause or resume both ECG and Conduction together';
    pauseBothBtn.onclick = () => {
      const goingToPause = !(pausedEcg && pausedConduction);
      if (goingToPause) {
        // pause both: capture paused timestamps
        ecgPausedAtMs = millis() - ecgTimeOffsetMs;
        conductionPausedAtMs = millis() - conductionTimeOffsetMs;
        pausedEcg = true; pausedConduction = true;
      } else {
        // resume both: restore offsets so timeline continues
        pausedEcg = false; pausedConduction = false;
        ecgTimeOffsetMs = millis() - ecgPausedAtMs;
        conductionTimeOffsetMs = millis() - conductionPausedAtMs;
      }
      // update labels for individual buttons
      try { ecgPauseBtn.textContent = pausedEcg ? 'Resume ECG' : 'Pause ECG'; } catch (e) {}
      try { conductionPauseBtn.textContent = pausedConduction ? 'Resume Conduction' : 'Pause Conduction'; } catch (e) {}
      pauseBothBtn.textContent = (pausedEcg && pausedConduction) ? 'Resume Both' : 'Pause Both';
    };
    msRow.appendChild(pauseBothBtn);

    // expose for draw() updates
    globalPanel._ecgMsCounter = msCounter;
    globalPanel._ecgGameMsCounter = gameMsCounter;
    globalPanel._ecgPauseBtn = ecgPauseBtn;
    globalPanel._conductionPauseBtn = conductionPauseBtn;
    // debug display for P placement
    const pDebug = document.createElement('div'); pDebug.style.fontSize = '12px'; pDebug.style.marginLeft = '8px'; pDebug.textContent = '';
    globalPanel._pDebug = pDebug;
    msRow.appendChild(pDebug);
    globalControlPanel = globalPanel;
    globalPanel.appendChild(msRow);
  } catch (e) { /* ignore UI creation errors */ }

  // Prefer to host the global ECG waveform controls inside the conduction
  // constructor panel so all related settings live together. If the
  // constructor panel exists, append into it; otherwise fall back to body.
  try {
    if (conductionPanelDiv) {
      // Adjust positioning for embedding inside the panel
      globalPanel.style.position = '';
      globalPanel.style.left = '';
      globalPanel.style.top = '';
      globalPanel.style.margin = '8px';
      // Ensure the panel is visible (open) so users see the controls
      conductionPanelDiv.style.display = '';
      conductionPanelDiv.appendChild(globalPanel);
    } else {
      document.body.appendChild(globalPanel);
    }
  } catch (e) { document.body.appendChild(globalPanel); }
  // (Time Dilation control moved into the Global panel; inline control removed)
  // Debug UI and popup removed per user request.

  // create BroadcastChannel for controls
  try {
    bc = new BroadcastChannel('ecg-controls');
    bc.onmessage = (ev) => {
      const msg = ev.data || {};
      if (!msg.type) return;
      if (msg.type === 'setHeartRate') {
        if (typeof msg.payload === 'number') heartRate = msg.payload;
        else if (msg.payload && typeof msg.payload.value === 'number') heartRate = msg.payload.value;
      } else if (msg.type === 'setZoneIschemia') {
        const p = msg.payload || {};
        if (typeof p.zone === 'string' && typeof p.value === 'number') {
          if (p.zone in zoneIschemia) zoneIschemia[p.zone] = constrain(p.value, 0, 100);
        }
      } else if (msg.type === 'setReciprocal') {
          if (typeof msg.payload === 'number') reciprocalPercent = constrain(msg.payload, 0, 100);
          else if (msg.payload && typeof msg.payload.value === 'number') reciprocalPercent = constrain(msg.payload.value, 0, 100);
        } else if (msg.type === 'requestState') {
          // respond with minimal state
          bc.postMessage({ type: 'state', payload: { heartRate, zoneIschemia, leadParams, reciprocal: reciprocalPercent } });
        }
    };
  } catch (e) {
    console.warn('BroadcastChannel not available', e);
    bc = null;
  }

  // load persisted values (if any) before creating controls
  loadTimeDilation();
  loadLeadParams();

  // After all sliders are created, update their values to match loaded settings and ensure changes are saved
  const sliderMap = [
    { id: 'qrsInput', var: 'qrsWidth' },
    { id: 'qdurInput', var: 'qDur' },
    { id: 'rdurInput', var: 'rDur' },
    { id: 'sdurInput', var: 'sDur' },
    { id: 'pdurInput', var: 'pDuration' },
    { id: 'hrInput', var: 'heartRate' },
    { id: 'tdurInput', var: 'tDuration' },
    { id: 'prInput', var: 'prDur' },
    { id: 'qtInput', var: 'qtIntervalMs' }
  ];
  setTimeout(() => {
    sliderMap.forEach(({id, var: v}) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = String(window[v]);
        el.addEventListener('input', () => {
          window[v] = el.type === 'range' ? parseFloat(el.value) : el.value;
          saveEcgWaveformSettings();
        });
      }
    });
  }, 0);
  // load persisted conduction items so the panel is populated on startup
  try {
    loadConductionItems();
    if (conductionItems && conductionItems.length > 0) selectedConductionIndex = 0;
    try { loadConductionExplicitSteps(); } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn('Failed to load conduction items at startup', e);
  }

  // Ensure aVR (flat index 3) has inverted P and T by default
  // Set to negative absolute value so loading saved positives still results in inversion.
  const aVRIndex = 3;
  if (leadParams[aVRIndex]) {
    leadParams[aVRIndex].p = -Math.abs(leadParams[aVRIndex].p || 1.0);
    leadParams[aVRIndex].t = -Math.abs(leadParams[aVRIndex].t || 1.0);
    // persist this default inversion
    saveLeadParams();
  }

  // create individual control divs (one per lead) but don't position them yet
  const labelsFlat = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'];
  for (let i = 0; i < 12; i++) {
    const cd = document.createElement('div');
    cd.style.position = 'absolute';
    cd.style.pointerEvents = 'auto';
    cd.style.background = 'rgba(255,255,255,0.96)';
    cd.style.border = '1px solid rgba(0,0,0,0.12)';
    cd.style.borderRadius = '6px';
    cd.style.padding = '6px';
    cd.style.fontSize = '11px';
    cd.style.width = '140px';
    cd.style.boxSizing = 'border-box';
    cd.style.zIndex = 10001;

    const title = document.createElement('div');
    title.textContent = labelsFlat[i];
    title.style.fontWeight = '600';
    title.style.marginBottom = '4px';
    cd.appendChild(title);

    // helper to add a small range row
    function addSmallRange(parent, labelText, min, max, step, initial, oninput) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';

      const lab = document.createElement('div');
      lab.textContent = labelText;
      lab.style.width = '18px';
      row.appendChild(lab);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(initial);
      input.style.flex = '1';
      input.oninput = (e) => {
        const num = Number(e.target.value);
        val.textContent = num.toFixed(2);
        oninput(num);
        // persist current lead params as the new defaults
        saveLeadParams();
      };
      row.appendChild(input);

      const val = document.createElement('div');
      val.textContent = String(initial.toFixed ? initial.toFixed(2) : initial);
      val.style.width = '36px';
      val.style.textAlign = 'right';
      row.appendChild(val);

      parent.appendChild(row);
      return {input, val, row};
    }

  // P, Q, R, S, T multipliers (allow negative P/T to model inversions)
  addSmallRange(cd, 'P', -2.0, 2.0, 0.01, leadParams[i].p, (v) => leadParams[i].p = v);
  addSmallRange(cd, 'Q', -3.0, 3.0, 0.01, leadParams[i].q, (v) => leadParams[i].q = v);
  addSmallRange(cd, 'R', -3.0, 3.0, 0.01, leadParams[i].r, (v) => leadParams[i].r = v);
  addSmallRange(cd, 'S', -3.0, 3.0, 0.01, leadParams[i].s, (v) => leadParams[i].s = v);
  // Allow negative T multiplier so aVR inversion can be represented
  addSmallRange(cd, 'T', -3.0, 3.0, 0.01, leadParams[i].t, (v) => leadParams[i].t = v);

    leadControlsDiv.appendChild(cd);
    leadControlDivs.push(cd);
  }

  // create ecg offscreen buffer for single-lead right half rendering
  if (ecgG) ecgG.remove();
  ecgG = createGraphics(Math.floor(windowWidth / 2), windowHeight);
  try { if (typeof ecgG.pixelDensity === 'function') ecgG.pixelDensity(window._ecg_dpr || 1); } catch (e) {}
  try { if (ecgG.drawingContext && 'imageSmoothingEnabled' in ecgG.drawingContext) ecgG.drawingContext.imageSmoothingEnabled = false; } catch (e) {}

  // load persisted conduction items then create conduction panel UI
  try { loadConductionItems(); } catch (e) { /* ignore */ }
  try { loadConductionExplicitSteps(); } catch (e) { /* ignore */ }
  try { loadEcgTriggering(); } catch (e) { /* ignore */ }
  try { createConductionPanel(); } catch (e) { console.warn('Failed to create conduction panel', e); }
  // briefly highlight the conduction panel so the user can locate it
  try { setTimeout(() => { highlightConductionPanel(4000); }, 150); } catch (e) {}
  // Create compact Basic view panel (default) exposing only: preset select,
  // sequence select, and time dilation. Advanced full UI remains available
  // via the "Advanced" toggle button.
  try {
    // small basic panel
    const basicPanel = document.createElement('div');
    basicPanel.id = 'basicPanel';
    basicPanel.style.position = 'fixed';
    basicPanel.style.top = '10px';
    basicPanel.style.right = '10px';
    basicPanel.style.zIndex = 10005;
    basicPanel.style.padding = '8px';
    basicPanel.style.background = 'rgba(255,255,255,0.96)';
    basicPanel.style.border = '1px solid rgba(0,0,0,0.12)';
    basicPanel.style.borderRadius = '6px';
    basicPanel.style.fontFamily = 'Helvetica, Arial, sans-serif';
    basicPanel.style.fontSize = '13px';

    const bpTitle = document.createElement('div'); bpTitle.textContent = 'Basic View'; bpTitle.style.fontWeight = '600'; bpTitle.style.marginBottom = '6px'; basicPanel.appendChild(bpTitle);

    // Preset select (compact copy)
    const basicPresetRow = document.createElement('div'); basicPresetRow.style.display = 'flex'; basicPresetRow.style.gap = '6px'; basicPresetRow.style.alignItems = 'center';
    const basicPreset = document.createElement('select'); basicPreset.id = 'basicPresetSelect'; basicPreset.style.minWidth = '160px';
    const basicLoadPreset = document.createElement('button'); basicLoadPreset.textContent = 'Load'; basicLoadPreset.onclick = () => { const v = basicPreset.value; if (!v) { alert('Select a preset'); return; } if (confirm('Load preset "' + v + '"? This will overwrite current settings.')) { if (loadNamedPreset(v)) { alert('Loaded preset: ' + v); } else alert('Failed to load preset: ' + v); } };
    basicPresetRow.appendChild(basicPreset); basicPresetRow.appendChild(basicLoadPreset); basicPanel.appendChild(basicPresetRow);

    // Sequence select (compact copy)
    const basicSeqRow = document.createElement('div'); basicSeqRow.style.display = 'flex'; basicSeqRow.style.gap = '6px'; basicSeqRow.style.alignItems = 'center'; basicSeqRow.style.marginTop = '6px';
    const basicSeq = document.createElement('select'); basicSeq.id = 'basicSequenceSelect'; basicSeq.style.minWidth = '160px';
    const basicLoadSeq = document.createElement('button'); basicLoadSeq.textContent = 'Load Seq'; basicLoadSeq.onclick = () => { const v = basicSeq.value; if (!v) { alert('Select a sequence'); return; } if (confirm('Load sequence "' + v + '"? This will replace the current sequence.')) { if (loadNamedSequence(v)) { alert('Loaded sequence: ' + v); refreshPresetSequenceUI(); } else alert('Failed to load sequence: ' + v); } };
    const basicPlaySeq = document.createElement('button'); basicPlaySeq.textContent = 'Play Sequence'; basicPlaySeq.id = 'basicPlaySeqBtn'; basicPlaySeq.style.marginLeft = '4px';
    basicPlaySeq.onclick = () => {
      try {
        if (!presetSequencePlaying) {
          // ensure sequence loops automatically when started from Basic
          presetSequenceLoop = true;
          // if no sequence selected, warn
          if (!presetSequence || presetSequence.length === 0) {
            if (basicSeq && basicSeq.value) {
              // try to load named sequence from select
              loadNamedSequence(basicSeq.value);
            }
          }
          startPresetSequence();
          basicPlaySeq.textContent = 'Pause Sequence';
        } else {
          stopPresetSequence();
          basicPlaySeq.textContent = 'Play Sequence';
        }
      } catch (e) { console.warn('basic play sequence failed', e); }
    };
    basicSeqRow.appendChild(basicSeq); basicSeqRow.appendChild(basicLoadSeq); basicSeqRow.appendChild(basicPlaySeq); basicPanel.appendChild(basicSeqRow);

    // Time dilation (compact, synced)
    const basicTdRow = document.createElement('div'); basicTdRow.style.display='flex'; basicTdRow.style.alignItems='center'; basicTdRow.style.gap='8px'; basicTdRow.style.marginTop='6px';
    const basicTdLab = document.createElement('div'); basicTdLab.textContent = 'Time dilation'; basicTdLab.style.width = '90px';
    const basicTdInput = document.createElement('input'); basicTdInput.type = 'range'; basicTdInput.min = '0.2'; basicTdInput.max = '10.0'; basicTdInput.step = '0.05'; basicTdInput.value = String(timeDilation); basicTdInput.style.flex = '1'; basicTdInput.id = 'basicTimeDilationInput';
    const basicTdVal = document.createElement('div'); basicTdVal.textContent = String(timeDilation.toFixed(2)); basicTdVal.style.width = '56px'; basicTdVal.style.textAlign = 'right'; basicTdVal.id = 'basicTimeDilationVal';
    basicTdInput.oninput = (e) => { const v = Number(e.target.value) || 1.0; timeDilation = v; basicTdVal.textContent = timeDilation.toFixed(2); saveTimeDilation(); refreshConductionPanel(); try { const orig = document.getElementById('timeDilationInput'); if (orig) orig.value = String(timeDilation); const origVal = document.getElementById('timeDilationVal'); if (origVal) origVal.textContent = timeDilation.toFixed(2); } catch (er) {} };
    basicTdRow.appendChild(basicTdLab); basicTdRow.appendChild(basicTdInput); basicTdRow.appendChild(basicTdVal); basicPanel.appendChild(basicTdRow);

    // Toggle to advanced/full UI
    const toggleRow = document.createElement('div'); toggleRow.style.display='flex'; toggleRow.style.justifyContent='flex-end'; toggleRow.style.marginTop='8px';
    const advBtn = document.createElement('button'); advBtn.textContent = 'Advanced'; advBtn.onclick = () => {
      // show advanced panels and hide basic panel
      try { if (conductionPanelDiv) conductionPanelDiv.style.display = ''; if (globalControlPanel) globalControlPanel.style.display = ''; basicPanel.style.display = 'none'; } catch (e) {}
    };
    toggleRow.appendChild(advBtn); basicPanel.appendChild(toggleRow);

    document.body.appendChild(basicPanel);

    // Default to Basic: hide the big construction/advanced panels
    try { if (conductionPanelDiv) conductionPanelDiv.style.display = 'none'; if (globalControlPanel) globalControlPanel.style.display = 'none'; } catch (e) {}

    // Helper to populate compact selects by mirroring the main selects
    function refreshBasicSelectors() {
      try {
        const srcPreset = document.getElementById('presetSelect'); const dstPreset = document.getElementById('basicPresetSelect');
        // Do not overwrite the select while the user is interacting with it
        if (srcPreset && dstPreset && document.activeElement !== dstPreset) {
          dstPreset.innerHTML = '';
          Array.from(srcPreset.options).forEach(o => { const no = document.createElement('option'); no.value = o.value; no.text = o.text; if (o.selected) no.selected = true; dstPreset.appendChild(no); });
        }
        const srcSeq = document.getElementById('sequenceSelect'); const dstSeq = document.getElementById('basicSequenceSelect');
        if (srcSeq && dstSeq && document.activeElement !== dstSeq) {
          dstSeq.innerHTML = '';
          Array.from(srcSeq.options).forEach(o => { const no = document.createElement('option'); no.value = o.value; no.text = o.text; if (o.selected) no.selected = true; dstSeq.appendChild(no); });
        }
      } catch (e) { /* ignore */ }
    }

    // keep basic selects in sync when presets/sequences are refreshed elsewhere
    setInterval(refreshBasicSelectors, 800);
    // keep play button label in sync with global state (in case sequence started elsewhere)
    setInterval(() => {
      try {
        const b = document.getElementById('basicPlaySeqBtn'); if (!b) return;
        b.textContent = presetSequencePlaying ? 'Pause Sequence' : 'Play Sequence';
        // disable play if there is no sequence available
        if (!presetSequence || presetSequence.length === 0) b.disabled = true; else b.disabled = false;
      } catch (e) {}
    }, 400);
    // also update on initial load
    setTimeout(refreshBasicSelectors, 200);
  } catch (e) { console.warn('Failed to create basic panel', e); }
  // load any previously active sequence so saved sequences persist across reloads
  try {
    // restore the active in-memory sequence (if present) and mark previews stale
    loadActiveSequence();
    // refresh UI selects so saved sequences/presets appear in the dropdowns
    try { refreshPresetSelectGlobal(); } catch (e) {}
    try { refreshSequenceSelectGlobal(); } catch (e) {}
    try { refreshPresetSequenceUI(); } catch (e) {}
  } catch (e) { /* ignore restore failures */ }

  // Attempt to open the conduction + waveform editor in its own window
  // automatically. Use a short timeout so page load isn't blocked; if
  // the browser blocks popups this will fail gracefully and the panel
  // remains embedded inline.
  // Automatic popout suppressed: user can open the Conduction panel
  // manually via the "Pop Out Constructor" button. This prevents the
  // panel from opening automatically on sketch start.

  // Listen for changes to ECG waveform constructor sliders and persist
  const persistWaveform = () => { saveEcgWaveformSettings(); };
  // QRS width
  const qrsInputEl = document.getElementById('qrsInput');
  if (qrsInputEl) {
    qrsInputEl.value = String(qrsWidth);
    qrsInputEl.addEventListener('input', () => {
      qrsWidth = Number(qrsInputEl.value);
      persistWaveform();
    });
  }
  // Q duration
  const qdurInputEl = document.getElementById('qdurInput');
  if (qdurInputEl) {
    qdurInputEl.value = String(qDur);
    qdurInputEl.addEventListener('input', () => {
      qDur = Number(qdurInputEl.value);
      persistWaveform();
    });
  }
  // R duration
  const rdurInputEl = document.getElementById('rdurInput');
  if (rdurInputEl) {
    rdurInputEl.value = String(rDur);
    rdurInputEl.addEventListener('input', () => {
      rDur = Number(rdurInputEl.value);
      persistWaveform();
    });
  }
  // S duration
  const sdurInputEl = document.getElementById('sdurInput');
  if (sdurInputEl) {
    sdurInputEl.value = String(sDur);
    sdurInputEl.addEventListener('input', () => {
      sDur = Number(sdurInputEl.value);
      persistWaveform();
    });
  }
  // Other sliders (P duration, HR, T duration, PR, QT)
  [
    'pdurInput','hrInput','tdurInput','prInput','qtInput','stInput'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', persistWaveform);
  });
}

function windowResized() {
  // preserve device-pixel alignment and disable smoothing after resize
  const dpr = window._ecg_dpr || (window.devicePixelRatio || 1);
  pixelDensity(dpr);
  resizeCanvas(windowWidth, windowHeight);
  try { drawingContext.imageSmoothingEnabled = false; } catch (e) {}
  // discard lead buffers so they will be recreated with correct sizes
  for (let i = 0; i < leadBuffers.length; i++) leadBuffers[i] = null;
  // recreate single-lead offscreen buffer
  if (ecgG) ecgG.remove();
  ecgG = createGraphics(Math.floor(windowWidth / 2), windowHeight);
  try { if (typeof ecgG.pixelDensity === 'function') ecgG.pixelDensity(window._ecg_dpr || 1); } catch (e) {}
  try { if (ecgG.drawingContext && 'imageSmoothingEnabled' in ecgG.drawingContext) ecgG.drawingContext.imageSmoothingEnabled = false; } catch (e) {}
  // clear any sequence preview buffers so they'll be recreated with new sizes
  try { if (Array.isArray(seqPreviewBuffers)) { seqPreviewBuffers.forEach(b => { try { if (b && b.remove) b.remove(); } catch (e) {} }); } seqPreviewBuffers = []; } catch (e) {}
}

function draw() {
  try {
    background(245);
    if (singleLeadView) {
      // Single-lead layout: CCS image on left half, ECG tracing on right half
      const halfW = Math.floor(width / 2);
      // In ischemia mode, reserve top portion of the left half for the
      // transverse vessel canvas (rendered as a DOM overlay above the p5
      // canvas). The heart image is shrunk to fit below the reserved strip.
      const vesselReservedTop = (appMode === 'ischemia') ? Math.floor(height * 0.32) : 0;
      // draw CCS image on left half, centered and scaled (or reserve left half if no image)
      push();
      imageMode(CORNER);
      const imgW = halfW;
      const imgH = Math.max(40, height - vesselReservedTop);
      let iw = imgW;
      let ih = imgH;
      let ix = 0;
      let iy = vesselReservedTop;
      if (ccsImg) {
        const s = Math.min(imgW / ccsImg.width, imgH / ccsImg.height);
        iw = ccsImg.width * s;
        ih = ccsImg.height * s;
        ix = Math.round((imgW - iw) / 2);
        iy = vesselReservedTop + Math.round((imgH - ih) / 2);
        image(ccsImg, ix, iy, iw, ih);
      } else {
        // draw placeholder rectangle for CCS area when image missing
        noFill(); stroke(200); rect(0, vesselReservedTop, imgW, imgH);
      }
      // draw any conduction overlays on top of CCS / placeholder (skipped in
      // ischemia mode — animations are suspended there)
      if (appMode !== 'ischemia') {
        try { drawConductionOverlay(ix, iy, iw, ih); } catch (e) { /* ignore overlay errors */ }
      }
      pop();

      // Render static PQRST waveform and moving indicator synced to heart rate and conduction
      if (ecgG) {
        ecgG.clear();
        // Draw grid
        ecgG.push();
        ecgG.background(255);
        ecgG.stroke(230);
        ecgG.strokeWeight(1);
        for (let x = 0; x < ecgG.width; x += 20) ecgG.line(x, 0, x, ecgG.height);
        for (let y = 0; y < ecgG.height; y += 20) ecgG.line(0, y, ecgG.width, y);
        ecgG.pop();

        // Draw scrolling PQRST waveform with stationary red indicator
        const padLeft = 40, padRight = 40, padTop = 40, padBottom = 40;
        const w = ecgG.width - padLeft - padRight;
        const h = ecgG.height - padTop - padBottom;
        const centerY = padTop + h / 2;
        const amplitude = h * 0.35;

        // Time references
        const beatPeriod = 60.0 / heartRate; // seconds per beat (ECG time)
        const nowMs = pausedEcg ? ecgPausedAtMs : (millis() - ecgTimeOffsetMs);
        // timeDilation slows playback: ECG seconds elapse slower than wall time
        const dilation = (typeof timeDilation === 'number' && timeDilation > 0) ? timeDilation : 1.0;
        const nowSec = (nowMs / 1000.0) / dilation;
        const userShift = (typeof ecgWaveShift === 'number') ? ecgWaveShift : 0;

        // Visible time window: show ~2 beats across the waveform area
        const beatsVisible = 2;
        const timeWindowSec = beatPeriod * beatsVisible;
        const pixelsPerSecond = w / timeWindowSec;

        // Stationary red indicator position. Place ~one QRS width to the
        // left of the previous 85% position so a small slice of upcoming
        // waveform (and the QRS itself) is fully visible to the right of
        // the indicator. ~one QRS width ≈ 0.10 s.
        const qrsWidthSec = 0.10;
        const indicatorOffsetFracFromRight = (qrsWidthSec / Math.max(0.001, timeWindowSec));
        const indicatorFrac = Math.max(0.05, Math.min(0.95, 0.85 - indicatorOffsetFracFromRight));
        const indicatorX = padLeft + Math.floor(w * indicatorFrac);

        // Time at any pixel x: t = nowSec + (x - indicatorX) / pixelsPerSecond + userShift
        // Solve for x at indicator: x = indicatorX -> t = nowSec + userShift
        const timeAtX = (x) => nowSec + (x - indicatorX) / pixelsPerSecond + userShift;
        const xAtTime = (t) => indicatorX + (t - nowSec - userShift) * pixelsPerSecond;

        // Visible beat times (centers of QRS at t = bt)
        const visibleStartT = timeAtX(padLeft) - 0.6;
        const visibleEndT = timeAtX(padLeft + w) + 0.6;
        const firstBeat = Math.floor(visibleStartT / beatPeriod) * beatPeriod;
        const beatTimes = [];
        for (let bt = firstBeat; bt < visibleEndT; bt += beatPeriod) beatTimes.push(bt);

        // --- Ischemia: derive effective T-wave scale and ST offset for the
        // currently displayed waveform. The single-lead path used to sample
        // singleBeatSignal() with the *baseline* tWaveScale/stOffset, so the
        // athero/thrombus/METs sliders had no visible effect on this view.
        // We now compute eff once per frame, publish ischemiaPercent for the
        // readout, and use eff.effT / eff.effST everywhere we sample the beat.
        let _ischT = tWaveScale;
        let _ischST = stOffset;
        let _ischStStartMs = stStartMs;
        let _ischStEndMs   = stEndMs;
        try {
          if (typeof computeIschemia === 'function' && typeof mapIschemiaToEff === 'function') {
            // Allow the Ischemia Curve editor to temporarily override the
            // displayed ischemia % while the user hovers over the curve, so
            // they can see the waveform at any pct in real time without
            // changing slider values.
            let _isch;
            if (typeof window._ischemiaPreviewPct === 'number' && isFinite(window._ischemiaPreviewPct)) {
              _isch = Math.max(0, Math.min(100, window._ischemiaPreviewPct));
            } else {
              _isch = computeIschemia(atheroPercent, METs, thrombusPercent);
            }
            ischemiaPercent = _isch;
            const _eff = mapIschemiaToEff(_isch);
            if (_eff && typeof _eff.effT === 'number') _ischT = _eff.effT;
            if (_eff && typeof _eff.effST === 'number') _ischST = _eff.effST;
            if (_eff && typeof _eff.effStStartMs === 'number') _ischStStartMs = _eff.effStStartMs;
            if (_eff && typeof _eff.effStEndMs   === 'number') _ischStEndMs   = _eff.effStEndMs;
            if (typeof ischemiaSpan !== 'undefined' && ischemiaSpan) ischemiaSpan.textContent = String(Math.round(ischemiaPercent));
            if (typeof ischemiaSlider !== 'undefined' && ischemiaSlider) ischemiaSlider.value = String(Math.round(ischemiaPercent));
          }
        } catch (e) { /* fall back to baseline */ }

        // Detect wave-feature offsets (relative to QRS center) using a template beat.
        // These move with whatever singleBeatSignal currently produces.
        let pStartOffset = null, pEndOffset = null;
        let qStartOffset = null, qEndOffset = null;
        let rStartOffset = null, rEndOffset = null;
        let sStartOffset = null, sEndOffset = null;
        let tStartOffset = null, tEndOffset = null;
        {
          const tplStart = -0.45, tplEnd = 0.65;
          const tplN = 440;
          let prev = null;
          let pPicked = false, qPicked = false, rPicked = false, sPicked = false, tPicked = false;
          for (let i = 0; i <= tplN; i++) {
            const tr = tplStart + (i / tplN) * (tplEnd - tplStart);
            const vv = singleBeatSignal(tr, tWaveScale, stOffset, {p:1,q:1,r:1,s:1,t:1});
            if (prev !== null) {
              if (!pPicked && prev <= 0.02 && vv > 0.02 && tr < -0.05) { pStartOffset = tr; pPicked = true; }
              else if (pPicked && pEndOffset === null && prev > 0.02 && vv <= 0.02 && tr < -0.02) { pEndOffset = tr; }
              if (!qPicked && prev > -0.02 && vv <= -0.02) { qStartOffset = tr; qPicked = true; }
              else if (qPicked && qEndOffset === null && prev <= -0.02 && vv > -0.02) { qEndOffset = tr; }
              if (!rPicked && qPicked && prev < 0.02 && vv >= 0.02) { rStartOffset = tr; rPicked = true; }
              else if (rPicked && rEndOffset === null && prev >= 0.02 && vv < 0.02) { rEndOffset = tr; }
              if (!sPicked && rPicked && prev > -0.02 && vv <= -0.02) { sStartOffset = tr; sPicked = true; }
              else if (sPicked && sEndOffset === null && prev <= -0.02 && vv > -0.02) { sEndOffset = tr; }
              if (!tPicked && sPicked && prev < 0.02 && vv >= 0.02) { tStartOffset = tr; tPicked = true; }
              else if (tPicked && tEndOffset === null && prev >= 0.02 && vv < 0.02) { tEndOffset = tr; }
            }
            prev = vv;
          }
          // Prefer duration-based P end when available
          if (pStartOffset !== null && typeof pDuration === 'number' && pDuration > 0) {
            pEndOffset = pStartOffset + pDuration;
          }
        }

        // Sequence runner: detect beat wrap by observing nowSec passing a beat boundary
        try {
          const currentBeatFrac = ((nowSec / beatPeriod) % 1 + 1) % 1;
          if (presetSequenceWaitingForEcgEnd && presetSequencePlaying) {
            if (currentBeatFrac < lastEcgBeatFrac) {
              presetSequenceWaitingForEcgEnd = false;
              presetSequenceIndex++;
              if (presetSequenceIndex >= presetSequence.length) {
                if (presetSequenceLoop) presetSequenceIndex = 0; else { stopPresetSequence(); }
              }
              if (presetSequencePlaying) {
                playCurrentAndScheduleNext();
              }
            }
          }
          lastEcgBeatFrac = currentBeatFrac;
        } catch (e) { /* ignore sequence timing errors */ }

        // Build sample points across the waveform region by summing visible beats.
        const points = [];
        for (let xi = 0; xi <= w; xi++) {
          const x = padLeft + xi;
          const t = timeAtX(x);
          let v = 0;
          for (let bt of beatTimes) v += singleBeatSignal(t - bt, _ischT, _ischST, {p:1,q:1,r:1,s:1,t:1}, { stStartMs: _ischStStartMs, stEndMs: _ischStEndMs });
          const y = centerY - v * amplitude;
          points.push({x, y, t});
        }

        ecgG.push();
        // Overlay: draw expected start/end intervals for conduction items bound to ECG events.
        // With scrolling, draw an overlay rect for each visible beat occurrence.
        if (showConductionOverlay) {
        try {
          const offsetForKey = (key) => {
            switch (key) {
              case 'P_start': return pStartOffset;
              case 'P_end': return pEndOffset;
              case 'Q_start': return qStartOffset;
              case 'R_start': return rStartOffset;
              case 'S_start': return sStartOffset;
              case 'T_start': return tStartOffset;
              default: return null;
            }
          };
          const overlays = [];
          const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
          for (let it of conductionItems) {
            if (!it) continue;
            if ((it.startMode || 'after_previous') !== 'on_ecg_event') continue;
            const ev = it.ecgEvent;
            if (!ev) continue;
            const off = offsetForKey(ev);
            if (typeof off !== 'number') continue;
            const durMs = computeItemEffectiveDurationMs(it, false) || 0;
            const durSec = durMs / 1000.0;
            const offsetMs = Number(it.startOffsetMs) || 0;
            const offsetSec = offsetMs / 1000.0;
            for (let bt of beatTimes) {
              const startT = bt + off + offsetSec;
              const endT = startT + durSec;
              const sx = clamp(Math.round(xAtTime(startT)), padLeft, padLeft + w);
              const ex = clamp(Math.round(xAtTime(endT)), padLeft, padLeft + w);
              if (ex <= sx) continue;
              overlays.push({ startX: sx, endX: ex, color: it.color || '#ff0000', label: it.name || it.id || '(item)' });
            }
          }

          if (overlays.length > 0) {
            overlays.sort((a,b) => a.startX - b.startX || (a.endX - b.endX));
            const maxTiers = Math.max(1, Math.min(6, Math.floor(h / 20)));
            const tierHeight = Math.max(12, Math.min(28, Math.floor(h / Math.max(1, maxTiers)) - 4));
            const gap = 6;
            const lastEnd = [];
            overlays.forEach(o => {
              let tier = 0;
              while (tier < lastEnd.length && !(o.startX > lastEnd[tier] + gap)) tier++;
              if (tier >= lastEnd.length) lastEnd.push(o.endX); else lastEnd[tier] = Math.max(lastEnd[tier], o.endX);
              o.tier = tier;
            });

            for (let o of overlays) {
              try {
                const rgb = hexToRgb(o.color || '#ff0000');
                const y = padTop + o.tier * (tierHeight + 4);
                const hrect = Math.min(tierHeight, Math.max(12, Math.floor(h - (y - padTop) - 4)));
                ecgG.noStroke();
                ecgG.fill(rgb.r, rgb.g, rgb.b, 48);
                ecgG.rect(o.startX, y, Math.max(2, o.endX - o.startX), hrect);
                ecgG.stroke(rgb.r, rgb.g, rgb.b);
                ecgG.strokeWeight(1);
                ecgG.line(o.startX, y, o.startX, y + hrect);
                ecgG.line(o.endX, y, o.endX, y + hrect);
                ecgG.noStroke(); ecgG.fill(0); ecgG.textSize(12);
                const tx = Math.max(o.startX + 4, Math.min(o.endX - 40, o.startX + 4));
                ecgG.text(o.label, tx, y + Math.min(14, Math.max(12, Math.round(hrect/2))));
              } catch (e) { /* ignore drawing errors */ }
            }
          }
        } catch (e) { /* overlay errors shouldn't break draw */ } }

        // Draw the waveform
        ecgG.stroke(0, 120, 0);
        ecgG.strokeWeight(3);
        ecgG.noFill();
        ecgG.beginShape();
        for (let pt of points) ecgG.vertex(pt.x, pt.y);
        ecgG.endShape();
        ecgG.pop();

        // Stationary red indicator line
        ecgG.push();
        ecgG.stroke(255, 0, 0);
        ecgG.strokeWeight(2);
        ecgG.line(indicatorX, padTop, indicatorX, ecgG.height - padBottom);
        ecgG.pop();

        // Debug log helper (kept for compatibility with debug popup)
        if (!window._waveCrossLog) window._waveCrossLog = [];
        function logWaveCross(wave, x) {
          const nowDt = new Date();
          window._waveCrossLog.push({wave, time: nowDt.toLocaleTimeString(), x: Math.round(x)});
          if (window.conductionDebugWindow && !window.conductionDebugWindow.closed) {
            try {
              const doc = window.conductionDebugWindow.document;
              let logDiv = doc.getElementById('waveCrossLog');
              if (!logDiv) {
                logDiv = doc.createElement('div');
                logDiv.id = 'waveCrossLog';
                doc.body.appendChild(logDiv);
              }
              let html = '<div style="font-weight:700;margin-bottom:4px">Wave Crossings</div>';
              for (let i = Math.max(0, window._waveCrossLog.length-20); i < window._waveCrossLog.length; i++) {
                const entry = window._waveCrossLog[i];
                html += `<div>${entry.time}: <b>${entry.wave}</b> at x=${entry.x}</div>`;
              }
              logDiv.innerHTML = html;
            } catch (e) {}
          }
        }

        // Wave-feature crossings: trigger when the waveform feature time
        // crosses the stationary indicator (i.e., feature absolute time
        // crosses nowSec + userShift between the previous frame and this one).
        const eventCrossings = [];
        const indicatorTime = nowSec + userShift;
        const prevIndicatorTime = (typeof window._lastIndicatorTime === 'number') ? window._lastIndicatorTime : indicatorTime;
        function checkFeatureCross(featOffset, label, eventKey) {
          if (typeof featOffset !== 'number') return;
          for (let bt of beatTimes) {
            const featT = bt + featOffset;
            if (prevIndicatorTime < featT && featT <= indicatorTime) {
              try { logWaveCross(label, indicatorX); } catch (e) {}
              if (label === 'P') {
                try { lastPStartMs = Math.max(0, nowMs); } catch (e) {}
              }
              eventCrossings.push(eventKey);
            }
          }
        }
        checkFeatureCross(pStartOffset, 'P', 'P_start');
        checkFeatureCross(pEndOffset, 'P end', 'P_end');
        checkFeatureCross(qStartOffset, 'Q', 'Q_start');
        checkFeatureCross(qEndOffset, 'Q end', 'Q_end');
        checkFeatureCross(rStartOffset, 'R', 'R_start');
        checkFeatureCross(rEndOffset, 'R end', 'R_end');
        checkFeatureCross(sStartOffset, 'S', 'S_start');
        checkFeatureCross(sEndOffset, 'S end', 'S_end');
        checkFeatureCross(tStartOffset, 'T', 'T_start');
        checkFeatureCross(tEndOffset, 'T end', 'T_end');
        window._lastIndicatorTime = indicatorTime;
        // Maintain back-compat for any external code referencing _lastIndicatorX
        window._lastIndicatorX = indicatorX;

        // ECG event crossings detected. Forward to global trigger handler
        // when ECG-triggering is enabled (manual per-item triggers still work).
        if (eventCrossings.length > 0) {
          if (ecgTriggeringEnabled) {
            try {
              eventCrossings.forEach(evKey => { try { triggerEcgEvent(evKey); } catch (e) {} });
            } catch (e) { /* ignore */ }
          }
        }

        // blit to right half (either the single ECG buffer or the full-sequence view)
        if (showSequenceOnRight && Array.isArray(presetSequence) && presetSequence.length > 0) {
          try { drawSequenceOnRight(halfW, 0, halfW, height); } catch (e) { console.warn('sequence blit error', e); image(ecgG, halfW, 0); }
        } else {
          image(ecgG, halfW, 0);
        }
        // Update MS counter and pause button labels if global panel exists
        try {
          if (globalControlPanel && globalControlPanel._ecgMsCounter) {
            const effectiveEcgNow = pausedEcg ? ecgPausedAtMs : (millis() - ecgTimeOffsetMs);
            const msSinceP = (lastPStartMs > 0) ? Math.max(0, Math.round(effectiveEcgNow - lastPStartMs)) : '-';
            globalControlPanel._ecgMsCounter.textContent = 'ms since P: ' + String(msSinceP);
            // also show 'game' ms (as if no time dilation): divide by timeDilation
            try {
              if (globalControlPanel._ecgGameMsCounter) {
                if (msSinceP === '-' || !isFinite(Number(timeDilation)) || Number(timeDilation) === 0) {
                  globalControlPanel._ecgGameMsCounter.textContent = 'game ms since P: -';
                } else {
                  const gameMs = Math.max(0, Math.round(Number(msSinceP) / Number(timeDilation)));
                  globalControlPanel._ecgGameMsCounter.textContent = 'game ms since P: ' + String(gameMs);
                }
              }
            } catch (e) {}
          }
          // update P debug readout
          try {
            if (globalControlPanel && globalControlPanel._pDebug) {
              const pS = (__debug_pStart !== null) ? Math.round(__debug_pStart * 1000) + ' ms' : '-';
              const pC = (__debug_pCenter !== null) ? Math.round(__debug_pCenter * 1000) + ' ms' : '-';
              const pE = (__debug_pEnd !== null) ? Math.round(__debug_pEnd * 1000) + ' ms' : '-';
              const pD = (__debug_pDur !== null) ? Math.round(__debug_pDur * 1000) + ' ms' : '-';
              const prText = (typeof prDur === 'number') ? (Math.round(prDur*1000) + ' ms PR') : '';
              const pdText = (typeof pDuration === 'number') ? (Math.round(pDuration*1000) + ' ms Pdur') : '';
              globalControlPanel._pDebug.textContent = prText + ' ' + pdText + ' | P start: ' + pS + ' center: ' + pC + ' end: ' + pE + ' dur: ' + pD;
            }
          } catch (e) {}
          if (globalControlPanel && globalControlPanel._ecgPauseBtn) {
            globalControlPanel._ecgPauseBtn.textContent = pausedEcg ? 'Resume ECG' : 'Pause ECG';
          }
          if (globalControlPanel && globalControlPanel._conductionPauseBtn) {
            globalControlPanel._conductionPauseBtn.textContent = pausedConduction ? 'Resume Conduction' : 'Pause Conduction';
          }
        } catch (e) {}
      }
    } else {
      // 12-lead grid layout: arrange 12 lead boxes
      const padding = 12;
      const cols = 3;
      const rows = 4;
      const boxW = Math.floor((width - (cols + 1) * padding) / cols);
      const boxH = Math.floor((height - (rows + 1) * padding) / rows);
      background(250);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= 12) continue;
          const x = padding + c * (boxW + padding);
          const y = padding + r * (boxH + padding);
          const label = leadLabelsGlobal[idx] || String(idx + 1);
          drawLead(x, y, boxW, boxH, label, idx);
        }
      }
    }
  } catch (drawErr) {
    console.error('Error during draw():', drawErr);
    clear();
    background(240);
    push();
    fill(0);
    noStroke();
    textSize(14);
    textAlign(LEFT, TOP);
    text('ECG draw error: ' + (drawErr && drawErr.message ? drawErr.message : String(drawErr)), 12, 12);
    pop();
    noLoop();
  }
}

// Draw a single lead box and its waveform (identical traces for now)
function drawLead(x, y, w, h, label, leadIndex) {
  // Use an offscreen buffer per-lead to stabilize pixel alignment and reduce jitter
  const dpr = window._ecg_dpr || (window.devicePixelRatio || 1);
  let buf = leadBuffers[leadIndex];
  if (!buf || buf._w !== w || buf._h !== h) {
    try {
      buf = createGraphics(Math.max(1, w), Math.max(1, h));
    } catch (e) {
      // fallback: if createGraphics fails, draw directly to canvas
      buf = null;
    }
    if (buf) {
      buf._w = w; buf._h = h;
      try { if (typeof buf.pixelDensity === 'function') buf.pixelDensity(dpr); } catch (e) {}
      try { if (buf.drawingContext && 'imageSmoothingEnabled' in buf.drawingContext) buf.drawingContext.imageSmoothingEnabled = false; } catch (e) {}
      leadBuffers[leadIndex] = buf;
    }
  }

  // If we have a buffer, draw the lead completely into it, then blit.
  if (buf) {
    buf.push();
    buf.clear();
    // background and rounded rect
    buf.noStroke(); buf.fill(255); buf.rect(0, 0, w, h, 4);
    // grid
    buf.strokeWeight(1); buf.stroke(230);
    const small = Math.max(6, Math.round(w / 40));
    for (let gx = 0; gx < w; gx += small) buf.line(gx, 0, gx, h);
    for (let gy = 0; gy < h; gy += small) buf.line(0, gy, w, gy);
    // label
    buf.noStroke(); buf.fill(20); buf.textSize(14); buf.textAlign(LEFT, TOP); buf.text(label, 6, 4);

    // waveform area
    const padTop = 22; const padBottom = 8;
    const traceY0 = padTop; const traceH = h - padTop - padBottom;
    const centerY = traceY0 + traceH / 2;

    // compute beats
    const now = millis() / 1000.0;
    const timeWindowLead = 4.0;
    const pixelsPerSecond = w / timeWindowLead;
    const beatPeriod = 60.0 / heartRate;
    const tStart = now - timeWindowLead - 0.5;
    const tEnd = now + 0.5;
    let firstBeat = Math.floor(tStart / beatPeriod) * beatPeriod;
    let beatTimes = [];
    for (let bt = firstBeat; bt < tEnd; bt += beatPeriod) beatTimes.push(bt);

    const alignBuf = (v) => Math.round(v * dpr) / dpr;

    // draw waveform into buffer
    buf.stroke(20, 80, 20); buf.strokeWeight(1); buf.noFill();
    const lp = leadParams[leadIndex] || {p:1,q:1,r:1,s:1,t:1};
    const leadZoneMap = ['lateral','inferior','inferior','lateral','lateral','inferior','anterior','anterior','anterior','anterior','lateral','lateral'];
    const zoneKey = leadZoneMap[leadIndex] || null;
    const primaryPct = zoneKey ? constrain(zoneIschemia[zoneKey] || 0, 0, 100) : 0;
    const primaryEff = mapIschemiaToEff(primaryPct);
    const reciprocalMap = { inferior:[4], anterior:[2,5], lateral:[2,5] };
    const recipStrength = constrain(reciprocalPercent / 100.0, 0, 1);

    // Precompute a single-beat template sampled at 1 sample per horizontal pixel
    // Expand template to cover both pre- and post-beat times so T/S (post-QRS) aren't lost.
    const templateLen = w * 2 + 1;
    const template = new Array(templateLen).fill(0);
    // compute finalEff once (primary + reciprocal inversion contributions)
    let finalEffT_base = primaryEff.effT;
    let finalEffST_base = primaryEff.effST;
    if (recipStrength > 0) {
      for (const zoneName of Object.keys(reciprocalMap)) {
        const targets = reciprocalMap[zoneName];
        if (targets && targets.indexOf(leadIndex) >= 0) {
          const srcPct = constrain(zoneIschemia[zoneName] || 0, 0, 100);
          const pctRec = srcPct * recipStrength;
          if (pctRec > 0.001) {
            const recEff = mapIschemiaToEff(pctRec);
            finalEffT_base += -recEff.effT;
            finalEffST_base += -recEff.effST;
          }
        }
      }
    }
    finalEffT_base = constrain(finalEffT_base, -3.0, 3.0);
    finalEffST_base = constrain(finalEffST_base, -3.0, 3.0);

    // Build template indexed so that index k corresponds to time t_rel = (k - w) / pixelsPerSecond
    const mid = w; // center index corresponds to t_rel = 0
    for (let k = 0; k < templateLen; k++) {
      const t_rel = (k - mid) / pixelsPerSecond;
      template[k] = singleBeatSignal(t_rel, finalEffT_base, finalEffST_base, lp);
    }

    // accumulate beats by integer pixel shifts to avoid subpixel phase jitter
    const acc = new Array(w + 1).fill(0);
    for (let bt of beatTimes) {
      // include user horizontal shift so accumulated beats are translated
      const deltaSec = now - bt + (typeof ecgWaveShift === 'number' ? ecgWaveShift : 0);
      const shift = Math.round(deltaSec * pixelsPerSecond); // integer pixel shift
      // k = ix + shift maps to template index; template index range is [0, templateLen-1]
      for (let ix = 0; ix <= w; ix++) {
        const k = ix + shift;
        if (k >= 0 && k < templateLen) acc[ix] += template[k];
      }
    }

    // draw accumulated waveform aligned to buffer pixels
    let prevX = null, prevY = null;
    for (let ix = 0; ix <= w; ix++) {
      const xA = alignBuf(ix);
      const v = acc[ix];
      const py = centerY - v * (traceH * 0.28);
      const yA = alignBuf(py);
      if (prevX !== null) buf.line(prevX, prevY, xA, yA);
      prevX = xA; prevY = yA;
    }

    buf.pop();

    // blit the buffer onto main canvas
    image(buf, x, y);
    // draw border on main canvas
    stroke(150); noFill(); rect(x, y, w, h, 4);
  } else {
    // fallback: draw directly if buffer unavailable
    push(); translate(x, y);
    noStroke(); fill(255); rect(0,0,w,h,4);
    strokeWeight(1); stroke(230);
    const small = Math.max(6, Math.round(w/40));
    for (let gx=0; gx<w; gx+=small) line(gx,0,gx,h);
    for (let gy=0; gy<h; gy+=small) line(0,gy,w,gy);
    noStroke(); fill(20); textSize(14); textAlign(LEFT, TOP); text(label,6,4);

    // simple direct waveform (previous behavior)
    const padTop = 22; const padBottom = 8; const traceY0 = padTop; const traceH = h - padTop - padBottom; const centerY = traceY0 + traceH/2;
    stroke(20,80,20); strokeWeight(1.5); noFill();
    const now = millis()/1000.0; const timeWindowLead = 4.0; const pixelsPerSecond = w/timeWindowLead; const beatPeriod = 60.0/heartRate;
    const tStart = now - timeWindowLead - 0.5; const tEnd = now + 0.5; let firstBeat = Math.floor(tStart/beatPeriod)*beatPeriod; let beatTimes = [];
    for (let bt = firstBeat; bt < tEnd; bt += beatPeriod) beatTimes.push(bt);
    let prevX=null, prevY=null;
    for (let ix=0; ix<=w; ix+=1) {
      const t = now - (w - ix)/pixelsPerSecond; let v=0; for (let bt of beatTimes) v+=singleBeatSignal(t-bt, primaryEff.effT, primaryEff.effST, lp);
      const py = centerY - v*(traceH*0.28);
      if (prevX!==null) line(prevX, prevY, ix, py);
      prevX = ix; prevY = py;
    }
    stroke(150); noFill(); rect(0,0,w,h,4);
    pop();
  }
}

// Draw a faint ECG grid like paper
function drawGrid() {
  push();
  background(250);
  stroke(230);
  strokeWeight(1);
  let step = 20;
  for (let x = 0; x < width; x += step) line(x, 0, x, height);
  for (let y = 0; y < height; y += step) line(0, y, width, y);
  pop();
}

// Conduction overlay drawing (animated version defined later in file).
// The animated `drawConductionOverlay` implementation appears further
// below and handles 'sequential' and 'concurrent' playback modes.

// Helper: compute point along polyline at normalized progress t (0..1)
function pointAlongPolyline(points, t) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  // compute lengths
  const segLengths = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]; const b = points[i+1];
    const dx = b.x - a.x; const dy = b.y - a.y; const L = Math.hypot(dx, dy);
    segLengths.push(L); total += L;
  }
  if (total <= 0) return { x: points[0].x, y: points[0].y };
  let dist = t * total;
  for (let i = 0; i < segLengths.length; i++) {
    if (dist <= segLengths[i]) {
      const a = points[i]; const b = points[i+1]; const frac = segLengths[i] <= 0 ? 0 : dist / segLengths[i];
      return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
    }
    dist -= segLengths[i];
  }
  // fallback to last point
  const last = points[points.length-1]; return { x: last.x, y: last.y };
}

// Helper: convert hex color (#rrggbb) to {r,g,b}
function hexToRgb(hex) {
  if (!hex) return {r:255,g:0,b:0};
  let h = String(hex).replace('#','');
  if (h.length === 3) h = h.split('').map(c=>c+c).join('');
  const n = parseInt(h,16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Extend overlay drawing with playback indicators for sequential/concurrent modes
function drawConductionOverlay(ix, iy, iw, ih) {
  // Only draw when in single-lead view
  if (!singleLeadView) return;
  push();
  translate(0,0);
  noFill();
  strokeWeight(2);
  const imgW = iw, imgH = ih; const imgX = ix, imgY = iy;
  // Use effective conduction time (respecting pause offset) when needed

  for (let i = 0; i < conductionItems.length; i++) {
    const it = conductionItems[i]; if (!it) continue;
    stroke(it.color || '#ff0000');
    // Always show shapes with a faint base fill (20% opacity) so they are
    // visible even when not activated. Active playback will render a stronger
    // fill on top of this base fill.
    if (it.type === 'shape' && Array.isArray(it.points) && it.points.length >= 3) {
      try { fill((it.color || '#ff0000') + '33'); } catch (e) { noFill(); }
    } else if (it.fill && it.closed) {
      // keep existing explicit fill behavior for closed items
      fill(it.color + '44');
    } else {
      noFill();
    }

    // draw base shape/path
    beginShape();
    if (it.points.length >= 3) {
      for (let k = 0; k < it.points.length; k++) {
        const p = it.points[k]; const x = imgX + p.x * imgW; const y = imgY + p.y * imgH; curveVertex(x, y);
      }
      if (it.closed) {
        const p0 = it.points[0]; const x0 = imgX + p0.x * imgW; const y0 = imgY + p0.y * imgH; curveVertex(x0, y0);
      }
    } else {
      for (let k = 0; k < it.points.length; k++) { const p = it.points[k]; const x = imgX + p.x * imgW; const y = imgY + p.y * imgH; if (k===0) vertex(x,y); else vertex(x,y); }
    }
    if (it.closed) endShape(CLOSE); else endShape();

    // interactive control points for selected item (only when editing)
    if (conductionEditMode && i === selectedConductionIndex) {
      for (let k = 0; k < it.points.length; k++) {
        const p = it.points[k]; const x = imgX + p.x * imgW; const y = imgY + p.y * imgH; noStroke(); fill('#ffffff'); ellipse(x, y, 10, 10); stroke('#000000'); noFill(); ellipse(x, y, 10, 10);
      }
    }
    // (playback visuals handled by centralized scheduler below)
  }
  // Per-item playback renderer: iterate all conduction items and draw any
  // item that has an active `playbackStartTime`. This replaces the old
  // step-based scheduler so items only play when manually triggered and
  // can overlap independently.
  try {
    const nowMs = pausedConduction ? conductionPausedAtMs : (millis() - conductionTimeOffsetMs);
    for (let ix = 0; ix < conductionItems.length; ix++) {
      const it = conductionItems[ix]; if (!it) continue;
      const baseStart = Number(it.playbackStartTime) || 0;
      const offsetMs = Number(it.startOffsetMs) || 0;
      const dilation = (typeof timeDilation === 'number' ? timeDilation : 1.0);
      const scheduledStart = baseStart + offsetMs * dilation;
      const perItemElapsed = nowMs - scheduledStart;
      if (scheduledStart <= 0 || perItemElapsed < 0) continue; // not started or scheduled in future

      let perItemEffectiveDur = 0;
      if (it.durationSource) {
        perItemEffectiveDur = Math.max(10, (getEcgFeatureMs(it.durationSource) || 0)) * dilation;
      } else if (it.type === 'shape') {
        const rampUp = (it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : Math.max(0, Number(it.rampUpMs) || 0)) * dilation;
        const sustain = (it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : Math.max(0, Number(it.sustainMs) || 0)) * dilation;
        const rampDown = (it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : Math.max(0, Number(it.rampDownMs) || 0)) * dilation;
        perItemEffectiveDur = Math.max(10, rampUp + sustain + rampDown);
      } else {
        perItemEffectiveDur = Math.max(10, Number(it.durationMs) || 1200) * dilation;
      }

      if (perItemElapsed >= perItemEffectiveDur) {
        // finished playing; clear start time so it won't replay until retriggered
        it.playbackStartTime = 0;
        continue;
      }

      const progressItem = Math.min(1.0, Math.max(0.0, perItemElapsed / Math.max(1, perItemEffectiveDur)));

      if (it.type === 'shape') {
        const rampUp = (it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : Math.max(0, Number(it.rampUpMs) || 0)) * dilation;
        const sustain = (it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : Math.max(0, Number(it.sustainMs) || 0)) * dilation;
        const rampDown = (it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : Math.max(0, Number(it.rampDownMs) || 0)) * dilation;
        const totalEnvelope = rampUp + sustain + rampDown;
        let alpha = 0;
        if (totalEnvelope <= 0) {
          alpha = Math.max(0, Math.sin(progressItem * Math.PI));
        } else {
          const useDurForScale = perItemEffectiveDur || totalEnvelope;
          const scale = totalEnvelope > useDurForScale ? (useDurForScale / totalEnvelope) : 1.0;
          const up = rampUp * scale;
          const sus = sustain * scale;
          const down = rampDown * scale;
          const t = Math.max(0, Math.min(useDurForScale, perItemElapsed));
          if (t < up) alpha = t / Math.max(1, up);
          else if (t < up + sus) alpha = 1.0;
          else if (t < up + sus + down) alpha = 1.0 - ((t - up - sus) / Math.max(1, down));
          else alpha = 0.0;
          alpha = Math.max(0, Math.min(1, alpha));
        }
        const rgb = hexToRgb(it.color || '#ff0000');
        push(); noStroke(); fill(rgb.r, rgb.g, rgb.b, Math.round(alpha * 220)); beginShape();
        for (let p of it.points) vertex(imgX + p.x * imgW, imgY + p.y * imgH);
        endShape(CLOSE); pop();
      } else {
        strokeWeight(0); noStroke();
        if (it.points.length >= 2 && (it.mode || 'sequential') !== 'concurrent') {
          const normPts = it.points.map(p => ({ x: p.x * imgW + imgX, y: p.y * imgH + imgY }));
          // Density scales with timeDilation: maximum density when timeDilation==1
          // Use a trail window proportional to the effective duration so
          // animations remain consistent across heart rates (avoid fixed upper cap).
          const trailMs = Math.max(120, Math.round(perItemEffectiveDur * 0.8));
          // Use user-controlled density only; do not scale with timeDilation
          let factor = (typeof conductionDensityScale === 'number' ? conductionDensityScale : 1.0);
          // clamp to a reasonable range (slider already provides 0.2..5.0)
          factor = Math.max(0, factor);
          const minSampleMs = 8; const maxSampleMs = 60;
          const sampleMs = Math.max(1, Math.round(maxSampleMs - factor * (maxSampleMs - minSampleMs)));
          const minSamples = Math.max(3, Math.round(8 * factor));
          const samples = Math.max(minSamples, Math.ceil(trailMs / sampleMs));
          const rgb = hexToRgb(it.color || '#ff0000');
          for (let s = 0; s < samples; s++) {
            const dt = s * (trailMs / samples);
            const sampleElapsed = Math.max(0, perItemElapsed - dt);
            const sampleProgress = Math.min(1.0, Math.max(0.0, sampleElapsed / Math.max(1, perItemEffectiveDur)));
            const pt = pointAlongPolyline(normPts, sampleProgress);
            if (!pt) continue;
            const alpha = (1 - s / Math.max(1, samples - 1)) * 0.95;
            const size = 6 + 12 * (1 - s / Math.max(1, samples));
            fill(rgb.r, rgb.g, rgb.b, Math.round(alpha * 220)); ellipse(pt.x, pt.y, size, size);
          }
        } else if (it.points.length >= 2) {
          const normPts = it.points.map(p => ({ x: p.x * imgW + imgX, y: p.y * imgH + imgY }));
          const pt = pointAlongPolyline(normPts, progressItem);
          if (pt) { const rgb = hexToRgb(it.color || '#ff0000'); fill(rgb.r, rgb.g, rgb.b, 220); ellipse(pt.x, pt.y, 12, 12); }
        } else if (it.points.length === 1) {
          const p = it.points[0]; const x = imgX + p.x * imgW; const y = imgY + p.y * imgH;
          // For single-point items scale trail with effective duration as well.
          const trailMs = Math.max(80, Math.round(perItemEffectiveDur * 0.6));
          // Use user-controlled density only; do not scale with timeDilation
          let factor2 = (typeof conductionDensityScale === 'number' ? conductionDensityScale : 1.0);
          factor2 = Math.max(0, factor2);
          const minSampleMs2 = 8; const maxSampleMs2 = 60;
          const sampleMs = Math.max(1, Math.round(maxSampleMs2 - factor2 * (maxSampleMs2 - minSampleMs2)));
          const minSamples2 = Math.max(2, Math.round(6 * factor2));
          const samples = Math.max(minSamples2, Math.ceil(trailMs / sampleMs));
          const rgb = hexToRgb(it.color || '#ff0000');
          for (let s = 0; s < samples; s++) {
            const dt = s * (trailMs / samples); const sampleElapsed = Math.max(0, perItemElapsed - dt);
            const frac = Math.min(1, sampleElapsed / Math.max(1, perItemEffectiveDur));
            const alpha = (1 - s / Math.max(1, samples - 1)) * (0.6 + 0.4 * frac);
            const size = 6 + 14 * (1 - s / Math.max(1, samples)); fill(rgb.r, rgb.g, rgb.b, Math.round(alpha * 220)); ellipse(x, y, size, size);
          }
        }
      }
    }
  } catch (e) {
    // keep draw loop robust; ignore per-item render errors
  }

        // On-canvas diagnostic overlay removed per user request.

      pop();
}

// Helper: find nearest point within radius (in pixels) on image area; returns {idx, ptIdx} or null
function findNearestPointOnImage(mx, my, ix, iy, iw, ih, radius=12) {
  for (let i = 0; i < conductionItems.length; i++) {
    const it = conductionItems[i];
    for (let k = 0; k < it.points.length; k++) {
      const p = it.points[k]; const x = ix + p.x * iw; const y = iy + p.y * ih;
      const d2 = (mx - x)*(mx - x) + (my - y)*(my - y);
      if (d2 <= radius*radius) return { idx: i, ptIdx: k };
    }
  }
  return null;
}

// simple HTML escaper for popup content
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// mouse interactions for editing conduction items (add/move points)
function mousePressed() {
  if (!singleLeadView || !ccsImg) return;
  const halfW = Math.floor(width / 2);
  // Only accept interactions on left half where CCS is drawn
  if (mouseX < 0 || mouseX > halfW || mouseY < 0 || mouseY > height) return;
  // compute image placement same as draw()
  const imgW = halfW; const imgH = height;
  const s = Math.min(imgW / ccsImg.width, imgH / ccsImg.height);
  const iw = ccsImg.width * s; const ih = ccsImg.height * s;
  const ix = Math.round((imgW - iw) / 2);
  const iy = Math.round((imgH - ih) / 2);

  // if edit mode and item selected, either select a nearby point for dragging or add a new point
  if (conductionEditMode && selectedConductionIndex >= 0) {
    const it = conductionItems[selectedConductionIndex];
    // Right-click on a point deletes it when in edit mode
    try {
      if (typeof mouseButton !== 'undefined' && mouseButton === RIGHT) {
        const nearDel = findNearestPointOnImage(mouseX, mouseY, ix, iy, iw, ih, 12);
        if (nearDel && nearDel.idx === selectedConductionIndex) {
          try { pushConductionHistory(selectedConductionIndex); } catch (e) {}
          // remove the point
          it.points.splice(nearDel.ptIdx, 1);
          // if item has no points left, remove the item entirely
          if (!Array.isArray(it.points) || it.points.length === 0) {
            if (confirm('Item has no points left. Delete the conduction item?')) {
              conductionItems.splice(selectedConductionIndex, 1);
              selectedConductionIndex = -1; conductionEditMode = false;
            } else {
              // leave empty item
            }
          }
          try { saveConductionItems(); } catch (e) {}
          refreshConductionPanel();
          return false; // prevent default/context menu
        }
      }
    } catch (e) {}
    // look for existing point near mouse
    const near = findNearestPointOnImage(mouseX, mouseY, ix, iy, iw, ih, 12);
    if (near && near.idx === selectedConductionIndex) {
      try { pushConductionHistory(selectedConductionIndex); } catch (e) {}
      conductionDragging.idx = selectedConductionIndex; conductionDragging.pt = near.ptIdx;
      return;
    }
    // otherwise add new point normalized to image coordinates
    const nx = (mouseX - ix) / iw; const ny = (mouseY - iy) / ih;
    try { pushConductionHistory(selectedConductionIndex); } catch (e) {}
    it.points.push({x: nx, y: ny});
    refreshConductionPanel();
    return;
  }
}

function mouseDragged() {
  if (!singleLeadView || !ccsImg) return;
  if (conductionDragging.idx >= 0 && conductionDragging.pt >= 0) {
    const halfW = Math.floor(width / 2);
    const imgW = halfW; const imgH = height;
    const s = Math.min(imgW / ccsImg.width, imgH / ccsImg.height);
    const iw = ccsImg.width * s; const ih = ccsImg.height * s;
    const ix = Math.round((imgW - iw) / 2);
    const iy = Math.round((imgH - ih) / 2);
    const it = conductionItems[conductionDragging.idx];
    if (!it) return;
    const nx = constrain((mouseX - ix) / iw, 0, 1); const ny = constrain((mouseY - iy) / ih, 0, 1);
    it.points[conductionDragging.pt] = {x: nx, y: ny};
    return false; // prevent default
  }
}

function mouseReleased() {
  if (conductionDragging.idx >= 0) {
    conductionDragging.idx = -1; conductionDragging.pt = -1; refreshConductionPanel();
  }
}

// =============================================================================
// Ischemia → ECG mapping
// The mapping is a piecewise-linear curve over ischemia% with breakpoints that
// specify (effT, effST). At pct=0 the baseline tWaveScale / stOffset are used;
// from there the curve is interpolated between consecutive breakpoints sorted
// by percent. Edit/save/load via the "Ischemia Curve" panel.
//
// effT  : T-wave scale at this ischemia level (negative = inverted T)
// effST : ST-segment offset (positive = elevation, negative = depression)
//
// The defaults below reproduce the old hard-coded behavior:
//   0..50  : T inverts from baseline -> -1, ST stays at baseline
//   50..90 : T pinned at -1, ST drops baseline -> -0.4 (depression)
//   90..95 : T pinned at -1, ST swings -0.4 -> +0.1
//   95..100: T -1 -> -0.25, ST +0.1 -> +0.7 (transmural / STEMI-like)
// =============================================================================
const ISCHEMIA_CURVE_DEFAULT = [
  { pct: 50,  effT: -1.0,  effST: null  },  // null effST = inherit baseline stOffset
  { pct: 90,  effT: -1.0,  effST: -0.4  },
  { pct: 95,  effT: -1.0,  effST:  0.1  },
  { pct: 100, effT: -0.25, effST:  0.7  },
];

// Active curve (mutable). Loaded from localStorage on startup.
let ischemiaCurve = ISCHEMIA_CURVE_DEFAULT.map(p => ({ ...p }));

const ISCHEMIA_CURVE_KEY = 'ccs.ischemiaCurve.v1';
const ISCHEMIA_CURVE_LIBRARY_KEY = 'ccs.ischemiaCurves.v1';

function _normalizeIschemiaCurve(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return ISCHEMIA_CURVE_DEFAULT.map(p => ({ ...p }));
  const cleaned = arr
    .filter(p => p && typeof p.pct === 'number' && isFinite(p.pct))
    .map(p => ({
      pct: Math.max(0, Math.min(100, Number(p.pct))),
      effT: (p.effT === null || p.effT === undefined) ? null : Number(p.effT),
      effST: (p.effST === null || p.effST === undefined) ? null : Number(p.effST),
      effStStartMs: (p.effStStartMs === null || p.effStStartMs === undefined) ? null : Number(p.effStStartMs),
      effStEndMs:   (p.effStEndMs   === null || p.effStEndMs   === undefined) ? null : Number(p.effStEndMs),
    }))
    .sort((a, b) => a.pct - b.pct);
  return cleaned.length > 0 ? cleaned : ISCHEMIA_CURVE_DEFAULT.map(p => ({ ...p }));
}

function saveIschemiaCurve() {
  try { storageSetItem(ISCHEMIA_CURVE_KEY, JSON.stringify(ischemiaCurve)); } catch (e) { console.warn('saveIschemiaCurve', e); }
}
function loadIschemiaCurve() {
  try {
    const raw = storageGetItem(ISCHEMIA_CURVE_KEY);
    if (!raw) return;
    ischemiaCurve = _normalizeIschemiaCurve(JSON.parse(raw));
  } catch (e) { console.warn('loadIschemiaCurve', e); }
}
function _getAllIschemiaCurves() {
  try { const raw = storageGetItem(ISCHEMIA_CURVE_LIBRARY_KEY); return raw ? (JSON.parse(raw) || {}) : {}; } catch (e) { return {}; }
}
function _saveAllIschemiaCurves(obj) {
  try { storageSetItem(ISCHEMIA_CURVE_LIBRARY_KEY, JSON.stringify(obj || {})); } catch (e) {}
}
function saveNamedIschemiaCurve(name) {
  if (!name) return false;
  try {
    const all = _getAllIschemiaCurves();
    all[name] = { name, savedAt: (new Date()).toISOString(), curve: ischemiaCurve.map(p => ({ ...p })) };
    _saveAllIschemiaCurves(all);
    return true;
  } catch (e) { console.warn('saveNamedIschemiaCurve', e); return false; }
}
function loadNamedIschemiaCurve(name) {
  try {
    const all = _getAllIschemiaCurves();
    const p = all[name];
    if (!p || !Array.isArray(p.curve)) return false;
    ischemiaCurve = _normalizeIschemiaCurve(p.curve);
    saveIschemiaCurve();
    return true;
  } catch (e) { return false; }
}
function deleteNamedIschemiaCurve(name) {
  try {
    const all = _getAllIschemiaCurves();
    if (!(name in all)) return false;
    delete all[name];
    _saveAllIschemiaCurves(all);
    return true;
  } catch (e) { return false; }
}

// Initial load (storage helpers are defined earlier in the file)
try { loadIschemiaCurve(); } catch (e) {}

// Map an ischemia percentage (0..100) into effective T scale, ST offset, and
// ST window (start/end in ms relative to QRS R-peak), using the editable
// piecewise-linear ischemiaCurve.
function mapIschemiaToEff(pct) {
  const baselineT = tWaveScale;
  const baselineST = stOffset;
  const baselineStStartMs = stStartMs;
  const baselineStEndMs   = stEndMs;
  const pctC = Math.max(0, Math.min(100, Number(pct) || 0));
  if (pctC <= 0) return { effT: baselineT, effST: baselineST, effStStartMs: baselineStStartMs, effStEndMs: baselineStEndMs };

  // Build a working list with an implicit baseline anchor at pct=0.
  const curve = (Array.isArray(ischemiaCurve) && ischemiaCurve.length > 0)
    ? ischemiaCurve.slice().sort((a, b) => a.pct - b.pct)
    : ISCHEMIA_CURVE_DEFAULT.slice();
  const resolveT  = (p) => (p.effT  === null || p.effT  === undefined) ? baselineT  : p.effT;
  const resolveST = (p) => (p.effST === null || p.effST === undefined) ? baselineST : p.effST;
  const resolveStStart = (p) => (p.effStStartMs === null || p.effStStartMs === undefined) ? baselineStStartMs : p.effStStartMs;
  const resolveStEnd   = (p) => (p.effStEndMs   === null || p.effStEndMs   === undefined) ? baselineStEndMs   : p.effStEndMs;
  const points = [{ pct: 0, effT: baselineT, effST: baselineST, effStStartMs: baselineStStartMs, effStEndMs: baselineStEndMs }]
    .concat(curve.map(p => ({
      pct: p.pct,
      effT: resolveT(p), effST: resolveST(p),
      effStStartMs: resolveStStart(p), effStEndMs: resolveStEnd(p),
    })));

  // Above the highest breakpoint: clamp to that breakpoint's values.
  if (pctC >= points[points.length - 1].pct) {
    const last = points[points.length - 1];
    return { effT: last.effT, effST: last.effST, effStStartMs: last.effStStartMs, effStEndMs: last.effStEndMs };
  }
  // Find the bracketing pair and lerp.
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (pctC >= a.pct && pctC <= b.pct) {
      const span = Math.max(1e-6, b.pct - a.pct);
      const f = (pctC - a.pct) / span;
      return {
        effT:  a.effT  + (b.effT  - a.effT)  * f,
        effST: a.effST + (b.effST - a.effST) * f,
        effStStartMs: a.effStStartMs + (b.effStStartMs - a.effStStartMs) * f,
        effStEndMs:   a.effStEndMs   + (b.effStEndMs   - a.effStEndMs)   * f,
      };
    }
  }
  return { effT: baselineT, effST: baselineST, effStStartMs: baselineStStartMs, effStEndMs: baselineStEndMs };
}

// Compute an ischemia percentage (0..100) from athero %, METs and thrombus %
function computeIschemia(athero, mets, thrombus) {
  const a = constrain(athero, 0, 100);
  const t = constrain(thrombus, 0, 100);
  if (a < 20 && t < 20) return 0;
  const aFactor = a <= 20 ? 0 : (a - 20) / 80.0;
  const tFactor = t / 100.0;
  const thrombusBias = 1.5;
  const combinedVuln = constrain((aFactor + thrombusBias * tFactor) / (1.0 + thrombusBias), 0, 1);
  const aFrac = a / 100.0;
  const tFrac = t / 100.0;
  const combinedFrac = Math.min(1.0, aFrac + thrombusBias * tFrac * (1.0 - aFrac));
  const metFactor = constrain((mets - 2) / (10 - 2), 0, 1);
  const vulnAmplification = 3.0;
  const metAmplifier = 1.0 + vulnAmplification * combinedVuln;
  const baseIschemia = constrain(combinedVuln * metFactor * metAmplifier * 100.0, 0, 100);
  const aFracLocal = a / 100.0;
  const thrombusAtheroSynergy = 2.0;
  const thrombusMultiplier = 1.0 + thrombusAtheroSynergy * aFracLocal;
  const thrombusIschemia = constrain(tFactor * thrombusBias * thrombusMultiplier * 100.0, 0, 100);
  let effectiveIschemia = Math.max(baseIschemia, thrombusIschemia);
  const capLevel = 85.0;
  if (combinedFrac > 0.99) {
    const f = constrain((combinedFrac - 0.99) / 0.01, 0, 1);
    const start = Math.min(effectiveIschemia, capLevel);
    return lerp(start, 100.0, f);
  }
  return Math.min(effectiveIschemia, capLevel);
}

// Main ECG renderer
function drawECG(hr) {
  let now = millis() / 1000.0;
  let beatPeriod = 60.0 / hr;
  let pixelsPerSecond = width / timeWindow;

  // Baseline center
  let centerY = height * 0.5;

  // Determine visible beat times
  let tStart = now - timeWindow - 1.0; // small buffer
  let tEnd = now + 1.0;

  // Precompute beat times in range
  let firstBeat = Math.floor(tStart / beatPeriod) * beatPeriod;
  let beatTimes = [];
  for (let t = firstBeat; t < tEnd; t += beatPeriod) beatTimes.push(t);

  // Draw ECG waveform by sampling horizontally
  // Draw ECG waveform by sampling horizontally with device-pixel alignment
  noFill();
  stroke(0, 60, 0);
  strokeWeight(2);
  // compute ischemia from athero% and METs, then derive effective T/ST
  // If athero < 20%, METs do not cause ischemia. Above 20%, METs > 2 increase ischemia up to METs=10.
  function computeIschemia(athero, mets, thrombus) {
    const a = constrain(athero, 0, 100);
    const t = constrain(thrombus, 0, 100);
    if (a < 20 && t < 20) return 0;
    // athero vulnerability factor (0..1) over 20..100
    const aFactor = a <= 20 ? 0 : (a - 20) / 80.0;
    // thrombus factor (0..1)
    const tFactor = t / 100.0;
    // bias thrombus to have stronger effect
    const thrombusBias = 1.5;
    // combined structural vulnerability (weighted)
    const combinedVuln = constrain((aFactor + thrombusBias * tFactor) / (1.0 + thrombusBias), 0, 1);

    // compute total anatomical narrowing fraction (used to force ischemia at extreme stenosis)
    const aFrac = a / 100.0;
    const tFrac = t / 100.0;
    const combinedFrac = Math.min(1.0, aFrac + thrombusBias * tFrac * (1.0 - aFrac));

    // METs effect (no effect until METs > 2)
    const metFactor = constrain((mets - 2) / (10 - 2), 0, 1);
    // amplify the effect of METs when structural vulnerability is high
    const vulnAmplification = 3.0; // tuning parameter (larger -> more sensitivity)
    const metAmplifier = 1.0 + vulnAmplification * combinedVuln;
    const baseIschemia = constrain(combinedVuln * metFactor * metAmplifier * 100.0, 0, 100);

  // Thrombus-driven ischemia: thrombus produces ischemia immediately and increases with %
  // Make thrombus effect larger when athero is present (synergy).
  // thrombusBias already used for narrowing; reuse here and amplify by athero fraction.
  const aFracLocal = a / 100.0;
  const thrombusAtheroSynergy = 2.0; // additional multiplier per full athero fraction
  const thrombusMultiplier = 1.0 + thrombusAtheroSynergy * aFracLocal;
  const thrombusIschemia = constrain(tFactor * thrombusBias * thrombusMultiplier * 100.0, 0, 100);

    // The effective ischemia is at least the thrombus-driven value or the METs-driven base
    let effectiveIschemia = Math.max(baseIschemia, thrombusIschemia);

    // Per new rule: only allow ischemia to exceed 95% when anatomical narrowing > 99%.
    // Otherwise cap ischemia at 95%.
    const capLevel = 85.0;
    if (combinedFrac > 0.99) {
      // ramp from capLevel -> 100 as combinedFrac goes 0.99 -> 1.0
      const f = constrain((combinedFrac - 0.99) / 0.01, 0, 1);
      // start ramp from at most capLevel
      const start = Math.min(effectiveIschemia, capLevel);
      return lerp(start, 100.0, f);
    }

    // Not yet beyond the 99% anatomical threshold: cap ischemia at 95%.
    return Math.min(effectiveIschemia, capLevel);
  }

  let baselineT = tWaveScale;
  let baselineST = stOffset;
  // compute derived ischemia and update displayed readout
  const derivedIschemia = computeIschemia(atheroPercent, METs, thrombusPercent);
  ischemiaPercent = derivedIschemia;
  if (typeof ischemiaSpan !== 'undefined') ischemiaSpan.textContent = String(Math.round(ischemiaPercent));
  if (typeof ischemiaSlider !== 'undefined') ischemiaSlider.value = String(Math.round(ischemiaPercent));

  let pct = constrain(ischemiaPercent, 0, 100);
  let effT = baselineT;
  let effST = baselineST;
  if (pct > 0) {
    if (pct <= 50) {
      let f = pct / 50.0;
      effT = lerp(baselineT, -1, f);
      effST = baselineST;
    } else if (pct <= 90) {
      effT = -1;
      let f = (pct - 50) / 40.0;
      effST = lerp(baselineST, -0.4, f);
    } else if (pct <= 95) {
      effT = -1;
      let f = (pct - 90) / 5.0;
      effST = lerp(-0.4, 0.1, f);
    } else {
      let f = (pct - 95) / 5.0;
      effT = lerp(-1, -0.25, f);
      effST = lerp(0.1, 0.7, f);
    }
  }

  // align sampling to device pixel grid
  const dpr = window._ecg_dpr || (window.devicePixelRatio || 1);
  const align = (v) => Math.round(v * dpr) / dpr;
  let prevX = null;
  let prevY = null;
  for (let x = 0; x <= width; x += 1) {
    let t = now - (width - x) / pixelsPerSecond;
    let v = 0;
    for (let bt of beatTimes) v += singleBeatSignal(t - bt, effT, effST);
    let y = centerY - v * amplitude;
    const xA = align(x);
    const yA = align(y);
    if (prevX !== null) line(prevX, prevY, xA, yA);
    prevX = xA; prevY = yA;
  }

  // Draw labels for P, QRS, T for beats that are (mostly) visible
  textFont('Helvetica');
  textSize(16);
  fill(120);
  noStroke();
  for (let bt of beatTimes) {
    // P wave center (approx -0.20s)
    let tP = bt - 0.18;

    // QRS center (0s)
    let tQRS = bt;

    // T wave center (+0.35s)
    let tT = bt + 0.35;
  }

  // Small HUD for heart rate
  push();
  fill(0);
  noStroke();
  rect(10, 10, 140, 34, 6);
  fill(255);
  textSize(16);
  text('HR: ' + Math.round(hr) + ' bpm', 18, 32);
  pop();
}

// Convert a timestamp to an x coordinate on screen given current time
function timeToX(t, now, pixelsPerSecond) {
  return width - (now - t) * pixelsPerSecond;
}

// Single beat signal function (seconds relative to beat center)
// Composed of P wave (small, negative/positive), QRS (sharp), and T wave (broader)
// singleBeatSignal now accepts an optional per-lead multiplier object: {q,r,s,t}
function singleBeatSignal(t, effTWaveScale, effSTOffset, leadMults, stOpts) {
  // We'll build each wave with explicit windows so we can enforce
  // small baseline intervals between waves.
  // Default / dynamic window boundaries (relative to QRS at t=0)
  const pStartDefault = -0.28;
  // move P a little closer to QRS by default so it's more visible at higher HR
  const pEndDefault = -0.10;
  // Compute Q/R/S windows from per-component durations so they can expand
  // q center sits slightly before R (negative), r is centered at 0, s after R
  const qCenter = -0.03;
  const rCenter = 0.0;
  // Use per-component durations (seconds) and allow an overall qrsWidth multiplier
  const qHalf = (qDur * qrsWidth) / 2.0;
  const rHalf = (rDur * qrsWidth) / 2.0;
  const sHalf = (sDur * qrsWidth) / 2.0;
  // Start/end for Q (entire Q interval)
  let qStart = qCenter - qHalf;
  let qEnd = qCenter + qHalf;
  // R window
  let rStart = rCenter - rHalf;
  let rEnd = rCenter + rHalf;
  // S window: place it immediately after R with a small default gap if needed
  const sGap = 0.006; // minimal gap between R end and S start
  let sStart = rEnd + sGap - sHalf;
  let sEnd = rEnd + sGap + sHalf;
  const tStartDefault = Math.max(rEnd + sGap + sHalf + 0.02, 0.12);
  const tEnd = 0.55;

  // Minimum gaps (seconds)
  // Relaxed to give user more direct control via PR and P-duration sliders
  const minPQGap = 0.005; // gap between end of P and start of Q
  const minTPGap = 0.02; // gap between end of T and start of next P

  // Adjust P window end so P and Q are separated by at least minPQGap
  let pStart = pStartDefault;
  let pEnd = Math.min(pEndDefault, qStart - minPQGap);
  if (pEnd <= pStart + 0.01) {
    // ensure a tiny width
    pEnd = pStart + 0.01;
  }

  // Previously this constraint used the beat period (HR) to enforce a gap
  // between T end and the next beat's P start. We remove HR dependence
  // here and instead use a fixed early bound so PR and P-duration
  // sliders control placement directly.
  const neededPStart = -1.0;
  if (pStart < neededPStart) {
    // shift P start later to create the required gap
    pStart = neededPStart;
    // keep pEnd not after qStart - minPQGap
    pEnd = Math.min(pEnd, qStart - minPQGap);
    if (pEnd <= pStart + 0.01) pEnd = pStart + 0.01;
  }

  // Helper: smooth rectangular window (raised-cosine taper)
  function smoothWindow(x, a, b) {
    if (x <= a || x >= b) return 0.0;
    const w = (x - a) / (b - a);
    // taper 10% of edges
    const edge = 0.1;
    if (w < edge) {
      const t = w / edge;
      return 0.5 * (1 - Math.cos(Math.PI * t));
    } else if (w > 1 - edge) {
      const t = (1 - w) / edge;
      return 0.5 * (1 - Math.cos(Math.PI * t));
    }
    return 1.0;
  }

  // P component: use user-controlled P duration while still respecting minimal gaps.
  let desiredPdur = pDuration; // seconds (user-controlled)

  // Preferred P center derived from PR interval (user control)
  const pCenterPref = qStart - prDur;
  // Start with center-based windows
  let pCenter = pCenterPref;
  pStart = pCenter - desiredPdur / 2.0;
  pEnd = pCenter + desiredPdur / 2.0;

  // Enforce that P ends before Q start minus minPQGap by shifting left if needed
  const latestPEnd = qStart - minPQGap;
  if (pEnd > latestPEnd) {
    const shift = pEnd - latestPEnd;
    pStart -= shift;
    pEnd = latestPEnd;
    pCenter -= shift;
  }

  // Ensure there's a gap between current beat's T end and the NEXT beat's P start.
  // If pStart is too early, try shifting right; if that would push pEnd past latestPEnd,
  // shrink the duration to fit between neededPStart and latestPEnd.
  if (pStart < neededPStart) {
    const shiftRight = neededPStart - pStart;
    pStart += shiftRight;
    pEnd += shiftRight;
    pCenter += shiftRight;
    if (pEnd > latestPEnd) {
      // not enough room: shrink to available space
      const available = Math.max(0.0, latestPEnd - neededPStart);
      const newDur = Math.max(0.01, available);
      pStart = neededPStart;
      pEnd = pStart + newDur;
      pCenter = (pStart + pEnd) / 2.0;
      desiredPdur = newDur;
    }
  }

  // Guard minimum width
  if (pEnd <= pStart + 0.001) {
    pEnd = pStart + 0.001;
    desiredPdur = pEnd - pStart;
    pCenter = (pStart + pEnd) / 2.0;
  }

  // ensure visible sigma (duration/4)
  const pSigma = Math.max(0.008, desiredPdur / 4.0);
  const pMult = (leadMults && typeof leadMults.p === 'number') ? leadMults.p : 1.0;
  // Base P (respecting sign of pAmp and per-lead multiplier)
  const pSign = (pAmp * pMult) >= 0 ? 1 : -1;
  let pBase = gauss(t, pCenter, pSigma) * Math.abs(pAmp * pMult) * smoothWindow(t, pStart, pEnd);
  if (pBiphasic) {
    // add a smaller opposite-phase lobe slightly later
    const bipOffset = Math.max(0.01, desiredPdur * 0.35);
    const bipSigma = Math.max(0.006, pSigma * 0.9);
    const bipAmp = 0.6 * Math.abs(pAmp * pMult);
    const second = gauss(t, pCenter + bipOffset, bipSigma) * bipAmp * smoothWindow(t, pCenter + bipOffset - bipSigma * 2, pCenter + bipOffset + bipSigma * 2);
    pBase = pSign * pBase + (-pSign) * second;
  } else {
    pBase = pSign * pBase;
  }
  let p = pBase * gP;

  // populate debug exports so UI can display computed placement
  try {
    __debug_pStart = pStart;
    __debug_pCenter = pCenter;
    __debug_pEnd = pEnd;
    __debug_pDur = desiredPdur;
  } catch (e) {}

  // Q component: small negative before R, scaled by qWaveScale and per-lead Q multiplier
  // Use the qCenter/qStart/qEnd computed earlier and per-component durations
  const qSigma = Math.max(0.002, qDur) * qrsWidth;
  const qMult = (leadMults && typeof leadMults.q === 'number') ? leadMults.q : 1.0;
  const effectiveQScale = qWaveScale * qMult;
  let q = -gauss(t, qCenter, qSigma) * 0.08 * effectiveQScale * smoothWindow(t, qStart, qEnd);
  q *= gQ;

  // R component (rCenter/rStart/rEnd computed earlier)
  const rSigma = Math.max(0.0015, rDur) * qrsWidth;
  // Reduce R amplitude smoothly as effective Q scale increases, but keep a
  // small residual R present even at high Q scales. This ensures an R
  // and S are still visible when a Q wave is large.
  const qMaxForScaling = 10.0;
  const rMin = 0.05; // minimum retained fraction of R/S amplitude
  const rScale = constrain(1.0 - (effectiveQScale / qMaxForScaling) * (1.0 - rMin), rMin, 1.0);
  const rMult = (leadMults && typeof leadMults.r === 'number') ? leadMults.r : 1.0;
  let r = gauss(t, rCenter, rSigma) * 1.0 * rScale * rMult * smoothWindow(t, rStart, rEnd);
  r *= gR;

  // S component
  const sCenter = 0.045;
  const sSigma = Math.max(0.002, sDur) * qrsWidth;
  // Raise (reduce the negative depth of) the S wave when ST elevation is present
  // so S becomes less negative as effSTOffset increases beyond a small threshold.
  const sBase = -gauss(t, sCenter, sSigma) * 0.2;
  let sScale = 1.0;
  // Use sRaiseThreshold and sFlattenAmount sliders to control when and how
  // S is raised. For effSTOffset > threshold we compute an exponential falloff
  // and blend it according to sFlattenAmount (0=no effect, 1=full).
  if (effSTOffset > sRaiseThreshold) {
    const maxOffset = sMaxOffset;
    const eps = 0.01;
    const denom = Math.max(1e-6, maxOffset - sRaiseThreshold);
    const k = Math.log(1 / eps) / denom; // decay constant
    let expScale = Math.exp(-k * (effSTOffset - sRaiseThreshold));
    expScale = constrain(expScale, 0, 1);
    sScale = (1 - sFlattenAmount) * 1 + sFlattenAmount * expScale;
    sScale = constrain(sScale, 0, 1);
  }
  // Additionally, when ST is offset (either elevated OR depressed) AND the
  // user-set ST window overlaps the S wave, the ST plateau replaces the S
  // notch — that fade-out happens further below where we know the ST window
  // bounds. Here we leave the S-shape contribution alone.
  // Blend S between its scaled negative base and a positive raise value.
  // When sScale==1 => s == sBase (original negative S).
  // When sScale==0 => s == sMaxRaise (fully raised, possibly positive).
  let sWindow = smoothWindow(t, sStart, sEnd);
  let s = (sBase * sScale + (1 - sScale) * sMaxRaise) * sWindow;
  // Apply per-lead S multiplier and the rScale attenuation
  const sMult = (leadMults && typeof leadMults.s === 'number') ? leadMults.s : 1.0;
  s *= rScale * sMult * gS;

  // T component with windowing
  // Desired T end is controlled by QT interval (ms) measured from Q onset (qStart)
  const desiredTEnd = qStart + qtIntervalMs / 1000.0;
  // Start T no earlier than a small gap after S end, but otherwise place so that T end matches desired QT
  const tStart = Math.max(sEnd + 0.02, desiredTEnd - Math.max(0.02, tDuration));
  const tEndFinal = tStart + Math.max(0.02, tDuration);
  // T center placed in the middle of the T window
  const tCenter = (tStart + tEndFinal) / 2.0;
  // Derive sigma from desired T duration (tDuration global) so sigma ~ duration/4
  const tSigma = Math.max(0.005, tDuration / 4.0);
  const tMult = (leadMults && typeof leadMults.t === 'number') ? leadMults.t : 1.0;
  let tw = gauss(t, tCenter, tSigma) * 0.36 * effTWaveScale * tMult * smoothWindow(t, tStart, tEndFinal);
  tw *= gT;

  // ST segment: a plateau over a USER-CONTROLLED time window (in ms,
  // relative to the QRS R-peak at t=0). Defaults pull from the global
  // stStartMs/stEndMs sliders; the ischemia curve can override per
  // breakpoint via stOpts.stStartMs / stOpts.stEndMs (in ms).
  //
  // The offset is added on top of whatever waves it overlaps. To avoid
  // any return to the isoelectric line at the joints we use a near-
  // instantaneous (~3 ms) cosine taper at each end so the offset is at
  // its full value almost immediately at stStart and decays just as
  // quickly at stEnd. Any wave (R tail, T onset, etc.) that occupies
  // the same time interval is summed with the offset, so the trace is
  // continuous: e.g., elevation inside R rises directly from the R peak
  // to the elevated plateau, and depression inside the S region replaces
  // the negative S notch with the depressed plateau.
  const _stStartSec = ((stOpts && typeof stOpts.stStartMs === 'number') ? stOpts.stStartMs : stStartMs) / 1000.0;
  const _stEndSec   = ((stOpts && typeof stOpts.stEndMs   === 'number') ? stOpts.stEndMs   : stEndMs)   / 1000.0;
  let stStart = _stStartSec;
  let stEndWindow = _stEndSec;
  if (stEndWindow <= stStart + 0.005) {
    stEndWindow = stStart + 0.005;
  }
  // Suppress the negative S whenever the ST window covers the S region
  // AND there's a non-trivial offset, so the depressed/elevated plateau
  // is visually contiguous with whatever wave it overlaps.
  // (sScale was computed earlier; this further fades S if the user has
  // pulled stStart back into or before the S wave.)
  if (Math.abs(effSTOffset) > 0.02 && stStart <= sEnd) {
    const overlapFrac = constrain((sEnd - stStart) / Math.max(1e-6, sEnd - sStart), 0, 1);
    s *= (1 - overlapFrac);
  }
  function stEnvelope(x, a, b) {
    if (x <= a || x >= b) return 0.0;
    const span = b - a;
    const taper = Math.min(0.003, span * 0.25); // ~3 ms onset/offset
    if (x < a + taper) {
      const u = (x - a) / taper;
      return 0.5 * (1 - Math.cos(Math.PI * u));
    }
    if (x > b - taper) {
      const u = (b - x) / taper;
      return 0.5 * (1 - Math.cos(Math.PI * u));
    }
    return 1.0;
  }
  let st = effSTOffset * stEnvelope(t, stStart, stEndWindow);

  return p + q + r + s + tw + st;
}

// Simple Gaussian helper
function gauss(x, mu, sigma) {
  let a = (x - mu) / sigma;
  return Math.exp(-0.5 * a * a);
}

// Draw single-lead ECG into provided graphics buffer `g` (width = right-half)
function drawSingleLeadTo(g, hr) {
  // local copy of ischemia mapping used in other functions
  function computeIschemia(athero, mets, thrombus) {
    const a = constrain(athero, 0, 100);
    const t = constrain(thrombus, 0, 100);
    if (a < 20 && t < 20) return 0;
    const aFactor = a <= 20 ? 0 : (a - 20) / 80.0;
    const tFactor = t / 100.0;
    const thrombusBias = 1.5;
    const combinedVuln = constrain((aFactor + thrombusBias * tFactor) / (1.0 + thrombusBias), 0, 1);
    const aFrac = a / 100.0;
    const tFrac = t / 100.0;
    const combinedFrac = Math.min(1.0, aFrac + thrombusBias * tFrac * (1.0 - aFrac));
    const metFactor = constrain((mets - 2) / (10 - 2), 0, 1);
    const vulnAmplification = 3.0;
    const metAmplifier = 1.0 + vulnAmplification * combinedVuln;
    const baseIschemia = constrain(combinedVuln * metFactor * metAmplifier * 100.0, 0, 100);
    const aFracLocal = a / 100.0;
    const thrombusAtheroSynergy = 2.0;
    const thrombusMultiplier = 1.0 + thrombusAtheroSynergy * aFracLocal;
    const thrombusIschemia = constrain(tFactor * thrombusBias * thrombusMultiplier * 100.0, 0, 100);
    let effectiveIschemia = Math.max(baseIschemia, thrombusIschemia);
    const capLevel = 85.0;
    if (combinedFrac > 0.99) {
      const f = constrain((combinedFrac - 0.99) / 0.01, 0, 1);
      const start = Math.min(effectiveIschemia, capLevel);
      return lerp(start, 100.0, f);
    }
    return Math.min(effectiveIschemia, capLevel);
  }

  const now = millis() / 1000.0;
  const beatPeriod = 60.0 / hr;
  const areaWidth = Math.max(1, g.width);
  const pixelsPerSecond = areaWidth / timeWindow;

  // layout inside buffer
  const padTop = 22;
  const padBottom = 8;
  const traceY0 = padTop;
  const traceH = Math.max(8, g.height - padTop - padBottom);
  const centerY = traceY0 + traceH * 0.5;

  // beat times
  let tStart = now - timeWindow - 1.0;
  let tEnd = now + 1.0;
  let firstBeat = Math.floor(tStart / beatPeriod) * beatPeriod;
  let beatTimes = [];
  for (let bt = firstBeat; bt < tEnd; bt += beatPeriod) beatTimes.push(bt);

  // compute ischemia-based T/ST
  const derivedIschemia = computeIschemia(atheroPercent, METs, thrombusPercent);
  // Publish to global so the readout (and any other UI) stays in sync. The
  // 12-lead path (drawECG) does this too; single-lead used to compute it
  // locally and never write it back, leaving the readout frozen at 0.
  ischemiaPercent = derivedIschemia;
  if (typeof ischemiaSpan !== 'undefined' && ischemiaSpan) ischemiaSpan.textContent = String(Math.round(ischemiaPercent));
  if (typeof ischemiaSlider !== 'undefined' && ischemiaSlider) ischemiaSlider.value = String(Math.round(ischemiaPercent));
  const eff = mapIschemiaToEff(derivedIschemia);

  // Build single-beat template (sampled at 1 px)
  const W = Math.max(1, Math.round(areaWidth));
  const templateLen = W * 2 + 1;
  const template = new Array(templateLen).fill(0);
  const mid = W;
  for (let k = 0; k < templateLen; k++) {
    const t_rel = (k - mid) / pixelsPerSecond;
    template[k] = singleBeatSignal(t_rel, eff.effT, eff.effST);
  }

  // accumulate integer-shifted beats
  const acc = new Array(W + 1).fill(0);
  for (let bt of beatTimes) {
    // include user horizontal shift so the single-lead buffer is translated
    const deltaSec = now - bt + (typeof ecgWaveShift === 'number' ? ecgWaveShift : 0);
    const shift = Math.round(deltaSec * pixelsPerSecond);
    for (let ix = 0; ix <= W; ix++) {
      const k = ix + shift;
      if (k >= 0 && k < templateLen) acc[ix] += template[k];
    }
  }

  // draw to buffer
  g.push();
  g.clear();
  // grid
  g.noFill();
  g.stroke(230);
  g.strokeWeight(1);
  const step = 20;
  for (let x = 0; x <= areaWidth; x += step) g.line(x, 0, x, g.height);
  for (let y = 0; y <= g.height; y += step) g.line(0, y, areaWidth, y);

  g.stroke(20, 80, 20);
  g.strokeWeight(1);
  const dpr = window._ecg_dpr || (window.devicePixelRatio || 1);
  const alignBuf = (v) => Math.round(v * dpr) / dpr;
  const ampScale = traceH * 0.09;
  let prevX = null, prevY = null;
  for (let ix = 0; ix <= W; ix++) {
    const xA = alignBuf(ix);
    const v = acc[ix] || 0;
    const py = centerY - v * ampScale;
    const yA = alignBuf(py);
    if (prevX !== null) g.line(prevX, prevY, xA, yA);
    prevX = xA; prevY = yA;
  }

  // small HUD
  g.push();
  g.fill(0); g.noStroke(); g.rect(10, 10, 200, 44, 6);
  g.fill(255); g.textSize(14); g.text('HR: ' + Math.round(hr) + ' bpm', 18, 30);
  g.textSize(12);
  const qDurMs = Math.round((qDur || 0) * 1000);
  const rDurMs = Math.round((rDur || 0) * 1000);
  const sDurMs = Math.round((sDur || 0) * 1000);
  const qrsMs = Math.round(((qDur || 0) + (rDur || 0) + (sDur || 0)) * qrsWidth * 1000);
  g.text('QRS: ' + qrsMs + ' ms  Q:' + qDurMs + ' ms R:' + rDurMs + ' ms S:' + sDurMs + ' ms', 18, 44);
  g.pop();

  g.pop();
}

// Temporarily override global waveform variables with the provided waveform
// object, execute `fn`, then restore previous globals. Useful for drawing
// sequence entries without permanently changing the app state.
function applyWaveformTemporarily(waveform, fn) {
  if (!waveform || typeof fn !== 'function') return fn && fn();
  const keys = ['atheroPercent','thrombusPercent','METs','heartRate','amplitude','timeWindow','tWaveScale','qWaveScale','stOffset','tDuration','qtIntervalMs','pDuration','pAmp','qrsWidth','qDur','rDur','sDur','pBiphasic','gP','gQ','gR','gS','gT','prDur','ecgWaveShift','overlayUsesDilation','showConductionOverlay'];
  const old = {};
  try {
    keys.forEach(k => { if (typeof window[k] !== 'undefined') old[k] = window[k]; window[k] = (typeof waveform[k] !== 'undefined') ? waveform[k] : window[k]; });
    return fn();
  } catch (e) { console.warn('applyWaveformTemporarily error', e); }
  finally {
    try { keys.forEach(k => { if (k in old) window[k] = old[k]; else delete window[k]; }); } catch (e) {}
  }
}

// Draw a single static beat (no moving indicator) into graphics buffer `g`.
// This samples a single canonical beat across the width and renders it.
function drawStaticSingleLeadTo(g, hr) {
  try {
    g.push();
    g.clear();
    // grid
    g.noFill(); g.stroke(230); g.strokeWeight(1);
    const step = 20;
    for (let x = 0; x <= g.width; x += step) g.line(x, 0, x, g.height);
    for (let y = 0; y <= g.height; y += step) g.line(0, y, g.width, y);

    const padLeft = 6, padRight = 6, padTop = 22, padBottom = 8;
    const W = Math.max(2, g.width - padLeft - padRight);
    const H = Math.max(8, g.height - padTop - padBottom);
    const centerY = padTop + H * 0.5;
    const amp = H * 0.09;

    // canonical sampling window used elsewhere
    const baseShift = -0.15;
    const canonicalStart = -0.2 + baseShift;
    const canonicalEnd = 0.6 - 0.15;
    const tRelStart = canonicalStart + (typeof ecgWaveShift === 'number' ? ecgWaveShift : 0);
    const tRelRange = canonicalEnd - canonicalStart;

    g.stroke(20, 80, 20); g.strokeWeight(1);
    let prevX = null, prevY = null;
    for (let ix = 0; ix <= W; ix++) {
      const frac = ix / W;
      const t_rel = tRelStart + frac * tRelRange;
      // Use current waveform globals (possibly overridden via applyWaveformTemporarily)
      const derived = computeIschemia(atheroPercent, METs, thrombusPercent);
      const eff = mapIschemiaToEff(derived);
      const v = singleBeatSignal(t_rel, eff.effT, eff.effST, {p:1,q:1,r:1,s:1,t:1}, { stStartMs: eff.effStStartMs, stEndMs: eff.effStEndMs });
      const x = padLeft + ix;
      const y = centerY - v * amp;
      const xa = Math.round(x * (window._ecg_dpr || 1)) / (window._ecg_dpr || 1);
      const ya = Math.round(y * (window._ecg_dpr || 1)) / (window._ecg_dpr || 1);
      if (prevX !== null) g.line(prevX, prevY, xa, ya);
      prevX = xa; prevY = ya;
    }

    // HUD label
    g.noStroke(); g.fill(0); g.textSize(12); g.textAlign(LEFT, TOP);
    g.text('HR: ' + Math.round(hr) + ' bpm', 8, 6);
    g.pop();
  } catch (e) { console.warn('drawStaticSingleLeadTo error', e); }
}

// Draw up to MAX_SEQUENCE_DISPLAY full ECG waveforms side-by-side into the
// right-half area defined by (ix,iy,iw,ih). Uses presetSequence array to
// determine which presets to draw and falls back to current waveform when
// a preset is missing.
function drawSequenceOnRight(ix, iy, iw, ih) {
  try {
    const n = Math.min(MAX_SEQUENCE_DISPLAY, Math.max(1, presetSequence.length));
    const colW = Math.floor(iw / n) || iw;
    const allPresets = _getAllPresets();
    // ensure preview buffers exist and are the right size
    for (let i = 0; i < n; i++) {
      const needW = colW;
      const needH = ih;
      if (!seqPreviewBuffers[i] || seqPreviewBuffers[i].width !== needW || seqPreviewBuffers[i].height !== needH) {
        try { if (seqPreviewBuffers[i] && seqPreviewBuffers[i].remove) seqPreviewBuffers[i].remove(); } catch (e) {}
        seqPreviewBuffers[i] = createGraphics(needW, needH);
        try { if (typeof seqPreviewBuffers[i].pixelDensity === 'function') seqPreviewBuffers[i].pixelDensity(window._ecg_dpr || 1); } catch (e) {}
      }
    }

    // regenerate snapshots only when needed (capture static copies)
    if (seqPreviewNeedsUpdate) {
      for (let i = 0; i < n; i++) {
        const name = presetSequence[i];
        const presetObj = (allPresets && allPresets[name]) ? allPresets[name] : null;
        const waveform = presetObj && presetObj.waveform ? presetObj.waveform : null;
        const buf = seqPreviewBuffers[i];
        if (!buf) continue;
        // Draw a STATIC single-beat snapshot using the preset waveform (no moving indicator)
        applyWaveformTemporarily(waveform, () => { try { drawStaticSingleLeadTo(buf, (waveform && waveform.heartRate) ? waveform.heartRate : heartRate); } catch (e) { console.warn('drawStaticSingleLeadTo preview error', e); } });
      }
      seqPreviewNeedsUpdate = false;
    }

    // blit each static snapshot and draw the moving indicator line per-column
    for (let i = 0; i < n; i++) {
      const name = presetSequence[i];
      const buf = seqPreviewBuffers[i];
      if (!buf) continue;
      image(buf, ix + i * colW, iy);
      // label the preset name (kept subtle)
      noStroke(); fill(0); textSize(12); textAlign(LEFT, TOP);
      const label = name || ('Preset ' + (i+1));
      text(label, ix + i * colW + 6, iy + 6);
    }
    
  } catch (e) { console.warn('drawSequenceOnRight error', e); }
}

// Draw the transverse vessel inside the small DOM canvas
function drawVessel() {
  if (!vesselCtx || !vesselCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  // ensure transform accounts for pixel ratio
  vesselCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = vesselCanvas.width / dpr;
  const h = vesselCanvas.height / dpr;
  vesselCtx.clearRect(0, 0, w, h);

  // center and radii
  const cx = w / 2;
  const cy = h / 2;
  const outerR = Math.min(w, h) * 0.45; // wall outer radius
  const wallThickness = Math.max(4, outerR * 0.14);
  const innerR = outerR - wallThickness; // lumen radius

  // draw vessel wall (outer)
  vesselCtx.beginPath();
  vesselCtx.arc(cx, cy, outerR, 0, Math.PI * 2);
  vesselCtx.fillStyle = '#f0f0f0';
  vesselCtx.fill();
  vesselCtx.lineWidth = 2;
  vesselCtx.strokeStyle = '#999';
  vesselCtx.stroke();
  // draw lumen and concentric plaque narrowing based on atheroPercent
  const aPercent = constrain(atheroPercent, 0, 100);
  const aFrac = aPercent / 100.0;
  // compute new inner lumen radius (concentric narrowing)
  const minLumen = 1; // minimal visible lumen radius in pixels
  let newInnerR = innerR;
  // compute inner radius after athero alone
  const tPercent_raw = constrain(thrombusPercent, 0, 100);
  const tFrac = tPercent_raw / 100.0;
  const thrombusBias = 1.5; // thrombus contributes more per percent
  const innerR_afterAthero = Math.max(minLumen, innerR * (1.0 - aFrac));

  // combined narrowing: thrombus eats into the remaining lumen after athero
  const extraFrac = thrombusBias * tFrac * (1.0 - aFrac);
  const combinedFrac = Math.min(1.0, aFrac + extraFrac);
  newInnerR = Math.max(minLumen, innerR * (1.0 - combinedFrac));

  // draw athero annulus (between innerR and innerR_afterAthero) if present
  if (aFrac > 0.001 && innerR_afterAthero < innerR - 0.5) {
    vesselCtx.beginPath();
    vesselCtx.arc(cx, cy, innerR, 0, Math.PI * 2, false);
    vesselCtx.arc(cx, cy, innerR_afterAthero, 0, Math.PI * 2, true);
    vesselCtx.closePath();
    // plaque color: match vessel wall (gray)
    vesselCtx.fillStyle = '#f0f0f0';
    vesselCtx.fill();
    vesselCtx.strokeStyle = '#999';
    vesselCtx.lineWidth = Math.max(1, Math.round(innerR * 0.03));
    vesselCtx.stroke();
  }

  // draw thrombus annulus (between innerR_afterAthero and newInnerR) if thrombus narrows further
  if (tFrac > 0.001 && newInnerR < innerR_afterAthero - 0.5) {
    vesselCtx.beginPath();
    vesselCtx.arc(cx, cy, innerR_afterAthero, 0, Math.PI * 2, false);
    vesselCtx.arc(cx, cy, newInnerR, 0, Math.PI * 2, true);
    vesselCtx.closePath();
    // thrombus color: brown
    vesselCtx.fillStyle = '#8B4513';
    vesselCtx.fill();
    vesselCtx.strokeStyle = '#5a2b0a';
    vesselCtx.lineWidth = Math.max(1, Math.round(innerR * 0.02));
    vesselCtx.stroke();
  }

  // draw lumen at the (possibly) narrowed radius
  vesselCtx.beginPath();
  vesselCtx.arc(cx, cy, newInnerR, 0, Math.PI * 2);
  vesselCtx.fillStyle = '#ffdddd';
  vesselCtx.fill();
  vesselCtx.lineWidth = 1.5;
  vesselCtx.strokeStyle = '#cc6666';
  vesselCtx.stroke();

  // (thrombus now represented as annulus; no central dot)
}

// =============================================================================
// App chrome: unified top toolbar + consistent panel styling.
// Built on top of the pre-existing panels (globalControlPanel,
// conductionPanelDiv, leadControlsDiv, basicPanel, data-file div). Adds a
// stylesheet, a top toolbar with toggle buttons, and a shared header bar
// (title + close X) on each panel. Hides the old scattered toggle buttons.
// Idempotent: safe to call once after panels exist.
// =============================================================================
function installAppChrome() {
  if (window.__appChromeInstalled) return;
  window.__appChromeInstalled = true;

  // ---- Inject stylesheet ---------------------------------------------------
  const css = `
    :root {
      --app-bg: #f7f9fc;
      --app-panel-bg: #ffffff;
      --app-panel-border: rgba(15, 23, 42, 0.08);
      --app-panel-shadow: 0 8px 24px rgba(15, 23, 42, 0.10);
      --app-text: #0f172a;
      --app-muted: #475569;
      --app-accent: #2563eb;
      --app-accent-hover: #1d4ed8;
      --app-danger: #dc2626;
      --app-success: #16a34a;
      --app-toolbar-h: 48px;
      --app-radius: 8px;
    }
    .app-toolbar {
      position: fixed; top: 0; left: 0; right: 0;
      height: var(--app-toolbar-h);
      display: flex; align-items: center; gap: 6px;
      padding: 0 12px;
      background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
      border-bottom: 1px solid var(--app-panel-border);
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
      z-index: 11000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px;
      color: var(--app-text);
    }
    .app-toolbar__brand {
      font-weight: 700; letter-spacing: 0.2px;
      padding: 0 12px 0 4px;
      color: var(--app-text);
      border-right: 1px solid var(--app-panel-border);
      margin-right: 6px;
    }
    .app-toolbar__spacer { flex: 1 1 auto; }
    .app-toolbar__readout {
      font-variant-numeric: tabular-nums;
      color: var(--app-muted);
      padding: 0 8px;
      white-space: nowrap;
    }
    .app-btn {
      appearance: none;
      font: inherit;
      color: var(--app-text);
      background: #ffffff;
      border: 1px solid var(--app-panel-border);
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
      line-height: 1.2;
    }
    .app-btn:hover { background: #f1f5f9; }
    .app-btn:active { background: #e2e8f0; }
    .app-btn--toolbar { padding: 6px 12px; }
    .app-btn--toolbar.is-active {
      background: var(--app-accent);
      border-color: var(--app-accent);
      color: #ffffff;
    }
    .app-btn--primary {
      background: var(--app-accent);
      border-color: var(--app-accent);
      color: #ffffff;
    }
    .app-btn--primary:hover { background: var(--app-accent-hover); border-color: var(--app-accent-hover); }
    .app-btn--danger { color: var(--app-danger); }
    .app-btn--danger:hover { background: #fee2e2; border-color: #fecaca; }
    .app-btn--icon {
      padding: 4px 8px;
      line-height: 1;
      font-size: 16px;
    }

    .app-panel {
      position: fixed;
      top: calc(var(--app-toolbar-h) + 8px);
      background: var(--app-panel-bg) !important;
      border: 1px solid var(--app-panel-border) !important;
      border-radius: var(--app-radius) !important;
      box-shadow: var(--app-panel-shadow);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: var(--app-text);
      z-index: 10500;
      overflow: hidden;
      display: flex; flex-direction: column;
    }
    .app-panel--hidden { display: none !important; }
    .app-panel__header {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      background: #f8fafc;
      border-bottom: 1px solid var(--app-panel-border);
      font-weight: 600;
      font-size: 13px;
      user-select: none;
      cursor: move;
    }
    .app-panel__title { flex: 1 1 auto; }
    .app-panel__close {
      appearance: none;
      background: transparent;
      border: none;
      color: var(--app-muted);
      font-size: 18px;
      line-height: 1;
      padding: 2px 6px;
      cursor: pointer;
      border-radius: 4px;
    }
    .app-panel__close:hover { background: #e2e8f0; color: var(--app-text); }
    .app-panel__body {
      padding: 10px 12px;
      overflow: auto;
      flex: 1 1 auto;
    }

    /* Style the existing inline buttons & inputs inside our panels for a
       cohesive look without rewriting them. */
    .app-panel button,
    .app-panel input[type="button"] {
      font: inherit;
      background: #ffffff;
      color: var(--app-text);
      border: 1px solid var(--app-panel-border);
      border-radius: 6px;
      padding: 4px 9px;
      cursor: pointer;
      transition: background 120ms ease;
    }
    .app-panel button:hover { background: #f1f5f9; }
    .app-panel select,
    .app-panel input[type="text"],
    .app-panel input[type="number"],
    .app-panel textarea {
      font: inherit;
      color: var(--app-text);
      background: #ffffff;
      border: 1px solid var(--app-panel-border);
      border-radius: 6px;
      padding: 3px 6px;
    }
    .app-panel input[type="range"] { accent-color: var(--app-accent); }
  `;
  const style = document.createElement('style');
  style.id = 'app-chrome-style';
  style.textContent = css;
  document.head.appendChild(style);

  // ---- Hide redundant legacy controls -------------------------------------
  const oldToggle = document.getElementById('toggleConstructorBtn');
  if (oldToggle) oldToggle.style.display = 'none';
  // The pop-out button at top:84px right:10px has no id; find by text.
  Array.from(document.querySelectorAll('button')).forEach(b => {
    const t = (b.textContent || '').trim();
    if (t === 'Pop Out Constructor' && b.style.position === 'fixed') {
      b.style.display = 'none';
    }
  });
  // Hide the basic panel (its functions are folded into the toolbar / panels).
  const basicEl = document.getElementById('basicPanel');
  if (basicEl) basicEl.style.display = 'none';
  // Hide the bottom-left "Data: local" controls bar; we expose its functions
  // via toolbar buttons and the data-file status in the toolbar.
  if (window._sketchDataStatusSpan && window._sketchDataStatusSpan.parentNode) {
    const dataBar = window._sketchDataStatusSpan.parentNode;
    dataBar.style.display = 'none';
  }

  // ---- Helper: wrap an existing panel with chrome (header + close) -------
  function wrapAsPanel(panel, title, opts) {
    if (!panel || panel.__chromeWrapped) return;
    panel.__chromeWrapped = true;
    panel.classList.add('app-panel');
    // Move existing children into a body wrapper.
    const body = document.createElement('div');
    body.className = 'app-panel__body';
    while (panel.firstChild) body.appendChild(panel.firstChild);
    // Header
    const header = document.createElement('div');
    header.className = 'app-panel__header';
    const titleEl = document.createElement('div');
    titleEl.className = 'app-panel__title';
    titleEl.textContent = title;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'app-panel__close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close (Esc)';
    closeBtn.onclick = () => { setPanelOpen(panel, false); };
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    panel.appendChild(header);
    panel.appendChild(body);
    panel.__bodyEl = body;
    panel.__headerEl = header;
    panel.__titleEl = titleEl;

    // Apply layout from opts: width, height, position
    if (opts && opts.width) panel.style.width = opts.width;
    if (opts && opts.height) panel.style.height = opts.height;
    if (opts && typeof opts.right === 'string') panel.style.right = opts.right;
    if (opts && typeof opts.left === 'string') panel.style.left = opts.left;
    if (opts && typeof opts.top === 'string') panel.style.top = opts.top;
    if (opts && typeof opts.bottom === 'string') panel.style.bottom = opts.bottom;
    if (opts && typeof opts.maxWidth === 'string') panel.style.maxWidth = opts.maxWidth;
    if (opts && typeof opts.maxHeight === 'string') panel.style.maxHeight = opts.maxHeight;

    // Drag-by-header so users can reposition panels.
    enableDrag(panel, header);
  }

  function setPanelOpen(panel, open) {
    if (!panel) return;
    if (open) {
      panel.classList.remove('app-panel--hidden');
      panel.style.display = '';
    } else {
      panel.classList.add('app-panel--hidden');
    }
    syncToolbarActiveStates();
  }
  function isPanelOpen(panel) {
    if (!panel) return false;
    return !panel.classList.contains('app-panel--hidden') && panel.style.display !== 'none';
  }

  function enableDrag(panel, handle) {
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
    handle.addEventListener('mousedown', (e) => {
      // Don't start drag from buttons inside the header
      if (e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      origLeft = rect.left; origTop = rect.top;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.left = origLeft + 'px';
      panel.style.top = origTop + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = (origLeft + (e.clientX - startX)) + 'px';
      panel.style.top = (origTop + (e.clientY - startY)) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // ---- Wrap the real panels -----------------------------------------------
  // Waveform/global controls panel
  if (window.globalControlPanel || (typeof globalControlPanel !== 'undefined' && globalControlPanel)) {
    const p = window.globalControlPanel || globalControlPanel;
    wrapAsPanel(p, 'Waveform & ECG Controls', { left: '12px', top: 'calc(var(--app-toolbar-h) + 8px)', width: '360px', maxHeight: 'calc(100vh - var(--app-toolbar-h) - 24px)' });
  }
  // Constructor panel
  if (typeof conductionPanelDiv !== 'undefined' && conductionPanelDiv) {
    wrapAsPanel(conductionPanelDiv, 'Conduction Constructor', { right: '12px', top: 'calc(var(--app-toolbar-h) + 8px)', width: 'min(1200px, calc(100vw - 24px))', maxHeight: 'calc(100vh - var(--app-toolbar-h) - 24px)' });
    // The "Hide Constructor" / "Basic View" buttons inside the body are now
    // redundant; remove them if found.
    try {
      conductionPanelDiv.querySelectorAll('button').forEach(b => {
        const t = (b.textContent || '').trim();
        if (t === 'Basic View') b.style.display = 'none';
      });
    } catch (e) {}
  }
  // Leads panel: do NOT wrap as a chrome panel because leadControlsDiv is a
  // full-screen overlay holding 12 absolutely-positioned per-lead boxes.
  // Wrapping would re-anchor their coordinates. Instead the toolbar Leads
  // button toggles its display directly.
  if (typeof leadControlsDiv !== 'undefined' && leadControlsDiv) {
    // Mark as panel-like for isPanelOpen / setPanelOpen helpers.
    leadControlsDiv.classList.add('app-panel--like');
  }

  // ---- Build a Files panel from the legacy data-file controls -------------
  let filesPanel = null;
  filesPanel = document.createElement('div');
  filesPanel.id = 'appFilesPanel';
  filesPanel.classList.add('app-panel', 'app-panel--hidden');
  filesPanel.style.left = '12px';
  filesPanel.style.top = 'calc(var(--app-toolbar-h) + 8px)';
  filesPanel.style.width = '320px';
  document.body.appendChild(filesPanel);
  {
    const header = document.createElement('div');
    header.className = 'app-panel__header';
    const titleEl = document.createElement('div'); titleEl.className = 'app-panel__title'; titleEl.textContent = 'Files & Data';
    const closeBtn = document.createElement('button'); closeBtn.className = 'app-panel__close'; closeBtn.textContent = '×'; closeBtn.title = 'Close (Esc)';
    closeBtn.onclick = () => setPanelOpen(filesPanel, false);
    header.appendChild(titleEl); header.appendChild(closeBtn);
    const body = document.createElement('div'); body.className = 'app-panel__body';
    body.style.display = 'flex'; body.style.flexDirection = 'column'; body.style.gap = '8px';

    function row(...kids) {
      const r = document.createElement('div');
      r.style.display = 'flex'; r.style.gap = '6px'; r.style.flexWrap = 'wrap';
      kids.forEach(k => r.appendChild(k));
      return r;
    }
    function btn(label, onClick, opts) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'app-btn' + (opts && opts.primary ? ' app-btn--primary' : '');
      b.onclick = onClick;
      if (opts && opts.title) b.title = opts.title;
      return b;
    }

    const status = document.createElement('div');
    status.style.fontSize = '12px'; status.style.color = 'var(--app-muted)';
    status.textContent = window._sketchDataHandle ? 'Storage: file' : 'Storage: local';
    setInterval(() => {
      try { status.textContent = window._sketchDataHandle ? 'Storage: file' : 'Storage: local'; } catch (e) {}
    }, 1000);

    body.appendChild(status);
    body.appendChild(row(
      btn('Open data file…', () => { try { promptOpenDataFile(); } catch (e) {} }),
      btn('Save as…', () => { try { promptSaveAsDataFile(); } catch (e) {} })
    ));
    body.appendChild(row(
      btn('Import CCS components…', () => { try { promptImportCcsComponents(); } catch (e) {} })
    ));
    body.appendChild(row(
      btn('New shape', () => { try { createConductionItem('shape'); refreshConductionPanel(); } catch (e) {} }),
      btn('New path', () => { try { createConductionItem('path'); refreshConductionPanel(); } catch (e) {} })
    ));

    filesPanel.appendChild(header);
    filesPanel.appendChild(body);
    enableDrag(filesPanel, header);
  }

  // ---- Build the toolbar --------------------------------------------------
  const toolbar = document.createElement('div');
  toolbar.className = 'app-toolbar';
  toolbar.id = 'appToolbar';

  const brand = document.createElement('div');
  brand.className = 'app-toolbar__brand';
  brand.textContent = 'Cardiac Sim';
  toolbar.appendChild(brand);

  // Helper: toolbar button bound to a panel
  const toolbarPanelButtons = [];
  function makeToolbarToggle(label, panel, opts) {
    const b = document.createElement('button');
    b.className = 'app-btn app-btn--toolbar';
    b.textContent = label;
    if (opts && opts.title) b.title = opts.title;
    b.onclick = () => {
      const wasOpen = isPanelOpen(panel);
      setPanelOpen(panel, !wasOpen);
    };
    toolbar.appendChild(b);
    toolbarPanelButtons.push({ btn: b, panel });
    return b;
  }

  // Pause/Resume both
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'app-btn app-btn--toolbar';
  pauseBtn.textContent = '⏸ Pause';
  pauseBtn.title = 'Pause/Resume ECG and conduction';
  pauseBtn.onclick = () => {
    try {
      // toggle global pause state by flipping both ECG and conduction
      const nowEcg = !!pausedEcg;
      // Use the same pattern as existing pause buttons
      if (!nowEcg) {
        ecgPausedAtMs = millis() - ecgTimeOffsetMs;
        pausedEcg = true;
        try { conductionPausedAtMs = millis() - conductionTimeOffsetMs; pausedConduction = true; } catch (e) {}
        pauseBtn.textContent = '▶ Resume';
        pauseBtn.classList.add('is-active');
      } else {
        ecgTimeOffsetMs = millis() - ecgPausedAtMs;
        pausedEcg = false;
        try { conductionTimeOffsetMs = millis() - conductionPausedAtMs; pausedConduction = false; } catch (e) {}
        pauseBtn.textContent = '⏸ Pause';
        pauseBtn.classList.remove('is-active');
      }
    } catch (e) { console.warn('toolbar pause error', e); }
  };
  toolbar.appendChild(pauseBtn);

  // Panel toggle buttons
  const waveformPanel = window.globalControlPanel || (typeof globalControlPanel !== 'undefined' ? globalControlPanel : null);
  const constructorPanel = (typeof conductionPanelDiv !== 'undefined') ? conductionPanelDiv : null;
  const leadsPanel = (typeof leadControlsDiv !== 'undefined') ? leadControlsDiv : null;
  if (waveformPanel) makeToolbarToggle('Waveform', waveformPanel, { title: 'Waveform & ECG controls' });
  if (constructorPanel) makeToolbarToggle('Constructor', constructorPanel, { title: 'Conduction paths/shapes constructor' });
  if (leadsPanel) makeToolbarToggle('Leads', leadsPanel, { title: 'Per-lead amplitude controls' });
  makeToolbarToggle('Files', filesPanel, { title: 'File and data controls' });

  // Pop out constructor (separate window)
  const popoutBtn = document.createElement('button');
  popoutBtn.className = 'app-btn app-btn--toolbar';
  popoutBtn.textContent = '⤢ Pop Out';
  popoutBtn.title = 'Open the constructor in its own window';
  popoutBtn.onclick = () => { try { openConductionWindow(); } catch (e) { console.warn(e); } };
  toolbar.appendChild(popoutBtn);

  // Spacer + readout
  const spacer = document.createElement('div'); spacer.className = 'app-toolbar__spacer'; toolbar.appendChild(spacer);
  const readout = document.createElement('div');
  readout.className = 'app-toolbar__readout';
  readout.id = 'appToolbarReadout';
  toolbar.appendChild(readout);

  document.body.appendChild(toolbar);

  // Push the canvas down so the toolbar doesn't overlap the ECG view.
  try {
    const canvasEl = document.querySelector('canvas');
    if (canvasEl) canvasEl.style.marginTop = '0px'; // p5 fills viewport; we just leave a gap visually via toolbar overlap
    document.body.style.paddingTop = '0';
  } catch (e) {}

  // Sync active states + readout
  function syncToolbarActiveStates() {
    toolbarPanelButtons.forEach(({ btn, panel }) => {
      if (isPanelOpen(panel)) btn.classList.add('is-active');
      else btn.classList.remove('is-active');
    });
  }
  window.__syncToolbarActive = syncToolbarActiveStates;
  // expose so close-btn handlers can call it
  // (we already reference setPanelOpen which calls it)
  setInterval(() => {
    try {
      const hr = (typeof heartRate === 'number') ? Math.round(heartRate) : '--';
      const td = (typeof timeDilation === 'number') ? timeDilation.toFixed(2) : '--';
      readout.textContent = 'HR ' + hr + ' bpm   ·   ×' + td + ' speed';
      syncToolbarActiveStates();
    } catch (e) {}
  }, 250);

  // Esc key closes any open panels
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      [waveformPanel, constructorPanel, leadsPanel, filesPanel].forEach(p => {
        if (p && isPanelOpen(p)) setPanelOpen(p, false);
      });
    }
  });

  // Default state: everything closed (clean ECG view).
  [waveformPanel, constructorPanel, leadsPanel, filesPanel].forEach(p => {
    if (p) setPanelOpen(p, false);
  });
  syncToolbarActiveStates();
}

// Install chrome shortly after setup() runs and panels are constructed.
// Delay past the data-file controls' setTimeout (1200ms) so we can hide them.
setTimeout(() => { try { installAppChrome(); } catch (e) { console.warn('installAppChrome failed', e); } }, 1500);

// =============================================================================
// Mode switching + Quick Bar + Ischemia overlay
// Adds:
//   - A toolbar "Mode" button that toggles between Conduction and Ischemia modes
//   - A bottom-right "Quick Controls" bar (waveform presets, sequence presets,
//     time dilation) anchored under the ECG strip
//   - In ischemia mode: a transverse vessel canvas above the heart image and
//     a small panel exposing athero / thrombus / METs sliders
// =============================================================================
function installModeAndQuickBar() {
  if (window.__modeAndQuickInstalled) return;
  window.__modeAndQuickInstalled = true;

  // ---- Vessel overlay (DOM canvas) -----------------------------------------
  // Positioned over the top of the left half of the p5 canvas. Hidden in
  // conduction mode, visible in ischemia mode. drawVessel() already paints
  // into vesselCanvas/vesselCtx — we just need to create them.
  const vesselWrap = document.createElement('div');
  vesselWrap.id = 'vesselWrap';
  vesselWrap.style.position = 'fixed';
  vesselWrap.style.left = '0';
  vesselWrap.style.top = 'var(--app-toolbar-h)';
  vesselWrap.style.width = '50vw';
  vesselWrap.style.height = '32vh';
  vesselWrap.style.pointerEvents = 'none';
  vesselWrap.style.display = 'none';
  vesselWrap.style.zIndex = '500';
  vesselWrap.style.padding = '12px';
  vesselWrap.style.boxSizing = 'border-box';
  const vesselCanvasEl = document.createElement('canvas');
  vesselCanvasEl.id = 'vesselCanvas';
  vesselCanvasEl.style.width = '100%';
  vesselCanvasEl.style.height = '100%';
  vesselCanvasEl.style.display = 'block';
  vesselWrap.appendChild(vesselCanvasEl);
  document.body.appendChild(vesselWrap);
  // Bind to globals used by drawVessel()
  vesselCanvas = vesselCanvasEl;
  vesselCtx = vesselCanvasEl.getContext('2d');
  function sizeVesselCanvas() {
    try {
      const dpr = window.devicePixelRatio || 1;
      const rect = vesselCanvasEl.getBoundingClientRect();
      vesselCanvasEl.width = Math.max(1, Math.round(rect.width * dpr));
      vesselCanvasEl.height = Math.max(1, Math.round(rect.height * dpr));
    } catch (e) {}
  }
  window.addEventListener('resize', sizeVesselCanvas);
  setTimeout(sizeVesselCanvas, 50);

  // ---- Ischemia controls panel --------------------------------------------
  const ischPanel = document.createElement('div');
  ischPanel.id = 'appIschemiaPanel';
  ischPanel.classList.add('app-panel', 'app-panel--hidden');
  // Place the panel at the same vertical level as the vessel canvas, on the
  // right side of the left half so it doesn't cover the vessel circle.
  ischPanel.style.left = 'calc(50vw - 332px)';
  ischPanel.style.top = 'calc(var(--app-toolbar-h) + 12px)';
  ischPanel.style.width = '320px';
  document.body.appendChild(ischPanel);
  {
    const header = document.createElement('div');
    header.className = 'app-panel__header';
    const titleEl = document.createElement('div'); titleEl.className = 'app-panel__title'; titleEl.textContent = 'Ischemia & Vessel';
    const closeBtn = document.createElement('button'); closeBtn.className = 'app-panel__close'; closeBtn.textContent = '×';
    closeBtn.onclick = () => ischPanel.classList.add('app-panel--hidden');
    header.appendChild(titleEl); header.appendChild(closeBtn);
    const body = document.createElement('div'); body.className = 'app-panel__body';
    body.style.display = 'flex'; body.style.flexDirection = 'column'; body.style.gap = '10px';

    function makeSlider(label, min, max, step, initial, onChange, unit) {
      const wrap = document.createElement('div');
      const top = document.createElement('div');
      top.style.display = 'flex'; top.style.justifyContent = 'space-between';
      top.style.fontSize = '12px'; top.style.color = 'var(--app-muted)';
      top.style.marginBottom = '4px';
      const lab = document.createElement('span'); lab.textContent = label;
      const val = document.createElement('span'); val.style.fontVariantNumeric = 'tabular-nums';
      val.textContent = String(initial) + (unit || '');
      top.appendChild(lab); top.appendChild(val);
      const input = document.createElement('input');
      input.type = 'range'; input.min = String(min); input.max = String(max);
      input.step = String(step); input.value = String(initial);
      input.style.width = '100%';
      input.oninput = (e) => {
        const v = Number(e.target.value);
        val.textContent = (Number.isInteger(step) ? String(v) : v.toFixed(2)) + (unit || '');
        onChange(v);
      };
      wrap.appendChild(top); wrap.appendChild(input);
      wrap.__input = input; wrap.__val = val;
      return wrap;
    }

    const atheroSlider = makeSlider('Atherosclerosis', 0, 100, 1, atheroPercent, (v) => {
      atheroPercent = v;
      try { saveEcgWaveformSettings(); } catch (e) {}
    }, '%');
    const thrombusSlider = makeSlider('Thrombus', 0, 100, 1, thrombusPercent, (v) => {
      thrombusPercent = v;
      try { saveEcgWaveformSettings(); } catch (e) {}
    }, '%');
    const metsSlider = makeSlider('METs (exertion)', 1, 10, 0.5, METs, (v) => {
      METs = v;
      try { saveEcgWaveformSettings(); } catch (e) {}
    }, '');

    body.appendChild(atheroSlider);
    body.appendChild(thrombusSlider);
    body.appendChild(metsSlider);

    // Live ischemia readout
    const readout = document.createElement('div');
    readout.style.fontSize = '12px';
    readout.style.color = 'var(--app-muted)';
    readout.style.padding = '6px 8px';
    readout.style.background = '#f8fafc';
    readout.style.borderRadius = '6px';
    readout.style.borderLeft = '3px solid var(--app-accent)';
    body.appendChild(readout);
    setInterval(() => {
      try {
        const isch = (typeof ischemiaPercent === 'number') ? Math.round(ischemiaPercent) : 0;
        readout.textContent = 'Effective ischemia: ' + isch + '%';
        // Also keep slider values in sync if changed elsewhere (e.g. preset load)
        if (Number(atheroSlider.__input.value) !== Math.round(atheroPercent)) {
          atheroSlider.__input.value = String(Math.round(atheroPercent));
          atheroSlider.__val.textContent = Math.round(atheroPercent) + '%';
        }
        if (Number(thrombusSlider.__input.value) !== Math.round(thrombusPercent)) {
          thrombusSlider.__input.value = String(Math.round(thrombusPercent));
          thrombusSlider.__val.textContent = Math.round(thrombusPercent) + '%';
        }
      } catch (e) {}
    }, 300);

    ischPanel.appendChild(header);
    ischPanel.appendChild(body);
  }

  // ---- Mode toggle --------------------------------------------------------
  function setMode(mode) {
    appMode = mode;
    if (mode === 'ischemia') {
      vesselWrap.style.display = '';
      ischPanel.classList.remove('app-panel--hidden');
      modeBtn.textContent = '🩺 Conduction Mode';
      modeBtn.title = 'Switch to Conduction mode';
      sizeVesselCanvas();
    } else {
      vesselWrap.style.display = 'none';
      ischPanel.classList.add('app-panel--hidden');
      modeBtn.textContent = '🫀 Ischemia Mode';
      modeBtn.title = 'Switch to Ischemia mode (vessel + athero/thrombus)';
    }
  }

  // Insert mode button into the toolbar (created by installAppChrome)
  const toolbar = document.getElementById('appToolbar');
  const modeBtn = document.createElement('button');
  modeBtn.className = 'app-btn app-btn--toolbar';
  modeBtn.textContent = '🫀 Ischemia Mode';
  modeBtn.title = 'Switch to Ischemia mode (vessel + athero/thrombus)';
  modeBtn.onclick = () => setMode(appMode === 'ischemia' ? 'conduction' : 'ischemia');
  if (toolbar) {
    // Insert before the spacer so it sits with the other primary buttons
    const spacer = toolbar.querySelector('.app-toolbar__spacer');
    if (spacer) toolbar.insertBefore(modeBtn, spacer);
    else toolbar.appendChild(modeBtn);
  }

  // ---- Quick Controls bar (under the ECG) ---------------------------------
  const quickBar = document.createElement('div');
  quickBar.id = 'appQuickBar';
  quickBar.style.position = 'fixed';
  quickBar.style.left = '50vw';
  quickBar.style.right = '12px';
  quickBar.style.bottom = '12px';
  quickBar.style.zIndex = '10000';
  quickBar.style.background = 'var(--app-panel-bg)';
  quickBar.style.border = '1px solid var(--app-panel-border)';
  quickBar.style.borderRadius = 'var(--app-radius)';
  quickBar.style.boxShadow = 'var(--app-panel-shadow)';
  quickBar.style.padding = '10px 12px';
  quickBar.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  quickBar.style.fontSize = '13px';
  quickBar.style.color = 'var(--app-text)';
  quickBar.style.marginLeft = '12px';
  quickBar.style.display = 'flex';
  quickBar.style.flexWrap = 'wrap';
  quickBar.style.gap = '14px';
  quickBar.style.alignItems = 'center';

  function group(labelText) {
    const g = document.createElement('div');
    g.style.display = 'flex'; g.style.flexDirection = 'column'; g.style.gap = '4px';
    g.style.minWidth = '0';
    const lab = document.createElement('div');
    lab.textContent = labelText;
    lab.style.fontSize = '11px'; lab.style.fontWeight = '600';
    lab.style.color = 'var(--app-muted)'; lab.style.textTransform = 'uppercase';
    lab.style.letterSpacing = '0.4px';
    g.appendChild(lab);
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.gap = '6px'; row.style.alignItems = 'center';
    g.appendChild(row);
    g.__row = row;
    return g;
  }
  function qbtn(label, onClick, opts) {
    const b = document.createElement('button');
    b.className = 'app-btn' + (opts && opts.primary ? ' app-btn--primary' : '');
    b.textContent = label;
    b.onclick = onClick;
    if (opts && opts.title) b.title = opts.title;
    return b;
  }

  // --- Waveform presets group ---
  const wpGroup = group('Waveform Preset');
  const wpSel = document.createElement('select');
  wpSel.id = 'quickPresetSelect';
  wpSel.style.minWidth = '160px';
  wpSel.style.padding = '4px 6px';
  wpSel.style.borderRadius = '6px';
  wpSel.style.border = '1px solid var(--app-panel-border)';
  wpSel.style.background = '#fff';
  wpGroup.__row.appendChild(wpSel);
  wpGroup.__row.appendChild(qbtn('Load', () => {
    const v = wpSel.value;
    if (!v) { alert('Select a preset'); return; }
    try { if (loadNamedPreset(v)) { /* loaded silently */ } else alert('Failed to load: ' + v); } catch (e) { console.warn(e); }
  }));
  wpGroup.__row.appendChild(qbtn('Save…', () => {
    const n = prompt('Save current waveform as preset name:');
    if (!n) return;
    try { if (saveNamedPreset(n)) refreshPresetSelectGlobal(); else alert('Save failed'); } catch (e) { console.warn(e); }
  }));
  quickBar.appendChild(wpGroup);

  // --- Sequence group ---
  const sqGroup = group('Sequence');
  const sqSel = document.createElement('select');
  sqSel.id = 'quickSequenceSelect';
  sqSel.style.minWidth = '160px';
  sqSel.style.padding = '4px 6px';
  sqSel.style.borderRadius = '6px';
  sqSel.style.border = '1px solid var(--app-panel-border)';
  sqSel.style.background = '#fff';
  sqGroup.__row.appendChild(sqSel);
  sqGroup.__row.appendChild(qbtn('Load', () => {
    const v = sqSel.value;
    if (!v) { alert('Select a sequence'); return; }
    try { if (loadNamedSequence(v)) { try { refreshPresetSequenceUI(); } catch (e) {} } else alert('Failed to load sequence'); } catch (e) { console.warn(e); }
  }));
  sqGroup.__row.appendChild(qbtn('Save…', () => {
    const n = prompt('Save current sequence as name:');
    if (!n) return;
    try { if (saveNamedSequence(n)) {} else alert('Save failed'); } catch (e) { console.warn(e); }
  }));
  const startSeqBtn = qbtn('Start', () => {
    try {
      if (!presetSequencePlaying) {
        presetSequenceLoop = true;
        if ((!presetSequence || presetSequence.length === 0) && sqSel.value) {
          loadNamedSequence(sqSel.value);
        }
        startPresetSequence();
      } else {
        stopPresetSequence();
      }
    } catch (e) { console.warn(e); }
  }, { primary: true });
  sqGroup.__row.appendChild(startSeqBtn);
  quickBar.appendChild(sqGroup);

  // --- Time dilation group ---
  const tdGroup = group('Speed (Time Dilation)');
  const tdInput = document.createElement('input');
  tdInput.type = 'range'; tdInput.min = '0.2'; tdInput.max = '10.0'; tdInput.step = '0.05';
  tdInput.value = String(timeDilation);
  tdInput.style.width = '180px';
  tdInput.style.accentColor = 'var(--app-accent)';
  const tdVal = document.createElement('div');
  tdVal.textContent = '×' + Number(timeDilation).toFixed(2);
  tdVal.style.fontVariantNumeric = 'tabular-nums';
  tdVal.style.minWidth = '46px';
  tdVal.style.color = 'var(--app-muted)';
  tdInput.oninput = (e) => {
    const v = Number(e.target.value) || 1.0;
    timeDilation = v;
    tdVal.textContent = '×' + v.toFixed(2);
    try { saveTimeDilation(); } catch (e) {}
    // Sync any other time-dilation inputs
    try {
      const orig = document.getElementById('timeDilationInput');
      if (orig && orig !== tdInput) orig.value = String(v);
      const origVal = document.getElementById('timeDilationVal');
      if (origVal) origVal.textContent = v.toFixed(2);
      const basic = document.getElementById('basicTimeDilationInput');
      if (basic && basic !== tdInput) basic.value = String(v);
      const basicVal = document.getElementById('basicTimeDilationVal');
      if (basicVal) basicVal.textContent = v.toFixed(2);
    } catch (e) {}
  };
  tdGroup.__row.appendChild(tdInput);
  tdGroup.__row.appendChild(tdVal);
  quickBar.appendChild(tdGroup);

  document.body.appendChild(quickBar);

  // Mirror options from constructor's preset/sequence selects into the quick
  // bar selects (the constructor's selects are auto-refreshed by
  // refreshPresetSelectGlobal / refreshSequenceSelectGlobal).
  function mirrorOptions(srcSelectId, dstSelect) {
    try {
      const src = document.getElementById(srcSelectId);
      if (!src) return;
      const prev = dstSelect.value;
      dstSelect.innerHTML = '';
      Array.from(src.options).forEach(o => {
        const no = document.createElement('option');
        no.value = o.value; no.text = o.text;
        dstSelect.appendChild(no);
      });
      // restore selection if option still exists
      if (prev && Array.from(dstSelect.options).some(o => o.value === prev)) {
        dstSelect.value = prev;
      }
    } catch (e) {}
  }
  setInterval(() => {
    mirrorOptions('presetSelect', wpSel);
    mirrorOptions('sequenceSelect', sqSel);
    // Sync Start button label with running state
    try { startSeqBtn.textContent = presetSequencePlaying ? 'Stop' : 'Start'; } catch (e) {}
    // Sync time dilation if changed elsewhere
    try {
      if (Math.abs(Number(tdInput.value) - timeDilation) > 0.001) {
        tdInput.value = String(timeDilation);
        tdVal.textContent = '×' + Number(timeDilation).toFixed(2);
      }
    } catch (e) {}
  }, 600);
  // Initial population
  setTimeout(() => {
    mirrorOptions('presetSelect', wpSel);
    mirrorOptions('sequenceSelect', sqSel);
  }, 200);

  // Initialize mode display
  setMode(appMode || 'conduction');

  // Start a render loop for the vessel canvas. drawVessel() is a no-op when
  // the canvas is hidden anyway, but we only invoke it in ischemia mode to
  // save work.
  function vesselTick() {
    try {
      if (appMode === 'ischemia' && typeof drawVessel === 'function') drawVessel();
    } catch (e) { /* ignore per-frame errors */ }
    requestAnimationFrame(vesselTick);
  }
  requestAnimationFrame(vesselTick);
}

// Install after the toolbar exists.
setTimeout(() => {
  try { installModeAndQuickBar(); }
  catch (e) { console.warn('installModeAndQuickBar failed', e); }
}, 1700);

// =============================================================================
// Ischemia Curve editor panel
// Lets you edit the piecewise-linear (pct -> effT, effST) breakpoints that
// drive how the athero / thrombus / METs sliders change the displayed ECG.
// Save current curve as a named library entry; load/delete named entries.
// =============================================================================
function installIschemiaCurveEditor() {
  if (window.__ischemiaCurveEditorInstalled) return;
  window.__ischemiaCurveEditorInstalled = true;

  // Panel
  const panel = document.createElement('div');
  panel.id = 'appIschemiaCurvePanel';
  panel.classList.add('app-panel', 'app-panel--hidden');
  panel.style.left = 'calc(50vw - 620px)';
  panel.style.top = 'calc(var(--app-toolbar-h) + 12px)';
  panel.style.width = '620px';
  panel.style.maxHeight = 'calc(100vh - var(--app-toolbar-h) - 24px)';
  panel.style.overflow = 'auto';
  document.body.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'app-panel__header';
  const title = document.createElement('div'); title.className = 'app-panel__title';
  title.textContent = 'Ischemia Curve';
  const closeBtn = document.createElement('button'); closeBtn.className = 'app-panel__close'; closeBtn.textContent = '×';
  closeBtn.onclick = () => { panel.classList.add('app-panel--hidden'); window._ischemiaPreviewPct = null; };
  header.appendChild(title); header.appendChild(closeBtn);

  const body = document.createElement('div'); body.className = 'app-panel__body';
  body.style.display = 'flex'; body.style.flexDirection = 'column'; body.style.gap = '12px';

  const help = document.createElement('div');
  help.style.fontSize = '12px';
  help.style.color = 'var(--app-muted)';
  help.style.lineHeight = '1.4';
  help.innerHTML = 'Each row is a breakpoint at a given <b>ischemia %</b>. Between breakpoints, '
    + '<b>effT</b> (T-wave scale; negative = inverted) and <b>effST</b> (ST offset; +elevation, −depression) '
    + 'are linearly interpolated from the baseline (waveform tab) at 0%. Leave a cell blank to inherit baseline.';
  body.appendChild(help);

  // Library row
  const libRow = document.createElement('div');
  libRow.style.display = 'flex'; libRow.style.gap = '6px'; libRow.style.alignItems = 'center';
  libRow.style.flexWrap = 'wrap';
  const libSel = document.createElement('select');
  libSel.style.flex = '1 1 160px'; libSel.style.minWidth = '140px';
  libSel.style.padding = '4px 6px'; libSel.style.borderRadius = '6px';
  libSel.style.border = '1px solid var(--app-panel-border)'; libSel.style.background = '#fff';
  function refreshLib() {
    const all = _getAllIschemiaCurves();
    const keys = Object.keys(all).sort();
    const prev = libSel.value;
    libSel.innerHTML = '';
    const empty = document.createElement('option'); empty.value = ''; empty.text = '-- saved curves --';
    libSel.appendChild(empty);
    keys.forEach(k => {
      const o = document.createElement('option');
      o.value = k;
      o.text = k + (all[k] && all[k].savedAt ? ('  (' + new Date(all[k].savedAt).toLocaleString() + ')') : '');
      libSel.appendChild(o);
    });
    if (prev && Array.from(libSel.options).some(o => o.value === prev)) libSel.value = prev;
  }
  function mkBtn(label, onClick, opts) {
    const b = document.createElement('button');
    b.className = 'app-btn' + (opts && opts.primary ? ' app-btn--primary' : '') + (opts && opts.danger ? ' app-btn--danger' : '');
    b.textContent = label; b.onclick = onClick;
    return b;
  }
  libRow.appendChild(libSel);
  libRow.appendChild(mkBtn('Load', () => {
    const v = libSel.value; if (!v) { alert('Pick a curve to load'); return; }
    if (loadNamedIschemiaCurve(v)) { rebuildRows(); } else alert('Failed to load curve');
  }));
  libRow.appendChild(mkBtn('Save As…', () => {
    const n = prompt('Save current curve as:'); if (!n) return;
    if (saveNamedIschemiaCurve(n)) { refreshLib(); libSel.value = n; } else alert('Save failed');
  }, { primary: true }));
  libRow.appendChild(mkBtn('Delete', () => {
    const v = libSel.value; if (!v) { alert('Pick a curve to delete'); return; }
    if (!confirm('Delete saved curve "' + v + '"?')) return;
    if (deleteNamedIschemiaCurve(v)) refreshLib(); else alert('Delete failed');
  }, { danger: true }));
  body.appendChild(libRow);

  // Breakpoint table
  const table = document.createElement('div');
  table.style.display = 'grid';
  table.style.gridTemplateColumns = '0.7fr 0.7fr 0.7fr 0.9fr 0.9fr auto';
  table.style.gap = '6px 8px';
  table.style.alignItems = 'center';
  body.appendChild(table);

  function header3(text) {
    const h = document.createElement('div');
    h.textContent = text;
    h.style.fontSize = '11px'; h.style.fontWeight = '600';
    h.style.color = 'var(--app-muted)'; h.style.textTransform = 'uppercase';
    h.style.letterSpacing = '0.4px';
    return h;
  }

  // Live preview: live ascii-ish svg curve below the table.
  const preview = document.createElement('div');
  preview.style.background = '#f8fafc';
  preview.style.border = '1px solid var(--app-panel-border)';
  preview.style.borderRadius = '6px';
  preview.style.padding = '8px';
  preview.style.userSelect = 'none';
  preview.style.touchAction = 'none';
  body.appendChild(preview);

  // Interactive preview state
  const PREVIEW = {
    W: 440, H: 160, padL: 32, padR: 8, padT: 8, padB: 22,
    yMin: -1.5, yMax: 1.5,
    drag: null, // { idx, axis: 'effT' | 'effST' }
  };
  function pxFromPct(pct) { return PREVIEW.padL + (pct / 100) * (PREVIEW.W - PREVIEW.padL - PREVIEW.padR); }
  function pctFromPx(px)  { return ((px - PREVIEW.padL) / (PREVIEW.W - PREVIEW.padL - PREVIEW.padR)) * 100; }
  function pxFromVal(v)   { return PREVIEW.padT + (1 - (v - PREVIEW.yMin) / (PREVIEW.yMax - PREVIEW.yMin)) * (PREVIEW.H - PREVIEW.padT - PREVIEW.padB); }
  function valFromPx(py)  { return PREVIEW.yMin + (1 - (py - PREVIEW.padT) / (PREVIEW.H - PREVIEW.padT - PREVIEW.padB)) * (PREVIEW.yMax - PREVIEW.yMin); }

  function drawPreview(hoverPct) {
    try {
      const { W, H, padL, padR, padT, padB } = PREVIEW;
      const innerW = W - padL - padR, innerH = H - padT - padB;
      const xAt = (pct) => padL + (pct / 100) * innerW;
      const yAt = (v) => padT + (1 - (v - PREVIEW.yMin) / (PREVIEW.yMax - PREVIEW.yMin)) * innerH;
      let svg = '<svg id="ischCurveSvg" width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" style="display:block;cursor:crosshair">';
      svg += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="white"/>';
      // grid
      for (let g = 0; g <= 100; g += 25) {
        const x = xAt(g);
        svg += '<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (padT + innerH) + '" stroke="#e5e7eb"/>';
        svg += '<text x="' + x + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="#64748b">' + g + '%</text>';
      }
      // y gridlines at -1, -0.5, 0.5, 1
      [-1, -0.5, 0.5, 1].forEach(v => {
        const y = yAt(v);
        svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (padL + innerW) + '" y2="' + y + '" stroke="#f1f5f9"/>';
        svg += '<text x="' + (padL - 4) + '" y="' + (y + 3) + '" font-size="9" text-anchor="end" fill="#94a3b8">' + v + '</text>';
      });
      // zero line
      const yZero = yAt(0);
      svg += '<line x1="' + padL + '" y1="' + yZero + '" x2="' + (padL + innerW) + '" y2="' + yZero + '" stroke="#cbd5e1"/>';
      svg += '<text x="6" y="' + (yZero + 4) + '" font-size="10" fill="#64748b">0</text>';

      // hover guide line + readout
      if (typeof hoverPct === 'number' && hoverPct >= 0 && hoverPct <= 100) {
        const hx = xAt(hoverPct);
        svg += '<line x1="' + hx + '" y1="' + padT + '" x2="' + hx + '" y2="' + (padT + innerH) + '" stroke="#0ea5e9" stroke-width="1" stroke-dasharray="3,3"/>';
        const eff = mapIschemiaToEff(hoverPct);
        const label = Math.round(hoverPct) + '%  effT=' + eff.effT.toFixed(2) + '  effST=' + eff.effST.toFixed(2);
        const tx = Math.min(W - 6, hx + 6);
        const anchor = (hx > W - 140) ? 'end' : 'start';
        const tx2 = (anchor === 'end') ? hx - 6 : hx + 6;
        svg += '<text x="' + tx2 + '" y="' + (padT + 12) + '" font-size="11" font-weight="600" text-anchor="' + anchor + '" fill="#0369a1">' + label + '</text>';
      }

      // sample curve every 1%
      let pathT = '', pathST = '';
      for (let p = 0; p <= 100; p += 1) {
        const eff = mapIschemiaToEff(p);
        const xx = xAt(p);
        const yT = yAt(eff.effT);
        const yST = yAt(eff.effST);
        pathT += (p === 0 ? 'M' : 'L') + xx.toFixed(1) + ',' + yT.toFixed(1) + ' ';
        pathST += (p === 0 ? 'M' : 'L') + xx.toFixed(1) + ',' + yST.toFixed(1) + ' ';
      }
      svg += '<path d="' + pathT + '" fill="none" stroke="#dc2626" stroke-width="2" pointer-events="none"/>';
      svg += '<path d="' + pathST + '" fill="none" stroke="#2563eb" stroke-width="2" pointer-events="none"/>';

      // baseline anchor at pct=0 (immutable, shown as small dots)
      svg += '<circle cx="' + xAt(0) + '" cy="' + yAt(tWaveScale) + '" r="3.5" fill="#fecaca" stroke="#dc2626" stroke-width="1"/>';
      svg += '<circle cx="' + xAt(0) + '" cy="' + yAt(stOffset) + '" r="3.5" fill="#bfdbfe" stroke="#2563eb" stroke-width="1"/>';

      // draggable handles for each breakpoint
      const sorted = ischemiaCurve.slice().sort((a, b) => a.pct - b.pct);
      sorted.forEach((p, idx) => {
        const cx = xAt(p.pct);
        const effT = (p.effT === null || p.effT === undefined) ? tWaveScale : p.effT;
        const effST = (p.effST === null || p.effST === undefined) ? stOffset : p.effST;
        // T handle (red square)
        svg += '<rect data-handle="T" data-idx="' + idx + '" x="' + (cx - 5) + '" y="' + (yAt(effT) - 5) + '" width="10" height="10" fill="#dc2626" stroke="white" stroke-width="1.5" style="cursor:grab"/>';
        // ST handle (blue circle)
        svg += '<circle data-handle="ST" data-idx="' + idx + '" cx="' + cx + '" cy="' + yAt(effST) + '" r="6" fill="#2563eb" stroke="white" stroke-width="1.5" style="cursor:grab"/>';
      });

      // legend
      svg += '<rect x="' + (padL) + '" y="2" width="10" height="10" fill="#dc2626"/><text x="' + (padL + 14) + '" y="11" font-size="10" fill="#0f172a">effT (drag □)</text>';
      svg += '<circle cx="' + (padL + 96) + '" cy="7" r="5" fill="#2563eb"/><text x="' + (padL + 106) + '" y="11" font-size="10" fill="#0f172a">effST (drag ○)</text>';
      svg += '</svg>';
      preview.innerHTML = svg;

      // Wire interactions on the freshly inserted SVG
      const svgEl = preview.querySelector('#ischCurveSvg');
      if (!svgEl) return;
      function svgPointFromEvent(e) {
        const rect = svgEl.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (W / rect.width);
        const y = (e.clientY - rect.top)  * (H / rect.height);
        return { x, y };
      }
      svgEl.addEventListener('mousedown', (e) => {
        const target = e.target;
        const handle = target && target.getAttribute && target.getAttribute('data-handle');
        const idx = target && target.getAttribute && Number(target.getAttribute('data-idx'));
        if (handle && Number.isInteger(idx)) {
          PREVIEW.drag = { idx, axis: handle };
          e.preventDefault();
        }
      });
      svgEl.addEventListener('mousemove', (e) => {
        const pt = svgPointFromEvent(e);
        if (PREVIEW.drag) {
          const sorted2 = ischemiaCurve.slice().sort((a, b) => a.pct - b.pct);
          const p = sorted2[PREVIEW.drag.idx];
          if (!p) return;
          const newPct = Math.max(0.5, Math.min(100, pctFromPx(pt.x)));
          const newVal = Math.max(PREVIEW.yMin, Math.min(PREVIEW.yMax, valFromPx(pt.y)));
          p.pct = Math.round(newPct);
          if (PREVIEW.drag.axis === 'T') p.effT = Math.round(newVal * 100) / 100;
          else p.effST = Math.round(newVal * 100) / 100;
          // Replace in-place sort & store
          ischemiaCurve.length = 0;
          sorted2.forEach(q => ischemiaCurve.push(q));
          saveIschemiaCurve();
          // While dragging, also live-preview at that pct
          window._ischemiaPreviewPct = p.pct;
          rebuildRows(); // also redraws preview with this hoverPct
          drawPreview(p.pct);
        } else {
          // Hover preview only when over the chart area
          if (pt.x >= PREVIEW.padL && pt.x <= W - PREVIEW.padR && pt.y >= PREVIEW.padT && pt.y <= H - PREVIEW.padB) {
            const hp = Math.max(0, Math.min(100, pctFromPx(pt.x)));
            window._ischemiaPreviewPct = hp;
            drawPreview(hp);
          }
        }
      });
      function endDrag() {
        if (PREVIEW.drag) {
          PREVIEW.drag = null;
          rebuildRows();
        }
      }
      svgEl.addEventListener('mouseup', endDrag);
      svgEl.addEventListener('mouseleave', () => {
        if (!PREVIEW.drag) {
          window._ischemiaPreviewPct = null;
          drawPreview(); // redraw without hover guide
        }
      });
      // Window-level mouseup so a release outside the SVG still ends the drag
      window.addEventListener('mouseup', endDrag, { once: true });
    } catch (e) { preview.textContent = '(preview error: ' + e.message + ')'; }
  }

  function rebuildRows() {
    table.innerHTML = '';
    table.appendChild(header3('Ischemia %'));
    table.appendChild(header3('effT'));
    table.appendChild(header3('effST'));
    table.appendChild(header3('ST start (ms)'));
    table.appendChild(header3('ST end (ms)'));
    table.appendChild(header3(''));

    const sorted = ischemiaCurve.slice().sort((a, b) => a.pct - b.pct);
    ischemiaCurve.length = 0;
    sorted.forEach(p => ischemiaCurve.push(p));

    ischemiaCurve.forEach((p, idx) => {
      const pctIn = document.createElement('input');
      pctIn.type = 'number'; pctIn.min = '0'; pctIn.max = '100'; pctIn.step = '1';
      pctIn.value = String(p.pct);
      pctIn.style.width = '100%'; pctIn.style.padding = '4px';
      pctIn.style.border = '1px solid var(--app-panel-border)'; pctIn.style.borderRadius = '4px';
      pctIn.oninput = (e) => {
        const v = Number(e.target.value);
        if (isFinite(v)) { p.pct = Math.max(0, Math.min(100, v)); saveIschemiaCurve(); drawPreview(); }
      };
      const tIn = document.createElement('input');
      tIn.type = 'number'; tIn.step = '0.05'; tIn.placeholder = 'baseline';
      tIn.value = (p.effT === null || p.effT === undefined) ? '' : String(p.effT);
      tIn.style.width = '100%'; tIn.style.padding = '4px';
      tIn.style.border = '1px solid var(--app-panel-border)'; tIn.style.borderRadius = '4px';
      tIn.oninput = (e) => {
        const s = e.target.value.trim();
        p.effT = (s === '') ? null : Number(s);
        saveIschemiaCurve(); drawPreview();
      };
      const stIn = document.createElement('input');
      stIn.type = 'number'; stIn.step = '0.05'; stIn.placeholder = 'baseline';
      stIn.value = (p.effST === null || p.effST === undefined) ? '' : String(p.effST);
      stIn.style.width = '100%'; stIn.style.padding = '4px';
      stIn.style.border = '1px solid var(--app-panel-border)'; stIn.style.borderRadius = '4px';
      stIn.oninput = (e) => {
        const s = e.target.value.trim();
        p.effST = (s === '') ? null : Number(s);
        saveIschemiaCurve(); drawPreview();
      };
      const stStartIn = document.createElement('input');
      stStartIn.type = 'number'; stStartIn.step = '1'; stStartIn.placeholder = 'baseline';
      stStartIn.title = 'ST window START in ms relative to QRS R-peak (blank = use baseline slider)';
      stStartIn.value = (p.effStStartMs === null || p.effStStartMs === undefined) ? '' : String(Math.round(p.effStStartMs));
      stStartIn.style.width = '100%'; stStartIn.style.padding = '4px';
      stStartIn.style.border = '1px solid var(--app-panel-border)'; stStartIn.style.borderRadius = '4px';
      stStartIn.oninput = (e) => {
        const s = e.target.value.trim();
        p.effStStartMs = (s === '') ? null : Number(s);
        saveIschemiaCurve(); drawPreview();
      };
      const stEndIn = document.createElement('input');
      stEndIn.type = 'number'; stEndIn.step = '1'; stEndIn.placeholder = 'baseline';
      stEndIn.title = 'ST window END in ms relative to QRS R-peak (blank = use baseline slider)';
      stEndIn.value = (p.effStEndMs === null || p.effStEndMs === undefined) ? '' : String(Math.round(p.effStEndMs));
      stEndIn.style.width = '100%'; stEndIn.style.padding = '4px';
      stEndIn.style.border = '1px solid var(--app-panel-border)'; stEndIn.style.borderRadius = '4px';
      stEndIn.oninput = (e) => {
        const s = e.target.value.trim();
        p.effStEndMs = (s === '') ? null : Number(s);
        saveIschemiaCurve(); drawPreview();
      };
      const delBtn = document.createElement('button');
      delBtn.className = 'app-btn app-btn--danger'; delBtn.textContent = '×';
      delBtn.title = 'Remove this breakpoint';
      delBtn.onclick = () => {
        ischemiaCurve.splice(idx, 1);
        saveIschemiaCurve(); rebuildRows(); drawPreview();
      };

      table.appendChild(pctIn);
      table.appendChild(tIn);
      table.appendChild(stIn);
      table.appendChild(stStartIn);
      table.appendChild(stEndIn);
      table.appendChild(delBtn);
    });

    drawPreview();
  }

  // Add / Reset row
  const addRow = document.createElement('div');
  addRow.style.display = 'flex'; addRow.style.gap = '6px'; addRow.style.flexWrap = 'wrap';
  addRow.appendChild(mkBtn('+ Add breakpoint', () => {
    // Insert a sensible new pct (median of largest gap)
    const sorted = ischemiaCurve.slice().sort((a, b) => a.pct - b.pct);
    const anchors = [0].concat(sorted.map(p => p.pct)).concat([100]);
    let bestGap = 0, bestPct = 50;
    for (let i = 0; i < anchors.length - 1; i++) {
      const gap = anchors[i + 1] - anchors[i];
      if (gap > bestGap) { bestGap = gap; bestPct = Math.round((anchors[i] + anchors[i + 1]) / 2); }
    }
    ischemiaCurve.push({ pct: bestPct, effT: null, effST: null, effStStartMs: null, effStEndMs: null });
    saveIschemiaCurve(); rebuildRows();
  }));
  addRow.appendChild(mkBtn('Reset to default', () => {
    if (!confirm('Reset the active curve to defaults?')) return;
    ischemiaCurve = ISCHEMIA_CURVE_DEFAULT.map(p => ({ ...p }));
    saveIschemiaCurve(); rebuildRows();
  }));
  body.appendChild(addRow);

  panel.appendChild(header);
  panel.appendChild(body);

  // Toolbar button
  const toolbar = document.getElementById('appToolbar');
  const btn = document.createElement('button');
  btn.className = 'app-btn app-btn--toolbar';
  btn.textContent = '📈 Ischemia Curve';
  btn.title = 'Edit how athero/thrombus/METs change the ECG';
  btn.onclick = () => {
    panel.classList.toggle('app-panel--hidden');
    if (!panel.classList.contains('app-panel--hidden')) { rebuildRows(); refreshLib(); }
  };
  if (toolbar) {
    const spacer = toolbar.querySelector('.app-toolbar__spacer');
    if (spacer) toolbar.insertBefore(btn, spacer);
    else toolbar.appendChild(btn);
  }

  refreshLib();
  rebuildRows();
}

setTimeout(() => {
  try { installIschemiaCurveEditor(); }
  catch (e) { console.warn('installIschemiaCurveEditor failed', e); }
}, 1800);
