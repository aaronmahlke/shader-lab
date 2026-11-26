import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Local mode: store a finished render in the project's `.shaderlab/renders/`
 * (gitignored): `<compId>.<ext>` + `<compId>.<ext>.json` (what it is: comp,
 * frames, fps, size, visual fingerprint…). The editor reuses the video when
 * only the audio changed; the CLI copies it to --out.
 * Multipart: projectId, compId, meta (JSON), file.
 */
export default defineEventHandler(async (event) => {
  if (!isLocalMode()) throw createError({ statusCode: 404 });
  const form = await readMultipartFormData(event);
  const field = (name: string) => form?.find((p) => p.name === name)?.data.toString() ?? "";
  const projectId = field("projectId");
  const compId = field("compId");
  const file = form?.find((p) => p.name === "file" && p.data);
  if (!/^[\w-]+$/.test(projectId) || !/^[\w-]+$/.test(compId) || !file?.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing projectId, compId or file" });
  }
  const folder = await projectPath(projectId);
  if (!folder) throw createError({ statusCode: 404, statusMessage: "Project not found" });
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(field("meta") || "{}");
  } catch {}
  const ext = (meta.kind === "audio" ? "wav" : String(meta.container ?? "mp4")).replace(/[^a-z0-9]/gi, "");
  const dir = join(folder, ".shaderlab", "renders");
  await mkdir(dir, { recursive: true });
  const name = `${compId}.${ext}`;
  await writeFile(join(dir, name), file.data);
  const record = { ...meta, file: name, bytes: file.data.length, savedAt: new Date().toISOString() };
  await writeFile(join(dir, `${name}.json`), JSON.stringify(record, null, 2));
  return { ...record, path: join(dir, name) };
});
