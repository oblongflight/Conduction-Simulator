// Time dilation factor (slider controlled)
let timeDilation = 1.0;
const TIME_DILATION_KEY = 'ecg.timeDilation.v1';
function saveTimeDilation() {
  try { localStorage.setItem(TIME_DILATION_KEY, String(timeDilation)); } catch (e) {}
}
function loadTimeDilation() {
  try {
    const raw = localStorage.getItem(TIME_DILATION_KEY);
    if (raw !== null) {
      const v = parseFloat(raw);
      if (!Number.isNaN(v) && v > 0) timeDilation = v;
    }
  } catch (e) {}
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

// Adjustable waveform parameters (controlled by sliders)
let tWaveScale = 1.0; // multiplier for T wave amplitude (can be negative)
let qWaveScale = 1.0; // multiplier for Q wave magnitude
let stOffset = 0.0; // ST elevation/depression (in signal units)
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

// Diagnostic / UI state
let conductionDragging = { idx: -1, pt: -1 };
// whether the user is in edit mode for conduction shapes/paths
let conductionEditMode = false;

// Persistence for waveform settings
const ECG_WAVEFORM_KEY = 'ecg.waveform.v1';
const PRESETS_KEY = 'ecg.presets.v1';

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
      overlayUsesDilation: !!overlayUsesDilation
    };
    localStorage.setItem(ECG_WAVEFORM_KEY, JSON.stringify(payload));
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
    const raw = localStorage.getItem(ECG_WAVEFORM_KEY);
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
    if (typeof p.tDuration === 'number') tDuration = p.tDuration;
    if (typeof p.qtIntervalMs === 'number') qtIntervalMs = p.qtIntervalMs;
    if (typeof p.pDuration === 'number') pDuration = p.pDuration;
    if (typeof p.pAmp === 'number') pAmp = p.pAmp;
    if (typeof p.ecgWaveShift === 'number') ecgWaveShift = p.ecgWaveShift;
      if (typeof p.overlayUsesDilation === 'boolean') overlayUsesDilation = p.overlayUsesDilation;
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
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch (e) { return {}; }
}

// Populate the preset select dropdown from localStorage (global helper)
function refreshPresetSelectGlobal() {
  try {
    const sel = document.getElementById('presetSelect');
    if (!sel) return;
    sel.innerHTML = '';
    const all = _getAllPresets();
    const keys = Object.keys(all || {}).sort((a,b) => (all[b].savedAt||'').localeCompare(all[a].savedAt||''));
    const empty = document.createElement('option'); empty.value = ''; empty.text = '-- presets --'; sel.appendChild(empty);
    keys.forEach(k => { const o = document.createElement('option'); o.value = k; o.text = k + (all[k].savedAt ? ('  (' + new Date(all[k].savedAt).toLocaleString() + ')') : ''); sel.appendChild(o); });
  } catch (e) { /* ignore */ }
}

function _saveAllPresets(obj) {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(obj)); return true; } catch (e) { console.warn('Failed to save presets', e); return false; }
}

