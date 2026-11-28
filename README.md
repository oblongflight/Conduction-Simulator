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

- Moving arrowheads show the direction of conduction along each pathway;
  node-firing indicators remain circular.
- Enable **Show pacemaker counters** for a numerical teaching overlay in sinus
  rhythm, PACs, PVCs, focal atrial tachycardia, MAT, wandering pacemaker,
  junctional rhythm, junctional tachycardia, atrial flutter, and atrial fibrillation.
  Digits charge from black 0 to bright yellow 9; the impending source reaches
  threshold without displaying 10. Normal myocardial counters charge slowly,
  while the SA node or active ectopic focus charges faster.
  At each local activation, its digits turn red and rapidly count from 9
  back to 0 before charging again. Atrial counters reset at the P wave;
  the AV node has its own counter, resetting when a modeled atrial impulse
  arrives there (80 ms after the P wave) or a junctional escape fires.
  In junctional rhythms the AV counter is the winning pacemaker: it reaches
  threshold at nodal firing, followed by ventricular activation and retrograde
  atrial activation. The SA counter remains suppressed rather than predicting
  a sinus beat. Flutter's atrial digits cycle regularly with reentry instead of
  showing a winning SA pacemaker. A Fib uses independent, rapid local atrial
  charging and red resets, rather than a synchronized atrial beat. These local
  cycles are schematic, not measured fibrillation wavefronts. AV counters follow
  fibrillatory inputs and ventricular counters follow only resulting ventricular
  activations; complete block retains the independent escape clock. If WPW
  produces ventricular fibrillation, ventricular digits also fluctuate locally.
  SA and AV digits are larger than the myocardial digits and
  centered on their nodes, with extra space around them for readability.
  In complete AV block it instead follows only the independent escape clock,
  without being reset by blocked atrial inputs.
  Left and right ventricular counters reset at their respective muscle
  activation times, including PVCs and escape beats. Between resets they
  charge at varied speeds around a schematic 30 bpm ventricular escape rate;
  the AV node charges independently at a schematic 50 bpm junctional rate.
  These resting slopes do not depend on the next incoming beat. Only a modeled
  firing site reaches threshold; resting charges are capped without generating
  extra escape beats. Normally ventricular activation is 15 ms
  after QRS onset; RBBB delays the right side to 95 ms, and LBBB delays the
  left side to 95 ms. These timings match the chamber-fill overlays. Early
  left ventricular pre-excitation follows the existing WPW timing.
  Thus an atrial impulse blocked at the AV node does not reset ventricular
  counters, and a PVC does not reset atrial counters.
  This optional illustration follows the existing seeded rhythm and ECG
  playhead; it does not generate beats or change timing. Pause and speed
  apply to the counters too, and queued settings affect them only when those
  settings reach the playhead. Other rhythms hide the digits and show an
  availability message, without turning off the selected mode.
- Enable **Highlight rhythm source** to outline modeled pacemaker sites or
  reentry circuits in purple. It follows the rhythm at the ECG playhead and
  does not alter or restart the tracing. PACs and PVCs show both their ectopic
  focus and the SA node; wandering pacemaker and MAT follow the most recent
  atrial focus. Complete AV block also highlights its junctional escape
  focus. AVRT highlights the AV node and schematic accessory pathway, rather
  than a complete anatomical loop. AF, VF, and VT have no single discrete
  source location modeled here, so no source is outlined for those rhythms.
- Choose normal sinus rhythm, wandering pacemaker, atrial premature beats
  (APB/PAC), AVNRT, AVRT, focal atrial tachycardia, multifocal atrial
  tachycardia (MAT), atrial flutter, atrial fibrillation, junctional rhythm,
  junctional tachycardia, ventricular tachycardia, ventricular premature beats
  (PVCs), or ventricular fibrillation.
- Independently choose normal AV conduction, first-degree block, Mobitz I,
  Mobitz II, or third-degree block, and normal bundles, RBBB, or LBBB.
  AVNRT and AVRT temporarily use normal AV conduction and disable the AV-block
  controls; the previous AV selection returns when another rhythm is selected.
- In AF and flutter, an **AV nodal refractory period** slider (100–800 ms)
  replaces the AV-block controls; the previous AV selection is restored on
  leaving those rhythms. Flutter retains its atrial-rate control and displays
  its resulting conduction ratio. AF uses a fixed, irregular atrial input
  averaging approximately 400 impulses per minute, with its ventricular
  response determined by the refractory period. With WPW enabled in flutter,
  the slider adjusts the independently displayed AV nodal conduction while
  the accessory pathway still conducts every beat. In AF with WPW it remains
  visible but disabled because the model immediately shows ventricular fibrillation.
