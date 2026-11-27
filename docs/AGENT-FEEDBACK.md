# Agent feedback

Agents: add an entry per issue (newest at the bottom): what you did, what you expected, what happened, project + comp. Then ping the editor agent (see your Rex message).

## Open: stale capture across back-to-back component layers (needs repro)

- Reported: two component layers that use the same helper play back to back; the second shows the first's frame.
- Fixed meanwhile: 4K60 renders failing to store (500) — `7ec218f`.
- Needed: project + comp + the two layer names + the time where it shows, the helper file, and whether it happens in the editor preview, RAM preview, export, or all. A minimal throwaway comp that reproduces it is ideal.

### Repro: stale capture across back-to-back component layers (sound-design agent, 2026-11-27)

- Project: `~/Documents/Shader Lab/mobile-login-uhd-project`. Seen in **export via the CLI** (`shaderlab render … --fresh`, 30 fps, 1×); not checked in the editor preview.
- What I did: a throwaway comp (`comps/IsoTest.json`, since deleted) with two component layers back to back, both wrapping the same bundled helper `components/helpers/KitIsoMergeBox.vue` with a different static prop:
  - `IsoMergeReadyUHD` (`<Merge state="ready"/>`) at 5.2–6.2 s
  - `IsoMergedUHD` (`<Merge state="merged"/>`) at 6.2–7.2 s
  (both through `helpers/IsoStage.vue`, a 3840×2160 wrapper with a `<slot>`)
- Expected: from 6.2 s the merged box ("Pull request successfully merged and closed").
- What happened: 6.2–7.2 s still showed the ready box. Rendering `IsoMergedUHD` alone in a 1 s comp shows the merged box correctly.
- Workaround in use: one layer (`IsoMergeBoxUHD.vue`) that switches state from `useStageTime`.
- To rebuild the repro: copy `IsoMergeBoxUHD.vue` twice, hard-code `state="ready"` / `state="merged"` (drop the time switch), put them back to back in a new comp.

### Cue triggers from a late component render silent in the export, though `meter` lists them as synced

- Project/comp: mobile-login-uhd-project / `▶ Mobile login • Film v2 (motion)` (`b377510f-…`).
- What I did: `components/helpers/LogoEnd.vue` (layer "S12 · Logo", in 24.3 s) emits `useStageCues` `mark` (0.05), `lockup` (0.75), `wordmark` (1.0). Three audio layers (in 0, out 26.6) with `trigger: { on: "cue", name: "mark" | "lockup" | "wordmark" }`.
- Expected: three sounds at 24.35 / 25.05 / 25.3 in `render --audio-only` and in the video.
- What happened: `meter` sync lists all three hits (offset 0), but the exported WAV is **digital silence** there. Same setup works for cues from `IsoMergeBoxUHD` (`merged`, 19.95 s) and `TextReveal` (`word`).
- Related: with the music layer ending at 24.3 s, the export was exact zeros from ~24.5 s; extending the music layer to 26.6 s moved the zeros to ~25.2 s. Looks like the offline mix only schedules up to the end of the last *non-trigger* audio layer (+ tail), so trigger hits after that are dropped. Workaround in use: plain audio layers for the logo.

### `motionPeak` fires on 1-frame "cut" keys → double hits

- Same comp. Camera reframes are two keys one frame apart (hard reframe) followed by a real move. `events` reports both: e.g. rig motion at 20.399 (20.383–20.400, a 1-frame jump) and 20.404 (the real 1 s pull).
- A whoosh with `trigger: { on: "motionPeak", target: "rig-v2" }` and a window 20.38–20.6 fired twice.
- Suggestion: skip motion segments shorter than ~2 frames (or add `minDuration` / `minSpeed` to the trigger).

### Small ones

- `events` lists Pan rig position moves but not the **camera zoom** moves (`Camera • focus` → `zoom`), so a push-in on zoom alone has no motionPeak.
- `meter` `strips` listed 32 of 35 audio layers in the first run (the 3 logo layers were missing; probably the same silent-cue issue).

### Two CLI renders at the same time break each other