function saveNamedPreset(name) {
  if (!name || !String(name).trim()) { alert('Please provide a preset name'); return false; }
  try {
    const key = String(name).trim();
    const wave = {
      atheroPercent, thrombusPercent, METs, heartRate, amplitude, timeWindow,
      tWaveScale, qWaveScale, stOffset, tDuration, qtIntervalMs,
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
let ecgTriggeringEnabled = false;
function saveConductionItems() {
  try {
    localStorage.setItem(CONDUCTION_ITEMS_KEY, JSON.stringify(conductionItems));
  } catch (e) { console.warn('saveConductionItems error', e); }
}

function loadConductionItems() {
  try {
    const raw = localStorage.getItem(CONDUCTION_ITEMS_KEY);
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

// Persist / load ECG-triggering toggle
function saveEcgTriggering() {
  try { localStorage.setItem(ECG_TRIGGER_KEY, JSON.stringify({ enabled: !!ecgTriggeringEnabled })); } catch (e) { console.warn('saveEcgTriggering error', e); }
}
function loadEcgTriggering() {
  try {
    const raw = localStorage.getItem(ECG_TRIGGER_KEY);
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
    points: type === 'shape' ? [{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.2 }, { x: 0.7, y: 0.6 }] : [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }],
    color: '#ff0000',
    fill: false,
    closed: type === 'shape',
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
      nameInp.onchange = () => { it.name = nameInp.value; saveConductionItems(); };
      const color = document.createElement('input'); color.type = 'color'; color.value = it.color || '#ff0000'; color.onchange = () => { it.color = color.value; saveConductionItems(); };
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
      startSel.onchange = () => { it.startMode = startSel.value; saveConductionItems(); refreshConductionPanel(); };
      startSel.title = 'Start mode';
      middle.appendChild(startSel);

      // if start on ECG event, show event selector
      const evSel = document.createElement('select'); evSel.style.marginLeft = '4px';
      ['', 'P_start','P_end','Q_start','Q_end','R_start','R_end','S_start','S_end','T_start','T_end'].forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v === '' ? 'event...' : v; if ((it.ecgEvent||'') === v) o.selected = true; evSel.appendChild(o); });
      evSel.onchange = () => { it.ecgEvent = evSel.value; saveConductionItems(); };
      if ((it.startMode||'after_previous') === 'on_ecg_event') middle.appendChild(evSel);

      // duration source selector (manual or ECG feature)
      const durSel = document.createElement('select'); ecgOptions.forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v === '' ? 'manual' : v; if ((it.durationSource||'') === v) o.selected = true; durSel.appendChild(o); });
      durSel.onchange = () => { it.durationSource = durSel.value || null; saveConductionItems(); refreshConductionPanel(); };
      middle.appendChild(durSel);

      // manual duration input (ms) shown when manual selected
      const durInput = document.createElement('input'); durInput.type = 'number'; durInput.min = '10'; durInput.step = '10'; durInput.style.width = '90px'; durInput.value = Number(it.durationMs || 1200);
      durInput.onchange = () => { it.durationMs = Math.max(10, Number(durInput.value) || 10); saveConductionItems(); };
      if (!it.durationSource) middle.appendChild(durInput);

      // per-item start offset (ms)
      const offsetIn = document.createElement('input'); offsetIn.type = 'number'; offsetIn.min = '-60000'; offsetIn.step = '10'; offsetIn.style.width = '90px'; offsetIn.value = Number(it.startOffsetMs || 0);
      offsetIn.title = 'Start offset in milliseconds (can be negative)';
      offsetIn.onchange = () => { it.startOffsetMs = Number(offsetIn.value) || 0; saveConductionItems(); };
      const offsetLab = document.createElement('div'); offsetLab.textContent = 'offset ms'; offsetLab.style.fontSize = '11px'; offsetLab.style.marginLeft = '6px';
      middle.appendChild(offsetLab); middle.appendChild(offsetIn);

      // shape-specific ramp fields
      if (it.type === 'shape') {
        const rampRow = document.createElement('div'); rampRow.style.display='flex'; rampRow.style.alignItems='center'; rampRow.style.gap='6px';
        // Create source selects for Up / Sustain / Down (allow manual when empty)
        const makeSourceSelect = (prop) => {
          const sel = document.createElement('select');
          ecgOptions.forEach(v => { const o = document.createElement('option'); o.value = v; o.text = v === '' ? 'manual' : v; if ((it[prop]||'') === v) o.selected = true; sel.appendChild(o); });
          sel.onchange = () => { it[prop] = sel.value || null; saveConductionItems(); refreshConductionPanel(); };
          sel.title = prop;
          return sel;
        };
        const upSel = makeSourceSelect('rampUpSource');
        const susSel = makeSourceSelect('sustainSource');
        const downSel = makeSourceSelect('rampDownSource');

        const upIn = document.createElement('input'); upIn.type='number'; upIn.min='0'; upIn.step='50'; upIn.style.width='80px'; upIn.value = Number(it.rampUpMs || 200); upIn.onchange = () => { it.rampUpMs = Math.max(0, Number(upIn.value) || 0); saveConductionItems(); };
        const susIn = document.createElement('input'); susIn.type='number'; susIn.min='0'; susIn.step='50'; susIn.style.width='80px'; susIn.value = Number(it.sustainMs || 800); susIn.onchange = () => { it.sustainMs = Math.max(0, Number(susIn.value) || 0); saveConductionItems(); };
        const downIn = document.createElement('input'); downIn.type='number'; downIn.min='0'; downIn.step='50'; downIn.style.width='80px'; downIn.value = Number(it.rampDownMs || 200); downIn.onchange = () => { it.rampDownMs = Math.max(0, Number(downIn.value) || 0); saveConductionItems(); };

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
  conductionPanelDiv.style.width = '900px';
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

  const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='6px'; btnRow.style.marginBottom='8px';
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
  // removed explicit step controls (we'll keep ordering via up/down in the list below)

  // Export / Import controls
  const expBtn = document.createElement('button'); expBtn.textContent = 'Export Paths/Shapes';
  expBtn.title = 'Export conduction items to JSON file';
  expBtn.onclick = () => { try { exportConductionData(); } catch (e) { console.warn('export error', e); alert('Export failed: ' + String(e)); } };

  const importFileInput = document.createElement('input'); importFileInput.type = 'file'; importFileInput.accept = '.json,application/json'; importFileInput.style.display = 'none';
  importFileInput.onchange = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const reader = new FileReader(); reader.onload = (ev) => { try { const parsed = JSON.parse(ev.target.result); handleImportedConduction(parsed); } catch (err) { alert('Invalid JSON file'); console.warn('import parse error', err); } }; reader.readAsText(f); importFileInput.value = ''; };
  const impBtn = document.createElement('button'); impBtn.textContent = 'Import From File'; impBtn.title = 'Import conduction items from a JSON file'; impBtn.onclick = () => { importFileInput.click(); };

  // Paste area for JSON import
  const pasteArea = document.createElement('textarea'); pasteArea.placeholder = 'Or paste JSON here to import'; pasteArea.style.width = '320px'; pasteArea.style.height = '56px'; pasteArea.style.marginLeft = '8px';
  const pasteImpBtn = document.createElement('button'); pasteImpBtn.textContent = 'Import Pasted JSON'; pasteImpBtn.onclick = () => {
    const txt = pasteArea.value && pasteArea.value.trim(); if (!txt) { alert('Paste JSON into the box first'); return; }
    try { const parsed = JSON.parse(txt); handleImportedConduction(parsed); pasteArea.value = ''; } catch (err) { alert('Invalid JSON pasted'); console.warn('paste import error', err); }
  };

  btnRow.appendChild(expBtn); btnRow.appendChild(impBtn); btnRow.appendChild(pasteImpBtn);
  conductionPanelDiv.appendChild(btnRow);

  // Presets UI: save/load named disease states (waveform + conduction)
  const presetsRow = document.createElement('div'); presetsRow.style.display = 'flex'; presetsRow.style.alignItems = 'center'; presetsRow.style.gap = '8px'; presetsRow.style.marginTop = '8px';
  const presetNameInput = document.createElement('input'); presetNameInput.type = 'text'; presetNameInput.placeholder = 'Preset name (e.g. "MI lateral")'; presetNameInput.style.flex = '1';
  const savePresetBtn = document.createElement('button'); savePresetBtn.textContent = 'Save Preset';
  savePresetBtn.onclick = () => {
    const n = presetNameInput.value && String(presetNameInput.value).trim();
    if (!n) { alert('Enter a preset name'); return; }
    if (saveNamedPreset(n)) { alert('Preset saved: ' + n); refreshPresetSelectGlobal(); presetNameInput.value = ''; }
    else alert('Failed to save preset');
  };
  const presetSelect = document.createElement('select'); presetSelect.style.width = '220px'; presetSelect.id = 'presetSelect';
  const loadPresetBtn = document.createElement('button'); loadPresetBtn.textContent = 'Load Preset'; loadPresetBtn.onclick = () => { const v = presetSelect.value; if (!v) { alert('Select a preset'); return; } if (confirm('Load preset "' + v + '"? This will overwrite current settings.')) { if (loadNamedPreset(v)) { alert('Loaded preset: ' + v); } else { alert('Failed to load preset: ' + v); } } };
  const delPresetBtn = document.createElement('button'); delPresetBtn.textContent = 'Delete Preset'; delPresetBtn.onclick = () => { const v = presetSelect.value; if (!v) { alert('Select a preset to delete'); return; } if (!confirm('Delete preset "' + v + '"?')) return; if (deleteNamedPreset(v)) { alert('Deleted: ' + v); refreshPresetSelectGlobal(); } else { alert('Failed to delete: ' + v); } };
  presetsRow.appendChild(presetNameInput); presetsRow.appendChild(savePresetBtn); presetsRow.appendChild(presetSelect); presetsRow.appendChild(loadPresetBtn); presetsRow.appendChild(delPresetBtn);
  conductionPanelDiv.appendChild(presetsRow);

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

  // placeholder for list
  const listHolder = document.createElement('div'); listHolder.className = 'cond-list'; conductionPanelDiv.appendChild(listHolder);

  // constructor point-editing removed in simplified UI

  // Show constructor panel by default and append to body; panel will host
  // the ECG waveform controls (moved later) so it opens automatically
  conductionPanelDiv.style.display = '';
  // set a sane default size for the constructor window
  conductionPanelDiv.style.width = '640px';
  conductionPanelDiv.style.maxWidth = '90%';
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
        try { refreshConductionPanel(); } catch (e) { /* ignore */ }
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
      refreshConductionPanel();
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
      conductionPanelDiv.style.width = conductionPanelOriginalStyles.width || '900px';
      conductionPanelDiv.style.maxWidth = conductionPanelOriginalStyles.maxWidth || '80%';
      conductionPanelDiv.style.zIndex = conductionPanelOriginalStyles.zIndex || 10003;
      conductionPanelDiv.style.padding = conductionPanelOriginalStyles.padding || '10px';
    }
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
    localStorage.setItem(LEAD_PARAMS_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn('Failed to save lead params', e);
  }
}

