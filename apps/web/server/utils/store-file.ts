import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { uuidv7 } from "uuidv7";
import type { CompositionMeta, ProjectStore, StoredComposition, StoredProject } from "./store";

/**
 * Local storage: every project is a folder.
 *
 *   my-video/
 *     shaderlab.json        project manifest (name, compositions)
 *     comps/<slug>.json     one CompositionConfig per composition (readable,
 *                           diffable, agent-editable)
 *     assets/               imported media (images, video)
 *     .shaderlab/           caches (thumbnails), safe to delete / gitignore
 *
 * `~/.shaderlab/projects.json` remembers which folders are open (recents).
 * Removing a project only forgets the folder; files are never deleted.
 */

export const MANIFEST = "shaderlab.json";

type ManifestComp = {
  id: string;
  name: string;
  file: string;
  sortIndex: number;
  createdAt: string;
  updatedAt: string;
  thumbnailUpdatedAt?: string | null;
};

export type ProjectManifest = {
  format: "shaderlab-project";
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  compositions: ManifestComp[];
};

type Registry = { projects: { id: string; path: string }[] };

const MEDIA_KEY_RE = /^local\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/;

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "comp";
}

function uniqueFile(manifest: ProjectManifest, name: string): string {
  const taken = new Set(manifest.compositions.map((c) => c.file));
  const base = slugify(name);
  let file = `comps/${base}.json`;
  for (let i = 2; taken.has(file); i++) file = `comps/${base}-${i}.json`;
  return file;
}

function registryPath() {
  return join(localHome(), "projects.json");
}

async function readRegistry(): Promise<Registry> {
  return (await readJson<Registry>(registryPath())) ?? { projects: [] };
}

async function writeRegistry(reg: Registry) {
  await writeJsonAtomic(registryPath(), reg);
}

/** Remember a project folder (most recent first). */
export async function registerProjectFolder(id: string, path: string) {
  const reg = await readRegistry();
  reg.projects = [{ id, path }, ...reg.projects.filter((p) => p.id !== id && p.path !== path)];
  await writeRegistry(reg);
}

async function projectPath(id: string): Promise<string | null> {
  const reg = await readRegistry();
  return reg.projects.find((p) => p.id === id)?.path ?? null;
}

export async function readManifest(folder: string): Promise<ProjectManifest | null> {
  const m = await readJson<ProjectManifest>(join(folder, MANIFEST));
  return m && m.format === "shaderlab-project" ? m : null;
}

/** Create a new project folder (must be empty or missing). */
export async function createProjectFolder(
  folder: string,
  input: { name?: string; compositionName?: string; data?: unknown },
): Promise<ProjectManifest> {
  if (existsSync(join(folder, MANIFEST))) {
    throw createError({ statusCode: 409, statusMessage: "Folder already contains a project" });
  }
  const now = new Date().toISOString();
  const manifest: ProjectManifest = {
    format: "shaderlab-project",
    version: 1,
    id: uuidv7(),
    name: input.name ?? basename(folder),
    createdAt: now,
    updatedAt: now,
    compositions: [],
  };
  const compName = input.compositionName ?? "Comp 1";
  const comp: ManifestComp = {
    id: uuidv7(),
    name: compName,
    file: uniqueFile(manifest, compName),
    sortIndex: 0,
    createdAt: now,
    updatedAt: now,
  };
  manifest.compositions.push(comp);
  await mkdir(join(folder, "assets"), { recursive: true });
  await mkdir(join(folder, "components"), { recursive: true });
  await writeJsonAtomic(join(folder, comp.file), input.data ?? emptyCompositionData());
  await writeJsonAtomic(join(folder, MANIFEST), manifest);
  await writeFile(join(folder, ".gitignore"), ".shaderlab/\n").catch(() => {});
  await registerProjectFolder(manifest.id, folder);
  return manifest;
}

/** Register an existing project folder; returns its manifest. */
export async function openProjectFolder(folder: string): Promise<ProjectManifest> {
  const manifest = await readManifest(folder);
  if (!manifest) throw createError({ statusCode: 404, statusMessage: "No shaderlab.json in that folder" });
  await registerProjectFolder(manifest.id, folder);
  return manifest;
}

