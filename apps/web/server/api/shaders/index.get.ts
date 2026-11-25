/** Legacy list: one entry per project (its first composition carries the data). */
export default defineEventHandler(async (event) => {
  const { userId } = await requireUser(event);
  const store = useStore();
  const projects = await store.listProjects(userId);
  const result = [];
  for (const project of projects) {
    const first = project.compositions[0];
    if (!first) continue;
    const pair = await store.findCompositionByAnyId(first.id);
    if (pair) result.push(withAppThumbnailUrl(toShaderShape(pair)));
  }
  return result;
});
