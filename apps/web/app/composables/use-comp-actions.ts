import type { CompositionMeta } from "#shared/types/project";
import { removeOpenCompId } from "~/utils/open-comps";

/** Create / duplicate / rename / delete comps (shared by tabs and the project panel). */
export function useCompActions(projectId: MaybeRefOrGetter<string>, activeCompId: MaybeRefOrGetter<string | null>) {
  const { comps, refresh } = useProjectCompositions(projectId);
  const busy = ref(false);
  const base = () => `/api/projects/${toValue(projectId)}/compositions`;

  async function create(open = true) {
    if (busy.value) return;
    busy.value = true;
    try {
      const created = await $fetch<CompositionMeta>(base(), {
        method: "POST",
        body: { name: `Comp ${comps.value.length + 1}` },
      });
      await refresh();
      if (open) await navigateTo(`/shader/${created.id}`);
    } catch (e) {
      console.error("Failed to create composition:", e);
    } finally {
      busy.value = false;
    }
  }

  async function duplicate(comp: CompositionMeta) {
    if (busy.value) return;
    busy.value = true;
    try {
      const created = await $fetch<CompositionMeta>(base(), {
        method: "POST",
        body: { duplicateOf: comp.id },
      });
      await refresh();
      await navigateTo(`/shader/${created.id}`);
    } catch (e) {
      console.error("Failed to duplicate composition:", e);
    } finally {
      busy.value = false;
    }
  }

  async function remove(comp: CompositionMeta) {
    try {
      await $fetch(`${base()}/${comp.id}`, { method: "DELETE" });
    } catch (e) {
      // 400 = last remaining composition; menus hide Delete then.
      console.warn("Failed to delete composition:", e);
      return;
    }
    removeOpenCompId(toValue(projectId), comp.id);
    const next = comps.value.find((c) => c.id !== comp.id);
    await refresh();
    if (comp.id === toValue(activeCompId) && next) await navigateTo(`/shader/${next.id}`);
  }

  async function rename(comp: CompositionMeta, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === comp.name) return;
    try {
      await $fetch(`${base()}/${comp.id}`, { method: "PATCH", body: { name: trimmed } });
    } catch (e) {
      console.error("Failed to rename composition:", e);
    }
    await refresh();
  }

  return { comps, refresh, busy, create, duplicate, remove, rename };
}
