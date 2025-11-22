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

// CCS annotation markers (normalized coordinates relative to image [0..1])
let ccsMarkers = {
  'SA': { label: 'SA node', x: 0.65, y: 0.18, visible: false, color: '#ff3333' },
  'AV': { label: 'AV node', x: 0.52, y: 0.48, visible: false, color: '#ff9933' },
  'His': { label: 'Bundle of His', x: 0.52, y: 0.55, visible: false, color: '#33aaff' },
  'LBB': { label: 'Left bundle', x: 0.45, y: 0.66, visible: false, color: '#33cc33' },
  'RBB': { label: 'Right bundle', x: 0.60, y: 0.66, visible: false, color: '#8877ff' },
  'Purkinje': { label: 'Purkinje fibers', x: 0.5, y: 0.85, visible: false, color: '#aa33aa' }
};
let placingMarker = null; // key of marker being placed by click (or null)
let showCcsMarkers = true; // master toggle for drawing markers

// explicit mapping from component name -> role (set by UI)
let explicitMapping = { SA: null, AV: null, His: null, LBB: null, RBB: null, Purkinje: null, Atrial: null };

// overlay data to help troubleshooting mapping/conversion
let conversionOverlay = { show: true, mappedRoles: {}, atrialCandidates: [] };
// saved converted mapping and paths (persisted)
let savedConvertedPaths = null;
let savedMappedRoles = null;
let useSavedConvertedPaths = false;
// user-added atrial paths (pixel coords)
let userAtrialPaths = [];
// per-role speed multipliers (1.0 = normal)
const roleSpeeds = { SA:1.0, Atrial:1.0, AV:1.0, His:1.0, LBB:1.0, RBB:1.0, Purkinje:1.0 };

// Component drawing / editing utility
let ccsComponents = {}; // map name -> { color, visible, strokes: [ [ {x,y}, ... ] ] }
let drawingMode = false; // true when user is drawing a stroke into selected component
let currentStroke = null; // accumulating points while dragging
let selectedComponent = null; // name of currently selected component
// shape drawing mode: 'spline' or 'oval' (or 'freehand' for legacy)
let shapeDrawMode = 'spline';
let currentShape = null; // { type, points } or { type:'oval', x0,y0,x1,y1 }

