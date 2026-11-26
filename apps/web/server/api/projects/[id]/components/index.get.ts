/** Project-level stage components (`<project>/components/*.vue`); local mode only. */
export default defineEventHandler(async (event) => {
  await requireUser(event);
  const id = getRouterParam(event, "id");
  if (!id || !isLocalMode()) return [];
  const folder = await projectPath(id);
  return folder ? await listProjectComponents(folder) : [];
});