- Enable **WPW accessory pathway** with sinus rhythm, focal atrial tachycardia,
  MAT, flutter, AF, or AVRT. The selection is retained but not applied while an
  incompatible rhythm is selected. AVRT remains orthodromic without a delta
  wave. AF with WPW is illustrated as immediate ventricular fibrillation; its
  numerical QRS measurement is unavailable.
- A circled hourglass marks AV nodal transit during first-degree block and
  progressively delayed conducted beats of Mobitz I. Circled X markers remain
  reserved for failed conduction, including blocked bundle branches.
  For Mobitz I and II, the AV-node X appears 30 ms before each dropped P wave
  and clears 30 ms before the next P wave; complete AV block retains a
  persistent X. The Mobitz II marker is placed at the AV node schematically,
  although the modeled block occurs in the His-Purkinje system. An accessory
  pathway can still conduct during a displayed AV-block pattern. In AF and
  flutter, an intermittent X instead marks an impulse arriving while the AV
  node is refractory, not necessarily a pathological AV block. In flutter
  with WPW, this X marks only the AV-node failure; the accessory pathway can
  still conduct that impulse to the ventricles.
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
  Changing a scenario setting or waveform morphology queues
  its transition just beyond the right edge, retaining the visible trace; the
  anatomy and readouts change when the new scenario reaches the playhead. The
  monitor indicates while a change is queued. A short
  illustrative smoothing joins the two waveforms without a discontinuity.
  Multiple changes while paused combine in the pending scenario; changes made
  as the strip advances are shown in order.
  New controls that change the tracing should use the same queued transition
  rather than restarting or rewriting the recording.
  The grid, calibration, playhead, and time labels are separate static layers.
  Upcoming tiles are prepared beyond the visible edge during browser idle time.
  A tile stays mounted with its original animation until it has scrolled out of
  view, except when a queued transition requires rebuilding its future portion.
  Each sample visits only beats close enough to contribute, including
  overlapping waves and segment offsets.
  Resizing rebuilds the cache.
  Playback speed changes neither physiological
  intervals nor the displayed rates. Scenario and waveform edits preserve
  previous beats and queued changes during playback. Pausing or hiding
  the tab freezes both the simulation and its animations; resuming preserves
  their phase. Readouts refresh at most ten times per second, independently of
  the animation's refresh rate.

Trains of up to 14 arrowheads, spaced seven anatomy units apart, show the
direction of flow through the conduction pathways. Native motion-path animations interpolate their
positions continuously without per-frame SVG geometry queries or rounded
position steps. The arrow and ECG animations share the simulation's playback
clock, including when paused or changing speed. Chamber
overlays are red: ventricular opacity rises smoothly from transparent at
activation onset to 50% at QRS end, then fades smoothly to transparent at T end.
The affected ventricle begins its rise later with a bundle block. In organized
atrial rhythms, opacity reaches 50% at P end, followed by a schematic 200 ms
recovery fade, independently of AV conduction. A Fib uses a fluctuating atrial
opacity that reaches 50%.
There are no yellow chamber fills or nodal halos.

