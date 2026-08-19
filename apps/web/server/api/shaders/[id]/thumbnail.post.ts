import { eq } from "drizzle-orm";
import { compositions } from "../../../database/schema";

export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const db = useDrizzle();

  const found = await findOwnedComposition(db, userId, id);
  if (!found) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }
  const compId = found.comp.id;

  // Read uploaded file from multipart form data
  const formData = await readMultipartFormData(event);
  const file = formData?.find((f) => f.name === "file");

  if (!file || !file.data) {
    throw createError({ statusCode: 400, statusMessage: "Missing thumbnail file" });
  }

  // Upload to S3
  const s3 = useS3();
  const key = `thumbnails/${compId}.png`;
  await s3.putObject(key, file.data, "image/png");

  // Store an app-served URL: the S3 endpoint is not necessarily reachable
  // from the browser (internal-only in prod). ?v= busts the immutable cache.
  const thumbnailUpdatedAt = new Date();
  const thumbnailUrl = `/api/shaders/${compId}/thumbnail?v=${thumbnailUpdatedAt.getTime()}`;

  await db
    .update(compositions)
    .set({ thumbnailUrl, thumbnailUpdatedAt })
    .where(eq(compositions.id, compId));

  return { thumbnailUrl };
});
