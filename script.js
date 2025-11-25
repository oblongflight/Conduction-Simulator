let atheroPercent = 0;
let thrombusPercent = 0;
let METs = 1.0;

// Heart parameters
let heartRate = 70; // bpm (editable)

// Visual tuning
let amplitude = 60; // pixels per unit ECG amplitude
let timeWindow = 10.0; // seconds shown across the canvas

// Adjustable waveform parameters (controlled by sliders)
let tWaveScale = 1.0; // multiplier for T wave amplitude (can be negative)
let qWaveScale = 1.0; // multiplier for Q wave magnitude
let stOffset = 0.0; // ST elevation/depression (in signal units)
let tDuration = 0.12; // T wave duration (seconds, approximate width)
let qtIntervalMs = 360; // QT interval in milliseconds (Q onset to T end)

// P-wave adjustable parameters
let pDuration = 0.05; // seconds (default ~50 ms)
let pAmp = 0.25; // amplitude multiplier (visible by default)
// Global QRS width multiplier (1.0 == normal)
let qrsWidth = 1.0;
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

// CCS image (optional) — loaded if present
let ccsImg = null;

// View mode: true = single-lead (CCS left + ECG right), false = 12-lead grid
let singleLeadView = true;

// Labels for 12-lead layout
const leadLabelsGlobal = ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'];

// Conduction overlay data structures (paths/shapes over CCS image)
let conductionItems = []; // each: { id, name, type:'path'|'shape', points:[{x,y}], color, fill, closed }
let selectedConductionIndex = -1;
let conductionEditMode = false; // when true, clicks edit/add points
let conductionDragging = { idx: -1, pt: -1 };
let conductionPanelDiv = null;
// Pop-out window state for the conduction panel
let conductionWindow = null;
let conductionPanelOriginalStyles = null;
// DOM debug container for conduction step/item durations
let conductionDebugDiv = null;
let conductionDebugWindow = null;
let conductionDebugWinDiv = null;

// Playback/scheduler state for conduction steps
let conductionPlayback = {
  playing: true,
  stepOrder: [], // ordered unique step values as they appear in conductionItems
  currentStepIndex: 0,
  stepStartTime: 0
};

// Per-step durations (ms). Keyed by step value (number -> ms)
let conductionStepDurations = {};
const CONDUCTION_STEPS_KEY = 'ecg.conductionSteps.v1';

function saveConductionStepDurations() {
  try {
    localStorage.setItem(CONDUCTION_STEPS_KEY, JSON.stringify(conductionStepDurations));
  } catch (e) { console.warn('Failed to save conduction step durations', e); }
}

