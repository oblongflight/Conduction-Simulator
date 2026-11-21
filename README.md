# Conduction Lab

A browser-based teaching simulator: electrical impulses animate over `CCS.png`
alongside a synchronized, continuous V1 rhythm strip. No build step or external
runtime dependencies are required.

## Run

Serve this directory over HTTP, for example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000>. Opening the HTML directly as a file is not supported
because the anatomy geometry is loaded from `sketch-data.json`.

## Teaching controls

- Choose normal sinus rhythm, wandering pacemaker, atrial premature beats
  (APB/PAC), AVNRT, AVRT, WPW, focal atrial tachycardia, multifocal atrial
  tachycardia (MAT), atrial flutter, atrial fibrillation, junctional rhythm,
  or junctional tachycardia.
- Independently choose normal AV conduction, first-degree block, Mobitz I,
  Mobitz II, or third-degree block, and normal bundles, RBBB, or LBBB.
  AVNRT and AVRT temporarily use normal AV conduction and disable the AV-block
  controls; the previous AV selection returns when another rhythm is selected.
- A circled hourglass marks AV nodal transit during first-degree block and
  progressively delayed conducted beats of Mobitz I. Circled X markers remain
  reserved for failed conduction, including blocked bundle branches. An
  intermittent AV-node X briefly marks the failed impulse and clears for
  conducted AV transit; complete AV block retains a persistent X.
- Scenario-specific controls set PR prolongation, Wenckebach progression,
  conducted beats before a dropped impulse, junctional escape rate, or the
  rhythm-specific rate. Selecting a rhythm sets its representative starting rate.
- Pause/resume playback or change its speed beside the rhythm rate in the top bar.
- The strip is centered on the current instant: 1.5 seconds of history to the
  left and 1.5 seconds of upcoming activity to the right. The ECG column matches
  the anatomy panel's height on wide screens, with waveform amplitude scaled
  to the taller canvas. On smaller screens the panels stack. The yellow center
  playhead is the current instant on the anatomy. A separate deterministic
  instance of the same event model previews the waveform without advancing the
  anatomy clock. `ecg-strip.js` renders static five-second tiles at fixed sample
  positions. Native browser transforms scroll those tiles on the same playback
  clock; JavaScript does not repaint them each frame.
  The grid, calibration, playhead, and time labels are separate static layers.
  Upcoming tiles are prepared beyond the visible edge during browser idle time.
  A tile stays mounted with its original animation until it has scrolled out of
  view. Each sample visits only beats close enough to contribute, including
  overlapping waves and segment offsets.
  Resizing or editing a scenario/morphology rebuilds the cache.
  Playback speed changes neither physiological
  intervals nor the displayed rates. Scenario or morphology edits restart the
  recording; previous beats are not rewritten during playback. Pausing or hiding
  the tab freezes both the simulation and its animations; resuming preserves
  their phase. Readouts refresh at most ten times per second, independently of
  the animation's refresh rate.

Dense trains of up to 24 dots, spaced four anatomy units apart, show flow through
the conduction pathways. Native motion-path animations interpolate their
positions continuously without per-frame SVG geometry queries or rounded
position steps. The dot and ECG animations share the simulation's playback
clock, including when paused or changing speed. Chamber
overlays are red: ventricular opacity rises smoothly from transparent at
activation onset to 50% at QRS end, then fades smoothly to transparent at T end.
The affected ventricle begins its rise later with a bundle block. In organized
atrial rhythms, opacity reaches 50% at P end, followed by a schematic 200 ms
recovery fade, independently of AV conduction. A Fib uses a fluctuating atrial
opacity that reaches 50%.
There are no yellow chamber fills or nodal halos.

