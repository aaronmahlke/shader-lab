/** Whether the server runs in local mode (desktop) and where projects go. */
export default defineEventHandler(() => ({
  local: isLocalMode(),
  projectsDir: isLocalMode() ? defaultProjectsDir() : null,
}));
