import type { InjectionKey } from "vue";

/**
 * Virtual clock for deterministic exports.
 *
 * Self-animating stage components run on wall time (rAF sequences + CSS
 * transitions), so exported frames used to bake whatever state the wall
 * clock happened to be in. During an export we:
 *
 * 1. suspend every timed sequence's own rAF loop and seek it to the exact
 *    frame time instead (same event order on every run), and
 * 2. pause every Web Animation (CSS transitions/animations) under the
 *    component stages and step its currentTime by exactly one frame.
 */

export type SequenceExportHandle = {
  /** Stop the sequence's own rAF loop without touching user pause state. */
  suspend: () => void;
  /** Resume the sequence's own rAF loop (if it was running). */
  resume: () => void;
  /** Deterministically seek to an absolute time in ms. */
  seekTo: (ms: number) => void;
};

/** Injection key: the component layer id a staged subtree belongs to. */
export const STAGE_LAYER_ID_KEY = Symbol("stage-layer-id") as InjectionKey<string>;

type StageSequenceEntry = {
  handle: SequenceExportHandle;
  layerId: string | null;
};

const sequences = new Set<StageSequenceEntry>();
let exportActive = false;
let timelineDriven = false;

function suspended(): boolean {
  return exportActive || timelineDriven;
}

export function registerExportSequence(
  handle: SequenceExportHandle,
  layerId: string | null = null,
): () => void {
  const entry: StageSequenceEntry = { handle, layerId };
  sequences.add(entry);
  if (suspended()) handle.suspend();
  return () => sequences.delete(entry);
}

export function isExportClockActive(): boolean {
  return exportActive;
}

/**
 * Editor mode: staged sequences never free-run on wall time; the playhead
 * drives them (via seekStageSequences) so a component's internal state always
 * corresponds to the timeline position — scrubbing, playing, and export all
 * agree on what "t" looks like.
 */
export function setTimelineDrive(active: boolean): void {
  if (timelineDriven === active) return;
  timelineDriven = active;
  for (const s of sequences) {
    if (suspended()) s.handle.suspend();
    else s.handle.resume();
  }
}

export function beginExportClock(): void {
  exportActive = true;
  for (const s of sequences) s.handle.suspend();
}

/**
 * Seek every staged sequence. `msForLayer` maps a component layer id (or null
 * for sequences outside any stage scope) to the sequence-local time in ms;
 * return null to leave a sequence untouched.
 */
export function seekStageSequences(msForLayer: (layerId: string | null) => number | null): void {
  for (const s of sequences) {
    const ms = msForLayer(s.layerId);
    if (ms !== null) s.handle.seekTo(ms);
  }
}

export function endExportClock(): void {
  exportActive = false;
  for (const s of sequences) {
    if (suspended()) s.handle.suspend();
    else s.handle.resume();
  }
}

/**
 * Pause + frame-step all Web Animations under the given roots. A transition
 * created on frame N starts at 0 on that frame and advances exactly
 * stepMs per subsequent frame, so its progress is frame-locked.
 */
export function createDomAnimationStepper() {
  const times = new WeakMap<Animation, number>();

  /** Force a style recalc so transitions created by this frame's DOM changes
   *  exist before we collect them. Without this, whether a brand-new
   *  transition is seen on its birth frame depends on browser scheduling —
   *  which is exactly the nondeterminism we are killing. */
  function flushStyles(roots: Element[]): void {
    for (const root of roots) {
      void (root as HTMLElement).offsetWidth;
    }
  }

  /** First export frame: the stage may carry transitions started before the
   *  export (their set depends on when the user clicked). Cancel them so
   *  every run starts from the same clean, freshly-reset state. */
  function reset(roots: Element[]): void {
    flushStyles(roots);
    for (const root of roots) {
      for (const anim of root.getAnimations({ subtree: true })) {
        try {
          anim.cancel();
        } catch {
          // ignore
        }
      }
    }
  }

  function step(roots: Element[], stepMs: number): void {
    flushStyles(roots);
    for (const root of roots) {
      for (const anim of root.getAnimations({ subtree: true })) {
        try {
          if (!times.has(anim)) {
            times.set(anim, 0);
            anim.pause();
            anim.currentTime = 0;
          } else {
            const t = (times.get(anim) ?? 0) + stepMs;
            times.set(anim, t);
            anim.currentTime = t;
          }
        } catch {
          // finished/detached animations can throw on seek; skip them
        }
      }
    }
  }

  function release(roots: Element[]): void {
    for (const root of roots) {
      for (const anim of root.getAnimations({ subtree: true })) {
        try {
          anim.play();
        } catch {
          // ignore
        }
      }
    }
  }

  return { reset, step, release };
}