The shared event model in `conduction.js` drives the anatomy and ECG.
Wandering pacemaker alternates among the SA node and two atrial sites. Focal
atrial tachycardia uses a left atrial focus; MAT alternates irregularly among
three atrial foci. Circles identify the available sites, and an expanding pulse
marks the focus during its P wave; the map readout names the current focus.
For an ectopic beat, dots travel from the focus to its nearest saved atrial
pathway and along it toward the AV node, arriving at the model's 80 ms AV-arrival
time. The left atrial route follows the upper atrial pathway to its junction
with the pathway descending to the AV node. These paths are schematic, not a
model of conduction velocity. Sinus-origin pathway animations are not triggered
by ectopic beats. Each focus has a consistent schematic V1 P-wave shape; these
shapes illustrate differences between foci, but V1 alone cannot definitively
localize an atrial focus.
During atrial flutter, a schematic elliptical reentry circuit appears at the
marked location on the anatomy. Its circulating dots complete one lap per
atrial beat and share the playback clock. The circuit definitions in `script.js`
can be extended for other rhythms; these loops illustrate rather than simulate
reentrant tissue. An independent, schematic 60 bpm sinus clock activates the
SA node and atrial pathway dots; flutter activations instead drive the atrial
chamber overlay, ECG and AV response at the selected flutter rate. Sinus
firings do not add separate atrial or ventricular beats to this simplified
model. Typical atrial flutter is usually described as a right atrial
circuit around the tricuspid valve, not the pulmonary valve.
AVNRT shows a small loop below the AV node with a zigzag nodal limb.
AVRT shows an orthodromic loop through the AV node, left ventricle and a
schematic left-sided accessory pathway, highlighted with a dashed green line.
Both rotate once per tachycardia cycle and use simplified tachycardia timing
with retrograde atrial activation; the
diagrams do not model conduction velocity or refractory behavior along each
limb. AVRT is distinct from the separate WPW pre-excitation scenario.
In rhythms driven by an antegrade atrial clock, blocked atrial impulses generate
P waves but no associated ventricular activation, QRS, or T wave. Third-degree
block has independent atrial and junctional/His escape clocks, except for the
WPW and junctional rhythm simplifications described below. A blocked bundle does not conduct
antegradely: the affected ventricle activates later through schematic
transseptal myocardium.

## Waveform authoring and saved data

Open **Waveform authoring** to duplicate an automatic V1 template and edit its
components, QT, and PR/ST offsets. RBBB includes an editable terminal R-prime.
PR timing belongs to the AV scenario, so the legacy P-to-Q gap is not used.
The component durations determine QRS and QT; changing a segment offset does
not change conduction timing.

Automatic morphology follows the selected bundle block. A custom morphology
replaces the component waveform but not rhythm-level signatures such as WPW
pre-excitation, focus-specific P-wave shapes, or the flutter/fibrillation
baseline, and it does not change conduction rules. Focus-specific P waves use
the magnitude of the custom P amplitude; setting it to zero hides them. A
warning identifies the limitations of custom morphology.

**Save waveform** saves the custom library in this browser under the existing
`ecg-lecture-lab.waveforms.v1` key. Existing five-component Lecture Lab libraries
can be loaded/imported; the legacy `sharpness` field is migrated to `topRadius`.
Export/import uses JSON and validates wave order, finite values, and supported
ranges. Import replaces the custom library after confirmation. Empty libraries
are valid: the built-in automatic templates are always available. Unsaved edits
are session-only until saved or exported.

The historical `sketch-data.json` and `ccs_components.json` are not modified.
Only the normalized anatomy geometry from the former is reused; its old
presets, animation timers, and browser-storage values are not restored.
The previous p5 runtime files and snapshots remain as historical assets but are
not loaded by the current page.

## Scope and limitations

This is an educational illustration, not a validated diagnostic ECG or a
biophysical tissue simulation. Activation is not contraction. V1 templates are
illustrative, and complete-block location and escape focus are simplified.
Wenckebach uses a configurable initial PR increment, halving subsequent increments
to illustrate shortening conducted R-R intervals, and a repeating drop pattern;
Mobitz II uses a fixed conducted PR and a repeating drop pattern. Rate ranges
are bounded for each rhythm. Wandering pacemaker, MAT, and PAC timing repeat
deterministic teaching patterns; flutter uses 2:1 conduction; atrial fibrillation
uses a fibrillatory baseline and deterministic irregular ventricular response.
AVNRT, AVRT, junctional rhythm, and junctional tachycardia use simplified timing
with retrograde P waves. As in the original junctional tachycardia model, selected
AV-block settings do not alter junctional or retrograde timing; even complete
block is not modeled as independent atrial activity for junctional rhythms.
WPW pre-excitation bypasses the selected AV block and uses a short PR
and widened, slurred QRS; the accessory pathway itself is not drawn on the anatomy.
A 2:1 AV pattern cannot be classified as Mobitz I or II from that pattern alone.

There is no full 12-lead projection, ischemia model, general retrograde-capture
or refractory/reentry model. In particular, future territorial ischemia needs a
coordinated multi-lead model, not independent changes to V1.

## Tests

With the same static server running, open <http://localhost:8000/tests.html>.
The dependency-free tests cover all AV/bundle combinations, every rhythm with
each bundle morphology, blocked beats, Wenckebach reset, AV dissociation, delayed activation,
frame-independent timing/history, centered ECG preview, exact chamber-opacity
endpoints, V1 morphology, authoring offsets, and invalid input. Rendering tests verify
three-second window placement, pixel-stable scrolling (allowing one channel
level for GPU rounding), zero signal resampling on ordinary frames, exact
pixel preservation at cache rollover, and complete history after resizing.
An isolated playback fixture also checks native subframe scrolling and dot
positions, relocated controls, and zero frame requests or phase changes when
paused and changing speed.

Repository: <https://github.com/oblongflight/Conduction-Simulator>
