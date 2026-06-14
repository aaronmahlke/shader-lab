import type { H3Event } from "h3";

export async function requireUser(event: H3Event) {
  const { secure } = await requireUserSession(event);
  if (!secure?.userId) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return secure;
}
