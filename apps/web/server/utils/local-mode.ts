import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Local mode (desktop app, or `NUXT_LOCAL_MODE=1`): projects are folders on
 * disk, there is no database/S3, and a single local user is always signed in.
 */
export function isLocalMode(): boolean {
  const v = process.env.NUXT_LOCAL_MODE;
  return v === "1" || v === "true";
}

export const LOCAL_USER = {
  id: "local",
  username: "local",
  email: "local@shaderlab",
  avatarUrl: null as string | null,
};

/** App state (recent projects registry, shared media): ~/.shaderlab unless overridden. */
export function localHome(): string {
  return process.env.SHADERLAB_HOME || join(homedir(), ".shaderlab");
}

/** Where "New project" puts folders when no path is given. */
export function defaultProjectsDir(): string {
  return process.env.SHADERLAB_PROJECTS_DIR || join(homedir(), "Documents", "Shader Lab");
}
