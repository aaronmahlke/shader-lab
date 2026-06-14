import { createCanvas, loadImage } from "@napi-rs/canvas";
import { eq } from "drizzle-orm";
import { renderCompositionToBuffer, type CompositionConfig } from "@shader-lab/core/server";
import { shaders } from "../../../database/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

async function drawOgOverlays(ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) {
  try {
    const storage = useStorage("assets:server");
    const logoSvg = await storage.getItemRaw("zeitwork-logo.svg");
    if (logoSvg) {
      const logo = await loadImage(logoSvg as Buffer);
      const logoTargetWidth = 160;
      const logoScale = logoTargetWidth / logo.width;
      ctx.drawImage(logo, 40, 36, logoTargetWidth, logo.height * logoScale);
    }
  } catch (e) {
    console.error("Failed to load logo:", e);
  }

  try {
    const storage = useStorage("assets:server");
    const titleSvg = await storage.getItemRaw("shader-lab-title.svg");
    if (titleSvg) {
      const title = await loadImage(titleSvg as Buffer);
      const titleTargetWidth = 320;
      const titleScale = titleTargetWidth / title.width;
      const titleW = titleTargetWidth;
      const titleH = title.height * titleScale;
      ctx.drawImage(title, 40, OG_HEIGHT - titleH - 40, titleW, titleH);
    }
  } catch (e) {
    console.error("Failed to load title:", e);
  }
}

async function compositeFromPngBuffer(png: Buffer): Promise<Buffer> {
  const canvas = createCanvas(OG_WIDTH, OG_HEIGHT);
  const ctx = canvas.getContext("2d");
  const img = await loadImage(png);
  ctx.drawImage(img, 0, 0, OG_WIDTH, OG_HEIGHT);
  await drawOgOverlays(ctx);
  return canvas.toBuffer("image/png");
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id || !UUID_RE.test(id)) {
    return sendRedirect(event, "/og-image.png", 302);
  }

  const db = useDrizzle();
  const [row] = await db
    .select({ data: shaders.data })
    .from(shaders)
    .where(eq(shaders.id, id))
    .limit(1);

  if (!row?.data) {
    return sendRedirect(event, "/og-image.png", 302);
  }

  const doc = row.data as Omit<CompositionConfig, "version">;
  const rendered = await renderCompositionToBuffer(
    { version: 1, ...doc },
    { width: OG_WIDTH, height: OG_HEIGHT, time: 2 },
  );

  if (!rendered) {
    return sendRedirect(event, "/og-image.png", 302);
  }

  const png = await compositeFromPngBuffer(rendered);

  setResponseHeader(event, "Content-Type", "image/png");
  setResponseHeader(event, "Cache-Control", "public, max-age=86400, s-maxage=86400");
  return png;
});
