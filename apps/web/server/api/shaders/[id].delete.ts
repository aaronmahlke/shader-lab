/** Legacy delete removes the whole project (single-comp world). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const found = await findOwnedComposition(userId, id);
  if (!found) throw createError({ statusCode: 404, statusMessage: "Composition not found" });

  await useStore().deleteProject(found.project.id);
  return { ok: true };
});
