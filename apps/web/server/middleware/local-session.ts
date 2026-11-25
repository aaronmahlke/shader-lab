/**
 * Local mode: the single local user is always signed in. Sets the session on
 * the first request so the client's auth middleware and user menu work
 * unchanged (no Google login on the desktop).
 */
export default defineEventHandler(async (event) => {
  if (!isLocalMode()) return;
  const session = await getUserSession(event);
  if (session.user) return;
  await setUserSession(event, {
    user: { id: LOCAL_USER.id, username: LOCAL_USER.username, email: LOCAL_USER.email, avatarUrl: null },
    secure: { userId: LOCAL_USER.id },
  });
});