function loadLeadParams() {
  try {
    const raw = localStorage.getItem(LEAD_PARAMS_KEY);
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

  // Advanced Settings toggle button (shows/hides per-lead controls)
  const advBtn = document.createElement('button');
  advBtn.textContent = 'Advanced Settings';
  advBtn.style.position = 'fixed';
  advBtn.style.top = '10px';
  advBtn.style.right = '10px';
  advBtn.style.zIndex = 10002;
  advBtn.style.padding = '8px 10px';
  advBtn.style.fontSize = '13px';
  advBtn.style.borderRadius = '6px';
  advBtn.style.border = '1px solid rgba(0,0,0,0.12)';
  advBtn.style.background = 'white';
  advBtn.onclick = () => {
    const isHidden = leadControlsDiv.style.display === 'none';
    leadControlsDiv.style.display = isHidden ? '' : 'none';
    advBtn.textContent = isHidden ? 'Hide Advanced' : 'Advanced Settings';
  };
  document.body.appendChild(advBtn);

  // View mode toggle button (Single lead <-> 12-lead)
  const viewToggleBtn = document.createElement('button');
  viewToggleBtn.textContent = singleLeadView ? 'Switch to 12-lead' : 'Switch to Single Lead';
  viewToggleBtn.style.position = 'fixed';
  viewToggleBtn.style.top = '46px';
  viewToggleBtn.style.right = '10px';
  viewToggleBtn.style.zIndex = 10002;
  viewToggleBtn.style.padding = '8px 10px';
  viewToggleBtn.style.fontSize = '13px';
  viewToggleBtn.style.borderRadius = '6px';
  viewToggleBtn.style.border = '1px solid rgba(0,0,0,0.12)';
  viewToggleBtn.style.background = 'white';
  viewToggleBtn.onclick = () => {
    singleLeadView = !singleLeadView;
    viewToggleBtn.textContent = singleLeadView ? 'Switch to 12-lead' : 'Switch to Single Lead';
    // hide per-lead overlay when in single-lead mode
    if (leadControlsDiv) leadControlsDiv.style.display = singleLeadView ? 'none' : 'none';
    // keep Advanced Settings button behavior separate; user can open per-lead panel when needed
  };
  document.body.appendChild(viewToggleBtn);

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
  const tdVal = document.createElement('div'); tdVal.textContent = String(timeDilation.toFixed(2)); tdVal.style.width = '56px'; tdVal.style.textAlign = 'right';
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
  // create conduction debug box (placed inside the global control panel)
  try {
    conductionDebugDiv = document.createElement('div');
    conductionDebugDiv.style.padding = '6px 8px';
    conductionDebugDiv.style.background = 'rgba(255,255,255,0.97)';
    conductionDebugDiv.style.border = '1px solid rgba(0,0,0,0.06)';
    conductionDebugDiv.style.borderRadius = '6px';
    conductionDebugDiv.style.fontSize = '12px';
    conductionDebugDiv.style.maxWidth = '360px';
    conductionDebugDiv.style.whiteSpace = 'normal';
    conductionDebugDiv.textContent = 'Conduction debug: awaiting playback...';
    // If the conduction constructor panel exists, host the debug box inside it
    // so it doesn't stick to the left of the main window. Otherwise fall back
    // to a fixed-position body overlay (legacy behavior).
    try {
      const rect = globalPanel.getBoundingClientRect();
      if (conductionPanelDiv) {
        conductionDebugDiv.style.position = '';
        conductionDebugDiv.style.margin = '8px';
        conductionDebugDiv.style.maxWidth = '100%';
        conductionDebugDiv.style.zIndex = '';
        conductionPanelDiv.appendChild(conductionDebugDiv);
      } else {
        conductionDebugDiv.style.position = 'fixed';
        conductionDebugDiv.style.left = String(Math.max(6, Math.round(rect.left))) + 'px';
        conductionDebugDiv.style.top = String(Math.max(6, Math.round(rect.bottom + 8))) + 'px';
        conductionDebugDiv.style.zIndex = 10004;
        document.body.appendChild(conductionDebugDiv);
      }
    } catch (e) {
      if (conductionPanelDiv) {
        conductionDebugDiv.style.position = '';
        conductionDebugDiv.style.margin = '8px';
        conductionPanelDiv.appendChild(conductionDebugDiv);
      } else {
        conductionDebugDiv.style.position = 'fixed';
        conductionDebugDiv.style.left = '10px';
        conductionDebugDiv.style.top = '220px';
        conductionDebugDiv.style.zIndex = 10004;
        document.body.appendChild(conductionDebugDiv);
      }
    }
  } catch (e) { conductionDebugDiv = null; }

  // Open control panel in a new window
  const openBtn = document.createElement('button');
  openBtn.textContent = 'Open Control Panel';
  openBtn.style.position = 'fixed';
  openBtn.style.top = '10px';
  openBtn.style.right = '150px';
  openBtn.style.zIndex = 10002;
  openBtn.style.padding = '8px 10px';
  openBtn.style.fontSize = '13px';
  openBtn.style.borderRadius = '6px';
  openBtn.style.border = '1px solid rgba(0,0,0,0.12)';
  openBtn.style.background = 'white';
  openBtn.onclick = () => {
    window.open('control.html', '_blank', 'width=420,height=320');
  };
  document.body.appendChild(openBtn);

  // Button to open the conduction debug popup window
  const debugPopBtn = document.createElement('button');
  debugPopBtn.textContent = 'Open Debug Popup';
  debugPopBtn.style.position = 'fixed';
  debugPopBtn.style.top = '46px';
  debugPopBtn.style.right = '150px';
  debugPopBtn.style.zIndex = 10002;
  debugPopBtn.style.padding = '6px 8px';
  debugPopBtn.style.fontSize = '12px';
  debugPopBtn.style.borderRadius = '6px';
  debugPopBtn.style.border = '1px solid rgba(0,0,0,0.12)';
  debugPopBtn.style.background = 'white';
  debugPopBtn.onclick = () => { openConductionDebugWindow(); };
  document.body.appendChild(debugPopBtn);

function openConductionDebugWindow() {
  try {
    if (conductionDebugWindow && !conductionDebugWindow.closed) {
      conductionDebugWindow.focus();
      return;
    }
    const w = window.open('', 'ConductionDebug', 'width=360,height=260,left=120,top=120');
    if (!w) { alert('Popup blocked: allow popups to open the debug window.'); return; }
    conductionDebugWindow = w;
    conductionDebugWinDiv = null;
    try {
      w.document.title = 'Conduction Debug';
      const style = w.document.createElement('style');
      style.textContent = 'body{font-family:Helvetica,Arial,sans-serif;margin:8px;background:#fff;color:#111} .title{font-weight:700;margin-bottom:6px} .item{margin-bottom:4px}';
      w.document.head.appendChild(style);
      const closeBtn = w.document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.style.float = 'right'; closeBtn.onclick = () => { try { w.close(); } catch (e) {} };
      w.document.body.appendChild(closeBtn);
      // create initial container so popup isn't blank
      conductionDebugWinDiv = w.document.createElement('div');
      conductionDebugWinDiv.style.marginTop = '6px';
      conductionDebugWinDiv.textContent = 'Conduction debug: awaiting playback...';
      w.document.body.appendChild(conductionDebugWinDiv);
    } catch (e) { /* ignore */ }
    // when popup closed, clear refs
    try { w.addEventListener('beforeunload', () => { conductionDebugWindow = null; conductionDebugWinDiv = null; }); } catch (e) {}
  } catch (e) { console.warn('openConductionDebugWindow error', e); }
}

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

  // Attempt to open the conduction + waveform editor in its own window
  // automatically. Use a short timeout so page load isn't blocked; if
  // the browser blocks popups this will fail gracefully and the panel
  // remains embedded inline.
  try {
    setTimeout(() => {
      try { openConductionWindow(); } catch (e) { /* popup may be blocked; ignore */ }
    }, 250);
  } catch (e) {}

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
    'pdurInput','hrInput','tdurInput','prInput','qtInput'
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
}

function draw() {
  try {
    background(245);
    if (singleLeadView) {
      // Single-lead layout: CCS image on left half, ECG tracing on right half
      const halfW = Math.floor(width / 2);
      // draw CCS image on left half, centered and scaled (or reserve left half if no image)
      push();
      imageMode(CORNER);
      const imgW = halfW;
      const imgH = height;
      let iw = imgW;
      let ih = imgH;
      let ix = 0;
      let iy = 0;
      if (ccsImg) {
        const s = Math.min(imgW / ccsImg.width, imgH / ccsImg.height);
        iw = ccsImg.width * s;
        ih = ccsImg.height * s;
        ix = Math.round((imgW - iw) / 2);
        iy = Math.round((imgH - ih) / 2);
        image(ccsImg, ix, iy, iw, ih);
      } else {
        // draw placeholder rectangle for CCS area when image missing
        noFill(); stroke(200); rect(0, 0, imgW, imgH);
      }
      // draw any conduction overlays on top of CCS / placeholder
      try { drawConductionOverlay(ix, iy, iw, ih); } catch (e) { /* ignore overlay errors */ }
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

        // Draw static PQRST waveform and sync indicator
        const padLeft = 40, padRight = 40, padTop = 40, padBottom = 40;
        const w = ecgG.width - padLeft - padRight;
        const h = ecgG.height - padTop - padBottom;
        const centerY = padTop + h / 2;
        const amplitude = h * 0.35;
        const sampleCount = w;
        let points = [];
        let pStartIdx = 0;
        let foundPStart = false;
        let prevV = null;
        // Use the same time reference as ECG rendering
        const beatPeriod = 60.0 / heartRate;
        const duration = beatPeriod * 1000 * timeDilation;
        const nowMs = pausedEcg ? ecgPausedAtMs : (millis() - ecgTimeOffsetMs);
        // t_rel range: -0.2s to +0.6s (we keep this range constant)
        // base shift previously used: 150ms left
        const baseShift = -0.15; // seconds
        // compute the canonical start and range (independent of user shift)
        const canonicalStart = -0.2 + baseShift;
        const canonicalEnd = 0.6 - 0.15;
        const canonicalRange = canonicalEnd - canonicalStart;
        // apply user-configurable horizontal shift without changing the range
        const tRelStart = canonicalStart + (typeof ecgWaveShift === 'number' ? ecgWaveShift : 0);
        const tRelRange = canonicalRange;
        const tRelEnd = tRelStart + tRelRange;
        // Calculate time within current beat, mapped to t_rel range
        const beatFrac = (nowMs / duration) % 1.0;
        const beatTime = tRelStart + beatFrac * tRelRange;
        for (let i = 0; i <= sampleCount; i++) {
          const t_rel = (i / sampleCount) * tRelRange + tRelStart;
          const v = singleBeatSignal(t_rel, tWaveScale, stOffset, {p:1,q:1,r:1,s:1,t:1});
          const x = padLeft + i;
          const y = centerY - v * amplitude;
          points.push({x, y, t_rel, v});
          // Find start of P wave (where signal rises above a threshold)
          if (!foundPStart && prevV !== null && v > 0.02 && prevV <= 0.02) {
            pStartIdx = i;
            foundPStart = true;
          }
          prevV = v;
          // Find start indices for Q, R, S, T waves
          if (i > 0) {
            // Q: sharp negative deflection after P
            if (!window._foundQStart && points[i-1].v > -0.02 && v <= -0.02) {
              window._qStartIdx = i;
              window._foundQStart = true;
            }
            // R: sharp positive after Q
            if (!window._foundRStart && points[i-1].v < 0.02 && v >= 0.02 && foundPStart && window._foundQStart) {
              window._rStartIdx = i;
              window._foundRStart = true;
            }
            // S: negative after R
            if (!window._foundSStart && points[i-1].v > -0.02 && v <= -0.02 && window._foundRStart) {
              window._sStartIdx = i;
              window._foundSStart = true;
            }
            // T: positive after S
            if (!window._foundTStart && points[i-1].v < 0.02 && v >= 0.02 && window._foundSStart) {
              window._tStartIdx = i;
              window._foundTStart = true;
            }
          }
        }
        ecgG.push();
        // Overlay: draw expected start/end intervals for conduction items bound to ECG events
        try {
          // Map event keys to point indices when available
          const eventIndexForKey = (key) => {
            if (!key) return null;
            switch (key) {
              case 'P_start': return foundPStart ? pStartIdx : null;
              case 'P_end': return foundPStart ? Math.min(points.length-1, pStartIdx + Math.round((pDuration||0)*sampleCount/tRelRange)) : null;
              case 'Q_start': return (window._foundQStart ? window._qStartIdx : null);
              case 'R_start': return (window._foundRStart ? window._rStartIdx : null);
              case 'S_start': return (window._foundSStart ? window._sStartIdx : null);
              case 'T_start': return (window._foundTStart ? window._tStartIdx : null);
              default: return null;
            }
          };
          // Collect overlay rectangles first so we can assign non-overlapping vertical tiers
          const overlays = [];
          for (let it of conductionItems) {
            if (!it) continue;
            if ((it.startMode || 'after_previous') !== 'on_ecg_event') continue;
            const ev = it.ecgEvent;
            if (!ev) continue;
            const startIdx = eventIndexForKey(ev);
            if (typeof startIdx !== 'number' || !points[startIdx]) continue;
            const startT_base = points[startIdx].t_rel;
            // Overlays reflect ECG-feature timing and should not be affected by
            // the playback `timeDilation`. Compute durations and offsets in
            // raw (non-dilated) milliseconds so they remain tied to the ECG.
            const durMs = computeItemEffectiveDurationMs(it, false) || 0;
            const durSec = durMs / 1000.0;
            // Apply per-item start offset (ms) without dilation so overlays show
            // the real ECG-relative offset.
            const offsetMs = Number(it.startOffsetMs) || 0;
            const offsetSec = offsetMs / 1000.0;
            const startT = startT_base + offsetSec;
            const endT = startT + durSec;
            const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
            const startX = clamp(Math.round(padLeft + ((startT - tRelStart) / tRelRange) * w), padLeft, padLeft + w);
            const endX = clamp(Math.round(padLeft + ((endT - tRelStart) / tRelRange) * w), padLeft, padLeft + w);
            if (endX <= startX) continue;
            overlays.push({ startX, endX, color: it.color || '#ff0000', label: it.name || it.id || '(item)' });
          }

          if (overlays.length > 0) {
            // sort by startX so stacking is deterministic
            overlays.sort((a,b) => a.startX - b.startX || (a.endX - b.endX));
            // determine number of tiers based on available height and desired tier height
            const maxTiers = Math.max(1, Math.min(6, Math.floor(h / 20)));
            const tierHeight = Math.max(12, Math.min(28, Math.floor(h / Math.max(1, maxTiers)) - 4));
            const gap = 6; // minimal horizontal gap to allow placing overlays on same tier
            const lastEnd = [];
            overlays.forEach(o => {
              let tier = 0;
              while (tier < lastEnd.length && !(o.startX > lastEnd[tier] + gap)) tier++;
              if (tier >= lastEnd.length) lastEnd.push(o.endX); else lastEnd[tier] = Math.max(lastEnd[tier], o.endX);
              o.tier = tier;
            });

            // draw overlays with tiered vertical positions
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
                // label
                ecgG.noStroke(); ecgG.fill(0); ecgG.textSize(12);
                const tx = Math.max(o.startX + 4, Math.min(o.endX - 40, o.startX + 4));
                ecgG.text(o.label, tx, y + Math.min(14, Math.max(12, Math.round(hrect/2))));
              } catch (e) { /* ignore drawing errors */ }
            }
          }
        } catch (e) { /* overlay errors shouldn't break draw */ }

        ecgG.stroke(0, 120, 0);
        ecgG.strokeWeight(3);
        ecgG.noFill();
        ecgG.beginShape();
        for (let pt of points) ecgG.vertex(pt.x, pt.y);
        ecgG.endShape();
        ecgG.pop();

        // Find indicator position by matching beatTime to t_rel (smooth interpolation)
        let indicatorX, indicatorIdx = 0;
        if (beatTime <= points[0].t_rel) {
          indicatorX = points[0].x;
          indicatorIdx = 0;
        } else if (beatTime >= points[points.length-1].t_rel) {
          indicatorX = points[points.length-1].x;
          indicatorIdx = points.length-1;
        } else {
          for (let i = 1; i < points.length; i++) {
            if (points[i].t_rel >= beatTime) {
              const prev = points[i-1], curr = points[i];
              const frac = (beatTime - prev.t_rel) / (curr.t_rel - prev.t_rel);
              indicatorX = prev.x + frac * (curr.x - prev.x);
              indicatorIdx = i;
              break;
            }
          }
        }
        ecgG.push();
        ecgG.stroke(255,0,0);
        ecgG.strokeWeight(2);
        ecgG.line(indicatorX, padTop, indicatorX, ecgG.height - padBottom);
        ecgG.pop();

        // Debugging: Track indicator crossing wave starts and log to popup
        if (!window._waveCrossLog) window._waveCrossLog = [];
        function logWaveCross(wave, x) {
          const now = new Date();
          window._waveCrossLog.push({wave, time: now.toLocaleTimeString(), x: Math.round(x)});
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
        // Track indicator crossing wave starts and trigger conduction steps by ECG event
        const eventCrossings = [];
        if (typeof window._lastIndicatorX === 'number') {
          // Helper: push event if indicator crosses from left to right
          function checkCross(idx, label, eventKey) {
            if (typeof idx === 'number') {
              const x = points[idx].x;
              if (window._lastIndicatorX < x && indicatorX >= x) {
                logWaveCross(label, x);
                // record P start effective timestamp for ms counter
                if (label === 'P') {
                  try { lastPStartMs = Math.max(0, nowMs); } catch (e) {}
                }
                eventCrossings.push(eventKey);
              }
            }
          }
          if (foundPStart) checkCross(pStartIdx, 'P', 'P_start');
          if (window._foundQStart) checkCross(window._qStartIdx, 'Q', 'Q_start');
          if (window._foundRStart) checkCross(window._rStartIdx, 'R', 'R_start');
          if (window._foundSStart) checkCross(window._sStartIdx, 'S', 'S_start');
          if (window._foundTStart) checkCross(window._tStartIdx, 'T', 'T_start');
          // End events: next sample after start
          function checkEnd(idx, label, eventKey) {
            if (typeof idx !== 'number') return;
            // Default: use the next sample as the end marker
            let endIdx = idx + 1;
            // For P waves, prefer a duration-based end: P_end = P_start + pDuration
            if (label === 'P') {
              try {
                const pStartTRel = points[idx] && points[idx].t_rel;
                if (typeof pStartTRel === 'number' && (typeof pDuration === 'number' && pDuration > 0)) {
                  const targetT = pStartTRel + pDuration; // seconds relative
                  for (let j = idx + 1; j < points.length; j++) {
                    if (points[j].t_rel >= targetT) { endIdx = j; break; }
                  }
                  if (endIdx >= points.length) endIdx = points.length - 1;
                }
              } catch (e) { /* fall back to idx+1 */ }
            }
            if (endIdx < points.length) {
              const x = points[endIdx].x;
              if (window._lastIndicatorX < x && indicatorX >= x) {
                logWaveCross(label + ' end', x);
                eventCrossings.push(eventKey);
              }
            }
          }
          if (foundPStart) checkEnd(pStartIdx, 'P', 'P_end');
          if (window._foundQStart) checkEnd(window._qStartIdx, 'Q', 'Q_end');
          if (window._foundRStart) checkEnd(window._rStartIdx, 'R', 'R_end');
          if (window._foundSStart) checkEnd(window._sStartIdx, 'S', 'S_end');
          if (window._foundTStart) checkEnd(window._tStartIdx, 'T', 'T_end');
          // Reset trigger when indicator wraps around to left
          if (window._lastIndicatorX > indicatorX) {
            window._conductionTriggered = false;
            window._foundQStart = false;
            window._foundRStart = false;
            window._foundSStart = false;
            window._foundTStart = false;
          }
        }
        window._lastIndicatorX = indicatorX;

        // ECG event crossings detected. We optionally forward events to the
        // global trigger handler when ECG-triggering is enabled (user toggle).
        // Manual triggers (the per-item Trigger buttons) still work.
        if (eventCrossings.length > 0) {
          if (ecgTriggeringEnabled) {
            try {
              eventCrossings.forEach(evKey => { try { triggerEcgEvent(evKey); } catch (e) {} });
            } catch (e) { /* ignore */ }
          }
        }

        // blit to right half
        image(ecgG, halfW, 0);
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
    if (it.fill && it.closed) fill(it.color + '44'); else noFill();

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

        // Diagnostic overlay: show per-item playback state to help debug why an item
        // (e.g., Right Ventricle) may not be animating. This is lightweight and safe
        // to leave in during testing; it's drawn in the top-right of the CCS image.
        try {
          const diagX = imgX + imgW - 224;
          const diagY = imgY + 8;
          const boxW = 216;
          const lines = [];
          for (let i = 0; i < conductionItems.length; i++) {
            const it = conductionItems[i];
            if (!it) continue;
            const baseStart = Number(it.playbackStartTime) || 0;
            const offset = Number(it.startOffsetMs) || 0;
            const dilation = (typeof timeDilation === 'number' ? timeDilation : 1.0);
            const scheduledStart = baseStart + offset * dilation;
            const elapsed = Math.round(nowMs - scheduledStart);
            // compute per-item effective duration (ms)
            let effDur = 0;
            if (it.durationSource) effDur = Math.max(10, (getEcgFeatureMs(it.durationSource) || 0)) * dilation;
            else if (it.type === 'shape') {
              const up = (it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : Number(it.rampUpMs) || 0) * dilation;
              const sus = (it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : Number(it.sustainMs) || 0) * dilation;
              const down = (it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : Number(it.rampDownMs) || 0) * dilation;
              effDur = Math.max(10, up + sus + down);
            } else effDur = Math.max(10, Number(it.durationMs) || 1200) * dilation;
            const playing = (scheduledStart > 0 && elapsed >= 0 && elapsed < effDur);
            lines.push({ name: it.name || ('Item ' + i), playing, scheduledStart, elapsed, effDur, offset });
            if (lines.length >= 12) break;
          }
          push();
          noStroke(); fill(255, 255, 255, 230); rect(diagX, diagY, boxW, 18 + lines.length * 14, 6);
          stroke(0,0,0,40); noFill(); rect(diagX, diagY, boxW, 18 + lines.length * 14, 6);
          noStroke(); fill(20); textSize(12); textAlign(LEFT, TOP);
          text('Conduction Debug', diagX + 6, diagY + 3);
          for (let li = 0; li < lines.length; li++) {
            const L = lines[li];
            const y = diagY + 18 + li * 14;
            fill(L.playing ? 'green' : 'black');
            const txt = L.name + (L.playing ? ' • PLAYING' : ' • idle') + '  (' + String(L.elapsed) + ' / ' + String(Math.round(L.effDur)) + 'ms)';
            text(txt, diagX + 6, y);
          }
          pop();
        } catch (ee) { /* ignore diagnostic errors */ }

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
    // look for existing point near mouse
    const near = findNearestPointOnImage(mouseX, mouseY, ix, iy, iw, ih, 12);
    if (near && near.idx === selectedConductionIndex) {
      conductionDragging.idx = selectedConductionIndex; conductionDragging.pt = near.ptIdx;
      return;
    }
    // otherwise add new point normalized to image coordinates
    const nx = (mouseX - ix) / iw; const ny = (mouseY - iy) / ih;
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

// Map an ischemia percentage (0..100) into effective T scale and ST offset
function mapIschemiaToEff(pct) {
  let baselineT = tWaveScale;
  let baselineST = stOffset;
  let effT = baselineT;
  let effST = baselineST;
  const pctC = constrain(pct, 0, 100);
  if (pctC > 0) {
    if (pctC <= 50) {
      let f = pctC / 50.0;
      effT = lerp(baselineT, -1, f);
      effST = baselineST;
    } else if (pctC <= 90) {
      effT = -1;
      let f = (pctC - 50) / 40.0;
      effST = lerp(baselineST, -0.4, f);
    } else if (pctC <= 95) {
      effT = -1;
      let f = (pctC - 90) / 5.0;
      effST = lerp(-0.4, 0.1, f);
    } else {
      let f = (pctC - 95) / 5.0;
      effT = lerp(-1, -0.25, f);
      effST = lerp(0.1, 0.7, f);
    }
  }
  return { effT, effST };
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
function singleBeatSignal(t, effTWaveScale, effSTOffset, leadMults) {
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

  // ST segment: create a smooth plateau (flat ST) between the end of S and
  // the start of T using the raised-cosine smoothWindow. This gives a
  // gentle transition from the S wave into the ST segment instead of a
  // gaussian tail that can look abrupt.
  // Define a window from slightly before sEnd to slightly before tStart
  let stStart = sEnd - sStOverlap; // fixed overlap with S for smoothing
  // Make ST end always centered on the T wave (tCenter).
  let stEndWindow = tCenter;
  // Ensure there's at least a minimal window; if not, push stStart earlier.
  if (stEndWindow <= stStart + 0.005) {
    stStart = stEndWindow - 0.005;
  }
  let st = effSTOffset * smoothWindow(t, stStart, stEndWindow);

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

  // small label
  vesselCtx.fillStyle = '#222';
  vesselCtx.font = Math.max(10, Math.round(w * 0.07)) + 'px sans-serif';
  vesselCtx.textAlign = 'center';
  vesselCtx.fillText('Vessel (transverse)', cx, h - 8);
}
