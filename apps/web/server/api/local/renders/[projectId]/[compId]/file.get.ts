import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The stored render file itself (?ext=mp4|webm|wav). */
export default defineEventHandler(async (event) => {
  if (!isLocalMode()) throw createError({ statusCode: 404 });
  const projectId = getRouterParam(event, "projectId") ?? "";
  const compId = getRouterParam(event, "compId") ?? "";
  const ext = String(getQuery(event).ext ?? "mp4");
  if (!/^[\w-]+$/.test(projectId) || !/^[\w-]+$/.test(compId) || !["mp4", "webm", "wav"].includes(ext)) {
    throw createError({ statusCode: 400 });
  }
  const folder = await projectPath(projectId);
  if (!folder) throw createError({ statusCode: 404 });
  const data = await readFile(join(folder, ".shaderlab", "renders", `${compId}.${ext}`)).catch(() => null);
  if (!data) throw createError({ statusCode: 404 });
  setHeader(event, "Content-Type", ext === "wav" ? "audio/wav" : `video/${ext}`);
  setHeader(event, "Cache-Control", "no-store");
  return data;
});
