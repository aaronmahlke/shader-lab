import { defineAsyncComponent, type Component } from "vue";

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
};

/** `StageCard` → `Card`: drop the directory prefix, then space out the camel case. */
function humanize(name: string): string {
  return name
    .replace(/^Stage(?=[A-Z])/, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export const STAGE_COMPONENT_ENTRIES: StageComponentEntry[] = Object.entries(STAGE_MODULES)
  .map(([path, load]) => {
    const name = path.split("/").pop()?.replace(/\.vue$/, "") ?? "";
    return { name, label: humanize(name), load };
  })
  .filter((entry) => entry.name)
  .sort((a, b) => a.name.localeCompare(b.name));

const componentCache = new Map<string, Component>();

/** Resolve a stored component name to a mountable component, or null when it no longer exists. */
export function resolveStageComponent(name: string): Component | null {
  const entry = STAGE_COMPONENT_ENTRIES.find((candidate) => candidate.name === name);
  if (!entry) return null;
  let component = componentCache.get(name);
  if (!component) {
    component = defineAsyncComponent(entry.load);
    componentCache.set(name, component);
  }
  return component;
}

/**
 * Picker options for the layer inspector. No empty "none" entry: reka-ui's
 * SelectItem rejects empty-string values, and new layers are seeded with the
 * first component anyway.
 */
export function stageComponentOptions(): { label: string; value: string }[] {
  return STAGE_COMPONENT_ENTRIES.map((entry) => ({ label: entry.label, value: entry.name }));
}

/** Default for freshly added component layers: the first staged component, if any. */
export function defaultStageComponentName(): string {
  return STAGE_COMPONENT_ENTRIES[0]?.name ?? "";
}
