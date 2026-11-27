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
