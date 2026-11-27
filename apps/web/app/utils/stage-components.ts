import { defineAsyncComponent, type Component } from "vue";
import { loadProjectComponent, projectComponentInfo, projectComponents } from "~/utils/project-components";

/**
 * The catalogue of stageable components for component layers.
 *
 * Built from a glob rather than a hand-written list: a component dropped into
 * `app/components/stage/` shows up in the picker on its own, and a deleted one
 * stops being an option instead of becoming a broken entry.
 */
const STAGE_MODULES = import.meta.glob<{ default: Component }>(
  "../components/stage/*.vue",
);

export type StageComponentEntry = {
  /** File name without extension, e.g. `StageCard` — the value stored on the layer. */
  name: string;
  /** Spaced-out name for the picker. */
  label: string;
  load: () => Promise<{ default: Component }>;
  /** Lives in the project's `components/` folder (vs. built into the app). */
  project?: boolean;
};

/** `StageCard` → `Card`: drop the directory prefix, then space out the camel case. */
function humanize(name: string): string {
  return name
    .replace(/^Stage(?=[A-Z])/, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

const BUILT_IN_ENTRIES: StageComponentEntry[] = Object.entries(STAGE_MODULES)
  .map(([path, load]) => {
    const name = path.split("/").pop()?.replace(/\.vue$/, "") ?? "";
    return { name, label: humanize(name), load };
  })
  .filter((entry) => entry.name)
  .sort((a, b) => a.name.localeCompare(b.name));

/**
 * Every stageable component: the open project's own (`components/*.vue`)
 * first, then the built-in ones. A project component shadows a built-in one
 * of the same name. Reactive (reads `projectComponents`).
 */
export function stageComponentEntries(): StageComponentEntry[] {
  const own = projectComponents.value.map((c) => ({
    name: c.name,
    label: humanize(c.name),
    load: () => loadProjectComponent(c.name),
    project: true,
  }));
  const taken = new Set(own.map((e) => e.name));
  return [...own, ...BUILT_IN_ENTRIES.filter((e) => !taken.has(e.name))];
}

const componentCache = new Map<string, Component>();

/** Component loads in flight (renders wait until 0: cues register on mount). */
let pendingLoads = 0;
export const stageComponentLoadsPending = () => pendingLoads;
function tracked<T>(load: () => Promise<T>): () => Promise<T> {
  return () => {
    pendingLoads++;
    return load().finally(() => pendingLoads--);
  };
}

/** Resolve a stored component name to a mountable component, or null when it no longer exists. */
export function resolveStageComponent(name: string): Component | null {
  const own = projectComponentInfo(name);
  // Project components are keyed by file version: saving the .vue swaps in the new one.
  const key = own ? `project:${name}:${own.version}` : `builtin:${name}`;
  let component = componentCache.get(key);
  if (component) return component;
  const entry = own ? null : BUILT_IN_ENTRIES.find((candidate) => candidate.name === name);
  if (!own && !entry) return null;
  component = defineAsyncComponent({
    loader: tracked(own ? () => loadProjectComponent(name).then((m) => m.default) : () => entry!.load().then((m) => m.default)),
    onError(err, _retry, fail) {
      console.error(`[stage component] ${name}:`, err);
      fail();
    },
  });
  componentCache.set(key, component);
  return component;
}

/**
 * Picker options for the layer inspector. No empty "none" entry: reka-ui's
 * SelectItem rejects empty-string values, and new layers are seeded with the
 * first component anyway.
 */
export function stageComponentOptions(): { label: string; value: string }[] {
  return stageComponentEntries().map((entry) => ({ label: entry.label, value: entry.name }));
}

/** Default for freshly added component layers: the first staged component, if any. */
export function defaultStageComponentName(): string {
  return stageComponentEntries()[0]?.name ?? "";
}