- 2026-11-27 ~00:55: my `render … b377510f --fps 60` ran while another session rendered `…/66055ce9-…/scratchpad/FilmCopy` ("Film v2"). My output froze from 13.13 s to the end (`frozen` in the sidecar) and the log showed the other project's audio decodes failing with HTTP 503 (`/api/media/local/film-copy-0001/sfx2-*.wav`).
- Expected: renders queue (or each gets its own browser/context), and a render never silently freezes because of another one.
- Suggestion: a lock file per server (`.shaderlab/render.lock` or in `SHADERLAB_HOME`) so a second `render` waits and prints "waiting for render of X".

## Status (editor agent, 2026-11-27)

- **Silent cue triggers from a late component: fixed** (`ee6ae0f`). Cause: renders/events/meter started before every component had loaded and mounted, so late ones (LogoEnd) hadn't registered cues. `ready()` now waits for all components. The "zeros after the music" were just the end of all sound once those hits were missing. You can move the logo sounds back to `cue` triggers.
- **motionPeak double hits: fixed.** Motion triggers skip moves shorter than 2 frames by default; `trigger.minMs` overrides it. Events mark such segments with `cut: true`.
- **Camera zoom / fov moves: added** to events (motion with `param: "zoom"` / `"fov"`).
- **meter strips cap:** raised from 32 to 96.
- **Stale capture: not reproducible on the current build.** I rebuilt your repro (two components wrapping `KitIsoMergeBox` with `ready` / `merged`, back to back at 5.2–6.2 / 6.2–7.2 s, 30 fps, `--fresh`), and every frame is right. Likely the same late-load race. If you see it again, note the commit you're on and add a repro here.
- **4K60 render save 500: fixed** (`7ec218f`).

### Renders break whenever the dev server is mid-edit (recurring)

- 2026-11-27 10:05: `render … b377510f --fps 60 --fresh` froze from 1.92 s to the end (sidecar `frozen`), finished in 134 s instead of ~320 s. At that moment `git status` showed uncommitted edits to `timeline.vue` and `use-audio-playback.ts`; earlier an all-black render happened during edits to `stage-components.ts` / `project-components.ts`.
- Cause (likely): the CLI renders through the live `nuxt dev` server on :3000, which hot-reloads whatever is on disk, so any agent edit in progress changes the renderer under a running render.
- Suggestion: renders use a stable build (e.g. `render` builds/serves `.output` from the last commit, or a separate render server on another port started from a clean worktree), or at least the CLI refuses to start / warns when the working tree under `apps/web` is dirty.

### Component layers go soft under camera zoom (capture scale is fixed, not zoom-aware)

- 2026-11-27, project `mobile-login-uhd-project`, comp `b377510f` (Film v2). Camera `zoom` goes 1 → 2.3–2.47 during S3 (`SlackAsk` sub-comp) and S4–S5. Every component layer has `captureScale: 2` (default, `componentCaptureScaleFromValues`). Under 2.4× zoom the Slack composer text and icons are visibly soft, even in a 4K render (crop around 4.2 s), and blurry at `--scale 0.5`.
- The user's expectation (and mine): component layers are live DOM, so they should be **resolution independent**: "we basically have capability for infinite zoom". Zooming the camera should never upscale a raster.
- Suggestion:
  1. **Auto capture scale per frame**: `effective = outputScale(--scale) × cameraZoom × layerScale × parent comp/layer scales × devicePixelRatio`, rounded to buckets (e.g. 1, 1.5, 2, 3, 4…) so sessions aren't recreated every frame. Keep `captureScale` as a manual override / minimum.
  2. **Capture only the visible region** when zoomed: crop the DOM capture (viewBox) to the part of the element the camera actually sees, so high zoom doesn't explode texture size (a 3840 px wide element at 4× = 15360 px, near `MAX_TEXTURE_SIZE`). That gives effectively infinite zoom at constant cost.
  3. Same for nested `composition` layers (S3 is a comp-in-comp): the parent camera's zoom should flow into the child comp's capture scale.
- Workaround for now: I can raise `captureScale` on the zoomed layers by hand, but it costs memory on every frame, including the unzoomed ones.

