import { stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Local mode: modification time of every comp file of a project (ms), so
 * the editor notices edits made on disk (agents, git, another editor) and
 * reloads them.
 */
export default defineEventHandler(async (event) => {
  if (!isLocalMode()) return { comps: {} };
  const projectId = getRouterParam(event, "projectId") ?? "";
  const folder = /^[\w-]+$/.test(projectId) ? await projectPath(projectId) : null;
  if (!folder) return { comps: {} };
  const manifest = await readManifest(folder);
  const comps: Record<string, number> = {};
  for (const c of manifest?.compositions ?? []) {
    const s = await stat(join(folder, c.file)).catch(() => null);
    if (s) comps[c.id] = Math.round(s.mtimeMs);
  }
  // Project sound rules (agents edit sound-rules.json too).
  const rules = await stat(join(folder, "sound-rules.json")).catch(() => null);
  comps.__soundRules = rules ? Math.round(rules.mtimeMs) : 0;
  setHeader(event, "Cache-Control", "no-store");
  return { comps };
});
