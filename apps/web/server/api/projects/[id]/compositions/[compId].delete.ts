export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const projectId = getRouterParam(event, "id");
  const compId = getRouterParam(event, "compId");
  if (!projectId || !compId) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const found = await findOwnedComposition(userId, compId);
  if (!found || found.project.id !== projectId) {
    throw createError({ statusCode: 404, statusMessage: "Composition not found" });
  }
  await useStore().deleteComposition(found.comp.id);
  return { ok: true };
});
