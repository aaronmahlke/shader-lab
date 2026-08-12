# Shader Lab — Product roadmap

Living reference for planned work toward a **modern motion-design tool with shader superpowers** (After Effects mental model, unified stack, GPU-native).

Last updated: 2026-06-15

---

## Vision

One **project** contains compositions, media, and reusable assets. Each **composition** is a layer stack with a timeline — 2D and optional 3D, procedural shader layers, text/shapes/media, keyframes, easing, and effects. Everything renders through `@shader-lab/core` (browser + headless).

Not a separate “artworks” pipeline. Not Three.js as the 2D compositor (v1 mistake). Optional custom 3D scene pass inside core when needed.

---

## Phase 0 — Foundation (mostly done on v2)

- [x] Unified layer stack + GPU compositor (`packages/core`)
- [x] Keyframes + property tracks + stopwatch
- [x] Timeline (transport, scrub, U-key reveal, multi-select)
- [x] LFO modulation engine (exists in core; UI/integration TBD — see below)
- [x] Headless renderer for export (`renderCompositionToBuffer`)
- [x] Centralized keyboard dispatch (`use-editor-keyboard`)

---

## Phase 1 — Every layer is a layer

Shared properties and timeline UX that apply to **all** layer types.

Status:

- [x] Universal properties in data model + inspector + timeline (opacity, position, scale, rotation, anchor, in/out points) — `layer.values` reserved names + `layer.timing`, rendered via the per-generator `layerComposite` pass; effects crossfade by opacity, distortion scales displacement
- [x] AE-style P/S/R/T reveal shortcuts (timeline)
- [x] In/out layer bar on the timeline (drag to move, edges to trim, double-click to reset)
- [ ] 3D layer toggle (Phase 7 prerequisite; add `positionZ`/`rotationX/Y` when scene3d lands)
- [ ] Timeline value editing (scrub/click values in the labels column)

### Universal layer properties

Every layer should have a common set (in data model + inspector + timeline):

| Property | Notes |
|---|---|
| **Opacity** | 0–100% |
| **Transform** | Position (X, Y, Z when 3D enabled) |
| **Scale** | Uniform or X/Y (and Z later) |
| **Rotation** | X, Y, Z (or collapse to Z-only in 2D mode) |
| **Anchor point** | AE-style; affects rotation/scale origin |
| **In / out points** | Layer visibility window on the timeline — bar showing when the layer is active in the comp (not necessarily full comp length) |
| **3D layer toggle** | Off = 2D stack behavior; on = participates in 3D scene pass |

Implementation note: add these to `LayerInstance` (or a nested `transform` / `layerStyle` object) early, even before 3D rendering exists, so keyframes and UI don’t need a migration later.

### AE-style keyboard shortcuts

Reveal/toggle property groups on selected layer(s):

| Key | Property |
|---|---|
| **P** | Position |
| **S** | Scale |
| **R** | Rotation |
| **T** | Opacity (opacity) |
| **U** | Keyframed properties only (done) |
| **UU** | Full expand (done) |

Integrate via `use-editor-keyboard` at timeline priority. Match AE where sensible.

### Timeline value editing

Currently values display but aren’t editable on the timeline.

- **Scrub** number in labels column (drag left/right)
- **Click** to enter exact value (input field)
- Respect property min/max/step from layer template
- Record undo history on commit
- Optional: shift-scrub for finer steps

---

## Phase 2 — Canvas & selection

### Bounding box selection on canvas

- Click layer → select (sync with layer list)
- Drag marquee on canvas → multi-select layers
- Show transform bounding box for selection (position, scale handles later)
- Shift/cmd modifier behavior aligned with timeline

Related (not yet requested but likely soon):

- Canvas gizmos for position / scale / rotation
- Snap to guides / other layers
- Safe margins / title-safe overlay

---

## Phase 3 — Easing

Core already supports named eases; need **Flow-style** curve editing.

- [x] Upgrade keyframe easing to **cubic bezier** (`x1, y1, x2, y2`) + named presets — `Keyframe.curve` beats `ease`, presets in `core/animation/easing.ts`
- [x] Apply to selected keyframe segment(s) — right-click a keyframe for the easing menu (applies to the whole selection)
- [x] Evaluate in `evaluateKeyframes` (bezier solve for `y` given `x`)
- [ ] UI: curve editor with handles, preset grid visualization, favorites

---

## Phase 4 — Previews & catalog

We have a **headless renderer** — use it systematically.

### Preview scenes

- Defined preview compositions per layer type / effect (like current `layer-previews` but rendered, not hand-picked)
- Headless render → PNG/WebP for:
  - Layer add menu / catalog cards
  - Dashboard composition cards
  - OG images / social previews
- Script or CI job to regenerate preview assets when shaders change

Location: extend `shared/editor/layer-previews.ts` + batch render script using `@shader-lab/core/server`.

---

## Phase 5 — Project structure & nesting

### Compositions as first-class assets

Move from single open comp to a **project**:

