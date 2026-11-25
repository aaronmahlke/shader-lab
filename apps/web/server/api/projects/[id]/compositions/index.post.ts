/** Add a composition to a project (optionally duplicating an existing one). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const projectId = getRouterParam(event, "id");
  if (!projectId) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = (await readBody(event).catch(() => null)) ?? {};
  const project = await findOwnedProject(userId, projectId);
  if (!project) throw createError({ statusCode: 404, statusMessage: "Project not found" });

  let data = body.data;
  let name = body.name;
  if (body.duplicateOf) {
    const source = await useStore().findCompositionByAnyId(body.duplicateOf);
    if (!source || source.project.id !== project.id || source.comp.id !== body.duplicateOf) {
      throw createError({ statusCode: 404, statusMessage: "Source composition not found" });
    }
    data = data ?? source.comp.data;
    name = name ?? `${source.comp.name} copy`;
  }

  return useStore().createComposition(project.id, {
    name: name ?? "Comp",
    data: data ?? emptyCompositionData(),
  });
});
