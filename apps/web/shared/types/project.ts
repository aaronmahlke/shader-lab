import type { CompositionConfig } from "@shader-lab/core";

/** Composition metadata as returned by the /api/projects endpoints (no data payload). */
export type CompositionMeta = {
  id: string;
  name: string;
  sortIndex: number;
  thumbnailUrl: string | null;
  thumbnailUpdatedAt?: string | null;
  createdAt?: string;
  updatedAt: string;
};

/** Project + composition metadata from GET /api/projects and GET /api/projects/:id. */
export type ProjectWithCompositions = {
  id: string;
  userId: string;
  name: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  compositions: CompositionMeta[];
};

/**
 * Legacy shader document shape from /api/shaders/:id.
 * `id` is always the composition id (even when the request used a legacy
 * project id) and `name` is the project name.
 */
export type ShaderDoc = {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  data: CompositionConfig;
  isPublic: boolean;
  thumbnailUrl: string | null;
  thumbnailUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