// Conduction animation state
let conductionPaths = []; // array of {fromKey,toKey,points[]}
let animateConduction = false;
let conductionStart = 0;
let conductionSpeed = 1.0; // multiplier (1.0 = real-time-ish)
let conductionSegmentDur = 0.06; // default per-segment duration (s)

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

  // --- CCS annotation controls (only meaningful in single-lead view) ---
  const ccsContainer = document.createElement('div');
  ccsContainer.style.position = 'fixed';
  ccsContainer.style.right = '10px';
  ccsContainer.style.top = '86px';
  ccsContainer.style.zIndex = 10002;
  ccsContainer.style.background = 'rgba(255,255,255,0.95)';
  ccsContainer.style.border = '1px solid rgba(0,0,0,0.12)';
  ccsContainer.style.borderRadius = '6px';
  ccsContainer.style.padding = '6px';
  ccsContainer.style.fontSize = '12px';

  const ccsLabel = document.createElement('div'); ccsLabel.textContent = 'CCS Annotations'; ccsLabel.style.fontWeight = '600'; ccsLabel.style.marginBottom = '6px'; ccsContainer.appendChild(ccsLabel);

  const select = document.createElement('select');
  select.style.width = '140px';
  select.style.marginBottom = '6px';
  for (const k of Object.keys(ccsMarkers)) {
    const opt = document.createElement('option'); opt.value = k; opt.textContent = ccsMarkers[k].label; select.appendChild(opt);
  }
  ccsContainer.appendChild(select);

  const placeBtn = document.createElement('button'); placeBtn.textContent = 'Place selected'; placeBtn.style.marginRight = '6px';
  placeBtn.onclick = () => { placingMarker = select.value; placeBtn.textContent = placingMarker ? 'Click image to place' : 'Place selected'; };
  ccsContainer.appendChild(placeBtn);

  const autoSa = document.createElement('button'); autoSa.textContent = 'Auto SA'; autoSa.style.marginLeft = '6px';
  autoSa.onclick = () => { ccsMarkers['SA'].visible = true; placingMarker = null; showCcsMarkers = true; };
  ccsContainer.appendChild(autoSa);

  const toggleMarkers = document.createElement('button'); toggleMarkers.textContent = 'Toggle markers'; toggleMarkers.style.display = 'block'; toggleMarkers.style.marginTop = '6px';
  toggleMarkers.onclick = () => { showCcsMarkers = !showCcsMarkers; };
  ccsContainer.appendChild(toggleMarkers);

  // --- Component drawing UI ---
  const compNameRow = document.createElement('div'); compNameRow.style.display='flex'; compNameRow.style.gap='6px'; compNameRow.style.marginTop='8px';
  const compInput = document.createElement('input'); compInput.placeholder = 'Component name'; compInput.style.flex='1'; compInput.style.fontSize='12px';
  const newCompBtn = document.createElement('button'); newCompBtn.textContent = 'New';
  compNameRow.appendChild(compInput); compNameRow.appendChild(newCompBtn); ccsContainer.appendChild(compNameRow);

  const compSelect = document.createElement('select'); compSelect.style.width='100%'; compSelect.style.marginTop='6px'; ccsContainer.appendChild(compSelect);

  const drawRow = document.createElement('div'); drawRow.style.display='flex'; drawRow.style.gap='6px'; drawRow.style.marginTop='6px';
  const drawToggle = document.createElement('button'); drawToggle.textContent = 'Enter Draw Mode';
  const saveCompBtn = document.createElement('button'); saveCompBtn.textContent = 'Save'; saveCompBtn.style.marginLeft='6px';
  drawRow.appendChild(drawToggle); drawRow.appendChild(saveCompBtn); ccsContainer.appendChild(drawRow);

  // Shape mode selector and finish/cancel buttons
  const shapeRow = document.createElement('div'); shapeRow.style.display='flex'; shapeRow.style.gap='6px'; shapeRow.style.marginTop='6px';
  const shapeSelect = document.createElement('select');
  ['freehand','spline','oval'].forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; shapeSelect.appendChild(o); });
  shapeSelect.value = shapeDrawMode || 'spline';
  const finishShapeBtn = document.createElement('button'); finishShapeBtn.textContent = 'Finish Shape';
  const cancelShapeBtn = document.createElement('button'); cancelShapeBtn.textContent = 'Cancel Shape';
  shapeRow.appendChild(shapeSelect); shapeRow.appendChild(finishShapeBtn); shapeRow.appendChild(cancelShapeBtn);
  ccsContainer.appendChild(shapeRow);

  const exportRow = document.createElement('div'); exportRow.style.display='flex'; exportRow.style.gap='6px'; exportRow.style.marginTop='6px';
  const exportAllBtn = document.createElement('button'); exportAllBtn.textContent = 'Export All';
  const importBtn = document.createElement('button'); importBtn.textContent = 'Import';
  const importInput = document.createElement('input'); importInput.type='file'; importInput.accept='application/json'; importInput.style.display='none';
  exportRow.appendChild(exportAllBtn); exportRow.appendChild(importBtn); exportRow.appendChild(importInput); ccsContainer.appendChild(exportRow);

  const compActions = document.createElement('div'); compActions.style.display='flex'; compActions.style.gap='6px'; compActions.style.marginTop='6px';
  const delCompBtn = document.createElement('button'); delCompBtn.textContent = 'Delete';
  const visToggleBtn = document.createElement('button'); visToggleBtn.textContent = 'Toggle Visibility';
  const addAtrialBtn = document.createElement('button'); addAtrialBtn.textContent = 'Add Atrial Path';
  compActions.appendChild(delCompBtn); compActions.appendChild(visToggleBtn); ccsContainer.appendChild(compActions);
  compActions.appendChild(addAtrialBtn);

  // helper to refresh component select options
  function refreshCompList() {
    const cur = compSelect.value;
    while (compSelect.firstChild) compSelect.removeChild(compSelect.firstChild);
    for (const name of Object.keys(ccsComponents)) {
      const o = document.createElement('option'); o.value = name; o.textContent = name; compSelect.appendChild(o);
    }
    if (Object.keys(ccsComponents).length === 0) { selectedComponent = null; compSelect.disabled = true; drawToggle.disabled = true; saveCompBtn.disabled = true; delCompBtn.disabled = true; visToggleBtn.disabled = true; }
    else { compSelect.disabled = false; compSelect.value = cur || Object.keys(ccsComponents)[0]; selectedComponent = compSelect.value; drawToggle.disabled = false; saveCompBtn.disabled = false; delCompBtn.disabled = false; visToggleBtn.disabled = false; }
    try { if (typeof refreshMappingOptions === 'function') refreshMappingOptions(); } catch (e) {}
  }

  // create new component
  newCompBtn.onclick = () => {
    const name = (compInput.value || '').trim();
    if (!name) return alert('Enter a name');
    if (ccsComponents[name]) return alert('Name exists');
    ccsComponents[name] = { color: '#00aaee', visible: true, strokes: [] };
    compInput.value = '';
    refreshCompList();
  };
  compSelect.onchange = () => { selectedComponent = compSelect.value; };

  // enter/exit draw mode
  drawToggle.onclick = () => {
    if (!selectedComponent) return alert('Select or create a component first');
    drawingMode = !drawingMode;
    drawToggle.textContent = drawingMode ? 'Exit Draw Mode' : 'Enter Draw Mode';
  };

  // shape mode change
  shapeSelect.onchange = () => { shapeDrawMode = shapeSelect.value; };

  // Finish current shape (primarily for spline mode)
  finishShapeBtn.onclick = () => {
    if (!selectedComponent) return alert('Select a component');
    if (!currentShape) return;
    const comp = ccsComponents[selectedComponent] || (ccsComponents[selectedComponent] = { color:'#00aaee', visible:true, strokes:[], shapes:[] });
    if (!comp.shapes) comp.shapes = [];
    // finalize and push
    comp.shapes.push(currentShape);
    currentShape = null;
  };

  // Cancel in-progress shape
  cancelShapeBtn.onclick = () => { currentShape = null; };

  // save a single component -> trigger download of JSON for that component
  saveCompBtn.onclick = () => {
    if (!selectedComponent) return alert('Select a component');
    const data = { name: selectedComponent, component: ccsComponents[selectedComponent] };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = selectedComponent + '.json'; a.click(); URL.revokeObjectURL(url);
  };

  exportAllBtn.onclick = () => {
    const data = { components: ccsComponents };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ccs_components.json'; a.click(); URL.revokeObjectURL(url);
  };
  importBtn.onclick = () => { importInput.click(); };
  importInput.onchange = (e) => {
    const f = importInput.files && importInput.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (parsed.components) {
          // merge
          for (const k of Object.keys(parsed.components)) ccsComponents[k] = parsed.components[k];
        } else if (parsed.name && parsed.component) {
          ccsComponents[parsed.name] = parsed.component;
        }
        refreshCompList();
      } catch (err) { alert('Invalid JSON'); }
    }; r.readAsText(f);
  };

  delCompBtn.onclick = () => { if (!selectedComponent) return; if (!confirm('Delete component ' + selectedComponent + '?')) return; delete ccsComponents[selectedComponent]; refreshCompList(); };
  visToggleBtn.onclick = () => { if (!selectedComponent) return; ccsComponents[selectedComponent].visible = !ccsComponents[selectedComponent].visible; };

  // Add currently selected component's shapes as atrial paths (pixel-space)
  addAtrialBtn.onclick = () => {
    if (!selectedComponent) return alert('Select a component first');
    const rect = window._lastCcsRect;
    if (!rect) return alert('CCS image not positioned yet; wait until the image is visible.');
    const comp = ccsComponents[selectedComponent];
    if (!comp) return alert('Component missing');
    const added = [];
    // prefer shapes (splines/oval), fallback to strokes
    if (comp.shapes && comp.shapes.length) {
      let idx = 0;
      for (const sh of comp.shapes) {
        if (!sh) continue;
        if (sh.type === 'spline' && sh.points && sh.points.length) {
          const pts = sh.points.map(p => ({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h }));
          const gname = selectedComponent + ':user' + idx;
          const pathObj = { from: 'SA', to: 'AV', points: pts, duration: Math.max(0.02, prDur), stage: 0, group: gname };
          userAtrialPaths.push(pathObj); added.push(pathObj); idx++;
        } else if (sh.type === 'oval') {
          const cx = (sh.x0 + sh.x1) / 2; const cy = (sh.y0 + sh.y1) / 2;
          const pts = [{ x: rect.x + cx * rect.w, y: rect.y + cy * rect.h }];
          const gname = selectedComponent + ':user' + idx;
          const pathObj = { from: 'SA', to: 'AV', points: pts, duration: Math.max(0.02, prDur), stage: 0, group: gname };
          userAtrialPaths.push(pathObj); added.push(pathObj); idx++;
        }
      }
    } else if (comp.strokes && comp.strokes.length) {
      let sidx = 0;
      for (const s of comp.strokes) {
        if (!s || s.length === 0) continue;
        const pts = s.map(p => ({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h }));
        const gname = selectedComponent + ':userstroke' + sidx;
        const pathObj = { from: 'SA', to: 'AV', points: pts, duration: Math.max(0.02, prDur), stage: 0, group: gname };
        userAtrialPaths.push(pathObj); added.push(pathObj); sidx++;
      }
    }
    if (added.length === 0) return alert('No drawable shapes found in selected component');
    // merge into savedConvertedPaths so animation will use them
    if (!savedConvertedPaths || !Array.isArray(savedConvertedPaths)) savedConvertedPaths = [];
    for (const p of added) {
      p.baseDuration = p.baseDuration || p.duration || conductionSegmentDur;
      savedConvertedPaths.push(p);
    }
    try { localStorage.setItem('ccs.savedConvertedPaths', JSON.stringify(savedConvertedPaths)); } catch (e) {}
    useSavedConvertedPaths = true;
    // update conductionPaths for immediate effect
    conductionPaths = savedConvertedPaths.slice();
    alert('Added ' + added.length + ' atrial path(s) from ' + selectedComponent);
  };

  refreshCompList();

  document.body.appendChild(ccsContainer);

  // Animation controls: Auto-detect, Play/Pause, Speed
  const autoBtn = document.createElement('button'); autoBtn.textContent = 'Auto-detect nodes'; autoBtn.style.display = 'block'; autoBtn.style.marginTop = '6px';
  autoBtn.onclick = () => { autoDetectNodes(); };
  ccsContainer.appendChild(autoBtn);

  // Convert drawn shapes into conduction paths
  const convertBtn = document.createElement('button'); convertBtn.textContent = 'Shapes → Paths'; convertBtn.style.display = 'block'; convertBtn.style.marginTop = '6px';
  convertBtn.onclick = () => { convertShapesToPaths(); buildConductionPaths(); };
  ccsContainer.appendChild(convertBtn);

  // Mapping UI: allow explicit mapping of components to conduction roles
  const mapContainer = document.createElement('div'); mapContainer.style.marginTop = '6px';
  mapContainer.style.display = 'grid'; mapContainer.style.gridTemplateColumns = '1fr 1fr'; mapContainer.style.gap = '6px';
  const roles = ['SA','Atrial','AV','His','LBB','RBB','Purkinje'];
  const mappingSelects = {};
  for (const role of roles) {
    const lab = document.createElement('div'); lab.textContent = role; lab.style.fontSize = '11px'; lab.style.alignSelf = 'center';
    const sel = document.createElement('select'); sel.style.fontSize = '12px'; sel.style.width = '100%';
    sel.appendChild(new Option('(none)',''));
    mappingSelects[role] = sel;
    mapContainer.appendChild(lab);
    mapContainer.appendChild(sel);
  }
  ccsContainer.appendChild(mapContainer);

  const mapRow = document.createElement('div'); mapRow.style.display='flex'; mapRow.style.gap='6px'; mapRow.style.marginTop='6px';
  const applyMapBtn = document.createElement('button'); applyMapBtn.textContent = 'Apply Mapping';
  const clearMapBtn = document.createElement('button'); clearMapBtn.textContent = 'Clear Mapping';
  const autofillMapBtn = document.createElement('button'); autofillMapBtn.textContent = 'Auto-fill';
  mapRow.appendChild(applyMapBtn); mapRow.appendChild(autofillMapBtn); mapRow.appendChild(clearMapBtn);
  ccsContainer.appendChild(mapRow);

  // Per-component conduction speed sliders
  const speedPanel = document.createElement('div'); speedPanel.style.marginTop = '8px'; speedPanel.style.display = 'grid'; speedPanel.style.gridTemplateColumns = '1fr 1fr'; speedPanel.style.gap = '6px';
  const speedRoles = ['SA','Atrial','AV','His','LBB','RBB','Purkinje'];
  const speedInputs = {};
  for (const r of speedRoles) {
    const lab = document.createElement('div'); lab.textContent = r; lab.style.fontSize = '11px'; lab.style.alignSelf = 'center';
    const wrap = document.createElement('div'); wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.gap='6px';
    const input = document.createElement('input'); input.type = 'range'; input.min='0.25'; input.max='4.0'; input.step='0.01'; input.value = String(roleSpeeds[r] || 1.0); input.style.flex='1';
    const val = document.createElement('div'); val.textContent = (roleSpeeds[r]||1).toFixed(2); val.style.width='44px'; val.style.textAlign='right'; val.style.fontSize='11px';
    input.oninput = (e) => { const v = Number(e.target.value); roleSpeeds[r] = v; val.textContent = v.toFixed(2); applyRoleSpeedsToPaths(); };
    wrap.appendChild(input); wrap.appendChild(val);
    speedPanel.appendChild(lab); speedPanel.appendChild(wrap);
    speedInputs[r] = input;
  }
  ccsContainer.appendChild(speedPanel);

  // LBBB simulation toggle
  let lbbbCheckbox = document.createElement('input'); lbbbCheckbox.type = 'checkbox'; lbbbCheckbox.style.marginLeft = '6px';
  let lbbbLabel = document.createElement('label'); lbbbLabel.style.fontSize = '12px'; lbbbLabel.style.marginLeft = '4px'; lbbbLabel.textContent = 'Simulate LBBB';
  const lbbbRow = document.createElement('div'); lbbbRow.style.marginTop = '6px'; lbbbRow.style.display = 'flex'; lbbbRow.style.alignItems = 'center';
  lbbbRow.appendChild(lbbbCheckbox); lbbbRow.appendChild(lbbbLabel); ccsContainer.appendChild(lbbbRow);

  // store previous state for restoration
  let _prevRoleSpeeds = null;
  let _prevLeadParams = null;
  let _prevQrsWidth = null;
  function setLBBB(on) {
    if (on) {
      // snapshot
      _prevRoleSpeeds = Object.assign({}, roleSpeeds);
      _prevLeadParams = JSON.parse(JSON.stringify(leadParams));
      _prevQrsWidth = qrsWidth;
      // slow left bundle, speed up right bundle slightly, slow Purkinje to widen QRS
      roleSpeeds.LBB = 0.25; roleSpeeds.RBB = 1.5; roleSpeeds.Purkinje = 0.6; roleSpeeds.His = 0.9; roleSpeeds.Atrial = 1.0;
      // widen QRS
      qrsWidth = Math.max(qrsWidth, 2.0);
      // adjust lead morphology towards typical LBBB pattern
      // V1 index = 6; V5 = 10; V6 = 11; I=0; aVL=4
      try {
        leadParams[6].r = 0.2; leadParams[6].s = 2.5; // V1: deep S
        leadParams[10].r = 2.5; leadParams[10].s = 0.4; // V5: tall R
        leadParams[11].r = 2.6; leadParams[11].s = 0.4; // V6: tall R
        leadParams[0].r = Math.max(1.2, leadParams[0].r); // I: larger R
        leadParams[4].r = Math.max(1.6, leadParams[4].r); // aVL
      } catch (e) {}
      applyRoleSpeedsToPaths(); buildConductionPaths(); saveLeadParams();
    } else {
      if (_prevRoleSpeeds) {
        for (const k of Object.keys(_prevRoleSpeeds)) roleSpeeds[k] = _prevRoleSpeeds[k];
      }
      if (_prevLeadParams) {
        for (let i = 0; i < Math.min(leadParams.length, _prevLeadParams.length); i++) leadParams[i] = Object.assign({}, _prevLeadParams[i]);
      }
      if (typeof _prevQrsWidth === 'number') qrsWidth = _prevQrsWidth;
      applyRoleSpeedsToPaths(); buildConductionPaths(); saveLeadParams();
    }
  }
  lbbbCheckbox.onchange = (e) => { setLBBB(!!e.target.checked); };

  // overlay toggle
  const overlayRow = document.createElement('div'); overlayRow.style.display='flex'; overlayRow.style.gap='6px'; overlayRow.style.marginTop='6px';
  const overlayChk = document.createElement('input'); overlayChk.type = 'checkbox'; overlayChk.checked = conversionOverlay.show; overlayChk.style.marginRight = '6px';
  const overlayLab = document.createElement('label'); overlayLab.textContent = 'Show mapping overlay'; overlayLab.style.fontSize = '12px';
  overlayRow.appendChild(overlayChk); overlayRow.appendChild(overlayLab); ccsContainer.appendChild(overlayRow);
  overlayChk.onchange = (e) => { conversionOverlay.show = !!e.target.checked; };

  // helper to populate mapping select options from current components
  function refreshMappingOptions() {
    const names = Object.keys(ccsComponents || {});
    for (const r of Object.keys(mappingSelects)) {
      const sel = mappingSelects[r];
      // remember current
      const cur = sel.value;
      while (sel.options.length > 0) sel.remove(0);
      sel.appendChild(new Option('(none)',''));
      for (const n of names) sel.appendChild(new Option(n, n));
      if (names.indexOf(cur) >= 0) sel.value = cur; else sel.value = '';
    }
  }
  // wire apply/clear/autofill
  applyMapBtn.onclick = () => {
    for (const r of Object.keys(mappingSelects)) explicitMapping[r] = mappingSelects[r].value || null;
    convertShapesToPaths(); buildConductionPaths();
    alert('Mapping applied. Converted shapes to ' + conductionPaths.length + ' segments.');
  };
  clearMapBtn.onclick = () => { for (const k of Object.keys(explicitMapping)) explicitMapping[k] = null; for (const s of Object.values(mappingSelects)) s.value = ''; };
  autofillMapBtn.onclick = () => {
    // use name heuristics to pre-select likely components
    for (const name of Object.keys(ccsComponents)) {
      const ln = name.toLowerCase();
      if (!explicitMapping.SA && _nameMatches(ln, ['sa','sino'])) explicitMapping.SA = name;
      if (!explicitMapping.Atrial && _nameMatches(ln, ['atrial','atria'])) explicitMapping.Atrial = name;
      if (!explicitMapping.AV && _nameMatches(ln, ['av'])) explicitMapping.AV = name;
      if (!explicitMapping.His && _nameMatches(ln, ['his'])) explicitMapping.His = name;
      if (!explicitMapping.LBB && _nameMatches(ln, ['lbb','left'])) explicitMapping.LBB = name;
      if (!explicitMapping.RBB && _nameMatches(ln, ['rbb','right'])) explicitMapping.RBB = name;
      if (!explicitMapping.Purkinje && _nameMatches(ln, ['purk','purkinje'])) explicitMapping.Purkinje = name;
    }
    // reflect into selects
    for (const r of Object.keys(mappingSelects)) mappingSelects[r].value = explicitMapping[r] || '';
  };

  // make sure mapping options refresh when components list changes
  // call from refreshCompList below by referencing the function name (it exists in this scope)

  const playBtn = document.createElement('button'); playBtn.textContent = 'Play'; playBtn.style.display = 'inline-block'; playBtn.style.marginTop = '6px'; playBtn.style.marginRight = '6px';
  playBtn.onclick = () => { if (!animateConduction) { startConduction(); playBtn.textContent = 'Pause'; } else { stopConduction(); playBtn.textContent = 'Play'; } };
  ccsContainer.appendChild(playBtn);

  const speedRow = document.createElement('div'); speedRow.style.display = 'flex'; speedRow.style.alignItems = 'center'; speedRow.style.gap = '6px'; speedRow.style.marginTop = '6px';
  const speedLab = document.createElement('div'); speedLab.textContent = 'Speed'; speedLab.style.width = '36px'; speedRow.appendChild(speedLab);
  const speedInput = document.createElement('input'); speedInput.type = 'range'; speedInput.min = '0.2'; speedInput.max = '4.0'; speedInput.step = '0.05'; speedInput.value = String(conductionSpeed); speedInput.style.flex = '1';
  const speedVal = document.createElement('div'); speedVal.textContent = conductionSpeed.toFixed(2); speedVal.style.width = '40px'; speedVal.style.textAlign = 'right';
  speedInput.oninput = (e) => { conductionSpeed = Number(e.target.value); speedVal.textContent = conductionSpeed.toFixed(2); };
  speedRow.appendChild(speedInput); speedRow.appendChild(speedVal); ccsContainer.appendChild(speedRow);

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
  qdurInput.oninput = (e) => { qDur = Number(e.target.value); qdurVal.textContent = qDur.toFixed(3); };
  qdurInput.style.flex = '1';
  const qdurVal = document.createElement('div'); qdurVal.textContent = qDur.toFixed(3); qdurVal.style.width = '56px'; qdurVal.style.textAlign = 'right';
  qdurRow.appendChild(qdurInput); qdurRow.appendChild(qdurVal); globalPanel.appendChild(qdurRow);

  // R duration slider (seconds)
  const rdurRow = document.createElement('div');
  rdurRow.style.display = 'flex'; rdurRow.style.alignItems = 'center'; rdurRow.style.gap = '8px';
  const rdurInput = document.createElement('input');
  rdurInput.type = 'range'; rdurInput.min = '0.003'; rdurInput.max = '0.06'; rdurInput.step = '0.001'; rdurInput.value = String(rDur);
  rdurInput.oninput = (e) => { rDur = Number(e.target.value); rdurVal.textContent = rDur.toFixed(3); };
  rdurInput.style.flex = '1';
  const rdurVal = document.createElement('div'); rdurVal.textContent = rDur.toFixed(3); rdurVal.style.width = '56px'; rdurVal.style.textAlign = 'right';
  rdurRow.appendChild(rdurInput); rdurRow.appendChild(rdurVal); globalPanel.appendChild(rdurRow);

  // S duration slider (seconds)
  const sdurRow = document.createElement('div');
  sdurRow.style.display = 'flex'; sdurRow.style.alignItems = 'center'; sdurRow.style.gap = '8px';
  const sdurInput = document.createElement('input');
  sdurInput.type = 'range'; sdurInput.min = '0.005'; sdurInput.max = '0.12'; sdurInput.step = '0.001'; sdurInput.value = String(sDur);
  sdurInput.oninput = (e) => { sDur = Number(e.target.value); sdurVal.textContent = sDur.toFixed(3); };
  sdurInput.style.flex = '1';
  const sdurVal = document.createElement('div'); sdurVal.textContent = sDur.toFixed(3); sdurVal.style.width = '56px'; sdurVal.style.textAlign = 'right';
  sdurRow.appendChild(sdurInput); sdurRow.appendChild(sdurVal); globalPanel.appendChild(sdurRow);

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
  const prRow = document.createElement('div'); prRow.style.display = 'flex'; prRow.style.alignItems = 'center'; prRow.style.gap = '8px';
  const prInput = document.createElement('input'); prInput.type = 'range'; prInput.min = '0.06'; prInput.max = '0.30'; prInput.step = '0.005'; prInput.value = String(prDur);
  prInput.style.flex = '1'; const prVal = document.createElement('div'); prVal.textContent = prDur.toFixed(3); prVal.style.width = '56px'; prVal.style.textAlign = 'right';
  prInput.oninput = (e) => { prDur = Number(e.target.value); prVal.textContent = prDur.toFixed(3); };
  const prLab = document.createElement('div'); prLab.textContent = 'PR'; prLab.style.width = '18px'; prRow.appendChild(prLab); prRow.appendChild(prInput); prRow.appendChild(prVal); globalPanel.appendChild(prRow);

  const qtRow = document.createElement('div'); qtRow.style.display = 'flex'; qtRow.style.alignItems = 'center'; qtRow.style.gap = '8px';
  const qtInput = document.createElement('input'); qtInput.type = 'range'; qtInput.min = '200'; qtInput.max = '600'; qtInput.step = '1'; qtInput.value = String(qtIntervalMs);
  qtInput.style.flex = '1'; const qtVal = document.createElement('div'); qtVal.textContent = String(qtIntervalMs); qtVal.style.width = '56px'; qtVal.style.textAlign = 'right';
  qtInput.oninput = (e) => { qtIntervalMs = Number(e.target.value); qtVal.textContent = String(qtIntervalMs); };
  const qtLab = document.createElement('div'); qtLab.textContent = 'QTms'; qtLab.style.width = '18px'; qtRow.appendChild(qtLab); qtRow.appendChild(qtInput); qtRow.appendChild(qtVal); globalPanel.appendChild(qtRow);

  document.body.appendChild(globalPanel);

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

  // load saved converted mapping/paths if present
  try {
    const sm = localStorage.getItem('ccs.savedMappedRoles');
    const sp = localStorage.getItem('ccs.savedConvertedPaths');
    if (sm && sp) {
      savedMappedRoles = JSON.parse(sm);
      savedConvertedPaths = JSON.parse(sp);
      // set overlay mapped roles for visual feedback
      conversionOverlay.mappedRoles = Object.assign({}, savedMappedRoles || {});
      useSavedConvertedPaths = Array.isArray(savedConvertedPaths) && savedConvertedPaths.length > 0;
    }
  } catch (e) { /* ignore */ }

  // Attempt to auto-import a local `ccs_components.json` file and auto-map paths
  function tryAutoImportCcs() {
    // fetch relative to the sketch location
    fetch('ccs_components.json').then(r => {
      if (!r.ok) throw new Error('not-found');
      return r.json();
    }).then(parsed => {
      if (!parsed) return;
      // merge components if present
      if (parsed.components) {
        for (const k of Object.keys(parsed.components)) {
          ccsComponents[k] = parsed.components[k];
        }
      } else if (parsed.name && parsed.component) {
        ccsComponents[parsed.name] = parsed.component;
      }
      refreshCompList();
      refreshMappingOptions();

      // auto-fill explicitMapping based on name heuristics (same as autofillMapBtn)
      for (const name of Object.keys(ccsComponents)) {
        const ln = name.toLowerCase();
        if (!explicitMapping.SA && _nameMatches(ln, ['sa','sino'])) explicitMapping.SA = name;
        if (!explicitMapping.Atrial && _nameMatches(ln, ['atrial','atria','atrial conduction'])) explicitMapping.Atrial = name;
        if (!explicitMapping.AV && _nameMatches(ln, ['av','atrioventricular'])) explicitMapping.AV = name;
        if (!explicitMapping.His && _nameMatches(ln, ['his','bundle of his'])) explicitMapping.His = name;
        if (!explicitMapping.LBB && _nameMatches(ln, ['lbb','left','left bundle'])) explicitMapping.LBB = name;
        if (!explicitMapping.RBB && _nameMatches(ln, ['rbb','right','right bundle'])) explicitMapping.RBB = name;
        if (!explicitMapping.Purkinje && _nameMatches(ln, ['purk','purkinje'])) explicitMapping.Purkinje = name;
      }

      // Wait until the CCS image rect is available (it may be computed after first draw)
      let attempts = 0;
      const waitAndConvert = () => {
        attempts++;
        const crect = window._lastCcsRect;
        if (crect && crect.w > 8 && crect.h > 8) {
          // run conversion and build paths
          convertShapesToPaths();
          buildConductionPaths();
          // ensure overlay shows mapped roles
          conversionOverlay.mappedRoles = Object.assign({}, explicitMapping || {});
          // persist savedConvertedPaths was handled by convertShapesToPaths
          console.log('Auto-imported ccs_components.json and applied mapping.');
          return;
        }
        if (attempts < 80) {
          setTimeout(waitAndConvert, 50);
        } else {
          console.warn('Auto-import: CCS rect not available; conversion deferred.');
        }
      };
      waitAndConvert();
    }).catch(err => {
      // silent: file not present or fetch blocked by CORS when served via file://
      console.log('No local ccs_components.json auto-imported:', err && err.message);
    });
  }

  // try auto-import once on startup
  tryAutoImportCcs();

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
      // draw CCS image on left half, centered and scaled
      if (ccsImg) {
        push();
        imageMode(CORNER);
        const imgW = halfW;
        const imgH = height;
        const s = Math.min(imgW / ccsImg.width, imgH / ccsImg.height);
        const iw = ccsImg.width * s;
        const ih = ccsImg.height * s;
        const ix = Math.round((imgW - iw) / 2);
        const iy = Math.round((imgH - ih) / 2);
        image(ccsImg, ix, iy, iw, ih);
        // draw markers over CCS image if requested
        if (showCcsMarkers) {
          noSmooth();
          for (const key of Object.keys(ccsMarkers)) {
            const m = ccsMarkers[key];
            if (!m.visible) continue;
            const px = ix + m.x * iw;
            const py = iy + m.y * ih;
            // pulsing halo
            push();
            noFill(); strokeWeight(2);
            stroke(red(color(m.color)), green(color(m.color)), blue(color(m.color)), 180);
            ellipse(px, py, 18, 18);
            strokeWeight(1);
            stroke(255);
            ellipse(px, py, 8, 8);
            // label
            noStroke(); fill(0); textSize(12); textAlign(LEFT, CENTER);
            text(m.label, px + 10, py);
            pop();
          }
          smooth();
        }
        // draw user-defined components (strokes) on top of CCS image
        if (ccsComponents && Object.keys(ccsComponents).length > 0) {
          push(); noFill(); strokeWeight(2);
          for (const name of Object.keys(ccsComponents)) {
            const comp = ccsComponents[name];
            if (!comp.visible) continue;
            // strokes (legacy freehand)
            stroke(0, 120, 200, 200);
            for (const strokePts of (comp.strokes || [])) {
              beginShape();
              for (const pt of strokePts) vertex(ix + pt.x * iw, iy + pt.y * ih);
              endShape();
            }
            // shapes (spline / oval)
            if (comp.shapes && comp.shapes.length) {
              for (const shape of comp.shapes) {
                if (!shape) continue;
                const isSAComp = _nameMatches(name, ['sa','sino','sinoatrial']);
                const isAVComp = _nameMatches(name, ['av','atrioventricular']);
                const fillColor = isSAComp ? (ccsMarkers['SA'] && ccsMarkers['SA'].color ? ccsMarkers['SA'].color : comp.color) : (isAVComp ? (ccsMarkers['AV'] && ccsMarkers['AV'].color ? ccsMarkers['AV'].color : comp.color) : null);
                if (shape.type === 'spline') {
                  const pts = shape.points || [];
                    stroke(0, 140, 200, 220); strokeWeight(2);
                    if (fillColor) {
                      const c = color(fillColor);
                      fill(red(c), green(c), blue(c), 110);
                    } else noFill();
                  if (pts.length === 1) {
                    const p = pts[0]; ellipse(ix + p.x * iw, iy + p.y * ih, 4, 4);
                  } else if (pts.length === 2) {
                    const p0 = pts[0], p1 = pts[1]; line(ix + p0.x * iw, iy + p0.y * ih, ix + p1.x * iw, iy + p1.y * ih);
                  } else {
                    // draw curve; close/fill only for SA/AV components
                    const doClose = isSAComp || isAVComp;
                    beginShape();
                    const first = pts[0]; curveVertex(ix + first.x * iw, iy + first.y * ih);
                    for (const p of pts) curveVertex(ix + p.x * iw, iy + p.y * ih);
                    const last = pts[pts.length - 1]; curveVertex(ix + last.x * iw, iy + last.y * ih);
                    if (doClose) endShape(CLOSE); else endShape();
                  }
                } else if (shape.type === 'oval') {
                    stroke(0, 140, 200, 220); strokeWeight(2);
                    const x0 = shape.x0 * iw + ix; const y0 = shape.y0 * ih + iy;
                    const x1 = shape.x1 * iw + ix; const y1 = shape.y1 * ih + iy;
                    const cxP = (x0 + x1) / 2; const cyP = (y0 + y1) / 2;
                    const rw = Math.abs(x1 - x0); const rh = Math.abs(y1 - y0);
                    if (fillColor && (isSAComp || isAVComp)) { const c = color(fillColor); fill(red(c), green(c), blue(c), 110); } else noFill();
                    ellipse(cxP, cyP, Math.max(2, rw), Math.max(2, rh));
                }
              }
            }
          }
          // draw current in-progress freehand stroke
          if (shapeDrawMode === 'freehand' && currentStroke && currentStroke.length > 0) {
            stroke(255, 100, 50); beginShape(); for (const pt of currentStroke) vertex(ix + pt.x * iw, iy + pt.y * ih); endShape();
          }
          // draw in-progress shape (spline control points or oval)
          if (currentShape) {
            if (currentShape.type === 'spline') {
              const pts = currentShape.points || [];
              stroke(255, 100, 50); noFill(); strokeWeight(2);
              if (pts.length === 1) ellipse(ix + pts[0].x * iw, iy + pts[0].y * ih, 6, 6);
              else if (pts.length === 2) line(ix + pts[0].x * iw, iy + pts[0].y * ih, ix + pts[1].x * iw, iy + pts[1].y * ih);
              else {
                beginShape(); const first = pts[0]; curveVertex(ix + first.x * iw, iy + first.y * ih); for (const p of pts) curveVertex(ix + p.x * iw, iy + p.y * ih); const last = pts[pts.length-1]; curveVertex(ix + last.x * iw, iy + last.y * ih); endShape();
              }
              // draw control handles
              noStroke(); fill(255,140,80); for (const p of pts) ellipse(ix + p.x * iw, iy + p.y * ih, 6, 6);
            } else if (currentShape.type === 'oval') {
              stroke(255, 100, 50); noFill(); strokeWeight(2);
              const x0 = currentShape.x0 * iw + ix; const y0 = currentShape.y0 * ih + iy;
              const x1 = currentShape.x1 * iw + ix; const y1 = currentShape.y1 * ih + iy;
              const cxP = (x0 + x1) / 2; const cyP = (y0 + y1) / 2;
              const rw = Math.abs(x1 - x0); const rh = Math.abs(y1 - y0);
              ellipse(cxP, cyP, Math.max(2, rw), Math.max(2, rh));
            }
          }
          pop();
        }
        pop();
      }
      // animate conduction on top of CCS image if active
      if (animateConduction && showCcsMarkers) {
        const crect = window._lastCcsRect;
        if (crect) drawConductionAnimation(crect.x, crect.y, crect.w, crect.h);
      }

      // Render ECG into offscreen buffer and blit into right half
      if (ecgG) {
        ecgG.clear();
        // grid and waveform
        drawSingleLeadTo(ecgG, heartRate);
        // blit to right half
        image(ecgG, halfW, 0);
      }
      // store last CCS image rect for click mapping
      window._lastCcsRect = (ccsImg ? (() => {
        const imgW = halfW;
        const imgH = height;
        const s = Math.min(imgW / ccsImg.width, imgH / ccsImg.height);
        const iw = ccsImg.width * s;
        const ih = ccsImg.height * s;
        const ix = Math.round((imgW - iw) / 2);
        const iy = Math.round((imgH - ih) / 2);
        return { x: ix, y: iy, w: iw, h: ih };
      })() : null);
      // draw conversion overlay (diagnostic) on top of CCS image
      drawConversionOverlay(window._lastCcsRect);
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
  g.textSize(12); g.text('QRS ×' + qrsWidth.toFixed(2) + '  Q:' + qDur.toFixed(3) + ' R:' + rDur.toFixed(3) + ' S:' + sDur.toFixed(3), 18, 44);
  g.pop();

  g.pop();
}

