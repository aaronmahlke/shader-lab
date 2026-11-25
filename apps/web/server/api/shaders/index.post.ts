/** Legacy create: a new project with a single composition. */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const body = await readBody(event);
  if (!body?.data) throw createError({ statusCode: 400, statusMessage: "Missing shader data" });

  const pair = await useStore().createProject(userId, {
    name: body.name ?? "Untitled",
    isPublic: body.isPublic ?? false,
    compositionName: "Comp 1",
    data: body.data,
  });
  return toShaderShape(pair);
});
