import type { CompWithProject } from "./store";

/**
 * Legacy shader-document shape (comp + owning project flattened) so the
 * pre-project editor and dashboard keep working against the new storage.
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
