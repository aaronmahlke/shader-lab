import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";

/**
 * Local mode: import a zipped project (multipart field "file").
 *
 * Unpacks into a free folder under the projects dir (named after the
 * project), registers it and returns its first comp. A zip of the folder
 * itself or of its contents both work: everything is taken relative to
 * the folder holding shaderlab.json. When that project id is already open
 * from another folder, the copy gets a fresh id (media URLs embed it).
 */
export default defineEventHandler(async (event) => {
  if (!isLocalMode()) throw createError({ statusCode: 404 });
  await requireUser(event);

  const form = await readMultipartFormData(event);
  const file = form?.find((p) => p.name === "file" && p.data);
  if (!file?.data) throw createError({ statusCode: 400, statusMessage: "Missing zip file" });

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(file.data));
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Not a valid zip file" });
  }

  // Root = the shallowest folder with a shaderlab.json (ignores macOS junk).
  const manifests = Object.keys(entries)
    .filter((p) => (p === MANIFEST || p.endsWith(`/${MANIFEST}`)) && !p.startsWith("__MACOSX/"))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  if (!manifests.length) throw createError({ statusCode: 400, statusMessage: "No shaderlab.json in that zip" });
  const prefix = manifests[0]!.slice(0, -MANIFEST.length);

  let manifest: ProjectManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(entries[manifests[0]!]));
  } catch {
    throw createError({ statusCode: 400, statusMessage: "shaderlab.json is not valid JSON" });
  }
  if (manifest?.format !== "shaderlab-project") {
    throw createError({ statusCode: 400, statusMessage: "Not a Shader Lab project" });
  }

  // Name: the zipped folder, else the zip's file name, else the manifest.
  const zippedFolder = prefix.replace(/\/$/, "").split("/").pop();
  const folderName = (zippedFolder || file.filename?.replace(/\.zip$/i, "") || manifest.name || "Imported").replace(/[/\\:]/g, "-");
  const base = join(defaultProjectsDir(), folderName);
  let folder = base;
  for (let i = 2; existsSync(folder); i++) folder = `${base} ${i}`;

  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(prefix) || path.endsWith("/")) continue;
    const rel = path.slice(prefix.length);
    if (!rel || rel.startsWith("__MACOSX/") || rel.split("/").some((s) => s === ".DS_Store" || s === ".shaderlab")) continue;
    const target = normalize(join(folder, rel));
    // Zip-slip guard: nothing may land outside the new folder.
    if (!target.startsWith(folder + sep)) {
      throw createError({ statusCode: 400, statusMessage: `Unsafe path in zip: ${rel}` });
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  // Same project already open elsewhere: give the copy its own project and
  // comp ids (media URLs and nested-comp refs embed them), so both coexist.
  const existing = await projectPath(manifest.id);
  if (existing && existing !== folder && existsSync(join(existing, MANIFEST))) {
    const ids = new Map<string, string>([[manifest.id, randomUUID()]]);
    for (const c of manifest.compositions ?? []) ids.set(c.id, randomUUID());
    const rewrite = async (p: string) => {
      let text = await readFile(p, "utf8");
      for (const [from, to] of ids) if (text.includes(from)) text = text.split(from).join(to);
      await writeFile(p, text);
    };
    await rewrite(join(folder, MANIFEST));
    const comps = join(folder, "comps");
    if (existsSync(comps)) {
      for (const f of await readdir(comps)) if (f.endsWith(".json")) await rewrite(join(comps, f));
    }
  }

  const opened = await openProjectFolder(folder);
  return {
    id: opened.id,
    name: opened.name,
    folder,
    firstCompositionId: opened.compositions[0]?.id ?? null,
  };
});