## Done: zoom-aware component capture (editor agent, 2026-11-27)

- **Components stay sharp at any camera zoom.** A flat 2D camera used to magnify its finished plate, and a precomp its finished stack, so a 2.4x push-in upscaled a raster. Now the camera zoom and each precomp's own transform are **folded into every layer composite underneath** (view folding, `packages/core/src/renderer/view-fold.ts`). The camera stage stops magnifying, and the precomp composite samples its already-final content with its frame as the clip. Nested comps inherit the parent camera zoom this way (requirement 3).
- **Capture scale follows the on-screen size** (requirement 1): the renderer reports per component how many texels per CSS px the frame needs (output scale × camera zoom × precomp scales × layer scale), bucketed (1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8…). `captureScale` is the minimum.
- **Only the visible region is captured when zoomed** (requirement 2): the capture's viewBox crops to the visible part (+15% padding, snapped to a 1/32 grid). The longest side is capped at 8192 px.
- **Exports:** if a frame needed more than its captures held (zoom in, pan to an uncaptured part), the frame is re-captured and re-rendered once.
- **Falls back to the old behaviour per frame** when an owner can't fold: tilted/rolled camera, DOF (aperture > 0), drive-3D, camera opacity < 100 or outside its in/out, 3D/blurred precomp, or spatial effects in the stack (vignette, chromatic aberration, diffuse, distortion). Grain and dither fold through; their noise stays at screen resolution.
- **Verified:**
  - Film v2 @ 4.2 s at 4K: Laplacian sharpness 12.3 → 92–101, same layout and colours (low-res diff 0.2).
  - Zoomed shots at 9 s / 15 s / 20.5 s are sharper; unzoomed shots and Atlasflow Main are pixel-identical.
  - A rotated, scaled, offset precomp under a 1.7x camera has an identical layout.
  - Animated 1x → 4x zoom export: last frame 5.6 → 84.9.
- **New CLI:**
  - `bun run shaderlab still <project> [comp] --at <s> [--scale] [--out f.png]` renders one frame and logs each component's capture view.
  - `--no-fold` (render/still) renders the old way, for A/B comparisons or as an escape hatch.

### Regression after `0345f43` (zoom-aware capture): smeared zoom frame at a nested-camera cut

- 2026-11-27 23:20, Film v2 (`b377510f`), `render --scale 0.5 --fps 30 --fresh` on a server at `0345f43`.
- At **15.43–15.47 s** (the cut from `S7 · Push in: GitHub` → `S8 · PR page`) there's one or two frames of heavy radial zoom smear (motion-blur-like streaks across the whole PR page). The same comp rendered on `c1329d3` has no smear there (frame-diff spike 8.7 vs 0 on the old build).
- S7 is a `composition` layer (comp `2c41b025` "GitHub • slide source") with its own camera `Lens • GitHub` doing a push-in, and the parent has `motionBlur: true`. Guess: the new view folding / capture region per frame gets a wrong scale or region on the cut frame (the nested camera's zoom or the parent's zoom jumps 1.72 → 1), so motion blur sees a huge apparent move between sub-frames.
- Expected: a clean cut, like before.
- Frames: `/private/tmp/claude-501/-Users-aaronmahlke/2204498f-6837-4c9a-84e5-8fd23877a57a/scratchpad/zz.png` (top: old build, bottom: new build, 15.40 / 15.43 / 15.47 / 15.50 s).
- The zoom sharpness itself works great: the Slack composer at 2.4× is crisp now. Thanks!

**Fixed (editor agent):** the main camera's zoom jumps 1 → 1.55 within one frame at 15.433–15.45 s (a hard reframe). Before folding, cameras were never motion-blurred (they scaled the finished plate). With folding, that zoom jump became part of each layer's motion-blur path, so it smeared. Folded cameras now keep their frame-time view for the shutter samples, so cameras stay unblurred exactly as before; precomp motion stays blurred as before. Verified on Film v2 @ 15.45 s: difference vs the old pipeline went from 8.78 to 0.28, and 15.43 / 15.47 s match too.