```
Project
├── compositions[]     ← each has own layers, tracks, settings, duration
├── media[]            ← images, video, fonts (refs)
├── lfos[]             ← reusable? or per-comp (see LFO section)
└── settings           ← name, maybe default comp size/fps
```

### Sidebar (replaces / augments current add flow)

Tabs, e.g.:

| Tab | Contents |
|---|---|
| **Assets** | Compositions in project, imported media, nested comp refs |
| **Effects / Layers** | Current “add layer” catalog (generators, effects, etc.) |

Drag asset from sidebar into comp → instance or nested comp layer.

### Nesting compositions

- Layer type: `composition` (reference to another comp in the project)
- Renders nested comp to texture/FBO at current time, then composites like any layer
- Transform + effects apply to nested result
- Duration: nested layer bar respects in/out; source comp has its own duration
- Open question: precomp duration vs parent — follow AE (precomp is self-contained)

### Persistence / DB

- Today: shaders saved as documents
- Future: **project** document containing multiple comps + asset refs
- Migration path from single-shader docs to project format

---

## Phase 6 — Content layers (unified stack)

Port ideas from pre-v2 **artworks**, not its pipeline.

| Layer type | Content pass |
|---|---|
| **Shape** | SDF rect / ellipse / round-rect shader |
| **Text** | Rasterize to texture (Canvas / headless canvas) → quad in stack |
| **Image / video** | Media texture → quad |
| **Component** | ✅ Live DOM capture → texture (`setComponentSource`; capture adapted from evlog's Render labs, MIT). Stage registry in `apps/web/app/components/stage/`, capture loop in `use-component-capture`. Headless renders it transparent (no DOM in node). |

All use universal transform + opacity + in/out + same effect stack.

Old artworks reference commit: `a3f6bdb` (`shared/artwork/text-layer.ts`, etc.) — data model hints only.

---

## Phase 7 — 3D / mograph

Custom **scene3d** module in core (no Three.js — keep bundle small; exact use cases only).

See prior architecture discussion:

- Scene pass → FBO (color + depth)
- Camera layer, light layers, mesh layers (cube, plane, sphere)
- 2D/3D-enabled layers as textured quads in scene
- Materials: phong → glass (transmission, IOR, env)
- Motion blur v1: multi-sample shutter (export); v2: velocity buffer

Depends on universal transform (Phase 1) with XYZ from the start.

---

## Phase 8 — LFOs on the timeline

LFO engine exists (`LFOSource`, `ModulationAssignment`). UI/integration is unresolved.

### Proposed UX

- Next to a property value: **LFO symbol** (like stopwatch)
- Click → create new LFO or pick existing
- LFO drives property over time (virtual/automatic keyframes or live evaluation)
- LFO **parameters** (rate, depth, phase, …) can themselves be keyframed
- Enable/disable LFO via keyframes

### Open problems

| Problem | Possible directions |
|---|---|
| **Single source of truth** | LFO is a modifier on `(layerId, paramName)`; one row in data, many UI surfaces |
| **Timeline representation** | Mini “LFO lane” under property vs collapsed badge only |
| **vs keyframes** | LFO adds on top of keyframed base value, or replaces until disabled? (AE: often additive via expressions) |
| **Reuse across properties** | Global LFO asset referenced by multiple assignments |
| **Editing in multiple places** | Inspector shows LFO params; timeline shows assignment; changes must sync via shared ref (one `ModulationAssignment` object) |
| **Baking** | Optional “bake LFO to keyframes” for export compatibility |

Recommendation: treat LFO as an **assignment** (already in model), not duplicate state. UI always reads/writes `assignments[]`. Timeline shows an icon + optional sub-lane; inspector shows full LFO editor when assignment selected.

---

## Explicitly later / not scoped yet

Items that come up in a full AE-like tool but aren’t in the current list:

- **Blend modes** per layer (multiply, screen, …)
- **Parenting** (layer A parent of B for transform inherit)
- **Masks / track mattes**
- **Graph editor** (value vs time curves beyond easing)
- **Motion blur** (3D phase; also 2D per-layer)
- **Expressions** (text-based; alternative/complement to LFO UI)
- **Render queue** (batch export comps/projects)
- **Markers** on timeline
- **Work area** (preview range vs full comp duration)
- **Audio** layers / waveform
- **Versioning** of project file format
- **Collaboration** / sharing (web-native advantage)

---

## Suggested build order

1. Universal layer properties + in/out bars + shortcuts (**P/S/R/T**)
2. Timeline value scrub/edit
3. Canvas bounding box selection (+ basic gizmos)
4. Bezier easing UI
5. Headless preview batch for catalog
6. Project model + sidebar (assets / effects tabs)
7. Nested compositions
8. Shape / text / media layers
9. scene3d pass + camera/lights/glass
10. LFO timeline integration (resolve open questions first)

---

## References

- Core renderer: `packages/core/README.md`
- Composition config: `packages/core/src/types/composition.ts`
- Layer templates: `packages/core/src/compiler/layer-templates.ts`
- Old artworks (text/image, separate pipeline — **do not revive**): git `a3f6bdb`
- Old Three.js as 2D compositor — **do not revive**; v2 raw GL is correct for 2D stack
