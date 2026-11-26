import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * `virtual:shaderlab-tw-sources`: the app's Tailwind entry and every
 * stylesheet it imports, so the browser can run Tailwind for project
 * components (their classes aren't in the app's build-time scan).
 *
 * Exports `{ entry, files, links }`: `files[path]` is the content,
 * `links[base + "\n" + id]` resolves an `@import` the way the build does.
 */
const ID = "virtual:shaderlab-tw-sources";
const RESOLVED = "\0" + ID;

export function twSourcesPlugin(opts: { entry: string; aliases: Record<string, string> }): Plugin {
  const require = createRequire(import.meta.url);
  const twDir = dirname(require.resolve("tailwindcss/package.json"));

  function resolveImport(id: string, base: string): string | null {
    if (opts.aliases[id]) return opts.aliases[id]!;
    if (id === "tailwindcss") return resolve(twDir, "index.css");
    if (id.startsWith("tailwindcss/")) {
      const p = resolve(twDir, id.slice("tailwindcss/".length));
      return p.endsWith(".css") ? p : `${p}.css`;
    }
    if (isAbsolute(id)) return id;
    if (id.startsWith(".")) return resolve(base, id);
    return null;
  }

  function collect() {
    const files: Record<string, string> = {};
    const links: Record<string, string> = {};
    const walk = (path: string) => {
      if (files[path] !== undefined || !existsSync(path)) return;
      // Drop @source: the browser pass only builds the candidates it's given.
      const content = readFileSync(path, "utf8").replace(/^@source\s+[^;]+;\s*$/gm, "");
      files[path] = content;
      for (const m of content.matchAll(/@(?:import|reference)\s+(['"])([^'"]+)\1/g)) {
        const target = resolveImport(m[2]!, dirname(path));
        if (!target) continue;
        links[`${dirname(path)}\n${m[2]}`] = target;
        walk(target);
      }
    };
    walk(opts.entry);
    return { entry: opts.entry, files, links };
  }

  return {
    name: "shaderlab:tw-sources",
    resolveId(id) {
      return id === ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const data = collect();
      for (const f of Object.keys(data.files)) this.addWatchFile(f);
      return `export default ${JSON.stringify(data)};`;
    },
  };
}
