/**
 * Create a project with its first composition. Local mode: `path` creates the
 * project folder there (else a free folder in the default projects dir).
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const body = (await readBody(event).catch(() => null)) ?? {};
  const input = {
    name: body.name ?? "Untitled",
    isPublic: body.isPublic ?? false,
    compositionName: body.compositionName ?? "Comp 1",
    data: body.data ?? emptyCompositionData(),
  };

  if (isLocalMode() && typeof body.path === "string" && body.path) {
    const manifest = await createProjectFolder(body.path, input);
    const pair = (await useStore().findCompositionByAnyId(manifest.compositions[0]!.id))!;
    return { ...pair.project, compositions: [pair.comp] };
  }

  const { project, comp } = await useStore().createProject(userId, input);
  return { ...project, compositions: [comp] };
});
