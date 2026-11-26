/** One project component, compiled for the browser runtime. */
export default defineEventHandler(async (event) => {
  await requireUser(event);
  const id = getRouterParam(event, "id");
  const name = getRouterParam(event, "name");
  if (!id || !name || !isLocalMode()) throw createError({ statusCode: 404, statusMessage: "Not found" });
  const folder = await projectPath(id);
  if (!folder) throw createError({ statusCode: 404, statusMessage: "Project not found" });
  try {
    const compiled = await compileProjectComponent(folder, name);
    if (!compiled) throw createError({ statusCode: 404, statusMessage: "Component not found" });
    setHeader(event, "Cache-Control", "no-store");
    return compiled;
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode) throw err;
    throw createError({ statusCode: 422, statusMessage: String((err as Error).message ?? err).slice(0, 500) });
  }
});
