export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const found = await findOwnedComposition(userId, id);
  if (!found) throw createError({ statusCode: 404, statusMessage: "Composition not found" });

  const formData = await readMultipartFormData(event);
  const file = formData?.find((f) => f.name === "file");
  if (!file || !file.data) throw createError({ statusCode: 400, statusMessage: "Missing thumbnail file" });

  const at = await useStore().setThumbnail(found.comp.id, file.data);
  // App-served URL; ?v= busts the immutable cache.
  return { thumbnailUrl: `/api/shaders/${found.comp.id}/thumbnail?v=${at.getTime()}` };
});