function loadConductionStepDurations() {
  try {
    const raw = localStorage.getItem(CONDUCTION_STEPS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    conductionStepDurations = {};
    for (const k of Object.keys(parsed)) {
      const n = Number(k);
      if (Number.isFinite(n)) conductionStepDurations[n] = Math.max(10, Number(parsed[k]) || 10);
    }
  } catch (e) { console.warn('Failed to load conduction step durations', e); }
}

// Clear a per-step override (callable from popup via window.opener)
function clearConductionStepOverride(step) {
  try {
    if (conductionStepDurations && (step in conductionStepDurations)) delete conductionStepDurations[step];
    try { saveConductionStepDurations(); } catch (e) {}
    try { refreshConductionPanel(); } catch (e) {}
  } catch (e) { /* ignore */ }
}

function computeConductionStepOrder() {
  const seen = new Set();
  const order = [];
  for (let it of conductionItems) {
    const s = Number(it.step) || 0;
    if (!seen.has(s)) { seen.add(s); order.push(s); }
  }
  conductionPlayback.stepOrder = order;
  // clamp currentStepIndex
  if (conductionPlayback.currentStepIndex >= conductionPlayback.stepOrder.length) conductionPlayback.currentStepIndex = 0;
}

function resetConductionPlayback() {
  conductionPlayback.stepStartTime = millis();
  conductionPlayback.currentStepIndex = 0;
  computeConductionStepOrder();
}

function createConductionItem(type = 'path') {
  const id = Date.now();
  const name = type === 'path' ? 'Path ' + (conductionItems.length + 1) : 'Shape ' + (conductionItems.length + 1);
  // mode: 'sequential' => animate a traveling dot along the path over durationMs
  // mode: 'concurrent' => show pulses at all points simultaneously
  const item = { id, name, type, points: [], color: '#ff0000', fill: (type === 'shape'), closed: (type === 'shape'), mode: 'sequential', durationMs: 1200, step: conductionItems.length, rampUpMs: 200, sustainMs: 800, rampDownMs: 200 };
  conductionItems.push(item);
  selectedConductionIndex = conductionItems.length - 1;
  refreshConductionPanel();
}

function refreshConductionPanel() {
  if (!conductionPanelDiv) return;
  // remove existing list area if present
  let list = conductionPanelDiv.querySelector('.cond-list');
  if (list) conductionPanelDiv.removeChild(list);
  list = document.createElement('div');
  list.className = 'cond-list';

  // Precompute step -> max item duration so headers can show a sensible default
  const stepMaxDur = {};
  for (let it of conductionItems) {
    const s = Number(it.step) || 0;
    // Determine item-driven duration: if item has a binding to an ECG feature use that, else shape totals or durationMs
    let itemDur = 0;
    if (it.durationSource) {
      const fv = getEcgFeatureMs(it.durationSource);
      itemDur = Math.max(10, fv || 10);
    } else if (it.type === 'shape') {
      // allow per-component bindings; use bound values when present
      const upVal = it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : (Number(it.rampUpMs) || 0);
      const susVal = it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : (Number(it.sustainMs) || 0);
      const downVal = it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : (Number(it.rampDownMs) || 0);
      const shapeTotal = upVal + susVal + downVal;
      itemDur = Math.max(10, shapeTotal || 0);
    } else {
      itemDur = Math.max(10, Number(it.durationMs) || 1200);
    }
    stepMaxDur[s] = Math.max(stepMaxDur[s] || 0, itemDur);
  }

  const seenSteps = new Set();
  conductionItems.forEach((it, idx) => {
    const stepVal = Number(it.step) || 0;
    // insert a step header when we encounter a new step
    if (!seenSteps.has(stepVal)) {
      seenSteps.add(stepVal);
      const hdr = document.createElement('div'); hdr.style.display='flex'; hdr.style.alignItems='center'; hdr.style.justifyContent='space-between'; hdr.style.gap='8px'; hdr.style.padding='6px 4px'; hdr.style.background='rgba(0,0,0,0.02)'; hdr.style.borderBottom='1px solid rgba(0,0,0,0.04)';
      const lbl = document.createElement('div'); lbl.textContent = 'Step ' + String(stepVal); lbl.style.fontWeight='700'; hdr.appendChild(lbl);
      const durWrap = document.createElement('div'); durWrap.style.display='flex'; durWrap.style.alignItems='center'; durWrap.style.gap='6px';
      const durLabel = document.createElement('div'); durLabel.textContent = 'Duration (ms)'; durLabel.style.fontSize='12px'; durLabel.style.opacity='0.8';
      // readonly computed driven duration (max of item-driven durations)
      const computedSpan = document.createElement('div'); computedSpan.style.fontSize = '12px'; computedSpan.style.opacity = '0.85'; computedSpan.style.minWidth = '64px';
      const computedDur = (stepMaxDur[stepVal] || 1200);
      computedSpan.textContent = 'computed: ' + String(Math.max(10, computedDur));
      // optional per-step override input (empty = use computed)
      const overrideInput = document.createElement('input'); overrideInput.type = 'number'; overrideInput.min = '10'; overrideInput.step = '10'; overrideInput.placeholder = 'auto'; overrideInput.style.width = '84px';
      const existingOverride = (conductionStepDurations && Number.isFinite(conductionStepDurations[stepVal])) ? conductionStepDurations[stepVal] : '';
      overrideInput.value = existingOverride !== '' ? String(existingOverride) : '';
      overrideInput.title = 'Optional per-step override in ms (leave empty to use computed)';
      overrideInput.onchange = (e) => {
        const v = e.target.value === '' ? null : Math.max(10, Number(e.target.value) || 10);
        if (v === null) {
          if (conductionStepDurations && (stepVal in conductionStepDurations)) delete conductionStepDurations[stepVal];
        } else {
          conductionStepDurations[stepVal] = v;
        }
        try { saveConductionStepDurations(); } catch (err) {}
        // update the UI to reflect the change
        refreshConductionPanel();
      };
      const clearBtn = document.createElement('button'); clearBtn.textContent = 'Clear'; clearBtn.title = 'Clear override'; clearBtn.onclick = () => { if (conductionStepDurations && (stepVal in conductionStepDurations)) delete conductionStepDurations[stepVal]; try { saveConductionStepDurations(); } catch (err) {} refreshConductionPanel(); };
      durWrap.appendChild(durLabel);
      durWrap.appendChild(computedSpan);
      durWrap.appendChild(overrideInput);
      durWrap.appendChild(clearBtn);
      hdr.appendChild(durWrap);
      list.appendChild(hdr);
    }

    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '6px'; row.style.padding = '6px'; row.style.borderBottom = '1px solid rgba(0,0,0,0.06)';
    // prevent wrapping so controls stay on a single line (avoid visual wrapping)
    row.style.flexWrap = 'nowrap';
    row.style.boxSizing = 'border-box';
    row.style.background = (conductionEditMode && idx === selectedConductionIndex) ? 'rgba(0,120,215,0.06)' : 'transparent';
    const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.value = it.name; nameInput.style.flex = '1'; nameInput.onchange = (e) => { it.name = e.target.value; };
    // Mode select (sequential vs concurrent)
    const modeSel = document.createElement('select');
    const mo1 = document.createElement('option'); mo1.value = 'sequential'; mo1.text = 'Sequential';
    const mo2 = document.createElement('option'); mo2.value = 'concurrent'; mo2.text = 'Concurrent';
    modeSel.appendChild(mo1); modeSel.appendChild(mo2); modeSel.value = it.mode || 'sequential';
    modeSel.style.width = '120px';
    modeSel.title = 'Playback mode: sequential (travels) or concurrent (all)';
    modeSel.onchange = (e) => { it.mode = e.target.value; refreshConductionPanel(); };
    // duration (ms) for traversal (paths editable; shapes driven by envelope totals)
    let durInput = null;
    let durSpan = null;
    if (it.type === 'shape') {
      durSpan = document.createElement('div');
      // compute envelope totals using per-component bindings when present
      const totUp = it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : (Number(it.rampUpMs) || 0);
      const totSus = it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : (Number(it.sustainMs) || 0);
      const totDown = it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : (Number(it.rampDownMs) || 0);
      const total = totUp + totSus + totDown;
      // if bound to a single ECG feature for overall duration, show that value instead
      if (it.durationSource) {
        const fv = getEcgFeatureMs(it.durationSource) || 0;
        durSpan.textContent = String(Math.max(10, fv));
      } else {
        durSpan.textContent = String(Math.max(10, total));
      }
      durSpan.title = 'Shape total duration (driven by envelope components)';
      durSpan.style.minWidth = '64px';
    } else {
      durInput = document.createElement('input'); durInput.type = 'number'; durInput.min = '10'; durInput.step = '10'; durInput.value = String(it.durationMs || 1200); durInput.title = 'Duration (ms) for traversal (per-item)';
      durInput.style.width = '64px'; durInput.oninput = (e) => { const v = Number(e.target.value) || 0; it.durationMs = Math.max(10, v); };
      // if bound to ECG feature, show a readonly span instead and hide editable input
      if (it.durationSource) {
        const fv = getEcgFeatureMs(it.durationSource) || 0;
        durSpan = document.createElement('div'); durSpan.textContent = String(Math.max(10, fv)); durSpan.style.minWidth = '64px'; durSpan.title = 'Duration driven from ECG feature';
        durInput.style.display = 'none';
      }
    }
    // step number: items with same step run concurrently; steps advance in order
    const stepInput = document.createElement('input'); stepInput.type = 'number'; stepInput.min = '0'; stepInput.step = '1'; stepInput.value = String(typeof it.step === 'number' ? it.step : 0); stepInput.title = 'Step: items with same step run concurrently'; stepInput.style.width = '56px'; stepInput.oninput = (e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); it.step = v; refreshConductionPanel(); };
    const upBtn = document.createElement('button'); upBtn.textContent = '↑'; upBtn.title = 'Move up'; upBtn.onclick = () => { if (idx > 0) { conductionItems.splice(idx-1, 0, conductionItems.splice(idx,1)[0]); selectedConductionIndex = idx-1; refreshConductionPanel(); } };
    const downBtn = document.createElement('button'); downBtn.textContent = '↓'; downBtn.title = 'Move down'; downBtn.onclick = () => { if (idx < conductionItems.length-1) { conductionItems.splice(idx+1, 0, conductionItems.splice(idx,1)[0]); selectedConductionIndex = idx+1; refreshConductionPanel(); } };
    const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.title = 'Delete'; delBtn.onclick = () => { conductionItems.splice(idx,1); if (selectedConductionIndex >= conductionItems.length) selectedConductionIndex = conductionItems.length - 1; refreshConductionPanel(); };
    const selBtn = document.createElement('button'); selBtn.textContent = 'Edit'; selBtn.title = 'Select/Edit'; selBtn.onclick = () => { selectedConductionIndex = idx; conductionEditMode = true; refreshConductionPanel(); };
    const typeSel = document.createElement('select'); const opt1 = document.createElement('option'); opt1.value='path'; opt1.text='Path'; const opt2 = document.createElement('option'); opt2.value='shape'; opt2.text='Shape'; typeSel.appendChild(opt1); typeSel.appendChild(opt2); typeSel.value = it.type; typeSel.onchange = (e) => { it.type = e.target.value; it.fill = it.type === 'shape'; it.closed = it.type === 'shape'; refreshConductionPanel(); };

    const colorIn = document.createElement('input'); colorIn.type = 'color'; colorIn.value = it.color; colorIn.oninput = (e) => { it.color = e.target.value; };

    row.appendChild(nameInput); row.appendChild(typeSel); row.appendChild(colorIn); row.appendChild(modeSel);
    if (durInput) row.appendChild(durInput); else if (durSpan) row.appendChild(durSpan);
    // binding select to tie this item's duration to an ECG feature
    const bindSel = document.createElement('select');
    const addOpt = (val, text) => { const o = document.createElement('option'); o.value = val; o.text = text; bindSel.appendChild(o); };
    addOpt('', 'Manual'); addOpt('P', 'P wave'); addOpt('PR', 'PR interval'); addOpt('QRS', 'QRS'); addOpt('QT', 'QT interval'); addOpt('T', 'T wave'); addOpt('TP', 'TP interval');
    bindSel.value = it.durationSource || '';
    bindSel.title = 'Bind this item\'s duration to an ECG feature';
    bindSel.onchange = (e) => { it.durationSource = e.target.value || null; refreshConductionPanel(); };
    row.appendChild(bindSel);
    // If this is a shape, provide envelope controls stacked vertically: ramp up, sustain, ramp down (ms)
    if (it.type === 'shape') {
      const envCol = document.createElement('div'); envCol.style.display = 'flex'; envCol.style.flexDirection = 'column'; envCol.style.gap = '4px'; envCol.style.marginLeft = '8px'; envCol.style.minWidth = '220px';
      const makeRow = (labelText, initial, onchange, bindingKey) => {
        const r = document.createElement('div'); r.style.display = 'flex'; r.style.alignItems = 'center'; r.style.gap = '6px';
        const lab = document.createElement('div'); lab.textContent = labelText; lab.style.width = '70px'; lab.style.fontSize = '12px';
        const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.step = '10'; inp.value = String(Number(initial) || 0); inp.style.width = '100px'; inp.oninput = (e) => { onchange(Number(e.target.value) || 0); };
        // binding select for this component
        const bind = document.createElement('select'); bind.style.width = '90px';
        const addOptComp = (val, text) => { const o = document.createElement('option'); o.value = val; o.text = text; bind.appendChild(o); };
        addOptComp('', 'Manual'); addOptComp('P', 'P wave'); addOptComp('PR', 'PR interval'); addOptComp('QRS', 'QRS'); addOptComp('QT', 'QT interval'); addOptComp('T', 'T wave'); addOptComp('TP', 'TP interval');
        // initialize binding value from item
        if (bindingKey && it[bindingKey]) bind.value = it[bindingKey]; else bind.value = '';
        bind.title = 'Bind this component\'s duration to an ECG feature';
        bind.onchange = (e) => { if (bindingKey) it[bindingKey] = e.target.value || null; refreshConductionPanel(); };
        // resolved-ms tooltip span (shows binding -> ms or numeric ms)
        const resolved = document.createElement('div'); resolved.style.fontSize = '11px'; resolved.style.opacity = '0.85'; resolved.style.width = '100px'; resolved.style.textAlign = 'right';
        // initialize resolved text
        try {
          const numericKey = bindingKey ? bindingKey.replace('Source', 'Ms') : null;
          const boundKey = bindingKey ? it[bindingKey] : null;
          let rv = 0;
          if (boundKey) rv = getEcgFeatureMs(boundKey) || 0; else if (numericKey) rv = Number(it[numericKey]) || 0; else rv = Number(initial) || 0;
          resolved.textContent = boundKey ? (boundKey + ' → ' + String(Math.max(0, rv)) + ' ms') : (String(Math.max(0, rv)) + ' ms');
        } catch (e) { resolved.textContent = '' }
        r.appendChild(lab); r.appendChild(inp); r.appendChild(bind); r.appendChild(resolved); return r;
      };
      const upRow = makeRow('Ramp Up', it.rampUpMs || 200, (v) => { it.rampUpMs = Math.max(0, v); refreshConductionPanel(); }, 'rampUpSource');
      const susRow = makeRow('Sustain', it.sustainMs || 800, (v) => { it.sustainMs = Math.max(0, v); refreshConductionPanel(); }, 'sustainSource');
      const downRow = makeRow('Ramp Down', it.rampDownMs || 200, (v) => { it.rampDownMs = Math.max(0, v); refreshConductionPanel(); }, 'rampDownSource');
      envCol.appendChild(upRow); envCol.appendChild(susRow); envCol.appendChild(downRow);
      row.appendChild(envCol);
    }

    row.appendChild(stepInput); row.appendChild(selBtn); row.appendChild(upBtn); row.appendChild(downBtn); row.appendChild(delBtn);
    row.onclick = (e) => { selectedConductionIndex = idx; refreshConductionPanel(); };
    list.appendChild(row);
  });

  conductionPanelDiv.appendChild(list);
  // persist the current list
  try { saveConductionItems(); } catch (e) { console.warn('Failed to save conduction items', e); }

  // recompute step order for playback whenever list changes
  try { computeConductionStepOrder(); } catch (e) { /* ignore */ }
}

