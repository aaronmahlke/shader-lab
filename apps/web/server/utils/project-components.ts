import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as nodeModule from "node:module";
import type * as SfcCompiler from "@vue/compiler-sfc";

// Loaded at runtime, not bundled: Nuxt inlines everything vue-ish, and the
// bundled compiler drags in dozens of optional template engines. Shipped in
// .output/server/node_modules via nitro.externals.traceInclude.
const SFC_SPEC = "@vue/compiler-sfc";
let sfcPromise: Promise<typeof SfcCompiler> | null = null;
function loadSfc(): Promise<typeof SfcCompiler> {
  sfcPromise ??= import(/* @vite-ignore */ SFC_SPEC) as Promise<typeof SfcCompiler>;
  return sfcPromise;
}
import { join } from "node:path";

/**
 * Project-level stage components: `<project>/components/*.vue`, compiled at
 * request time so they work in dev, the built server and the desktop app.
 *
 * Output is a function body for the browser runtime (utils/project-components):
 * imports become `__req("spec")` lookups, `export default` becomes
 * `__exports.default =`. TypeScript is stripped with Node's built-in stripper
 * (type annotations only, which is all a component needs).
 */

export type ProjectComponentInfo = { name: string; version: string };

export type CompiledProjectComponent = {
  name: string;
  version: string;
  code: string;
  /** Module specifiers the code asks for (the browser loads these first). */
  imports: string[];
  /** Compiled <style> blocks (scoped ones already rewritten). */
  css: string;
  /** `data-v-…` when any style is scoped. */
  scopeId: string | null;
  /** Class candidates for the browser's Tailwind pass. */
  candidates: string[];
};

const NAME_RE = /^[A-Za-z][\w-]*$/;

export function componentsDir(projectFolder: string): string {
  return join(projectFolder, "components");
}

export async function listProjectComponents(projectFolder: string): Promise<ProjectComponentInfo[]> {
  const dir = componentsDir(projectFolder);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: ProjectComponentInfo[] = [];
  for (const file of names) {
    if (!file.endsWith(".vue")) continue;
    const name = file.slice(0, -4);
    if (!NAME_RE.test(name)) continue;
    const s = await stat(join(dir, file)).catch(() => null);
    if (!s?.isFile()) continue;
    out.push({ name, version: `${Math.round(s.mtimeMs)}-${s.size}` });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const cache = new Map<string, CompiledProjectComponent>();

export async function compileProjectComponent(
  projectFolder: string,
  name: string,
): Promise<CompiledProjectComponent | null> {
  if (!NAME_RE.test(name)) return null;
  const file = join(componentsDir(projectFolder), `${name}.vue`);
  const s = await stat(file).catch(() => null);
  if (!s?.isFile()) return null;
  const version = `${Math.round(s.mtimeMs)}-${s.size}`;
  const key = `${file}|${version}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const source = await readFile(file, "utf8");
  const result = compileSfc(await loadSfc(), name, source, version);
  cache.set(key, result);
  return result;
}

function compileSfc(
  sfc: typeof SfcCompiler,
  name: string,
  source: string,
  version: string,
): CompiledProjectComponent {
  const { descriptor, errors } = sfc.parse(source, { filename: `${name}.vue` });
  if (errors.length) throw new Error(`${name}.vue: ${errors.map((e) => String(e)).join("; ")}`);

  const id = createHash("sha1").update(`${name}\n${source}`).digest("hex").slice(0, 8);
  const scoped = descriptor.styles.some((s) => s.scoped);
  const isTs = (descriptor.scriptSetup?.lang ?? descriptor.script?.lang) === "ts";

  let code: string;
  if (descriptor.script || descriptor.scriptSetup) {
    code = sfc.compileScript(descriptor, {
      id,
      inlineTemplate: true,
      templateOptions: { scoped, id: `data-v-${id}` } as never,
    }).content;
  } else {
    // Template-only component.
    const tpl = sfc.compileTemplate({
      id,
      source: descriptor.template?.content ?? "",
      filename: `${name}.vue`,
      scoped,
    });
    code = tpl.code.replace(/^export function render/m, "function render") + "\nexport default { render };";
  }
  if (isTs) code = stripTypes(code);

  const imports = new Set<string>();
  code = rewriteModule(code, imports);

  const css = descriptor.styles
    .map(
      (style) =>
        sfc.compileStyle({ source: style.content, filename: `${name}.vue`, id: `data-v-${id}`, scoped: style.scoped })
          .code,
    )
    .join("\n");

  return {
    name,
    version,
    code,
    imports: [...imports],
    css,
    scopeId: scoped ? `data-v-${id}` : null,
    candidates: classCandidates(source),
  };
}

function stripTypes(code: string): string {
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (c: string, o?: object) => string })
    .stripTypeScriptTypes;
  if (!strip) throw new Error("This runtime can't strip TypeScript (needs Node ≥ 22.13); use plain <script setup>.");
  return strip(code, { mode: "strip" });
}

/** `import … from "x"` → `const … = __req("x")`, `export default` → `__exports.default =`. */
function rewriteModule(code: string, imports: Set<string>): string {
  let out = code.replace(
    /^import\s+([\s\S]+?)\s+from\s+(['"])([^'"]+)\2;?[ \t]*$/gm,
    (_m, clause: string, _q: string, spec: string) => {
      imports.add(spec);
      const req = `__req(${JSON.stringify(spec)})`;
      const parts: string[] = [];
      let rest = clause.trim();
      const ns = rest.match(/\*\s+as\s+([\w$]+)/);
      const named = rest.match(/\{([\s\S]*)\}/);
      rest = rest.replace(/\*\s+as\s+[\w$]+/, "").replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
      if (rest) parts.push(`const ${rest} = ${req}.default;`);
      if (ns) parts.push(`const ${ns[1]} = ${req};`);
      if (named) {
        const fields = named[1]!
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("type "))
          .map((s) => s.replace(/\s+as\s+/, ": "));
        if (fields.length) parts.push(`const { ${fields.join(", ")} } = ${req};`);
      }
      return parts.join(" ");
    },
  );
  out = out.replace(/^import\s+(['"])([^'"]+)\1;?[ \t]*$/gm, ""); // side-effect imports: not supported, dropped
  out = out.replace(/^export\s+default\s+/m, "__exports.default = ");
  return out;
}

/** Everything that could be a class name (Tailwind ignores what isn't one). */
function classCandidates(source: string): string[] {
  const set = new Set<string>();
  for (const token of source.split(/[\s'"`<>{}]+/)) {
    const t = token.replace(/^[,;:(]+|[,;)]+$/g, "");
    if (t && t.length < 120) set.add(t);
    if (token && token !== t && token.length < 120) set.add(token);
  }
  return [...set];
}
