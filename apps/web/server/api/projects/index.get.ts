/** All projects of the user, with composition metadata (no data payloads). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const projects = await useStore().listProjects(userId);
  return projects.map((p) => ({ ...p, compositions: p.compositions.map(withAppThumbnailUrl) }));
});