// Persistence for conduction items
const CONDUCTION_STORAGE_KEY = 'ecg.conductionItems.v1';
function saveConductionItems() {
  try {
    const toSave = conductionItems.map(it => ({ id: it.id, name: it.name, type: it.type, points: it.points.map(p => ({ x: Number(p.x), y: Number(p.y) })), color: it.color, fill: !!it.fill, closed: !!it.closed, mode: it.mode || 'sequential', durationMs: Number(it.durationMs) || 1200, step: Number(it.step) || 0, rampUpMs: Number(it.rampUpMs) || 200, sustainMs: Number(it.sustainMs) || 800, rampDownMs: Number(it.rampDownMs) || 200, durationSource: it.durationSource || null, rampUpSource: it.rampUpSource || null, sustainSource: it.sustainSource || null, rampDownSource: it.rampDownSource || null }));
    localStorage.setItem(CONDUCTION_STORAGE_KEY, JSON.stringify(toSave));
    // also persist per-step durations
    try { saveConductionStepDurations(); } catch (e) { console.warn('Failed to save step durations', e); }
  } catch (e) { console.warn('saveConductionItems error', e); }
}

function loadConductionItems() {
  try {
    const raw = localStorage.getItem(CONDUCTION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    conductionItems = parsed.map((it, idx) => {
      const safePoints = Array.isArray(it.points) ? it.points.map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })) : [];
        return {
          id: it.id || Date.now(),
          name: it.name || ('Item ' + (idx + 1)),
          type: it.type === 'shape' ? 'shape' : 'path',
          points: safePoints,
          color: it.color || '#ff0000',
          fill: !!it.fill,
          closed: !!it.closed,
          mode: (it.mode === 'concurrent' ? 'concurrent' : 'sequential'),
          durationMs: Number(it.durationMs) || 1200,
          step: (typeof it.step === 'number') ? it.step : (typeof it.step === 'string' ? Number(it.step) || 0 : idx),
          rampUpMs: Number(it.rampUpMs) || 200,
          sustainMs: Number(it.sustainMs) || 800,
          rampDownMs: Number(it.rampDownMs) || 200
        ,
          durationSource: it.durationSource || null,
          rampUpSource: it.rampUpSource || null,
          sustainSource: it.sustainSource || null,
          rampDownSource: it.rampDownSource || null
        };
    });
    // load per-step durations as well
    try { loadConductionStepDurations(); } catch (e) { /* ignore */ }
    // ensure scheduler step order known
    try { computeConductionStepOrder(); } catch (e) {}
  } catch (e) { console.warn('loadConductionItems error', e); }
}

