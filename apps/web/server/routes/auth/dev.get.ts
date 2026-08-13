// DEV ONLY - workbox preview helper, not committed.
// Logs in as a local dev user without Google OAuth. Disabled in production.
import { eq } from "drizzle-orm";
import { users } from "../../database/schema";

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 });
  }

  const db = useDrizzle();
  const email = "dev@localhost";

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email, username: "dev", googleId: null, avatarUrl: null })
      .returning();
  }
  if (!user) {
    throw createError({ statusCode: 500, statusMessage: "could not create dev user" });
  }

  await setUserSession(event, {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
    secure: {
      userId: user.id,
    },
  });

  return sendRedirect(event, "/");
});
