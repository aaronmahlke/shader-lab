/**
 * Pure, deterministic core for the timed-sequence player.
 *
 * Used two ways:
 * - Live preview: `useTimedSequence` feeds it real rAF deltas.
 * - Export: the export clock seeks it to exact frame times, so a
 *   self-animating component renders identically on every run
 *   (the "virtual clock" for deterministic exports).
 */

export type SequenceClockEvent = {
  /** Time in milliseconds from the start of the cycle. */
  at: number;
  /** Invoked once when elapsed first crosses `at`. */
  run: () => void;
};

export type SequenceClockOptions = {
  events: SequenceClockEvent[];
  /** Total duration of one cycle in ms. */
  totalDuration: number;
  loop?: boolean;
  onReset?: () => void;
  onStop?: () => void;
};

export type SequenceClock = {
  /** Current elapsed ms within the cycle. */
  elapsed: () => number;
  stopped: () => boolean;
  /** Advance by a delta (live playback path). */
  advanceBy: (deltaMs: number) => void;
  /** Seek to an absolute time; seeking backward resets and replays. */
  advanceTo: (targetMs: number) => void;
  reset: () => void;
};

export function createSequenceClock(opts: SequenceClockOptions): SequenceClock {
  let elapsed = 0;
  let nextIdx = 0;
  let stopped = false;

  function fireDue() {
    while (nextIdx < opts.events.length && (opts.events[nextIdx]?.at ?? Infinity) <= elapsed) {
      opts.events[nextIdx]?.run();
      nextIdx++;
    }
  }

  function reset() {
    opts.onReset?.();
    elapsed = 0;
    nextIdx = 0;
    stopped = false;
  }

  function advanceTo(targetMs: number) {
    if (targetMs < elapsed) reset();
    if (stopped) return;

    let target = targetMs;
    const total = opts.totalDuration;

    // Degenerate cycle: fire everything once and stop looping math.
    if (total <= 0) {
      elapsed = Math.max(target, 0);
      fireDue();
      return;
    }

    for (;;) {
      elapsed = Math.min(target, total);
      fireDue();
      if (target < total) return;
      if (!opts.loop) {
        stopped = true;
        opts.onStop?.();
        return;
      }
      opts.onReset?.();
      elapsed = 0;
      nextIdx = 0;
      target -= total;
      if (target <= 0) return;
    }
  }

  return {
    elapsed: () => elapsed,
    stopped: () => stopped,
    advanceBy: (deltaMs: number) => advanceTo(elapsed + Math.max(deltaMs, 0)),
    advanceTo,
    reset,
  };
}
