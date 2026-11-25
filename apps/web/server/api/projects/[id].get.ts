/** Project + composition metadata (no data payloads); owner or public. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const userId = await optionalUserId(event);
  const store = useStore();
  const project = await store.getProject(id);
  if (!project || !(project.isPublic || project.userId === userId)) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }
  const comps = await store.listCompositionMeta(project.id);
  return { ...project, compositions: comps.map(withAppThumbnailUrl) };
});
