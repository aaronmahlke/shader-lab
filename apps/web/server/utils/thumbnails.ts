type ThumbnailRow = {
  id: string;
  thumbnailUrl: string | null;
  thumbnailUpdatedAt: Date | null;
};

/**
 * Rows saved before 655dbd7 store putObject's return value in thumbnailUrl:
 * the raw S3 endpoint URL, which is internal-only in prod, so those cards
 * never render. Ignore the stored value and derive the app-served URL from
 * thumbnailUpdatedAt (set on every capture since the column exists). Rows
 * with an unreachable absolute URL and no capture timestamp become null so
 * cards show the fallback instead of a broken image.
 */
export function withAppThumbnailUrl<T extends ThumbnailRow>(row: T): T {
  if (row.thumbnailUpdatedAt) {
    return {
      ...row,
      thumbnailUrl: `/api/shaders/${row.id}/thumbnail?v=${row.thumbnailUpdatedAt.getTime()}`,
    };
  }
  if (row.thumbnailUrl && !row.thumbnailUrl.startsWith("/")) {
    return { ...row, thumbnailUrl: null };
  }
  return row;
}