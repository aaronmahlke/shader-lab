
export default defineOAuthGoogleEventHandler({
  config: {
    scope: ["openid", "email", "profile"],
  },
  async onSuccess(event, { user: googleUser }) {
    const db = useDrizzle();

    // Look up existing user by Google ID
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.googleId, String(googleUser.sub)))
      .limit(1);

    let user: typeof existing;

    if (existing) {
      // Update avatar if changed
      if (googleUser.picture && googleUser.picture !== existing.avatarUrl) {
        await db
          .update(users)
          .set({ avatarUrl: googleUser.picture, updatedAt: new Date() })
          .where(eq(users.id, existing.id));
      }
      user = existing;
    } else {
      // Check if email already exists (user previously registered via different method)
      const [byEmail] = await db
        .select()
        .from(users)
        .where(eq(users.email, googleUser.email))
        .limit(1);

      if (byEmail) {
        // Link Google account to existing user
        await db
          .update(users)
          .set({ googleId: String(googleUser.sub), avatarUrl: googleUser.picture, updatedAt: new Date() })
          .where(eq(users.id, byEmail.id));
        user = byEmail;
      } else {
        // Create new user
        const username = googleUser.email.split("@")[0] ?? `user-${Date.now()}`;

        // Ensure username is unique
        let finalUsername = username;
        let suffix = 1;
        while (true) {
          const [clash] = await db
            .select()
            .from(users)
            .where(eq(users.username, finalUsername))
            .limit(1);
          if (!clash) break;
          finalUsername = `${username}${suffix++}`;
        }

        const [created] = await db
          .insert(users)
          .values({
            email: googleUser.email,
            username: finalUsername,
            googleId: String(googleUser.sub),
            avatarUrl: googleUser.picture ?? null,
          })
          .returning();

        user = created;
      }
    }

    if (!user) {
      return sendRedirect(event, "/login?error=failed");
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
  },
  onError(event, error) {
    console.error("Google OAuth error:", error);
    return sendRedirect(event, "/login?error=oauth");
  },
});
