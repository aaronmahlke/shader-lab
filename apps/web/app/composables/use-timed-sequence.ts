// Ported from evlog (apps/docs/app/composables/useTimedSequence.ts),
// MIT License, Copyright (c) 2026 HugoRCD — https://github.com/HugoRCD/evlog

import { onBeforeUnmount, readonly, ref } from "vue";
import { createSequenceClock } from "#shared/editor/sequence-clock";
import { registerExportSequence } from "~/utils/export-clock";

/**
 * Tiny rAF-based sequencer for inline doc demos.
 *
 * Drives a list of timed events (each with a `at` ms offset and a `run` callback)
 * along a single virtual timeline. Supports pause / resume / restart so readers
 * can stop a looping demo to inspect a state, then play it back.
 *
 * Honors `prefers-reduced-motion` by firing every event immediately on start
 * (so the final state is shown without animation), and is meant to be wired to
 * an `IntersectionObserver` from the consuming component.
 */

export interface TimedEvent {
  /** Time in milliseconds from the start of the cycle. */
  at: number;
  /** Callback invoked once when `elapsed` first crosses `at`. */
  run: () => void;
}

export interface UseTimedSequenceOptions {
  events: TimedEvent[];
  /** Total duration of one cycle (incl. any tail hold), in ms. */
  totalDuration: number;
  /** Loop back to the start when totalDuration is reached. */
  loop?: boolean;
  /** When true, fire all events immediately on `start()` and never tick. */
  reducedMotion?: boolean;
  /** Reset consumer state to its initial values (called on cycle loop and `restart()`). */
  onReset?: () => void;
}

export function useTimedSequence(opts: UseTimedSequenceOptions) {
  const elapsed = ref(0);
  const paused = ref(false);
  const started = ref(false);

  let rafId: number | undefined;
  let lastTimestamp = 0;
  let suspended = false;

  // Deterministic core shared by live playback (rAF deltas) and export
  // seeking (the virtual clock drives exact frame times).
  const clock = createSequenceClock({
    events: opts.events,
    totalDuration: opts.totalDuration,
    loop: opts.loop,
    onReset: opts.onReset,
    onStop: () => stop(),
  });

  function tick(timestamp: number) {
    if (suspended) return;
    if (lastTimestamp === 0) {
      lastTimestamp = timestamp;
      rafId = requestAnimationFrame(tick);
      return;
    }
    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    clock.advanceBy(delta);
    elapsed.value = clock.elapsed();

    if (!paused.value && started.value) {
      rafId = requestAnimationFrame(tick);
    }
  }

  const unregisterExport = registerExportSequence({
    suspend() {
      suspended = true;
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        rafId = undefined;
      }
    },
    resume() {
      suspended = false;
      if (started.value && !paused.value && !opts.reducedMotion) {
        lastTimestamp = 0;
        rafId = requestAnimationFrame(tick);
      }
    },
    seekTo(ms: number) {
      if (opts.reducedMotion) return;
      started.value = true;
      clock.advanceTo(ms);
      elapsed.value = clock.elapsed();
    },
  });

  function start() {
    if (started.value) return;
    started.value = true;
    if (opts.reducedMotion) {
      opts.events.forEach((e) => e.run());
      return;
    }
    if (suspended) return;
    lastTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (paused.value || !started.value) return;
    paused.value = true;
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
  }

  function resume() {
    if (!paused.value || !started.value) return;
    paused.value = false;
    if (suspended) return;
    lastTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  }

  function toggle() {
    if (paused.value) resume();
    else pause();
  }

  function restart() {
    clock.reset();
    elapsed.value = 0;
    paused.value = false;
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    if (!started.value) {
      start();
      return;
    }
    if (suspended) return;
    lastTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    started.value = false;
  }

  onBeforeUnmount(() => {
    unregisterExport();
    stop();
  });

  return {
    start,
    pause,
    resume,
    toggle,
    restart,
    stop,
    paused: readonly(paused),
    started: readonly(started),
    elapsed: readonly(elapsed),
  };
}
