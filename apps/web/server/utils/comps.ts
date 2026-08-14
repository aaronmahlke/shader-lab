import { and, asc, eq } from "drizzle-orm";
import { compositions, projects } from "../database/schema";

export type ProjectRow = typeof projects.$inferSelect;
export type CompositionRow = typeof compositions.$inferSelect;

export type CompWithProject = { project: ProjectRow; comp: CompositionRow };

/**
 * Resolve a composition by composition id OR project id (first comp).
 * Migrated legacy documents share one id for both, so old /shader/<id> URLs
 * hit either path.
 */
export async function findCompositionByAnyId(
  db: ReturnType<typeof useDrizzle>,
  id: string,
): Promise<CompWithProject | null> {
  const [byComp] = await db
    .select({ project: projects, comp: compositions })
    .from(compositions)
    .innerJoin(projects, eq(compositions.projectId, projects.id))
    .where(eq(compositions.id, id))
    .limit(1);
  if (byComp) return byComp;

  const [byProject] = await db
    .select({ project: projects, comp: compositions })
    .from(compositions)
    .innerJoin(projects, eq(compositions.projectId, projects.id))
    .where(eq(projects.id, id))
    .orderBy(asc(compositions.sortIndex), asc(compositions.createdAt))
    .limit(1);
  return byProject ?? null;
}

/** The comp + project pair when the given user owns it, else null. */
export async function findOwnedComposition(
  db: ReturnType<typeof useDrizzle>,
  userId: string,
  id: string,
): Promise<CompWithProject | null> {
  const found = await findCompositionByAnyId(db, id);
  if (!found || found.project.userId !== userId) return null;
  return found;
}

/** The project when the given user owns it, else null. */
export async function findOwnedProject(
  db: ReturnType<typeof useDrizzle>,
  userId: string,
  projectId: string,
): Promise<ProjectRow | null> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return project ?? null;
}

/**
 * Legacy shader-document shape (comp + owning project flattened) so the
 * pre-project editor and dashboard keep working against the new tables.
 */
export function toShaderShape(pair: CompWithProject) {
  const { project, comp } = pair;
  return {
    id: comp.id,
    projectId: project.id,
    userId: project.userId,
    name: project.name,
    data: comp.data,
    isPublic: project.isPublic,
    thumbnailUrl: comp.thumbnailUrl,
    thumbnailUpdatedAt: comp.thumbnailUpdatedAt,
    createdAt: comp.createdAt,
    updatedAt: comp.updatedAt,
  };
}

/** Minimal valid CompositionConfig for a brand-new composition. */
export function emptyCompositionData() {
  return { version: 1, layers: [], lfos: [], assignments: [] };
}