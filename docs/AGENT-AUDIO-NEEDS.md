# What an agent needs to do sound design in Shader Lab

Written after scoring `mobile-login-uhd-project` (Film comp, 724 frames) end to end with an agent:
Splice samples, story-arc music, mix, and 23 clip layers written into the comp. Everything below is
something that was missing, faked, or worked around during that run.

---

## 1. Rendering and verification (blocker)

- **No headless export.** The only export path is the editor tab. The first agent-triggered export
  rendered 724 frames but the picture froze from ~8.8 s (tab in the background, components stopped
  updating). Nothing reported an error.
  - Need: `shaderlab render <project> <comp> --out x.mp4 [--audio-only] [--scale] [--fps]`, running
    without a visible tab, deterministic.
- **No render self-check.** Export should fail (or warn) when consecutive frames are identical where
  the timeline says something animates.
- **No audio-only render.** To check a mix the agent has to export video, or rebuild the mix outside
  Shader Lab. Need an offline mix of the comp's audio layers to WAV (the export already does this
  internally: `renderAudioMix`).

## 2. Timing data the agent can read

- **Motion is only available as raw keyframes.** To put a whoosh on the fastest moment of a move,
  the agent re-implemented bezier easing and computed the speed peak itself.
  - Need an API: evaluate any param at t, its velocity, and per-segment `start / speedPeak / end`.
- **Component-internal timing is invisible.** Typing lives in `TypeCue.vue` (per-character pace and
  jitter). The agent had to read the Vue source and re-run the same math to get 47 keystroke times.
  - Need: components can emit **cues/markers** (`keystroke`, `reveal`, `pressed`, `posted`) that the
    host collects on the timeline, so sound can be placed from them.
- **Pointer presses are fine** (`press` keyframes), as are layer in-points. More of that.
- **Exports don't say what they are.** A downloaded MP4 was a 664-frame trimmed cut that matched no
  project on disk (all were 724 frames), which made every click 48 frames off.
  - Need: embed comp id, project version and frame count in exports (metadata or sidecar JSON).
- **Timeline markers** (named, with time) the agent can read and write: "drop", "payoff", "story turn".

## 3. Audio model

What had to be baked into files because Shader Lab can't do it yet:

| Baked into the file today | Needed in Shader Lab |
|---|---|
| Music low-pass automation (filtered build → drop) | Effect chains (EQ, filter, comp, reverb, delay, saturation) with keyframes / LFOs |
| Music ducking under clicks, 200 ms vacuum before the drop | Volume automation + compressor with **sidechain** |
| 4-layer click stack as one file | Precomps as groups / buses |
| Pan, pitch variation per keystroke | Per-layer pan, pitch, time-stretch |
| Stereo width (narrow build → wide drop) | Width / mid-side on a track or bus |
| Looping the 16 s music bed and 8 s drum loop | Loop region on audio clips |
| Trim + fades on every whoosh | Clip trim, fade in/out curves, gain, reverse |
| Master loudness (−14 LUFS, −1 dBTP) | Master bus limiter + loudness target |

Plus:

- **Audio in precomps**, so scenes carry their own sound and retiming moves it.
- **Mixer**: fader, pan, mute, solo per layer; precomps as group buses; master bus; return buses.
- **Picture-locked triggers** with:
  - `anchor: onset | peak | end`: a whoosh's *peak* lands on the move's speed peak, a riser's *end*
    on the hit, a click's *onset* on the press.
  - **fit to move**: trim the sound's rise and tail to the move's length.
  - **variation**: round-robin samples, pitch and gain jitter, so repeated clicks don't sound robotic.
  - sources: keyframe, speed peak, layer in/out, pointer press/release, component cue, marker.
- **BPM grid**: tempo + offset on the comp, bar/beat lines on the timeline, snap keyframes to beats
  (this film: 120 BPM, offset so 15.0 s and 21.0 s are downbeats).
- **Waveforms** on audio layers.
- Synthesis last. Code-synthesized UI sounds sound cheap; real samples win.

## 4. Assets

- **`assets/` rejects subfolders** ("Invalid media path"). 23 clips had to live flat as `sfx-*.wav`.
  Allow `assets/sfx/…`, `assets/music/…`.
- **Reference instead of copy**: link to `~/Splice/sounds/...` or a sound library, with the source
  and license stored per asset (Splice ID, pack, license).
- **Auto-reload on file change.** After writing `Film.json` and assets, the agent had to reload the
  editor tab through Chrome DevTools to see the result.

## 5. Metering and analysis (readable by agents)

- Integrated LUFS, short-term LUFS over time, true peak, per layer and master.
- Peak/onset time of any audio clip (to verify "the whoosh peak is on the speed peak").
- Sync report: each trigger vs. its picture event, offset in ms.

## 6. Agent API / CLI

- Comps as JSON on disk works well. Keep it. Add a **JSON schema** so agent writes are validated.
- CLI sketch:
  - `shaderlab events <comp>`: every motion segment (start/peak/end), pointer press/release, layer
    in/out, component cue, marker.
  - `shaderlab render …` (video / audio-only)
  - `shaderlab meter <comp>`: LUFS / true peak / per-layer levels
  - `shaderlab validate <project>`
- Comp settings are already plain JSON (`motionBlur` was set that way). Good.

## 7. Review loop

- The agent can't hear. Measured checks (sync, loudness, gating) were reliable; an audio model judge
  (Gemini) was good on arc and taste but unreliable on timing (it reported a present Enter key as
  "missing").
- Need: **A/B versions** of the sound in the editor (mix v2 vs v4 on the same picture), and
  **timestamped comments** from the human ("whoosh late here", "drop too loud") that the agent reads
  as its next brief.

## Suggested order

0. Headless render (video + audio-only) and export metadata
1. Events API: speed peaks, component cues, markers
2. Audio in precomps
3. Mixer and buses
4. Effect chains with automation (+ sidechain)
5. Picture-locked triggers (anchor, fit to move, variation)
6. Clip tools, loop region, BPM grid, waveforms
7. Metering API
8. Synthesis
