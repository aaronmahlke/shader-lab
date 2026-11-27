import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** Save project sound rules; an empty list removes the file. */
export default defineEventHandler(async (event) => {
  await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id || !isLocalMode()) throw createError({ statusCode: 404 });
  const folder = await projectPath(id);
  if (!folder) throw createError({ statusCode: 404, statusMessage: "Project not found" });
  const body = await readBody<{ rules?: unknown }>(event);
  if (!Array.isArray(body?.rules)) throw createError({ statusCode: 400, statusMessage: "rules[] required" });
  const file = join(folder, "sound-rules.json");
  if (!body.rules.length) await rm(file, { force: true });
  else await writeFile(file, JSON.stringify({ rules: body.rules }, null, 2) + "\n");
  return { ok: true, count: body.rules.length };
});