// Start/stop conduction animation
function startConduction() {
  // ensure paths exist
  buildConductionPaths();
  if (!conductionPaths || conductionPaths.length === 0) return;
  animateConduction = true;
  conductionStart = millis() / 1000.0;
}
function stopConduction() { animateConduction = false; }

// Build simple conduction paths from current marker positions
function buildConductionPaths() {
  // If user converted shapes to paths and requested to use them, prefer savedConvertedPaths
  if (useSavedConvertedPaths && savedConvertedPaths && savedConvertedPaths.length) {
    conductionPaths = savedConvertedPaths;
    return;
  }
  conductionPaths = [];
  // require SA and AV at minimum
  if (!ccsMarkers['SA'] || !ccsMarkers['AV']) return;
  const keys = ['SA','AV','His','LBB','RBB','Purkinje'];
  // map normalized coords to displayed pixel coords using last CCS rect
  const rect = window._lastCcsRect;
  if (!rect) return;
  const toPx = (m) => ({ x: rect.x + m.x * rect.w, y: rect.y + m.y * rect.h });
  // SA -> AV
  conductionPaths.push({ from: 'SA', to: 'AV', points: [ toPx(ccsMarkers['SA']), toPx(ccsMarkers['AV']) ], duration: prDur });
  // AV -> His
  if (ccsMarkers['His'].visible) conductionPaths.push({ from: 'AV', to: 'His', points: [ toPx(ccsMarkers['AV']), toPx(ccsMarkers['His']) ], duration: 0.02 });
  // His -> LBB and RBB
  if (ccsMarkers['LBB'].visible) conductionPaths.push({ from: 'His', to: 'LBB', points: [ toPx(ccsMarkers['His']), toPx(ccsMarkers['LBB']) ], duration: conductionSegmentDur });
  if (ccsMarkers['RBB'].visible) conductionPaths.push({ from: 'His', to: 'RBB', points: [ toPx(ccsMarkers['His']), toPx(ccsMarkers['RBB']) ], duration: conductionSegmentDur });
  // Bundles -> Purkinje (if present)
  if (ccsMarkers['Purkinje'].visible) {
    if (ccsMarkers['LBB'].visible) conductionPaths.push({ from: 'LBB', to: 'Purkinje', points: [ toPx(ccsMarkers['LBB']), toPx(ccsMarkers['Purkinje']) ], duration: conductionSegmentDur });
    if (ccsMarkers['RBB'].visible) conductionPaths.push({ from: 'RBB', to: 'Purkinje', points: [ toPx(ccsMarkers['RBB']), toPx(ccsMarkers['Purkinje']) ], duration: conductionSegmentDur });
  }
}

