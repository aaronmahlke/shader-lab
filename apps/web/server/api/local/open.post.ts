/** Local mode: open (register) an existing project folder. Body: { path }. */
export default defineEventHandler(async (event) => {
  if (!isLocalMode()) throw createError({ statusCode: 404 });
  const body = (await readBody(event).catch(() => null)) ?? {};
  if (typeof body.path !== "string" || !body.path) {
    throw createError({ statusCode: 400, statusMessage: "Missing path" });
  }
  const manifest = await openProjectFolder(body.path);
  return { id: manifest.id, name: manifest.name, firstCompositionId: manifest.compositions[0]?.id ?? null };
});