/** A free folder name under the default projects dir. */
function freeFolder(name: string): string {
  const base = join(defaultProjectsDir(), name.replace(/[/\\:]/g, "-") || "Untitled");
  let folder = base;
  for (let i = 2; existsSync(folder); i++) folder = `${base} ${i}`;
  return folder;
}

function toProject(m: ProjectManifest): StoredProject {
  return {
    id: m.id,
    userId: LOCAL_USER.id,
    name: m.name,
    isPublic: false,
    createdAt: new Date(m.createdAt),
    updatedAt: new Date(m.updatedAt),
  };
}

function thumbUrl(c: ManifestComp) {
  return c.thumbnailUpdatedAt ? `/api/shaders/${c.id}/thumbnail?v=${new Date(c.thumbnailUpdatedAt).getTime()}` : null;
}

function toMeta(c: ManifestComp): CompositionMeta {
  return {
    id: c.id,
    name: c.name,
    sortIndex: c.sortIndex,
    thumbnailUrl: thumbUrl(c),
    thumbnailUpdatedAt: c.thumbnailUpdatedAt ? new Date(c.thumbnailUpdatedAt) : null,
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.updatedAt),
  };
}

function sortedComps(m: ProjectManifest) {
  return [...m.compositions].sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt.localeCompare(b.createdAt));
}

