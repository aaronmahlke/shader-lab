/** Hosted: deletes the project. Local: forgets the folder (files stay). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const project = await findOwnedProject(userId, id);
  if (!project) throw createError({ statusCode: 404, statusMessage: "Project not found" });

  await useStore().deleteProject(project.id);
  return { ok: true };
});