// Draw conduction animation overlay; rect parameters used for coordinate mapping
function drawConductionAnimation(ix, iy, iw, ih) {
  if (!conductionPaths || conductionPaths.length === 0) return;
  const now = (millis() / 1000.0 - conductionStart) * conductionSpeed;
  push(); noFill();
  strokeWeight(3);
  // draw all polylines first
  for (let seg of conductionPaths) {
    const pts = seg.points || [];
    if (pts.length < 2) continue;
    stroke(200,200,200,120);
    for (let i = 0; i < pts.length - 1; i++) line(pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y);
  }

  // Group segments by stage (default stage 0 if not provided)
  const stageMap = new Map();
  for (const seg of conductionPaths) {
    const stage = (typeof seg.stage !== 'undefined') ? seg.stage : 0;
    if (!stageMap.has(stage)) stageMap.set(stage, []);
    stageMap.get(stage).push(seg);
  }
  // sort stage keys ascending
  const stages = Array.from(stageMap.keys()).sort((a,b) => a - b);
  // compute duration per stage as the max segment duration in that stage
  const stageDur = {};
  for (const s of stages) {
    let maxD = 0.01;
    for (const seg of stageMap.get(s)) maxD = Math.max(maxD, Math.max(0.01, seg.duration || conductionSegmentDur));
    stageDur[s] = maxD;
  }
  // compute stage start times cumulatively
  const stageStart = {};
  let accStart = 0;
  for (const s of stages) { stageStart[s] = accStart; accStart += stageDur[s]; }

  const totalTime = accStart;

  // For each segment, if current time falls within its stage window, draw a pulse along that segment
  for (const s of stages) {
    const segs = stageMap.get(s) || [];
    const sStart = stageStart[s];
    // Atrial stage: one dot per atrial group, each path should start at SA and end at AV
    if (s === 0) {
      // group segments by seg.group, prefer the segment with most points for each group
      const byGroup = new Map();
      for (const seg of segs) {
        const gk = seg.group || (seg.name || seg.from + '->' + seg.to);
        if (!byGroup.has(gk)) byGroup.set(gk, seg);
        else if ((seg.points || []).length > ((byGroup.get(gk).points||[]).length)) byGroup.set(gk, seg);
      }
      // compute SA/AV pixel positions (if markers exist)
      const rect = window._lastCcsRect || { x:0, y:0, w:0, h:0 };
      let saPx = null, avPx = null;
      if (ccsMarkers && ccsMarkers['SA'] && ccsMarkers['SA'].visible) saPx = { x: rect.x + ccsMarkers['SA'].x * rect.w, y: rect.y + ccsMarkers['SA'].y * rect.h };
      if (ccsMarkers && ccsMarkers['AV'] && ccsMarkers['AV'].visible) avPx = { x: rect.x + ccsMarkers['AV'].x * rect.w, y: rect.y + ccsMarkers['AV'].y * rect.h };
      // Draw composite path for each group as a faint guide (SA -> group's spline -> AV)
      push();
      stroke(255,200,80,120); strokeWeight(2); noFill();
      for (const [gk, seg] of byGroup.entries()) {
        const basePts = (seg.points || []).slice();
        const pts = [];
        if (saPx) pts.push(saPx);
        else if (basePts.length) pts.push(basePts[0]);
        for (const p of basePts) pts.push(p);
        if (avPx) pts.push(avPx);
        else if (basePts.length) pts.push(basePts[basePts.length-1]);
        if (pts.length < 2) continue;
        beginShape();
        for (const p of pts) vertex(p.x, p.y);
        endShape();
        // draw small endpoints for clarity
        noStroke(); fill(255,200,80,180); ellipse(pts[0].x, pts[0].y, 6, 6); ellipse(pts[pts.length-1].x, pts[pts.length-1].y, 6, 6);
      }
      pop();
      for (const [gk, seg] of byGroup.entries()) {
        const segDur = Math.max(0.01, seg.duration || conductionSegmentDur);
        const segStart = sStart;
        const segEnd = segStart + segDur;
        if (!(now >= segStart && now <= segEnd)) continue;
        // create composite path: SA -> seg.points... -> AV
        const basePts = (seg.points || []).slice();
        const pts = [];
        if (saPx) pts.push(saPx);
        else if (basePts.length) pts.push(basePts[0]);
        for (const p of basePts) pts.push(p);
        if (avPx) pts.push(avPx);
        else if (basePts.length) pts.push(basePts[basePts.length-1]);

        if (pts.length < 2) continue;
        const f = (now - segStart) / segDur;
        // compute lengths and interpolate
        let lens = [];
        let total = 0;
        for (let j = 0; j < pts.length - 1; j++) {
          const dx = pts[j+1].x - pts[j].x; const dy = pts[j+1].y - pts[j].y; const L = Math.sqrt(dx*dx + dy*dy);
          lens.push(L); total += L;
        }
        let target = f * total;
        let accum = 0;
        let sx = pts[0].x, sy = pts[0].y;
        for (let j = 0; j < lens.length; j++) {
          if (accum + lens[j] >= target) {
            const localF = (target - accum) / (lens[j] || 1);
            sx = lerp(pts[j].x, pts[j+1].x, localF);
            sy = lerp(pts[j].y, pts[j+1].y, localF);
            break;
          }
          accum += lens[j];
        }
        noStroke(); fill(255,160,30);
        ellipse(sx, sy, 12, 12);
        if (saPx) drawNodeHighlight('SA');
        if (avPx) drawNodeHighlight('AV');
      }
      continue;
    }
    // non-atrial stages: animate every segment in parallel as before
    for (const seg of segs) {
      const segDur = Math.max(0.01, seg.duration || conductionSegmentDur);
      const segStart = sStart; // all segments in stage start at stage start
      const segEnd = segStart + segDur;
      if (now >= segStart && now <= segEnd) {
        const f = (now - segStart) / segDur;
        const pts = seg.points || [];
        if (pts.length < 2) {
          // single point: draw at that point
          if (pts.length === 1) {
            noStroke(); fill(255,160,30);
            ellipse(pts[0].x, pts[0].y, 12, 12);
            if (typeof seg.from === 'string') drawNodeHighlight(seg.from);
            if (typeof seg.to === 'string') drawNodeHighlight(seg.to);
          }
          continue;
        }
        // compute lengths and target
        let lens = [];
        let total = 0;
        for (let j = 0; j < pts.length - 1; j++) {
          const dx = pts[j+1].x - pts[j].x; const dy = pts[j+1].y - pts[j].y; const L = Math.sqrt(dx*dx + dy*dy);
          lens.push(L); total += L;
        }
        let target = f * total;
        let accum = 0;
        let sx = pts[0].x, sy = pts[0].y;
        for (let j = 0; j < lens.length; j++) {
          if (accum + lens[j] >= target) {
            const localF = (target - accum) / (lens[j] || 1);
            sx = lerp(pts[j].x, pts[j+1].x, localF);
            sy = lerp(pts[j].y, pts[j+1].y, localF);
            break;
          }
          accum += lens[j];
        }
        noStroke(); fill(255,160,30);
        ellipse(sx, sy, 12, 12);
        if (typeof seg.from === 'string') drawNodeHighlight(seg.from);
        if (typeof seg.to === 'string') drawNodeHighlight(seg.to);
      }
    }
  }

  // wrap animation when finished
  if (now > totalTime + 0.02) {
    conductionStart = millis() / 1000.0;
  }
  pop();
}

