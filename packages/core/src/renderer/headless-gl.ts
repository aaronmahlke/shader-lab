export const HEADLESS_GL_CONTEXT_ATTRS = {
  preserveDrawingBuffer: true,
  createWebGL2Context: true,
} as const;

export type HeadlessGlFactory = (
  width: number,
  height: number,
  attrs?: typeof HEADLESS_GL_CONTEXT_ATTRS,
) => WebGL2RenderingContext | null;

export function createHeadlessGlContext(
  createGL: HeadlessGlFactory,
  width: number,
  height: number,
): WebGL2RenderingContext {
  const gl = createGL(width, height, HEADLESS_GL_CONTEXT_ATTRS);
  if (!gl?.RGBA16F) {
    throw new Error("WebGL2 is required");
  }
  return gl;
}

export async function loadHeadlessGl(): Promise<HeadlessGlFactory> {
  try {
    const mod = await import("gl");
    return mod.default as HeadlessGlFactory;
  } catch {
    const { createRequire } = await import("module");
    const { join } = await import("path");
    const serverPkg = join(process.cwd(), ".output", "server", "package.json");
    const require = createRequire(serverPkg);
    return require("gl") as HeadlessGlFactory;
  }
}
