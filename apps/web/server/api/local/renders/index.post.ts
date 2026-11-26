import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Local mode: store a finished render in the project's `.shaderlab/renders/`
 * (gitignored): `<compId>.<ext>` + `<compId>.<ext>.json` (what it is: comp,
 * frames, fps, size, visual fingerprint…). The editor reuses the video when
 * only the audio changed; the CLI copies it to --out.
 *
 * Raw body = the file, streamed straight to disk (4K60 renders are hundreds
 * of MB; multipart parsing buffered all of it and failed). Query: projectId,
 * compId; header x-render-meta: the meta JSON (URI-encoded).
 */
export default defineEventHandler(async (event) => {
  if (!isLocalMode()) throw createError({ statusCode: 404 });
  const q = getQuery(event);
  const projectId = String(q.projectId ?? "");
  const compId = String(q.compId ?? "");
  if (!/^[\w-]+$/.test(projectId) || !/^[\w-]+$/.test(compId)) {
    throw createError({ statusCode: 400, statusMessage: "Missing projectId or compId" });
  }
  const folder = await projectPath(projectId);
  if (!folder) throw createError({ statusCode: 404, statusMessage: "Project not found" });
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(decodeURIComponent(getHeader(event, "x-render-meta") ?? "") || "{}");
  } catch {}
  const ext = (meta.kind === "audio" ? "wav" : String(meta.container ?? "mp4")).replace(/[^a-z0-9]/gi, "");
  const dir = join(folder, ".shaderlab", "renders");
  await mkdir(dir, { recursive: true });
  const name = `${compId}.${ext}`;
  const tmp = join(dir, `.${name}.part`);
  await pipeline(event.node.req, createWriteStream(tmp));
  const bytes = (await stat(tmp)).size;
  if (!bytes) throw createError({ statusCode: 400, statusMessage: "Empty file" });
  await rename(tmp, join(dir, name));
  const record = { ...meta, file: name, bytes, savedAt: new Date().toISOString() };
  await writeFile(join(dir, `${name}.json`), JSON.stringify(record, null, 2));
  return { ...record, path: join(dir, name) };
});
