import { readdir, readFile, realpath, stat } from "node:fs/promises";
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
import { join, posix } from "node:path";

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

async function componentRoot(folder: string) {
  const dir = componentsDir(await realpath(folder));
  return (await realpath(dir).catch(() => null)) === dir ? dir : null;
}

export async function listProjectComponents(projectFolder: string): Promise<ProjectComponentInfo[]> {
  const root = await componentRoot(projectFolder);
  if (!root) return [];
  const names: string[] = [];
  // Helpers aren't picker entries, but saving one must invalidate its parents.
  const revisions: string[] = [];
  async function scan(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await scan(file);
      if (!entry.isFile() || !entry.name.endsWith(".vue")) continue;
      const s = await stat(file).catch(() => null);
      if (!s) continue;
      revisions.push(JSON.stringify([file, s.mtimeMs, s.size]));
      const name = entry.name.slice(0, -4);
      if (dir === root && NAME_RE.test(name)) names.push(name);
    }
  }
  await scan(root);
  const version = createHash("sha1").update(JSON.stringify(revisions.sort())).digest("hex");
  return names.sort((a, b) => a.localeCompare(b)).map(name => ({ name, version }));
}

type LocalModule = CompiledProjectComponent & { local: Record<string, string> };

export async function compileProjectComponent(projectFolder: string, name: string) {
  if (!NAME_RE.test(name)) return null;
  const root = await componentRoot(projectFolder);
  if (!root) return null;
  const modules = new Map<string, LocalModule>();
  const visiting = new Set<string>();
  async function visit(id: string): Promise<boolean> {
    if (modules.has(id)) return true;
    if (visiting.has(id)) throw new Error("Circular component import: " + [...visiting, id].join(" -> "));
    const file = join(root!, id);
    const actual = await realpath(file).catch(() => null);
    if (!actual) return false;
    if (actual !== file) throw new Error("Symlinked component not supported: " + id);
    if (!(await stat(actual)).isFile()) return false;
    visiting.add(id);
    const source = await readFile(actual, "utf8");
    const version = createHash("sha1").update(source).digest("hex");
    const compiled = compileSfc(await loadSfc(), id.slice(0, -4), source, version);
    const local: Record<string, string> = {};
    for (const spec of compiled.imports) {
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
      const child = posix.join(posix.dirname(id), spec);
      if (!spec.endsWith(".vue") || /[^\w./ -]/.test(spec) || child.startsWith("../")) {
        throw new Error(id + ": invalid local component import " + spec);
      }
      if (!(await visit(child))) throw new Error(id + ": cannot find " + spec);
      local[spec] = child;
    }
    visiting.delete(id);
    modules.set(id, { ...compiled, local });
    return true;
  }
  const entry = name + ".vue";
  return await visit(entry) ? { entry, modules: [...modules.values()] } : null;
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
