import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Project sound rules (`<project>/sound-rules.json`, a kit for every comp); local mode only. */
export default defineEventHandler(async (event) => {
  await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id || !isLocalMode()) return { rules: [] };
  const folder = await projectPath(id);
  if (!folder) return { rules: [] };
  setHeader(event, "Cache-Control", "no-store");
  try {
    const data = JSON.parse(await readFile(join(folder, "sound-rules.json"), "utf8"));
    return { rules: Array.isArray(data?.rules) ? data.rules : [] };
  } catch {
    return { rules: [] };
  }
});