export function createFileStore(): ProjectStore {
  /** All registered projects that still exist on disk. */
  async function loadAll(): Promise<{ folder: string; manifest: ProjectManifest }[]> {
    const reg = await readRegistry();
    const out: { folder: string; manifest: ProjectManifest }[] = [];
    for (const p of reg.projects) {
      const manifest = await readManifest(p.path);
      if (manifest) out.push({ folder: p.path, manifest });
    }
    return out;
  }

  async function load(projectId: string) {
    const folder = await projectPath(projectId);
    if (!folder) return null;
    const manifest = await readManifest(folder);
    return manifest ? { folder, manifest } : null;
  }

  /** Find the project containing a composition id. */
  async function locateComp(compId: string) {
    for (const entry of await loadAll()) {
      const comp = entry.manifest.compositions.find((c) => c.id === compId);
      if (comp) return { ...entry, comp };
    }
    return null;
  }

  async function readComp(folder: string, projectId: string, c: ManifestComp): Promise<StoredComposition> {
    const data = (await readJson(join(folder, c.file))) ?? emptyCompositionData();
    return { ...toMeta(c), projectId, data };
  }

  async function save(folder: string, manifest: ProjectManifest) {
    manifest.updatedAt = new Date().toISOString();
    await writeJsonAtomic(join(folder, MANIFEST), manifest);
  }

  /** Media and thumbnails never escape the project folder. */
  function inside(folder: string, ...parts: string[]) {
    const p = resolve(folder, ...parts);
    if (!p.startsWith(resolve(folder))) throw createError({ statusCode: 400, statusMessage: "Invalid path" });
    return p;
  }

  return {
    async listProjects() {
      const all = await loadAll();
      return all
        .map(({ manifest }) => ({ ...toProject(manifest), compositions: sortedComps(manifest).map(toMeta) }))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },

    async getProject(id) {
      const entry = await load(id);
      return entry ? toProject(entry.manifest) : null;
    },

    async listCompositionMeta(projectId) {
      const entry = await load(projectId);
      return entry ? sortedComps(entry.manifest).map(toMeta) : [];
    },

    async createProject(_userId, input) {
      const folder = freeFolder(input.name ?? "Untitled");
      const manifest = await createProjectFolder(folder, input);
      const comp = await readComp(folder, manifest.id, manifest.compositions[0]!);
      return { project: toProject(manifest), comp };
    },

    async updateProject(id, input) {
      const entry = await load(id);
      if (!entry) throw createError({ statusCode: 404, statusMessage: "Project not found" });
      if (input.name !== undefined) entry.manifest.name = input.name;
      await save(entry.folder, entry.manifest);
      return toProject(entry.manifest);
    },

    async deleteProject(id) {
      // Forget the folder only — never delete user files.
      const reg = await readRegistry();
      reg.projects = reg.projects.filter((p) => p.id !== id);
      await writeRegistry(reg);
    },

    async findCompositionByAnyId(id) {
      const byComp = await locateComp(id);
      if (byComp) {
        return {
          project: toProject(byComp.manifest),
          comp: await readComp(byComp.folder, byComp.manifest.id, byComp.comp),
        };
      }
      const entry = await load(id);
      const first = entry && sortedComps(entry.manifest)[0];
      if (!entry || !first) return null;
      return { project: toProject(entry.manifest), comp: await readComp(entry.folder, entry.manifest.id, first) };
    },

    async createComposition(projectId, input) {
      const entry = await load(projectId);
      if (!entry) throw createError({ statusCode: 404, statusMessage: "Project not found" });
      const now = new Date().toISOString();
      const comp: ManifestComp = {
        id: uuidv7(),
        name: input.name,
        file: uniqueFile(entry.manifest, input.name),
        sortIndex: Math.max(-1, ...entry.manifest.compositions.map((c) => c.sortIndex)) + 1,
        createdAt: now,
        updatedAt: now,
      };
      await writeJsonAtomic(join(entry.folder, comp.file), input.data);
      entry.manifest.compositions.push(comp);
      await save(entry.folder, entry.manifest);
      return readComp(entry.folder, projectId, comp);
    },

    async updateComposition(compId, input) {
      const found = await locateComp(compId);
      if (!found) throw createError({ statusCode: 404, statusMessage: "Composition not found" });
      const comp = found.comp;
      if (input.name !== undefined) comp.name = input.name;
      if (input.sortIndex !== undefined) comp.sortIndex = input.sortIndex;
      if (input.data !== undefined) await writeJsonAtomic(join(found.folder, comp.file), input.data);
      comp.updatedAt = new Date().toISOString();
      await save(found.folder, found.manifest);
      return readComp(found.folder, found.manifest.id, comp);
    },

    async deleteComposition(compId) {
      const found = await locateComp(compId);
      if (!found) return;
      if (found.manifest.compositions.length <= 1) {
        throw createError({ statusCode: 400, statusMessage: "A project needs at least one composition" });
      }
      // Drop it from the manifest; the comp file stays on disk (recoverable).
      found.manifest.compositions = found.manifest.compositions.filter((c) => c.id !== compId);
      await save(found.folder, found.manifest);
    },

    async setThumbnail(compId, png) {
      const found = await locateComp(compId);
      if (!found) throw createError({ statusCode: 404, statusMessage: "Composition not found" });
      const file = inside(found.folder, ".shaderlab", "thumbnails", `${compId}.png`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, png);
      const at = new Date();
      found.comp.thumbnailUpdatedAt = at.toISOString();
      await writeJsonAtomic(join(found.folder, MANIFEST), found.manifest);
      return at;
    },

    async getThumbnail(compId) {
      const found = await locateComp(compId);
      if (!found) return null;
      try {
        return await readFile(inside(found.folder, ".shaderlab", "thumbnails", `${compId}.png`));
      } catch {
        return null;
      }
    },

    async putMedia(owner, file) {
      const entry = owner.projectId ? await load(owner.projectId) : null;
      const dir = entry ? join(entry.folder, "assets") : join(localHome(), "media");
      await mkdir(dir, { recursive: true });
      // Keep the original name (readable for agents), deduplicated.
      const stem = (file.name ? basename(file.name, extname(file.name)) : "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || String(Date.now());
      let name = `${stem}.${file.ext}`;
      for (let i = 2; existsSync(join(dir, name)); i++) name = `${stem}-${i}.${file.ext}`;
      await writeFile(join(dir, name), file.data);
      return `local/${entry ? entry.manifest.id : "_shared"}/${name}`;
    },

    async getMedia(key) {
      const [, projectId, name] = key.split("/");
      const dir = projectId === "_shared" ? join(localHome(), "media") : (() => null)();
      let base = dir;
      if (!base) {
        const entry = await load(projectId!);
        if (!entry) return null;
        base = join(entry.folder, "assets");
      }
      try {
        return await readFile(inside(base, name!));
      } catch {
        return null;
      }
    },

    isValidMediaKey(key) {
      return MEDIA_KEY_RE.test(key);
    },
  };
}
