import type { H3Event } from "h3";

/** Signed-in user (the fixed local user in local mode). */
export async function requireUser(event: H3Event): Promise<{ userId: string }> {
  if (isLocalMode()) return { userId: LOCAL_USER.id };
  const { secure } = await requireUserSession(event);
  if (!secure?.userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return { userId: secure.userId as string };
}
