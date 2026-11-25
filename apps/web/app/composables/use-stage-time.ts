import { inject, onBeforeUnmount, onMounted, ref } from "vue";
import { registerExportSequence, STAGE_LAYER_ID_KEY } from "~/utils/export-clock";

/**
 * Layer-local time (seconds) for a staged component, driven by the timeline.
 *
 * Components that use this render purely from `t` (no timers, no CSS
 * transitions), so scrubbing, playback and export always show the same frame
 * for the same time. Outside the editor (no stage scope) it free-runs on rAF.
 */
export function useStageTime() {
  const t = ref(0);
  const layerId = inject(STAGE_LAYER_ID_KEY, null);
  let raf: number | null = null;
  let start = 0;
  let running = false;

  const tick = (now: number) => {
    t.value = (now - start) / 1000;
    raf = requestAnimationFrame(tick);
  };
  const handle = {
    suspend() {
      running = false;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    },
    resume() {
      if (running) return;
      running = true;
      start = performance.now() - t.value * 1000;
      raf = requestAnimationFrame(tick);
    },
    seekTo(ms: number) {
      t.value = ms / 1000;
    },
  };

  let unregister: (() => void) | null = null;
  onMounted(() => {
    // registerExportSequence suspends right away when the timeline drives.
    handle.resume();
    unregister = registerExportSequence(handle, layerId);
  });
  onBeforeUnmount(() => {
    handle.suspend();
    unregister?.();
  });
  return t;
}