// Try a simple brightness-based auto-detection of nodes
function autoDetectNodes() {
  if (!ccsImg) return;
  const rect = window._lastCcsRect;
  if (!rect) return;
  // draw the displayed CCS image into a temp graphics at the same displayed size
  const temp = createGraphics(Math.max(2, Math.round(rect.w)), Math.max(2, Math.round(rect.h)));
  temp.noSmooth(); temp.imageMode(CORNER);
  temp.background(255);
  temp.image(ccsImg, 0, 0, temp.width, temp.height);
  temp.loadPixels();
  // sample brightness on a coarse grid
  const grid = [];
  const gx = Math.max(30, Math.round(temp.width / 24));
  const gy = Math.max(30, Math.round(temp.height / 24));
  for (let y = 0; y < temp.height; y += gy) {
    for (let x = 0; x < temp.width; x += gx) {
      const idx = (y * temp.width + x) * 4;
      const r = temp.pixels[idx], g = temp.pixels[idx+1], b = temp.pixels[idx+2];
      const bright = (r + g + b) / 3;
      grid.push({ x, y, bright });
    }
  }
  // pick top N brightest spots
  grid.sort((a,b) => b.bright - a.bright);
  const picks = grid.slice(0, 8);
  // map picks to normalized coordinates relative to rect
  const pts = picks.map(p => ({ x: (p.x + 0.5) / temp.width, y: (p.y + 0.5) / temp.height }));
  // heuristic assignment by vertical ordering: top=SA, mid=AV, lower=His, lower-left=LBB, lower-right=RBB, bottom=Purkinje
  pts.sort((a,b) => a.y - b.y);
  if (pts.length >= 1) { ccsMarkers['SA'].x = pts[0].x; ccsMarkers['SA'].y = pts[0].y; ccsMarkers['SA'].visible = true; }
  if (pts.length >= 2) { ccsMarkers['AV'].x = pts[1].x; ccsMarkers['AV'].y = pts[1].y; ccsMarkers['AV'].visible = true; }
  if (pts.length >= 3) { ccsMarkers['His'].x = pts[2].x; ccsMarkers['His'].y = pts[2].y; ccsMarkers['His'].visible = true; }
  // for LBB/RBB, pick two lower points and pick left/right by x
  const lower = pts.slice(3).sort((a,b) => a.y - b.y).slice(0,3);
  if (lower.length >= 1) { ccsMarkers['Purkinje'].x = lower[lower.length-1].x; ccsMarkers['Purkinje'].y = lower[lower.length-1].y; ccsMarkers['Purkinje'].visible = true; }
  if (lower.length >= 2) {
    const lr = lower.slice(0,2).sort((a,b) => a.x - b.x);
    ccsMarkers['LBB'].x = lr[0].x; ccsMarkers['LBB'].y = lr[0].y; ccsMarkers['LBB'].visible = true;
    ccsMarkers['RBB'].x = lr[1].x; ccsMarkers['RBB'].y = lr[1].y; ccsMarkers['RBB'].visible = true;
  }
  // cleanup
  temp.remove();
  // show markers
  showCcsMarkers = true;
  // rebuild conduction paths
  buildConductionPaths();
}

