/**
 * The set of compositions open as tabs above the timeline, persisted per
 * project as an ordered array of comp ids. The tab strip is the owner: it
 * loads the set on mount, always merges the active comp in, and prunes ids
 * of deleted comps. Other components (project panel) only need the helpers
 * to drop a comp from the set when they delete it.
 */
export function openCompsStorageKey(projectId: string): string {
  return `shader-lab:open-comps:${projectId}`;
}

export function loadOpenCompIds(projectId: string): string[] {
  if (import.meta.server) return [];
  try {
    const raw = window.localStorage.getItem(openCompsStorageKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

export function saveOpenCompIds(projectId: string, ids: string[]): void {
  if (import.meta.server) return;
  try {
    window.localStorage.setItem(openCompsStorageKey(projectId), JSON.stringify(ids));
  } catch {
    // Quota/privacy-mode errors: the open set just resets next session.
  }
}

/** Remove one comp id from the stored open set (e.g. after deleting a comp). */
export function removeOpenCompId(projectId: string, compId: string): void {
  saveOpenCompIds(
    projectId,
    loadOpenCompIds(projectId).filter((id) => id !== compId),
  );
}