function createConductionPanel() {
  conductionPanelDiv = document.createElement('div');
  conductionPanelDiv.style.position = 'fixed';
  conductionPanelDiv.style.right = '10px';
  conductionPanelDiv.style.top = '120px';
  // Make the panel wide to avoid wrapping of controls
  conductionPanelDiv.style.width = '900px';
  conductionPanelDiv.style.maxWidth = '80%';
  conductionPanelDiv.style.background = 'rgba(255,255,255,0.98)';
  conductionPanelDiv.style.border = '1px solid rgba(0,0,0,0.12)';
  conductionPanelDiv.style.borderRadius = '8px';
  conductionPanelDiv.style.padding = '10px';
  conductionPanelDiv.style.zIndex = 10003;
  conductionPanelDiv.style.fontFamily = 'Helvetica, Arial, sans-serif';

  const title = document.createElement('div'); title.textContent = 'Conduction Paths/Shapes'; title.style.fontWeight = '700'; title.style.marginBottom = '8px'; conductionPanelDiv.appendChild(title);

  const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='6px'; btnRow.style.marginBottom='8px';
  const addPathBtn = document.createElement('button'); addPathBtn.textContent = 'Add Path'; addPathBtn.onclick = () => { createConductionItem('path'); };
  const addShapeBtn = document.createElement('button'); addShapeBtn.textContent = 'Add Shape'; addShapeBtn.onclick = () => { createConductionItem('shape'); };
  const toggleEdit = document.createElement('button'); toggleEdit.textContent = 'Toggle Edit'; toggleEdit.onclick = () => { conductionEditMode = !conductionEditMode; toggleEdit.style.background = conductionEditMode ? '#eef' : ''; };
  // refresh UI when toggling edit so highlights update immediately
  toggleEdit.onclick = () => { conductionEditMode = !conductionEditMode; toggleEdit.style.background = conductionEditMode ? '#eef' : ''; refreshConductionPanel(); };
  const playPauseBtn = document.createElement('button'); playPauseBtn.textContent = conductionPlayback.playing ? 'Pause' : 'Play'; playPauseBtn.onclick = () => { conductionPlayback.playing = !conductionPlayback.playing; playPauseBtn.textContent = conductionPlayback.playing ? 'Pause' : 'Play'; if (conductionPlayback.playing) conductionPlayback.stepStartTime = millis(); };
  btnRow.appendChild(addPathBtn); btnRow.appendChild(addShapeBtn); btnRow.appendChild(toggleEdit);
  btnRow.appendChild(playPauseBtn);
  conductionPanelDiv.appendChild(btnRow);

  // placeholder for list
  const listHolder = document.createElement('div'); listHolder.className = 'cond-list'; conductionPanelDiv.appendChild(listHolder);

  // point controls
  const pointRow = document.createElement('div'); pointRow.style.display='flex'; pointRow.style.gap='6px'; pointRow.style.marginTop='8px';
  const delPointBtn = document.createElement('button'); delPointBtn.textContent = 'Delete Point'; delPointBtn.onclick = () => { if (selectedConductionIndex >=0) { const it = conductionItems[selectedConductionIndex]; if (it && conductionDragging.pt >=0) { it.points.splice(conductionDragging.pt,1); conductionDragging.pt = -1; refreshConductionPanel(); } } };
  const clearPtsBtn = document.createElement('button'); clearPtsBtn.textContent = 'Clear Points'; clearPtsBtn.onclick = () => { if (selectedConductionIndex >=0) { conductionItems[selectedConductionIndex].points = []; refreshConductionPanel(); } };
  pointRow.appendChild(delPointBtn); pointRow.appendChild(clearPtsBtn);
  conductionPanelDiv.appendChild(pointRow);

  document.body.appendChild(conductionPanelDiv);
  refreshConductionPanel();
}

