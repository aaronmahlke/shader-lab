/** Legacy update: data goes to the composition, name/isPublic to the project. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readBody(event);
  const found = await findOwnedComposition(userId, id);
  if (!found) throw createError({ statusCode: 404, statusMessage: "Composition not found" });

  const store = useStore();
  if (body.data !== undefined) await store.updateComposition(found.comp.id, { data: body.data });
  await store.updateProject(found.project.id, { name: body.name, isPublic: body.isPublic });

  const updated = await findOwnedComposition(userId, found.comp.id);
  return toShaderShape(updated!);
});
