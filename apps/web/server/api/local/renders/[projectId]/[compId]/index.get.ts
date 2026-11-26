import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Last stored render of a comp (?kind=video|audio): its metadata, or null. */
export default defineEventHandler(async (event) => {
  if (!isLocalMode()) return null;
  const projectId = getRouterParam(event, "projectId") ?? "";
  const compId = getRouterParam(event, "compId") ?? "";
  const kind = getQuery(event).kind === "audio" ? "audio" : "video";
  if (!/^[\w-]+$/.test(projectId) || !/^[\w-]+$/.test(compId)) return null;
  const folder = await projectPath(projectId);
  if (!folder) return null;
  for (const ext of kind === "audio" ? ["wav"] : ["mp4", "webm"]) {
    try {
      const meta = JSON.parse(await readFile(join(folder, ".shaderlab", "renders", `${compId}.${ext}.json`), "utf8"));
      return { ...meta, url: `/api/local/renders/${projectId}/${compId}/file?ext=${ext}` };
    } catch {}
  }
  return null;
});
