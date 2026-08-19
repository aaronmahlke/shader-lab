import { createCanvas, loadImage } from "@napi-rs/canvas";
import { and, eq, inArray } from "drizzle-orm";
import { renderCompositionToBuffer, type CompositionConfig } from "@shader-lab/core/server";
import { compositions as compositionsTable } from "../../../database/schema";


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

/** Safety cap on referenced comps loaded for one OG render. */
const MAX_NESTED_COMPS = 10;

/** compRefId values of composition layers (defensive: data is untyped JSON). */
function compRefIdsIn(layers: CompositionConfig["layers"] | undefined): string[] {
  if (!Array.isArray(layers)) return [];
  const ids: string[] = [];
  for (const layer of layers) {
    if (layer?.type !== "composition") continue;
    const id = layer.values?.compRefId;
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids;
}

/**
 * Comps referenced (transitively) by the rendered comp's composition layers,
 * restricted to the same project — mirrors the editor's registry so nested
 * composition layers show up in OG images too.
 */
async function loadReferencedCompositions(
  db: ReturnType<typeof useDrizzle>,
  projectId: string,
  rootLayers: CompositionConfig["layers"] | undefined,
): Promise<Record<string, CompositionConfig>> {
  const registry: Record<string, CompositionConfig> = {};
  const seen = new Set<string>(compRefIdsIn(rootLayers));
  let pending = [...seen];

  while (pending.length > 0 && Object.keys(registry).length < MAX_NESTED_COMPS) {
    const rows = await db
      .select()
      .from(compositionsTable)
      .where(and(
        eq(compositionsTable.projectId, projectId),
        inArray(compositionsTable.id, pending),
      ))
      .limit(MAX_NESTED_COMPS);
    pending = [];
    for (const row of rows) {
      if (!row.data || registry[row.id]) continue;
      const config = { version: 1, ...(row.data as Omit<CompositionConfig, "version">) };
      registry[row.id] = config;
      for (const refId of compRefIdsIn(config.layers)) {
        if (seen.has(refId)) continue;
        seen.add(refId);
        pending.push(refId);
      }
    }
    if (rows.length === 0) break;
  }
  return registry;
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
  const found = await findCompositionByAnyId(db, id);

  if (!found?.comp.data) {
    return sendRedirect(event, "/og-image.png", 302);
  }

  const doc = found.comp.data as Omit<CompositionConfig, "version">;
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
