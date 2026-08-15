import type { CompositionMeta, ProjectWithCompositions } from "#shared/types/project";

/**
 * Shared project + composition list for the editor: the project panel, the
 * open-comp tab strip, and the inspector's Composition select all read the
 * same `useState` slot, so a single refresh() after create/rename/duplicate/
 * delete updates every consumer at once (no triple-fetching).
 *
 * Only one project is open per editor page, so a single slot is enough; the
 * stored project id is checked against the caller's so a stale project from a
 * previous session never leaks into another project's editor.
 */
export function useProjectCompositions(projectId: MaybeRefOrGetter<string | null>) {
  const state = useState<ProjectWithCompositions | null>("editor-project-comps", () => null);

  const project = computed(() => {
    const id = toValue(projectId);
    return id && state.value?.id === id ? state.value : null;
  });

  const comps = computed<CompositionMeta[]>(() => project.value?.compositions ?? []);

  async function refresh(): Promise<void> {
    const id = toValue(projectId);
    if (!id) return;
    try {
      state.value = await $fetch<ProjectWithCompositions>(`/api/projects/${id}`);
    } catch {
      // Silent: consumers keep the last known list.
    }
  }

  return { project, comps, refresh };
}
