export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    return sendRedirect(event, "/og-image.png", 302);
  }
  return sendRedirect(event, `/api/og/${id}/_`, 302);
});
