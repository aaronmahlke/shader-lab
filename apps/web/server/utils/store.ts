/**
 * Project storage behind one interface, so the API routes don't care where
 * projects live:
 *
 *   - hosted: Postgres (projects/compositions tables) + S3 (thumbnails, media)
 *   - local:  project folders on disk (desktop app / `NUXT_LOCAL_MODE=1`)
 *
 * Ownership is checked by the routes against `project.userId`; in local mode
 * every project belongs to the single local user.
 */

export type StoredProject = {
  id: string;
  userId: string;
  name: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredComposition = {
  id: string;
  projectId: string;
  name: string;
  sortIndex: number;
  data: unknown;
  thumbnailUrl: string | null;
  thumbnailUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CompositionMeta = Omit<StoredComposition, "data" | "projectId">;

export type CompWithProject = { project: StoredProject; comp: StoredComposition };

export interface ProjectStore {
  /** Projects of a user (newest first) with composition metadata (sorted). */
  listProjects(userId: string): Promise<(StoredProject & { compositions: CompositionMeta[] })[]>;
  getProject(id: string): Promise<StoredProject | null>;
  listCompositionMeta(projectId: string): Promise<CompositionMeta[]>;
  createProject(
    userId: string,
    input: { name?: string; isPublic?: boolean; compositionName?: string; data?: unknown },
  ): Promise<CompWithProject>;
  updateProject(id: string, input: { name?: string; isPublic?: boolean }): Promise<StoredProject>;
  deleteProject(id: string): Promise<void>;

  /** By composition id, or by project id (its first composition). */
  findCompositionByAnyId(id: string): Promise<CompWithProject | null>;
  createComposition(
    projectId: string,
    input: { name: string; data: unknown },
  ): Promise<StoredComposition>;
  /** Also bumps the project's updatedAt. */
  updateComposition(
    compId: string,
    input: { name?: string; data?: unknown; sortIndex?: number },
  ): Promise<StoredComposition>;
  deleteComposition(compId: string): Promise<void>;

  /** Store a PNG thumbnail; returns the capture time. */
  setThumbnail(compId: string, png: Buffer): Promise<Date>;
  getThumbnail(compId: string): Promise<Buffer | null>;

  /** Store an uploaded media file; returns its key (served at /api/media/<key>). */
  putMedia(
    owner: { userId: string; projectId?: string },
    file: { ext: string; data: Buffer; mime: string; name?: string },
  ): Promise<string>;
  /** Key must have passed `isValidMediaKey`. */
  getMedia(key: string): Promise<Buffer | null>;
  isValidMediaKey(key: string): boolean;
}

let store: ProjectStore | null = null;

/** The active store: project folders in local mode, Postgres + S3 otherwise. */
export function useStore(): ProjectStore {
  if (!store) store = isLocalMode() ? createFileStore() : createDbStore();
  return store;
}

/** The comp + project pair when `userId` owns it, else null. */
export async function findOwnedComposition(userId: string, id: string): Promise<CompWithProject | null> {
  const found = await useStore().findCompositionByAnyId(id);
  if (!found || found.project.userId !== userId) return null;
  return found;
}

/** The project when `userId` owns it, else null. */
export async function findOwnedProject(userId: string, projectId: string): Promise<StoredProject | null> {
  const project = await useStore().getProject(projectId);
  return project && project.userId === userId ? project : null;
}

/** Logged-in user id, or null for anonymous requests (public reads). */
export async function optionalUserId(event: Parameters<typeof getUserSession>[0]): Promise<string | null> {
  if (isLocalMode()) return LOCAL_USER.id;
  try {
    const session = await getUserSession(event);
    return session.secure?.userId ?? null;
  } catch {
    return null;
  }
}