The shared event model in `conduction.js` drives the anatomy and ECG.
`automaticity.js` reconstructs the same seeded beat sequence separately for the
counter illustration. Its schematic charging slopes illustrate competition,
not measured membrane potentials or a cellular electrophysiology simulation.
The red countdown lasts up to 120 ms in the atria, 80 ms in the AV node,
and 160 ms in each ventricle, shortened to a third of the next local cycle
when necessary. The AV counter charges slowly between arrivals and illustrates
the independent escape clock in complete block; bypassed AV conduction does
not imply a new spontaneous beat. These are illustrative
activation/reset intervals, not measured refractory periods. Working myocardial
cells are not all normally functioning pacemakers, and premature beats can also
arise from triggered activity or reentry. In particular, the focal atrial
tachycardia counters illustrate focus dominance, not the mechanism of its
separately drawn schematic reentry loop.
Wandering pacemaker alternates among the SA node and two atrial sites. Focal
atrial tachycardia uses a left atrial focus; MAT alternates irregularly among
three atrial foci. Circles identify the available sites, and an expanding pulse
marks the focus during its P wave. Focal atrial tachycardia also shows a miniature
schematic reentry loop centered on its focus, completing one lap per atrial beat.
The optional source highlight outlines this loop.
PACs use the same schematic left atrial focus and P-wave morphology as focal
atrial tachycardia. It pulses only for the premature beat while ordinary sinus
beats continue to originate at the SA node.
Junctional rhythm and tachycardia use the same circle-and-pulse marker centered
on the AV node. An independent junctional escape in complete AV block
uses that marker too; its pulse follows the escape clock, not the atrial clock.
Ectopic atrial beats do not animate the atrial conduction pathways or draw a
route from the focus to the AV node. Their focus pulse, atrial chamber overlay,
ECG, and modeled AV arrival at 80 ms remain unchanged; sinus-origin beats still
animate the atrial pathways. Atrial focus P-wave shapes, including the PAC morphology, are
schematic; they illustrate differences between foci, but V1 alone cannot
definitively localize an atrial focus.
During atrial flutter, a schematic elliptical reentry circuit appears at the
marked location on the anatomy. Its circulating arrows complete one lap per
atrial beat and share the playback clock. The circuit definitions in `script.js`
can be extended for other rhythms; these loops illustrate rather than simulate
reentrant tissue. An independent, schematic 60 bpm sinus clock activates the
SA node and atrial pathway arrows; flutter activations instead drive the atrial
chamber overlay, ECG and AV response at the selected flutter rate. Sinus
firings do not add separate atrial or ventricular beats to this simplified
model. Typical atrial flutter is usually described as a right atrial
circuit around the tricuspid valve, not the pulmonary valve.
AVNRT shows a miniature loop contained within the AV node, with a zigzag nodal
limb and circulating arrows scaled to fit inside the node.
AVRT shows a schematic left-sided accessory pathway as a dashed green line,
without drawn connections to the conduction system. Arrows travel retrogradely
along the pathway from ventricular activation to retrograde atrial activation,
and disappear between impulses. In AVRT, the atria depolarize without arrows
on the atrial conduction pathways; retrograde activation from the AV node
continues to show those arrows. Both rhythms use simplified
tachycardia timing with retrograde atrial activation; the diagrams do not model
conduction velocity or refractory behavior along each limb. With WPW enabled in
an antegrade atrial rhythm, arrows cross the same left-sided accessory pathway
from the left atrium to the left ventricle at QRS onset. A localized red overlay spreads
from the ventricular insertion before merging into the broader ventricular
activation, including when the left bundle is blocked. AF with WPW instead
shows irregular, repeating schematic impulses traveling down the accessory
pathway, independently fluctuating atrial and ventricular overlays, and a
continuous ventricular fibrillation waveform without organized beats. The
pathway impulses illustrate conduction rather than representing individual
ventricular beats or a refractory-period model.
Ventricular tachycardia is modeled as a regular ventricular-origin rhythm with
wide complexes and no organized atrial activity. PVCs are added intermittently
to an independent sinus clock, with a compensatory pause and wide complexes.
Choose an LV or RV PVC focus; the opposite ventricle activates after the same
schematic transseptal delay used for a bundle branch block.
Ventricular fibrillation uses continuous disorganized ventricular activity
without discrete beats or atrial fibrillation.
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
are bounded for each rhythm. Wandering pacemaker and MAT use randomized beat
intervals and shuffled sets of three foci. PACs occur after a randomized 2–6
sinus beats, with a shortened coupling interval and a longer recovery interval.
These are illustrative patterns, not physiological probability distributions.
Each rhythm segment uses a fresh random sequence shared by the anatomy and ECG;
resizing or changing playback speed preserves it. In AF and flutter, the simplified AV node
conducts an impulse when its refractory period has elapsed since the last
conducted impulse; rejected impulses do not restart that period. An impulse
arriving exactly at the recovery boundary conducts. The default 350 ms period
produces 2:1 flutter at 300 bpm; WPW bypasses it and conducts every flutter beat
1:1. Flutter with WPW separately illustrates AV nodal transit and refractory
blocks but does not model fusion or collision between the pathways. AF uses a fibrillatory baseline and a deterministic irregular atrial
input, producing an irregular ventricular response. For teaching, AF with
WPW immediately becomes ventricular fibrillation rather than modeling
pre-excited AF, pathway refractoriness, or the transition to VF.
AVNRT, AVRT, junctional rhythm, and junctional tachycardia use simplified timing
with retrograde P waves. As in the original junctional tachycardia model, selected
AV-block settings do not alter junctional or retrograde timing; even complete
block is not modeled as independent atrial activity for junctional rhythms.
WPW pre-excitation bypasses the selected AV block, suppresses the independent
escape rhythm in complete block, and uses a short PR
and a widened QRS with a continuous slurred R-wave upstroke to its peak rather than a
separate deflection. A silent Q interval is folded into the upstroke; a
nonzero custom or bundle-template Q wave remains before it. The accessory
pathway's animation is schematic, not a conduction-velocity model.
A 2:1 AV pattern cannot be classified as Mobitz I or II from that pattern alone.

There is no full 12-lead projection, ischemia model, general retrograde-capture
or tissue-level refractory/reentry model. In particular, future territorial
ischemia needs a coordinated multi-lead model, not independent changes to V1.

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
