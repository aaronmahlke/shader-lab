import { and, asc, count, desc, eq } from "drizzle-orm";
import { compositions, projects } from "../database/schema";
import type { StoredCompositionMeta, ProjectStore, StoredComposition, StoredProject } from "./store";

const MEDIA_KEY_RE = /^uploads\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** Hosted storage: Postgres rows + S3 objects (thumbnails, uploads). */
export function createDbStore(): ProjectStore {
  const db = () => useDrizzle();

  const compMeta = {
    id: compositions.id,
    name: compositions.name,
    sortIndex: compositions.sortIndex,
    thumbnailUrl: compositions.thumbnailUrl,
    thumbnailUpdatedAt: compositions.thumbnailUpdatedAt,
    createdAt: compositions.createdAt,
    updatedAt: compositions.updatedAt,
  };

  return {
    async listProjects(userId) {
      const rows = await db()
        .select({ project: projects, comp: compMeta })
        .from(projects)
        .innerJoin(compositions, eq(compositions.projectId, projects.id))
        .where(eq(projects.userId, userId))
        .orderBy(desc(projects.updatedAt), asc(compositions.sortIndex), asc(compositions.createdAt));
      const byProject = new Map<string, StoredProject & { compositions: StoredCompositionMeta[] }>();
      for (const row of rows) {
        let entry = byProject.get(row.project.id);
        if (!entry) {
          entry = { ...row.project, compositions: [] };
          byProject.set(row.project.id, entry);
        }
        entry.compositions.push(row.comp);
      }
      return [...byProject.values()];
    },

    async getProject(id) {
      const [project] = await db().select().from(projects).where(eq(projects.id, id)).limit(1);
      return project ?? null;
    },

    async listCompositionMeta(projectId) {
      return db()
        .select(compMeta)
        .from(compositions)
        .where(eq(compositions.projectId, projectId))
        .orderBy(asc(compositions.sortIndex), asc(compositions.createdAt));
    },

    async createProject(userId, input) {
      const [project] = await db()
        .insert(projects)
        .values({ userId, name: input.name ?? "Untitled", isPublic: input.isPublic ?? false })
        .returning();
      const [comp] = await db()
        .insert(compositions)
        .values({
          projectId: project!.id,
          name: input.compositionName ?? "Comp 1",
          sortIndex: 0,
          data: input.data ?? emptyCompositionData(),
        })
        .returning();
      return { project: project!, comp: comp as StoredComposition };
    },

    async updateProject(id, input) {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.isPublic !== undefined) updates.isPublic = input.isPublic;
      const [updated] = await db().update(projects).set(updates).where(eq(projects.id, id)).returning();
      return updated!;
    },

    async deleteProject(id) {
      await db().delete(projects).where(eq(projects.id, id));
    },

    async findCompositionByAnyId(id) {
      const [byComp] = await db()
        .select({ project: projects, comp: compositions })
        .from(compositions)
        .innerJoin(projects, eq(compositions.projectId, projects.id))
        .where(eq(compositions.id, id))
        .limit(1);
      if (byComp) return byComp as { project: StoredProject; comp: StoredComposition };
      const [byProject] = await db()
        .select({ project: projects, comp: compositions })
        .from(compositions)
        .innerJoin(projects, eq(compositions.projectId, projects.id))
        .where(eq(projects.id, id))
        .orderBy(asc(compositions.sortIndex), asc(compositions.createdAt))
        .limit(1);
      return (byProject as { project: StoredProject; comp: StoredComposition }) ?? null;
    },

    async createComposition(projectId, input) {
      const [last] = await db()
        .select({ sortIndex: compositions.sortIndex })
        .from(compositions)
        .where(eq(compositions.projectId, projectId))
        .orderBy(desc(compositions.sortIndex))
        .limit(1);
      const [comp] = await db()
        .insert(compositions)
        .values({ projectId, name: input.name, sortIndex: (last?.sortIndex ?? -1) + 1, data: input.data })
        .returning();
      return comp as StoredComposition;
    },

    async updateComposition(compId, input) {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.data !== undefined) updates.data = input.data;
      if (input.sortIndex !== undefined) updates.sortIndex = input.sortIndex;
      const [updated] = await db()
        .update(compositions)
        .set(updates)
        .where(eq(compositions.id, compId))
        .returning();
      await db().update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, updated!.projectId));
      return updated as StoredComposition;
    },

    async deleteComposition(compId) {
      const [comp] = await db().select().from(compositions).where(eq(compositions.id, compId)).limit(1);
      if (!comp) return;
      const [{ value: total }] = await db()
        .select({ value: count() })
        .from(compositions)
        .where(eq(compositions.projectId, comp.projectId));
      if (Number(total) <= 1) {
        throw createError({ statusCode: 400, statusMessage: "A project needs at least one composition" });
      }
      await db().delete(compositions).where(and(eq(compositions.id, compId)));
    },

    async setThumbnail(compId, png) {
      await useS3().putObject(`thumbnails/${compId}.png`, png, "image/png");
      const at = new Date();
      await db()
        .update(compositions)
        .set({ thumbnailUrl: `/api/shaders/${compId}/thumbnail?v=${at.getTime()}`, thumbnailUpdatedAt: at })
        .where(eq(compositions.id, compId));
      return at;
    },

    async getThumbnail(compId) {
      try {
        return await useS3().getObject(`thumbnails/${compId}.png`);
      } catch {
        return null;
      }
    },

    async putMedia(owner, file) {
      const key = `uploads/${owner.userId}/${Date.now()}.${file.ext}`;
      try {
        await useS3().putObject(key, file.data, file.mime);
      } catch (err) {
        console.error(`[uploads] putObject failed for ${key}:`, err);
        throw createError({ statusCode: 502, statusMessage: "Media storage is unavailable" });
      }
      return key;
    },

    async getMedia(key) {
      try {
        return await useS3().getObject(key);
      } catch {
        return null;
      }
    },

    isValidMediaKey(key) {
      return MEDIA_KEY_RE.test(key);
    },
  };
}
