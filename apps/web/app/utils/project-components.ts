import * as Vue from "vue";
import { shallowRef, type Component } from "vue";
import { useStageTime } from "~/composables/use-stage-time";

/**
 * Browser side of project-level components (`<project>/components/*.vue`).
 *
 * The server compiles each file to a function body (see
 * server/utils/project-components.ts); here we load the modules it imports,
 * run Tailwind over its classes, inject its CSS and evaluate it. Nuxt-style
 * auto-imports work: every `vue` export plus `useStageTime`.
 */

export type ProjectComponentInfo = { name: string; version: string };

type Compiled = ProjectComponentInfo & {
  code: string;
  imports: string[];
  css: string;
  scopeId: string | null;
  candidates: string[];
};

/** Modules project components may import. */
const MODULES: Record<string, () => Promise<unknown>> = {
  vue: async () => Vue,
  "@heroicons/vue/16/solid": () => import("@heroicons/vue/16/solid"),
  "@heroicons/vue/20/solid": () => import("@heroicons/vue/20/solid"),
  "@heroicons/vue/24/solid": () => import("@heroicons/vue/24/solid"),
  "@heroicons/vue/24/outline": () => import("@heroicons/vue/24/outline"),
  "@vueuse/core": () => import("@vueuse/core"),
  "#shaderlab": async () => ({ useStageTime }),
};

/** Components of the open project; reactive so pickers and panels update. */
export const projectComponents = shallowRef<ProjectComponentInfo[]>([]);
let currentProject: string | null = null;

export async function loadProjectComponents(projectId: string | null): Promise<void> {
  currentProject = projectId;
  if (!projectId) {
    projectComponents.value = [];
    return;
  }
  try {
    const list = await $fetch<ProjectComponentInfo[]>(`/api/projects/${projectId}/components`);
    if (currentProject !== projectId) return;
    // Keep the array identity when nothing changed (no needless re-renders).
    const same =
      list.length === projectComponents.value.length &&
      list.every((c, i) => c.name === projectComponents.value[i]?.name && c.version === projectComponents.value[i]?.version);
    if (!same) projectComponents.value = list;
  } catch {
    if (currentProject === projectId) projectComponents.value = [];
  }
}

export function projectComponentInfo(name: string): ProjectComponentInfo | null {
  return projectComponents.value.find((c) => c.name === name) ?? null;
}

const AUTO_IMPORTS: Record<string, unknown> = (() => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(Vue)) if (/^[A-Za-z_$][\w$]*$/.test(k)) out[k] = v;
  out.useStageTime = useStageTime;
  return out;
})();

/** Load + evaluate one project component (throws with a readable message). */
export async function loadProjectComponent(name: string): Promise<{ default: Component }> {
  const projectId = currentProject;
  if (!projectId) throw new Error("No project open");
  let compiled: Compiled;
  try {
    compiled = await $fetch<Compiled>(`/api/projects/${projectId}/components/${encodeURIComponent(name)}`);
  } catch (err) {
    const msg = (err as { data?: { statusMessage?: string }; message?: string }).data?.statusMessage;
    throw new Error(`${name}.vue: ${msg ?? (err as Error).message}`);
  }

  const mods: Record<string, unknown> = {};
  for (const spec of compiled.imports) {
    const load = MODULES[spec];
    if (!load) throw new Error(`${name}.vue imports "${spec}", which project components can't use.`);
    mods[spec] = await load();
  }

  injectStyle(name, compiled.css + "\n" + (await utilitiesFor(compiled.candidates)));

  const exports: { default?: Component } = {};
  const names = Object.keys(AUTO_IMPORTS);
  // The block scope lets the module shadow auto-import names with its own imports.
  // eslint-disable-next-line no-new-func
  const run = new Function("__req", "__exports", ...names, `{\n${compiled.code}\n}\n//# sourceURL=project-components/${name}.vue`);
  run((spec: string) => mods[spec], exports, ...names.map((n) => AUTO_IMPORTS[n]));
  const component = exports.default as (Component & { __scopeId?: string }) | undefined;
  if (!component) throw new Error(`${name}.vue has no default export`);
  if (compiled.scopeId) component.__scopeId = compiled.scopeId;
  return { default: component };
}

function injectStyle(name: string, css: string) {
  const id = `project-component-style-${name}`;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

// --- Tailwind, in the browser, over the app's own theme -----------------------

type TwCompiler = { build(candidates: string[]): string };
let twCompiler: Promise<TwCompiler> | null = null;

function compiler(): Promise<TwCompiler> {
  twCompiler ??= (async () => {
    const [{ compile }, sources] = await Promise.all([
      import("tailwindcss"),
      import("virtual:shaderlab-tw-sources").then((m) => m.default as TwSources),
    ]);
    const dir = (p: string) => p.slice(0, p.lastIndexOf("/"));
    return compile(`@import ${JSON.stringify(sources.entry)};`, {
      base: dir(sources.entry),
      loadStylesheet: async (id: string, base: string) => {
        const path = id === sources.entry ? id : sources.links[`${base}\n${id}`];
        if (!path || sources.files[path] === undefined) return { path: id, base, content: "" };
        return { path, base: dir(path), content: sources.files[path]! };
      },
    }) as Promise<TwCompiler>;
  })();
  return twCompiler;
}

type TwSources = { entry: string; files: Record<string, string>; links: Record<string, string> };

/** Utility CSS for the candidates (theme vars + utilities only; the app already has base styles). */
async function utilitiesFor(candidates: string[]): Promise<string> {
  if (!candidates.length) return "";
  try {
    const css = (await compiler()).build(candidates);
    return topLevelBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ""))
      .filter((b) => /^@layer (theme|utilities|properties)\s*\{|^@property\b/.test(b))
      .join("\n");
  } catch (err) {
    console.warn("[project components] Tailwind failed", err);
    return "";
  }
}

function topLevelBlocks(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        out.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      out.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return out;
}