// Helper: return ECG feature duration in ms for binding keys
function getEcgFeatureMs(key) {
  if (!key) return null;
  switch (String(key)) {
    case 'P': return Math.max(1, Math.round((pDuration || 0) * 1000));
    case 'PR': return Math.max(1, Math.round((prDur || 0) * 1000));
    case 'QRS': return Math.max(1, Math.round(((qDur || 0) + (rDur || 0) + (sDur || 0)) * (qrsWidth || 1) * 1000));
    case 'QT': return Math.max(1, Math.round(qtIntervalMs || 0));
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

    const w = window.open('', 'ConductionPanel', 'width=520,height=760,left=80,top=80');
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
  globalPanel.style.left = '10px';
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
  qrsInput.oninput = (e) => { qrsWidth = Number(e.target.value); qrsVal.textContent = qrsWidth.toFixed(2); };
  qrsInput.style.flex = '1';
  const qrsVal = document.createElement('div'); qrsVal.textContent = qrsWidth.toFixed(2); qrsVal.style.width = '44px'; qrsVal.style.textAlign = 'right';
  qrsRow.appendChild(qrsInput); qrsRow.appendChild(qrsVal); globalPanel.appendChild(qrsRow);
  // Q duration slider (seconds)
  const qdurRow = document.createElement('div');
  qdurRow.style.display = 'flex'; qdurRow.style.alignItems = 'center'; qdurRow.style.gap = '8px';
  const qdurInput = document.createElement('input');
  qdurInput.type = 'range'; qdurInput.min = '0.005'; qdurInput.max = '0.08'; qdurInput.step = '0.001'; qdurInput.value = String(qDur);
  qdurInput.oninput = (e) => { qDur = Number(e.target.value); qdurVal.textContent = String(Math.round(qDur * 1000)) + ' ms'; refreshConductionPanel(); };
  qdurInput.style.flex = '1';
  const qdurVal = document.createElement('div'); qdurVal.textContent = String(Math.round(qDur * 1000)) + ' ms'; qdurVal.style.width = '56px'; qdurVal.style.textAlign = 'right';
  qdurRow.appendChild(qdurInput); qdurRow.appendChild(qdurVal); globalPanel.appendChild(qdurRow);

  // R duration slider (seconds)
  const rdurRow = document.createElement('div');
  rdurRow.style.display = 'flex'; rdurRow.style.alignItems = 'center'; rdurRow.style.gap = '8px';
  const rdurInput = document.createElement('input');
  rdurInput.type = 'range'; rdurInput.min = '0.003'; rdurInput.max = '0.06'; rdurInput.step = '0.001'; rdurInput.value = String(rDur);
  rdurInput.oninput = (e) => { rDur = Number(e.target.value); rdurVal.textContent = String(Math.round(rDur * 1000)) + ' ms'; refreshConductionPanel(); };
  rdurInput.style.flex = '1';
  const rdurVal = document.createElement('div'); rdurVal.textContent = String(Math.round(rDur * 1000)) + ' ms'; rdurVal.style.width = '56px'; rdurVal.style.textAlign = 'right';
  rdurRow.appendChild(rdurInput); rdurRow.appendChild(rdurVal); globalPanel.appendChild(rdurRow);

  // S duration slider (seconds)
  const sdurRow = document.createElement('div');
  sdurRow.style.display = 'flex'; sdurRow.style.alignItems = 'center'; sdurRow.style.gap = '8px';
  const sdurInput = document.createElement('input');
  sdurInput.type = 'range'; sdurInput.min = '0.005'; sdurInput.max = '0.12'; sdurInput.step = '0.001'; sdurInput.value = String(sDur);
  sdurInput.oninput = (e) => { sDur = Number(e.target.value); sdurVal.textContent = String(Math.round(sDur * 1000)) + ' ms'; refreshConductionPanel(); };
  sdurInput.style.flex = '1';
  const sdurVal = document.createElement('div'); sdurVal.textContent = String(Math.round(sDur * 1000)) + ' ms'; sdurVal.style.width = '56px'; sdurVal.style.textAlign = 'right';
  sdurRow.appendChild(sdurInput); sdurRow.appendChild(sdurVal); globalPanel.appendChild(sdurRow);

  // P duration slider (seconds)
  const pdurRow = document.createElement('div');
  pdurRow.style.display = 'flex'; pdurRow.style.alignItems = 'center'; pdurRow.style.gap = '8px';
  const pdurInput = document.createElement('input');
  pdurInput.type = 'range'; pdurInput.min = '0.01'; pdurInput.max = '0.20'; pdurInput.step = '0.005'; pdurInput.value = String(pDuration);
  pdurInput.oninput = (e) => { pDuration = Number(e.target.value); pdurVal.textContent = String(Math.round(pDuration * 1000)) + ' ms'; refreshConductionPanel(); };
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
  hrInput.oninput = (e) => { heartRate = Number(e.target.value) || 60; hrVal.textContent = String(Math.round(heartRate)) + ' bpm'; refreshConductionPanel(); };
  hrRow.appendChild(hrLab); hrRow.appendChild(hrInput); hrRow.appendChild(hrVal); globalPanel.appendChild(hrRow);

  // Global amplitude sliders for P/Q/R/S/T
  function addAmpRow(label, min, max, step, initial, oninput) {
    const row = document.createElement('div');
    row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
    const lab = document.createElement('div'); lab.textContent = label; lab.style.width = '18px'; row.appendChild(lab);
    const input = document.createElement('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(initial); input.style.flex = '1';
    const val = document.createElement('div'); val.textContent = (typeof initial === 'number' ? initial.toFixed(2) : String(initial)); val.style.width = '48px'; val.style.textAlign = 'right';
    input.oninput = (e) => { const num = Number(e.target.value); val.textContent = num.toFixed(2); oninput(num); };
    row.appendChild(input); row.appendChild(val); globalPanel.appendChild(row);
    return {input, val, row};
  }

  addAmpRow('P', -3.0, 3.0, 0.01, gP, (v) => { gP = v; });
  addAmpRow('Q', 0.0, 5.0, 0.01, gQ, (v) => { gQ = v; });
  addAmpRow('R', 0.0, 5.0, 0.01, gR, (v) => { gR = v; });
  addAmpRow('S', 0.0, 5.0, 0.01, gS, (v) => { gS = v; });
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
  prInput.style.flex = '1'; const prVal = document.createElement('div'); prVal.textContent = String(Math.round(prDur * 1000)) + ' ms'; prVal.style.width = '56px'; prVal.style.textAlign = 'right';
  prInput.oninput = (e) => { prDur = Number(e.target.value); prVal.textContent = String(Math.round(prDur * 1000)) + ' ms'; refreshConductionPanel(); };
  const prLab = document.createElement('div'); prLab.textContent = 'PR'; prLab.style.width = '18px'; prRow.appendChild(prLab); prRow.appendChild(prInput); prRow.appendChild(prVal); globalPanel.appendChild(prRow);

  const qtRow = document.createElement('div'); qtRow.style.display = 'flex'; qtRow.style.alignItems = 'center'; qtRow.style.gap = '8px';
  const qtInput = document.createElement('input'); qtInput.type = 'range'; qtInput.min = '200'; qtInput.max = '600'; qtInput.step = '1'; qtInput.value = String(qtIntervalMs);
  qtInput.style.flex = '1'; const qtVal = document.createElement('div'); qtVal.textContent = String(qtIntervalMs); qtVal.style.width = '56px'; qtVal.style.textAlign = 'right';
  qtInput.oninput = (e) => { qtIntervalMs = Number(e.target.value); qtVal.textContent = String(qtIntervalMs); refreshConductionPanel(); };
  const qtLab = document.createElement('div'); qtLab.textContent = 'QTms'; qtLab.style.width = '18px'; qtRow.appendChild(qtLab); qtRow.appendChild(qtInput); qtRow.appendChild(qtVal); globalPanel.appendChild(qtRow);

  document.body.appendChild(globalPanel);
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
    // position fixed so it's not occluded or scrolled away; anchor below globalPanel
    try {
      const rect = globalPanel.getBoundingClientRect();
      conductionDebugDiv.style.position = 'fixed';
      conductionDebugDiv.style.left = String(Math.max(6, Math.round(rect.left))) + 'px';
      conductionDebugDiv.style.top = String(Math.max(6, Math.round(rect.bottom + 8))) + 'px';
      conductionDebugDiv.style.zIndex = 10004;
    } catch (e) {
      conductionDebugDiv.style.position = 'fixed'; conductionDebugDiv.style.left = '10px'; conductionDebugDiv.style.top = '220px'; conductionDebugDiv.style.zIndex = 10004;
    }
    document.body.appendChild(conductionDebugDiv);
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
  loadLeadParams();

  // load persisted conduction items so the panel is populated on startup
  try {
    loadConductionItems();
    if (conductionItems && conductionItems.length > 0) selectedConductionIndex = 0;
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
  addSmallRange(cd, 'Q', 0.0, 3.0, 0.01, leadParams[i].q, (v) => leadParams[i].q = v);
  addSmallRange(cd, 'R', 0.0, 3.0, 0.01, leadParams[i].r, (v) => leadParams[i].r = v);
  addSmallRange(cd, 'S', 0.0, 3.0, 0.01, leadParams[i].s, (v) => leadParams[i].s = v);
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

  // create conduction panel UI
  try { createConductionPanel(); } catch (e) { console.warn('Failed to create conduction panel', e); }
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

      // Render ECG into offscreen buffer and blit into right half
      if (ecgG) {
        ecgG.clear();
        // grid and waveform
        drawSingleLeadTo(ecgG, heartRate);
        // blit to right half
        image(ecgG, halfW, 0);
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
      const deltaSec = now - bt;
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
  const now = millis();

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
  // centralized step scheduler: draw moving impulses for the active step
  // compute step order if empty
  if (!conductionPlayback.stepOrder || conductionPlayback.stepOrder.length === 0) computeConductionStepOrder();
  const stepOrder = conductionPlayback.stepOrder || [];
  if (stepOrder.length > 0 && conductionPlayback.playing) {
    // ensure stepStartTime initialized
    if (!conductionPlayback.stepStartTime || conductionPlayback.stepStartTime <= 0) conductionPlayback.stepStartTime = millis();
    const activeStepVal = stepOrder[conductionPlayback.currentStepIndex] || 0;
    // find items in the active step in panel order
    const activeIdxs = [];
    for (let i = 0; i < conductionItems.length; i++) {
      const it = conductionItems[i]; if (!it) continue;
      if ((Number(it.step) || 0) === activeStepVal) activeIdxs.push(i);
    }
    if (activeIdxs.length > 0) {
      // compute step duration as the driven max of item durations (shapes use envelope totals)
      let maxDur = 0;
      for (const ix of activeIdxs) {
        const it = conductionItems[ix];
        if (!it) continue;
        // compute binding-aware per-component values for shapes AND honor
        // a bound overall duration for non-shape items (durationSource)
        if (it.durationSource) {
          const fv = getEcgFeatureMs(it.durationSource) || 0;
          const d = Math.max(10, fv || 0);
          if (d > maxDur) maxDur = d;
          continue;
        }
        // shape envelopes: use per-component bindings when present
        if (it.type === 'shape') {
          const upVal = it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : (Number(it.rampUpMs) || 0);
          const susVal = it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : (Number(it.sustainMs) || 0);
          const downVal = it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : (Number(it.rampDownMs) || 0);
          const shapeTotal = upVal + susVal + downVal;
          const d = Math.max(10, shapeTotal || 0);
          if (d > maxDur) maxDur = d;
          continue;
        }
        // fallback: explicit per-item durationMs
        const d = Math.max(10, Number(it.durationMs) || 1200);
        if (d > maxDur) maxDur = d;
      }
      // allow per-step override if present in persisted `conductionStepDurations`
      const overrideVal = (conductionStepDurations && Number.isFinite(conductionStepDurations[activeStepVal])) ? conductionStepDurations[activeStepVal] : null;
      const stepDur = (Number.isFinite(overrideVal) ? overrideVal : maxDur);
      // build per-item computed durations for debugging / display
      const activeItemDurations = activeIdxs.map(ix => {
        const it = conductionItems[ix];
        if (!it) return { name: 'Unknown', dur: 0 };
        if (it.durationSource) {
          return { name: it.name || ('Item ' + ix), dur: getEcgFeatureMs(it.durationSource) || 0 };
        } else if (it.type === 'shape') {
          const upVal = it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : (Number(it.rampUpMs) || 0);
          const susVal = it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : (Number(it.sustainMs) || 0);
          const downVal = it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : (Number(it.rampDownMs) || 0);
          return { name: it.name || ('Item ' + ix), dur: Math.max(10, upVal + susVal + downVal) };
        } else {
          return { name: it.name || ('Item ' + ix), dur: Math.max(10, Number(it.durationMs) || 1200) };
        }
      });
      const nowMs = millis();
      const elapsed = nowMs - conductionPlayback.stepStartTime;
      const progress = Math.min(1.0, Math.max(0.0, elapsed / Math.max(1, stepDur)));

      // draw moving dot along each active item (or shape depolarization)
      for (const ix of activeIdxs) {
        const it = conductionItems[ix]; if (!it) continue;
        // If this item is a closed shape, show depolarization by fading its fill
        if (it.type === 'shape') {
            // determine per-component durations using bindings when present
            const rampUp = it.rampUpSource ? (getEcgFeatureMs(it.rampUpSource) || 0) : Math.max(0, Number(it.rampUpMs) || 0);
            const sustain = it.sustainSource ? (getEcgFeatureMs(it.sustainSource) || 0) : Math.max(0, Number(it.sustainMs) || 0);
            const rampDown = it.rampDownSource ? (getEcgFeatureMs(it.rampDownSource) || 0) : Math.max(0, Number(it.rampDownMs) || 0);
            const totalEnvelope = rampUp + sustain + rampDown;
            const boundMs = it.durationSource ? getEcgFeatureMs(it.durationSource) : null;
            const effectiveItemDur = (boundMs && Number.isFinite(boundMs)) ? Math.max(10, boundMs) : Math.max(10, totalEnvelope || 0);
          let alpha = 0;
            if (totalEnvelope <= 0) {
              alpha = Math.max(0, Math.sin(progress * Math.PI));
            } else {
              // fit envelope into the available step duration; if envelope is longer than step, scale it down.
              // Use the effectiveItemDur to decide scaling if bound, otherwise use envelope total.
              const useDurForScale = effectiveItemDur || totalEnvelope || stepDur;
              const scale = totalEnvelope > useDurForScale ? (useDurForScale / totalEnvelope) : 1.0;
              const up = rampUp * scale;
              const sus = sustain * scale;
              const down = rampDown * scale;
              const t = Math.max(0, Math.min(useDurForScale, elapsed)); // elapsed is ms since step start
              if (t < up) {
                alpha = t / Math.max(1, up);
              } else if (t < up + sus) {
                alpha = 1.0;
              } else if (t < up + sus + down) {
                alpha = 1.0 - ((t - up - sus) / Math.max(1, down));
              } else {
                alpha = 0.0;
              }
              alpha = Math.max(0, Math.min(1, alpha));
            }
          const rgb = hexToRgb(it.color || '#ff0000');
          push();
          noStroke();
          fill(rgb.r, rgb.g, rgb.b, Math.round(alpha * 220));
          beginShape();
          for (let p of it.points) vertex(imgX + p.x * imgW, imgY + p.y * imgH);
          endShape(CLOSE);
          pop();
          // keep the outline already drawn above; skip dot
        } else {
          strokeWeight(0);
          noStroke();
          // draw a short fading trail for sequential path items (traveling pulse)
          if (it.points.length >= 2 && (it.mode || 'sequential') !== 'concurrent') {
            const normPts = it.points.map(p => ({ x: p.x * imgW + imgX, y: p.y * imgH + imgY }));
            // trail length in ms (longer trail for better persistence)
            const trailMs = Math.min(1200, Math.max(120, stepDur * 0.8));
            const sampleMs = 40; // ms between trail samples
            const samples = Math.max(5, Math.ceil(trailMs / sampleMs));
            const rgb = hexToRgb(it.color || '#ff0000');
            for (let s = 0; s < samples; s++) {
              const dt = s * (trailMs / samples);
              const sampleElapsed = Math.max(0, elapsed - dt);
              const sampleProgress = Math.min(1.0, Math.max(0.0, sampleElapsed / Math.max(1, stepDur)));
              const pt = pointAlongPolyline(normPts, sampleProgress);
              if (!pt) continue;
              const alpha = (1 - s / Math.max(1, samples - 1)) * 0.95;
              const size = 6 + 12 * (1 - s / Math.max(1, samples));
              fill(rgb.r, rgb.g, rgb.b, Math.round(alpha * 220));
              ellipse(pt.x, pt.y, size, size);
            }
          } else if (it.points.length >= 2) {
            // concurrent paths or no trail requested: simple dot at current progress
            const normPts = it.points.map(p => ({ x: p.x * imgW + imgX, y: p.y * imgH + imgY }));
            const pt = pointAlongPolyline(normPts, progress);
            if (pt) {
              const rgb = hexToRgb(it.color || '#ff0000');
              fill(rgb.r, rgb.g, rgb.b, 220);
              ellipse(pt.x, pt.y, 12, 12);
            }
          } else if (it.points.length === 1) {
            const p = it.points[0]; const x = imgX + p.x * imgW; const y = imgY + p.y * imgH;
            // pulse the single point with a longer fading ring trail
            const trailMs = Math.min(800, Math.max(80, stepDur * 0.6));
            const sampleMs = 50;
            const samples = Math.max(3, Math.ceil(trailMs / sampleMs));
            const rgb = hexToRgb(it.color || '#ff0000');
            for (let s = 0; s < samples; s++) {
              const dt = s * (trailMs / samples);
              const sampleElapsed = Math.max(0, elapsed - dt);
              const frac = Math.min(1, sampleElapsed / Math.max(1, stepDur));
              const alpha = (1 - s / Math.max(1, samples - 1)) * (0.6 + 0.4 * frac);
              const size = 6 + 14 * (1 - s / Math.max(1, samples));
              fill(rgb.r, rgb.g, rgb.b, Math.round(alpha * 220));
              ellipse(x, y, size, size);
            }
          }
        }
      }

      // Draw active element names as text below the CCS image
      try {
        const names = activeIdxs.map(i => conductionItems[i] && conductionItems[i].name ? conductionItems[i].name : 'Item ' + i);
        const txt = names.join('  •  ');
        // draw just below image area
        const textX = imgX + 6;
        const textY = imgY + imgH + 18;
        push();
        noStroke(); fill(10); textSize(14); textFont('Helvetica');
        text(txt, textX, textY);
        pop();
      } catch (e) {
        // ignore
      }

      // Update the conduction debug DOM (if present) so it's visible in the control panel/popup
      try {
        if (conductionDebugDiv) {
          conductionDebugDiv.innerHTML = '';
          const h = document.createElement('div'); h.style.fontWeight = '700'; h.textContent = 'Step ' + activeStepVal + ' dur: ' + String(stepDur) + ' ms'; conductionDebugDiv.appendChild(h);
          for (let i = 0; i < activeItemDurations.length; i++) {
            const it = activeItemDurations[i]; const r = document.createElement('div'); r.textContent = it.name + ': ' + String(Math.round(it.dur)) + ' ms'; conductionDebugDiv.appendChild(r);
          }
        }
        if (conductionDebugWindow && !conductionDebugWindow.closed) {
          try {
            const doc = conductionDebugWindow.document;
            if (!conductionDebugWinDiv) { conductionDebugWinDiv = doc.createElement('div'); doc.body.appendChild(conductionDebugWinDiv); }
            let html = '<div class="title">Step ' + activeStepVal + ' dur: ' + String(stepDur) + ' ms</div>';
            // show override state and provide a clear button that calls back to opener
            const ov = (conductionStepDurations && Number.isFinite(conductionStepDurations[activeStepVal])) ? conductionStepDurations[activeStepVal] : null;
            if (Number.isFinite(ov)) {
              html += '<div class="item">Override: ' + String(ov) + ' ms <button onclick="try{ window.opener.clearConductionStepOverride(' + activeStepVal + '); }catch(e){}">Clear</button></div>';
            } else {
              html += '<div class="item">Override: (none)</div>';
            }
            for (let i = 0; i < activeItemDurations.length; i++) { const it = activeItemDurations[i]; html += '<div class="item">' + escapeHtml(it.name) + ': ' + String(Math.round(it.dur)) + ' ms</div>'; }
            conductionDebugWinDiv.innerHTML = html;
          } catch (e) { /* ignore popup update errors */ }
        }
      } catch (e) { /* ignore DOM update issues */ }

      // advance to next step when progress complete
      if (progress >= 1.0) {
        conductionPlayback.currentStepIndex = (conductionPlayback.currentStepIndex + 1) % stepOrder.length;
        conductionPlayback.stepStartTime = millis();
      }
    }
  }

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
  const minPQGap = 0.04; // gap between end of P and start of Q
  const minTPGap = 0.06; // gap between end of T and start of next P

  // Determine beatPeriod from current heartRate (global)
  const beatPeriod = 60.0 / heartRate;

  // Adjust P window end so P and Q are separated by at least minPQGap
  let pStart = pStartDefault;
  let pEnd = Math.min(pEndDefault, qStart - minPQGap);
  if (pEnd <= pStart + 0.01) {
    // ensure a tiny width
    pEnd = pStart + 0.01;
  }

  // Ensure there's a gap between current beat's T end and the NEXT beat's P start.
  // Next beat's P start would be at (beatPeriod + pStart). We want:
  // (beatPeriod + pStart) - tEnd >= minTPGap  =>  pStart >= tEnd - beatPeriod + minTPGap
  const neededPStart = tEnd - beatPeriod + minTPGap;
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

  // Compute constraints for P center so P window stays between neededPStart and qStart - minPQGap
  let minCenter = neededPStart + desiredPdur / 2.0;
  let maxCenter = qStart - minPQGap - desiredPdur / 2.0;

  // If constraints conflict (very high HR), shrink desiredPdur to fit available space
  if (minCenter > maxCenter) {
    const available = (qStart - minPQGap) - neededPStart;
    if (available <= 0.0) {
      // no room, fallback to a very narrow P centered between bounds
      desiredPdur = 0.01;
      minCenter = neededPStart + desiredPdur / 2.0;
      maxCenter = qStart - minPQGap - desiredPdur / 2.0;
    } else {
      // shrink to 90% of available
      desiredPdur = Math.max(0.01, available * 0.9);
      minCenter = neededPStart + desiredPdur / 2.0;
      maxCenter = qStart - minPQGap - desiredPdur / 2.0;
    }
  }

  // pick a P center based on preferred PR duration, constrained to available space
  const prevCenter = (pStart + pEnd) / 2.0;
  const pCenterPref = qStart - prDur; // preferred P center located prDur before Q onset
  let pCenter = constrain(pCenterPref, minCenter, maxCenter);
  // if preferred center is wildly out-of-bounds (e.g., very high HR), fall back near previous
  if (pCenter < minCenter || pCenter > maxCenter) pCenter = constrain(prevCenter, minCenter, maxCenter);

  // set p window to desired duration around center
  pStart = pCenter - desiredPdur / 2.0;
  pEnd = pCenter + desiredPdur / 2.0;

  // Enforce that P always ends before Q start minus minPQGap.
  const latestPEnd = qStart - minPQGap;
  if (pEnd > latestPEnd) {
    // shift left so pEnd == latestPEnd
    const shift = pEnd - latestPEnd;
    pCenter -= shift;
    pStart -= shift;
    pEnd = latestPEnd;
  }

  // Try to keep P start after neededPStart (to maintain T->P gap), but
  // never allow P to end after latestPEnd. If both can't be satisfied
  // (common at high HR), prioritize keeping P before Q by clamping to latestPEnd
  if (pStart < neededPStart) {
    // available space between neededPStart and latestPEnd
    const available = latestPEnd - neededPStart;
    if (available >= desiredPdur) {
      // there is room: place P starting at neededPStart
      pStart = neededPStart;
      pEnd = pStart + desiredPdur;
      pCenter = (pStart + pEnd) / 2.0;
    } else {
      // not enough room to satisfy both; prioritize P before Q
      // set pEnd to latestPEnd and shrink duration to available (min 0.01s)
      const newDur = Math.max(0.01, available);
      pEnd = latestPEnd;
      pStart = pEnd - newDur;
      pCenter = (pStart + pEnd) / 2.0;
      desiredPdur = newDur;
    }
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
    const deltaSec = now - bt;
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