function drawNodeHighlight(key) {
  const rect = window._lastCcsRect; if (!rect) return;
  const m = ccsMarkers[key]; if (!m || !m.visible) return;
  const px = rect.x + m.x * rect.w; const py = rect.y + m.y * rect.h;
  push(); noFill(); strokeWeight(2); stroke(255,200,60); ellipse(px, py, 20, 20); pop();
}

// Helper: simple name matchers for SA/AV
function _nameMatches(name, patterns) {
  const s = (name || '').toLowerCase();
  for (const p of patterns) if (s.indexOf(p) !== -1) return true;
  return false;
}

// Convert drawn shapes/components into conduction path segments
function convertShapesToPaths() {
  const rect = window._lastCcsRect;
  if (!rect) { alert('CCS image not positioned yet; resize or ensure image is visible.'); return; }
  // find components by explicit mapping first, then heuristics
  let saCompName = explicitMapping.SA || null;
  let avCompName = explicitMapping.AV || null;
  let hisCompName = explicitMapping.His || null;
  let lbbCompName = explicitMapping.LBB || null;
  let rbbCompName = explicitMapping.RBB || null;
  let purkCompName = explicitMapping.Purkinje || null;
  let atrialCompName = explicitMapping.Atrial || null;
  if (!saCompName || !avCompName || !hisCompName || !lbbCompName || !rbbCompName || !purkCompName || !atrialCompName) {
    for (const name of Object.keys(ccsComponents)) {
      const ln = name.toLowerCase();
      if (!saCompName && _nameMatches(ln, ['sa','sino','sinoatrial'])) saCompName = name;
      if (!avCompName && _nameMatches(ln, ['av','atrioventricular'])) avCompName = name;
      if (!hisCompName && _nameMatches(ln, ['his'])) hisCompName = name;
      if (!lbbCompName && _nameMatches(ln, ['lbb','left','left bundle'])) lbbCompName = name;
      if (!rbbCompName && _nameMatches(ln, ['rbb','right','right bundle'])) rbbCompName = name;
      if (!purkCompName && _nameMatches(ln, ['purk','purkinje'])) purkCompName = name;
      if (!atrialCompName && _nameMatches(ln, ['atria','atrial','atrial conduction','atrial-system','atrial conduction'])) atrialCompName = name;
    }
  }

  // helper to compute a representative pixel point from a component shape
  function compCenterPx(comp) {
    if (!comp) return null;
    // prefer shapes over strokes
    const shape = (comp.shapes && comp.shapes.length) ? comp.shapes[0] : null;
    if (shape) {
      if (shape.type === 'oval') {
        const cx = (shape.x0 + shape.x1) / 2;
        const cy = (shape.y0 + shape.y1) / 2;
        return { x: rect.x + cx * rect.w, y: rect.y + cy * rect.h };
      } else if (shape.type === 'spline') {
        const pts = shape.points || [];
        if (pts.length === 0) return null;
        let sx = 0, sy = 0;
        for (const p of pts) { sx += p.x; sy += p.y; }
        sx /= pts.length; sy /= pts.length;
        return { x: rect.x + sx * rect.w, y: rect.y + sy * rect.h };
      }
    }
    // fallback: if strokes exist, use centroid of first stroke
    if (comp.strokes && comp.strokes.length) {
      const s = comp.strokes[0]; if (s.length) {
        let sx = 0, sy = 0;
        for (const p of s) { sx += p.x; sy += p.y; }
        sx /= s.length; sy /= s.length;
        return { x: rect.x + sx * rect.w, y: rect.y + sy * rect.h };
      }
    }
    return null;
  }

  // helper: get pixel point from marker if available
  function markerPx(key) {
    const m = ccsMarkers[key]; if (!m || !m.visible) return null;
    return { x: rect.x + m.x * rect.w, y: rect.y + m.y * rect.h };
  }

  // resolve primary nodes (prefer component shapes, otherwise markers)
  const saPt = saCompName ? compCenterPx(ccsComponents[saCompName]) : markerPx('SA');
  const avPt = avCompName ? compCenterPx(ccsComponents[avCompName]) : markerPx('AV');
  const hisPt = hisCompName ? compCenterPx(ccsComponents[hisCompName]) : markerPx('His');
  const lbbPt = lbbCompName ? compCenterPx(ccsComponents[lbbCompName]) : markerPx('LBB');
  const rbbPt = rbbCompName ? compCenterPx(ccsComponents[rbbCompName]) : markerPx('RBB');
  const purkPt = purkCompName ? compCenterPx(ccsComponents[purkCompName]) : markerPx('Purkinje');

  // reset overlay info, populate mapped roles
  conversionOverlay.mappedRoles = {};
  conversionOverlay.atrialCandidates = [];
  if (saCompName) conversionOverlay.mappedRoles.SA = saCompName;
  if (avCompName) conversionOverlay.mappedRoles.AV = avCompName;
  if (hisCompName) conversionOverlay.mappedRoles.His = hisCompName;
  if (lbbCompName) conversionOverlay.mappedRoles.LBB = lbbCompName;
  if (rbbCompName) conversionOverlay.mappedRoles.RBB = rbbCompName;
  if (purkCompName) conversionOverlay.mappedRoles.Purkinje = purkCompName;
  if (atrialCompName) conversionOverlay.mappedRoles.Atrial = atrialCompName;

  // build atrial conduction point sequence
  let atrialPts = [];
  // atrialGroups: if present, each group is treated as an independent atrial line
  // (one group per spline shape or per stroke), so each group will animate as a whole in parallel.
  if (typeof atrialGroups === 'undefined') atrialGroups = null;
  if (atrialCompName) {
    const comp = ccsComponents[atrialCompName];
    atrialGroups = [];
    // prefer spline shapes: create one group per spline shape
    if (comp.shapes && comp.shapes.length) {
      let idx = 0;
      for (const sh of comp.shapes) {
        if (!sh) continue;
        if (sh.type === 'spline' && sh.points && sh.points.length) {
          const pts = [];
          for (const p of sh.points) pts.push({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
          if (pts.length) atrialGroups.push({ name: atrialCompName + ':' + idx, points: pts });
          idx++;
        } else if (sh.type === 'oval') {
          const cx = (sh.x0 + sh.x1) / 2; const cy = (sh.y0 + sh.y1) / 2;
          atrialGroups.push({ name: atrialCompName + ':oval' + idx, points: [{ x: rect.x + cx * rect.w, y: rect.y + cy * rect.h }] });
          idx++;
        }
      }
    }
    // fallback to strokes: treat each stroke as a separate group
    if ((!atrialGroups || atrialGroups.length === 0) && comp.strokes && comp.strokes.length) {
      let sidx = 0;
      for (const s of comp.strokes) {
        if (!s || s.length === 0) continue;
        const pts = [];
        for (const p of s) pts.push({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
        if (pts.length) atrialGroups.push({ name: atrialCompName + ':stroke' + sidx, points: pts });
        sidx++;
      }
    }
    // if still empty, leave atrialPts empty (will fall back later)
    if (!atrialGroups || atrialGroups.length === 0) atrialGroups = null;
  }

  // if no atrial component points, create a simple mid-point path between SA and AV
  // We'll support two modes:
  // - atrialPts filled from an explicit Atrial component (single concatenated path)
  // - candidates: multiple distinct spline components inferred between SA and AV -> treat each as a separate atrial line
  if (atrialPts.length === 0 && saPt && avPt) {
    // try to infer atrial spline(s) from any unassigned component shapes roughly between SA and AV
    const saToAv = { x: avPt.x - saPt.x, y: avPt.y - saPt.y };
    const segLen = Math.sqrt(saToAv.x*saToAv.x + saToAv.y*saToAv.y) || 1;
    // normalize direction
    const dir = { x: saToAv.x / segLen, y: saToAv.y / segLen };
    const perpThresh = Math.max(10, segLen * 0.35); // allow perpendicular distance
    const candidates = [];
    for (const name of Object.keys(ccsComponents)) {
      // skip node-like components
      if (_nameMatches(name, ['sa','sino','av','atrioventricular','his','lbb','rbb','purk','purkinje'])) continue;
      const comp = ccsComponents[name];
      if (!comp || !comp.shapes) continue;
      for (const sh of comp.shapes) {
        if (!sh || sh.type !== 'spline' || !sh.points || sh.points.length === 0) continue;
        // compute centroid in pixel coords
        let sx=0, sy=0;
        for (const p of sh.points) { sx += p.x; sy += p.y; }
        sx /= sh.points.length; sy /= sh.points.length;
        const cx = rect.x + sx * rect.w; const cy = rect.y + sy * rect.h;
        // vector from SA to centroid
        const v = { x: cx - saPt.x, y: cy - saPt.y };
        const proj = v.x * dir.x + v.y * dir.y; // projection along SA->AV
        const perpX = v.x - proj * dir.x; const perpY = v.y - proj * dir.y;
        const perpDist = Math.sqrt(perpX*perpX + perpY*perpY);
        if (proj >= -segLen*0.2 && proj <= segLen*1.2 && perpDist <= perpThresh) {
          candidates.push({ name, sh, proj });
        }
      }
    }
    if (candidates.length > 0) {
      // sort by projection and keep each candidate as its own group (distinct atrial line)
      candidates.sort((a,b) => a.proj - b.proj);
      atrialGroups = [];
      for (const c of candidates) {
        conversionOverlay.atrialCandidates.push(c.name);
        const pts = [];
        for (const p of c.sh.points) pts.push({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
        if (pts.length) atrialGroups.push({ name: c.name, points: pts });
      }
    } else {
      // fallback: single midpoint
      const mid = { x: (saPt.x + avPt.x) / 2, y: (saPt.y + avPt.y) / 2 };
      atrialPts = [ mid ];
    }
  }

  // Now assemble conductionPaths in logical order
  const paths = [];
  // SA -> (atrial points...) -> AV
  if (saPt) {
    // If we have distinct atrial groups (multiple spline lines), create one path per group
    if (atrialGroups && atrialGroups.length) {
      // compute reference length (SA->AV) for duration scaling
      const refLen = Math.max(1, Math.sqrt(Math.pow(avPt.x - saPt.x,2) + Math.pow(avPt.y - saPt.y,2)));
      for (const g of atrialGroups) {
        // use the spline points themselves so each spline animates from its own start->end
        const pts = (g.points && g.points.length) ? g.points.slice() : [];
        if (pts.length < 2) continue;
        // compute geometric length of this spline
        let L = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const dx = pts[i+1].x - pts[i].x; const dy = pts[i+1].y - pts[i].y; L += Math.sqrt(dx*dx + dy*dy);
        }
        // scale duration relative to refLen; clamp to reasonable bounds
        let dur = prDur * (L / refLen);
        dur = Math.max(0.02, Math.min(dur, prDur * 3));
        paths.push({ from: 'SA', to: 'AV', points: pts, duration: dur, stage: 0, group: g.name || ('atrial' + Math.random().toString(36).slice(2,6)) });
      }
      // Also keep the direct SA->AV path (preserve existing direct conduction)
      if (saPt && avPt) {
        paths.push({ from: 'SA', to: 'AV', points: [ saPt, avPt ], duration: prDur, stage: 0, group: 'SA->AV.direct' });
      }
    } else if (atrialPts.length) {
      // single concatenated atrial path -> create sequential segments but treat entire SA->AV as stage 0
      const segDur = Math.max(0.01, prDur / (atrialPts.length + 1));
      let from = saPt;
      for (let i = 0; i < atrialPts.length; i++) {
        const to = atrialPts[i]; paths.push({ from: 'SA', to: 'atrial', points: [ from, to ], duration: segDur, stage: 0 }); from = to;
      }
      if (avPt) paths.push({ from: 'atrial', to: 'AV', points: [ from, avPt ], duration: Math.max(0.01, prDur / 2), stage: 0 });
    } else if (avPt) {
      paths.push({ from: 'SA', to: 'AV', points: [ saPt, avPt ], duration: prDur, stage: 0 });
    }
  }

  // AV -> His
  if (avPt && hisPt) {
    // try to follow AV/His shapes if provided
    let avShapePts = [];
    if (avCompName) {
      const comp = ccsComponents[avCompName];
      if (comp && comp.shapes && comp.shapes.length) {
        const sh = comp.shapes[0];
        if (sh.type === 'spline' && sh.points && sh.points.length) avShapePts = sh.points.map(p => ({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h }));
      }
    }
    const pts = avShapePts.length ? [ avPt ].concat(avShapePts).concat([ hisPt ]) : [ avPt, hisPt ];
    paths.push({ from: 'AV', to: 'His', points: pts, duration: 0.02, stage: 1 });
  }
  // His -> LBB/RBB
  if (hisPt && lbbPt) {
    const pts = [ hisPt ];
    if (lbbCompName) {
      const comp = ccsComponents[lbbCompName];
      if (comp && comp.shapes && comp.shapes.length) {
        const sh = comp.shapes[0]; if (sh.type === 'spline' && sh.points && sh.points.length) for (const p of sh.points) pts.push({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
      }
    }
    pts.push(lbbPt);
    paths.push({ from: 'His', to: 'LBB', points: pts, duration: conductionSegmentDur, stage: 2 });
  }
  if (hisPt && rbbPt) {
    const pts = [ hisPt ];
    if (rbbCompName) {
      const comp = ccsComponents[rbbCompName];
      if (comp && comp.shapes && comp.shapes.length) {
        const sh = comp.shapes[0]; if (sh.type === 'spline' && sh.points && sh.points.length) for (const p of sh.points) pts.push({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
      }
    }
    pts.push(rbbPt);
    paths.push({ from: 'His', to: 'RBB', points: pts, duration: conductionSegmentDur, stage: 2 });
  }
  // Bundles -> Purkinje
  if (lbbPt && purkPt) {
    const pts = [ lbbPt ];
    if (lbbCompName) {
      const comp = ccsComponents[lbbCompName];
      if (comp && comp.shapes && comp.shapes.length) {
        const sh = comp.shapes[0]; if (sh.type === 'spline' && sh.points && sh.points.length) for (const p of sh.points) pts.push({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
      }
    }
    pts.push(purkPt);
    paths.push({ from: 'LBB', to: 'Purkinje', points: pts, duration: conductionSegmentDur, stage: 3 });
  }
  if (rbbPt && purkPt) {
    const pts = [ rbbPt ];
    if (rbbCompName) {
      const comp = ccsComponents[rbbCompName];
      if (comp && comp.shapes && comp.shapes.length) {
        const sh = comp.shapes[0]; if (sh.type === 'spline' && sh.points && sh.points.length) for (const p of sh.points) pts.push({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
      }
    }
    pts.push(purkPt);
    paths.push({ from: 'RBB', to: 'Purkinje', points: pts, duration: conductionSegmentDur, stage: 3 });
  }

  conductionPaths = paths;
  // persist and mark that we should use these converted paths for animation
  savedConvertedPaths = paths;
  savedMappedRoles = Object.assign({}, conversionOverlay.mappedRoles || {});
  useSavedConvertedPaths = true;
  try {
    localStorage.setItem('ccs.savedMappedRoles', JSON.stringify(savedMappedRoles));
    localStorage.setItem('ccs.savedConvertedPaths', JSON.stringify(savedConvertedPaths));
  } catch (e) {
    // ignore storage errors
  }
  // annotate baseDuration for each segment so we can scale later
  for (const seg of savedConvertedPaths) {
    if (!seg) continue;
    seg.baseDuration = seg.baseDuration || seg.duration || conductionSegmentDur;
  }
  // ensure node markers visible if we derived positions from shapes
  if (saCompName) { if (ccsMarkers['SA']) { ccsMarkers['SA'].visible = true; const c = compCenterPx(ccsComponents[saCompName]); if (c) { ccsMarkers['SA'].x = (c.x - rect.x) / rect.w; ccsMarkers['SA'].y = (c.y - rect.y) / rect.h; } } }
  if (avCompName) { if (ccsMarkers['AV']) { ccsMarkers['AV'].visible = true; const c = compCenterPx(ccsComponents[avCompName]); if (c) { ccsMarkers['AV'].x = (c.x - rect.x) / rect.w; ccsMarkers['AV'].y = (c.y - rect.y) / rect.h; } } }

  // rebuild displayed paths
  buildConductionPaths();
  alert('Converted shapes to ' + conductionPaths.length + ' conduction segments.');
}

// Apply current roleSpeeds to the savedConvertedPaths (without re-running conversion)
function applyRoleSpeedsToPaths() {
  if (!savedConvertedPaths || !Array.isArray(savedConvertedPaths)) return;
  // update durations in place based on baseDuration and roleSpeeds
  for (const seg of savedConvertedPaths) {
    if (!seg) continue;
    const base = seg.baseDuration || seg.duration || conductionSegmentDur;
    let roleKey = null;
    if (seg.to && roleSpeeds.hasOwnProperty(seg.to)) roleKey = seg.to;
    else if (seg.from && roleSpeeds.hasOwnProperty(seg.from)) roleKey = seg.from;
    // default use Atrial for segments with 'atrial' in from/to
    if (!roleKey && (String(seg.from || '').toLowerCase().indexOf('atrial') !== -1 || String(seg.to || '').toLowerCase().indexOf('atrial') !== -1)) roleKey = 'Atrial';
    if (roleKey && roleSpeeds[roleKey]) seg.duration = Math.max(0.01, base / roleSpeeds[roleKey]);
    else seg.duration = base;
  }
  // ensure conductionPaths use these updated saved paths
  if (useSavedConvertedPaths) {
    conductionPaths = savedConvertedPaths;
  }
  // no need to alert; just rebuild visuals
  buildConductionPaths();
}

// Draw a debugging overlay showing mapped components and atrial candidates
function drawConversionOverlay(ccsRect) {
  if (!conversionOverlay.show) return;
  if (!ccsRect) return;
  push();
  noFill(); strokeWeight(2);
  // draw mapped roles with labels
  const roleColors = { SA: '#ff3333', AV: '#ff9933', His: '#33aaff', LBB: '#33cc33', RBB: '#8877ff', Purkinje: '#aa33aa', Atrial: '#ffaa00' };
  for (const role of Object.keys(conversionOverlay.mappedRoles || {})) {
    const name = conversionOverlay.mappedRoles[role];
    if (!name) continue;
    const comp = ccsComponents[name];
    if (!comp) continue;
    // compute bounding box of shapes/strokes in pixel coords
    let minx=Infinity, miny=Infinity, maxx=-Infinity, maxy=-Infinity, cx=0, cy=0, count=0;
    if (comp.shapes) {
      for (const sh of comp.shapes) {
        if (sh.type === 'oval') {
          const x0 = ccsRect.x + sh.x0 * ccsRect.w, y0 = ccsRect.y + sh.y0 * ccsRect.h; const x1 = ccsRect.x + sh.x1 * ccsRect.w, y1 = ccsRect.y + sh.y1 * ccsRect.h;
          minx = Math.min(minx, Math.min(x0,x1)); miny = Math.min(miny, Math.min(y0,y1)); maxx = Math.max(maxx, Math.max(x0,x1)); maxy = Math.max(maxy, Math.max(y0,y1));
          cx += (x0+x1)/2; cy += (y0+y1)/2; count++;
        } else if (sh.type === 'spline' && sh.points) {
          for (const p of sh.points) {
            const px = ccsRect.x + p.x * ccsRect.w, py = ccsRect.y + p.y * ccsRect.h;
            minx = Math.min(minx, px); miny = Math.min(miny, py); maxx = Math.max(maxx, px); maxy = Math.max(maxy, py);
            cx += px; cy += py; count++;
          }
        }
      }
    }
    if (comp.strokes) {
      for (const s of comp.strokes) for (const p of s) {
        const px = ccsRect.x + p.x * ccsRect.w, py = ccsRect.y + p.y * ccsRect.h;
        minx = Math.min(minx, px); miny = Math.min(miny, py); maxx = Math.max(maxx, px); maxy = Math.max(maxy, py);
        cx += px; cy += py; count++;
      }
    }
    if (count === 0) continue;
    cx /= count; cy /= count;
    const col = roleColors[role] || '#00aaee';
    stroke(col); fill(red(color(col)), green(color(col)), blue(color(col)), 24);
    // highlight SA/AV with filled rect/ellipse
    if (role === 'SA' || role === 'AV') {
      // draw an ellipse around centroid
      noStroke(); fill(red(color(col)), green(color(col)), blue(color(col)), 64); ellipse(cx, cy, Math.max(16, (maxx-minx)*1.4), Math.max(12, (maxy-miny)*1.4));
      stroke(255); noFill(); textSize(12); fill(0); textAlign(LEFT, CENTER); text(role + ': ' + name, cx + 8, cy);
    } else {
      stroke(col); noFill(); // draw bounding rect using p5.rect
      rect(minx - 3, miny - 3, Math.max(4, maxx - minx + 6), Math.max(4, maxy - miny + 6));
      noStroke(); fill(col); textSize(11); textAlign(LEFT, TOP); text(role + ': ' + name, minx + 4, miny + 4);
    }
  }

  // draw atrial candidates list
  if (conversionOverlay.atrialCandidates && conversionOverlay.atrialCandidates.length) {
    let y = ccsRect.y + 8;
    for (const nm of conversionOverlay.atrialCandidates) {
      const comp = ccsComponents[nm]; if (!comp) continue;
      // centroid
      let sx=0, sy=0, cnt=0;
      if (comp.shapes) for (const sh of comp.shapes) if (sh.type === 'spline' && sh.points) for (const p of sh.points) { sx += p.x; sy += p.y; cnt++; }
      if (cnt === 0 && comp.strokes && comp.strokes.length) for (const s of comp.strokes) for (const p of s) { sx += p.x; sy += p.y; cnt++; }
      if (cnt === 0) continue;
      const cx = ccsRect.x + (sx/cnt) * ccsRect.w; const cy = ccsRect.y + (sy/cnt) * ccsRect.h;
      noFill(); stroke('#ffaa00'); strokeWeight(2); ellipse(cx, cy, 14, 14);
      noStroke(); fill('#aa6600'); textSize(11); textAlign(LEFT, CENTER); text('candidate: ' + nm, cx + 10, cy);
      y += 16;
    }
  }
  pop();
}

// p5 mousePressed handler: place markers if in placing mode and click inside CCS image
function mousePressed() {
  if (!singleLeadView) return; // only relevant in single-lead mode
  const rect = window._lastCcsRect;
  if (!rect) return;
  // If we're in drawing mode and have a selected component, start drawing depending on shape mode
  if (drawingMode && selectedComponent && mouseX >= rect.x && mouseX <= rect.x + rect.w && mouseY >= rect.y && mouseY <= rect.y + rect.h) {
    const nx = (mouseX - rect.x) / rect.w;
    const ny = (mouseY - rect.y) / rect.h;
    if (shapeDrawMode === 'freehand') {
      currentStroke = [];
      currentStroke.push({ x: nx, y: ny });
      return;
    } else if (shapeDrawMode === 'spline') {
      if (!currentShape || currentShape.type !== 'spline') currentShape = { type: 'spline', points: [] };
      currentShape.points.push({ x: nx, y: ny });
      return;
    } else if (shapeDrawMode === 'oval') {
      // start an oval bounding box; will be updated on drag and finalized on release
      currentShape = { type: 'oval', x0: nx, y0: ny, x1: nx, y1: ny };
      return;
    }
  }
  // Otherwise, marker placement mode
  if (!placingMarker) return;
  // mouseX/mouseY are global canvas coords; ensure click was inside CCS image area
  if (mouseX >= rect.x && mouseX <= rect.x + rect.w && mouseY >= rect.y && mouseY <= rect.y + rect.h) {
    // normalized coords
    const nx = (mouseX - rect.x) / rect.w;
    const ny = (mouseY - rect.y) / rect.h;
    const key = placingMarker;
    if (ccsMarkers[key]) {
      ccsMarkers[key].x = nx; ccsMarkers[key].y = ny; ccsMarkers[key].visible = true;
    }
    placingMarker = null;
    // update place button text if present
    const btns = document.getElementsByTagName('button');
    for (const b of btns) if (b.textContent === 'Click image to place') b.textContent = 'Place selected';
  }
}

function mouseDragged() {
  const rect = window._lastCcsRect; if (!rect) return;
  if (!drawingMode || !selectedComponent) return;
  // freehand: accumulate points while dragging
  if (shapeDrawMode === 'freehand') {
    if (!currentStroke) return;
    if (mouseX < rect.x || mouseX > rect.x + rect.w || mouseY < rect.y || mouseY > rect.y + rect.h) return;
    currentStroke.push({ x: (mouseX - rect.x) / rect.w, y: (mouseY - rect.y) / rect.h });
    return;
  }
  // oval: update second corner while dragging
  if (currentShape && currentShape.type === 'oval') {
    const nx = constrain((mouseX - rect.x) / rect.w, 0, 1);
    const ny = constrain((mouseY - rect.y) / rect.h, 0, 1);
    currentShape.x1 = nx; currentShape.y1 = ny;
  }
}

function mouseReleased() {
  // finalize freehand stroke
  if (currentStroke && selectedComponent) {
    const strokes = ccsComponents[selectedComponent].strokes || [];
    strokes.push(currentStroke);
    ccsComponents[selectedComponent].strokes = strokes;
    currentStroke = null;
  }
  // finalize oval shape on mouse release
  if (currentShape && currentShape.type === 'oval' && selectedComponent) {
    const comp = ccsComponents[selectedComponent] || (ccsComponents[selectedComponent] = { color:'#00aaee', visible:true, strokes:[], shapes:[] });
    if (!comp.shapes) comp.shapes = [];
    // ensure normalized coords are clamped
    currentShape.x0 = constrain(currentShape.x0, 0, 1); currentShape.y0 = constrain(currentShape.y0, 0, 1);
    currentShape.x1 = constrain(currentShape.x1, 0, 1); currentShape.y1 = constrain(currentShape.y1, 0, 1);
    comp.shapes.push(currentShape);
    currentShape = null;
  }
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
