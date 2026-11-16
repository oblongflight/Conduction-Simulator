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

- Choose normal AV conduction, first-degree block, Mobitz I, Mobitz II, or
  third-degree block.
- Independently choose normal bundles, RBBB, or LBBB. All 15 combinations work.
- Scenario-specific controls set PR prolongation, Wenckebach progression,
  conducted beats before a dropped impulse, or junctional escape rate.
- Pause/resume playback or change its speed beside Atrial rate in the top bar.
- The strip is centered on the current instant: 2.5 seconds of history to the
  left and 2.5 seconds of upcoming activity to the right. The ECG column matches
  the anatomy panel's height on wide screens, with waveform amplitude scaled
  to the taller canvas. On smaller screens the panels stack. The yellow center
  playhead is the current instant on the anatomy. A separate deterministic
  instance of the same event model previews the waveform without advancing the
  anatomy clock. `ecg-strip.js` renders a static, 15-second offscreen strip at
  fixed sample positions. A native browser transform animation scrolls that image
  on its own compositing layer; JavaScript does not repaint it each frame.
  The grid, calibration, playhead, and time labels are separate static layers.
  As playback advances, cached pixels
  are retained exactly and only the newly exposed five-second segment is generated.
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
The affected ventricle begins its rise later with a bundle block. Atrial opacity
reaches 50% at P end, followed by a schematic 200 ms recovery fade, independently
of AV conduction. There are no yellow chamber fills or nodal halos.

The shared event model in `conduction.js` drives the anatomy and ECG.
Blocked atrial impulses generate P waves but no associated ventricular
activation, QRS, or T wave. Third-degree block has independent atrial and
junctional/His escape clocks. A blocked bundle does not conduct antegradely:
the affected ventricle activates later through schematic transseptal myocardium.

## Waveform authoring and saved data

Open **Waveform authoring** to duplicate an automatic V1 template and edit its
components, QT, and PR/ST offsets. RBBB includes an editable terminal R-prime.
PR timing belongs to the AV scenario, so the legacy P-to-Q gap is not used.
The component durations determine QRS and QT; changing a segment offset does
not change conduction timing.

Automatic morphology follows the selected bundle block. A custom morphology
overrides the ECG appearance, including QRS width, but not the selected
conduction rules; a warning identifies this teaching limitation.

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
Mobitz II uses a fixed conducted PR and a repeating drop pattern. Atrial rates
are limited to 40–120 bpm for these teaching examples. A 2:1 AV pattern cannot
be classified as Mobitz I or II from that pattern alone.

There is no full 12-lead projection, ischemia model, retrograde capture, or
general refractory/reentry model. In particular, future territorial ischemia
needs a coordinated multi-lead model, not independent changes to V1.

## Tests

With the same static server running, open <http://localhost:8000/tests.html>.
The dependency-free tests cover all AV/bundle combinations, blocked beats,
Wenckebach reset, AV dissociation, delayed activation, frame-independent
timing/history, centered ECG preview, exact chamber-opacity endpoints, V1
morphology, authoring offsets, and invalid input. Rendering tests verify
five-second window placement, pixel-stable scrolling (allowing one channel
level for GPU rounding), zero signal resampling on ordinary frames, exact
pixel preservation at cache rollover, and complete history after resizing.
An isolated playback fixture also checks native subframe scrolling and dot
positions, relocated controls, and zero frame requests or phase changes when
paused and changing speed.

Repository: <https://github.com/oblongflight/Conduction-Simulator>
