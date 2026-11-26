import { inject, onBeforeUnmount, shallowRef } from "vue";
import { STAGE_LAYER_ID_KEY } from "~/utils/export-clock";

/**
 * Component cues: moments inside a staged component (a keystroke, a message
 * posted, a reveal) declared in LAYER time, so sound and the events API can
 * sync to them without re-deriving the component's own timing.
 *
 *   useStageCues(() => keystrokeTimes.map((t) => ({ time: t, name: "keystroke" })))
 *
 * The function should be pure (props → cues); it's read when events are
 * collected. Outside the editor stage it does nothing.
 */
export type StageCue = { time: number; name: string; data?: Record<string, unknown> };

/** layerId (stage id, may be prefixed for nested comps) → cue providers. */
export const stageCueProviders = new Map<string, Set<() => StageCue[]>>();
export const stageCuesVersion = shallowRef(0);

export function useStageCues(provide: () => StageCue[]): void {
  const layerId = inject(STAGE_LAYER_ID_KEY, null);
  if (!layerId) return;
  let set = stageCueProviders.get(layerId);
  if (!set) stageCueProviders.set(layerId, (set = new Set()));
  set.add(provide);
  stageCuesVersion.value++;
  onBeforeUnmount(() => {
    set!.delete(provide);
    if (!set!.size) stageCueProviders.delete(layerId);
    stageCuesVersion.value++;
  });
}

/** All cues of one staged layer, in layer time (sorted). */
export function cuesForLayer(layerId: string): StageCue[] {
  const out: StageCue[] = [];
  for (const fn of stageCueProviders.get(layerId) ?? []) {
    try {
      for (const c of fn()) if (Number.isFinite(c.time)) out.push(c);
    } catch (err) {
      console.warn("[cues]", layerId, err);
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
