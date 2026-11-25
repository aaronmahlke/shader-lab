export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readBody(event);
  const project = await findOwnedProject(userId, id);
  if (!project) throw createError({ statusCode: 404, statusMessage: "Project not found" });

  return useStore().updateProject(project.id, { name: body.name, isPublic: body.isPublic });
});
