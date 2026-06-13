import type { LayerCategory, LayerType } from "../types/editor";
import type { LayerInstance, LFOSource, ModulationAssignment } from "../types/editor";
import LAYER_TEMPLATES from "./layer-templates";
import { getLayerPreviewStack } from "./layer-previews";

export type LayerCatalogCategory = LayerCategory | "all";

export type LayerCatalogEntry = {
  type: LayerType;
  label: string;
  description: string;
  category: LayerCategory;
  tags: string[];
  featured: boolean;
  searchText: string;
  previewLayers: LayerInstance[];
  previewLfos: LFOSource[];
  previewAssignments: ModulationAssignment[];
};

const CATEGORY_LABELS: Record<LayerCategory, string> = {
  generator: "Generators",
  distortion: "Distort",
  effect: "Effects",
};

export const LAYER_CATALOG_CATEGORIES: {
  key: LayerCatalogCategory;
  label: string;
}[] = [
  { key: "all", label: "All" },
  { key: "generator", label: CATEGORY_LABELS.generator },
  { key: "distortion", label: CATEGORY_LABELS.distortion },
  { key: "effect", label: CATEGORY_LABELS.effect },
];

const CATALOG_META: Partial<
  Record<LayerType, { tags?: string[]; featured?: boolean }>
> = {
  mesh: { tags: ["gradient", "color", "points", "blob"], featured: true },
  gradient: { tags: ["ramp", "linear", "color"] },
  solid: { tags: ["fill", "flat", "color"] },
  noise: { tags: ["procedural", "animated", "texture"] },
  waveFill: { tags: ["shape", "dissolve", "stipple", "wave"], featured: true },
  bandFill: { tags: ["shape", "dissolve", "band", "strip"] },
  distortion: { tags: ["wave", "displace", "warp", "uv"], featured: true },
  dither: { tags: ["posterize", "quantize", "retro"] },
  grain: { tags: ["noise", "film", "texture"], featured: true },
  seam: { tags: ["edge", "block", "sample"] },
  hybridDissolve: { tags: ["dissolve", "stipple", "composite"] },
  vignette: { tags: ["darken", "edge", "frame"] },
  chromaticAberration: {
    tags: ["rgb", "split", "lens", "color", "aberration"],
    featured: true,
  },
};

function buildSearchText(
  label: string,
  description: string,
  category: LayerCategory,
  tags: string[],
): string {
  return [label, description, CATEGORY_LABELS[category], ...tags]
    .join(" ")
    .toLowerCase();
}

export const LAYER_CATALOG: LayerCatalogEntry[] = Object.entries(LAYER_TEMPLATES).map(
  ([type, template]) => {
    const layerType = type as LayerType;
    const meta = CATALOG_META[layerType];
    const tags = meta?.tags ?? [];

    return {
      type: layerType,
      label: template.label,
      description: template.description,
      category: template.category,
      tags,
      featured: meta?.featured ?? false,
      searchText: buildSearchText(
        template.label,
        template.description,
        template.category,
        tags,
      ),
      previewLayers: getLayerPreviewStack(layerType),
      previewLfos: [],
      previewAssignments: [],
    };
  },
);

export function getCategoryLabel(category: LayerCategory): string {
  return CATEGORY_LABELS[category];
}

export type LayerCatalogGroup = {
  key: string;
  label: string;
  items: LayerCatalogEntry[];
};

export function groupCatalogEntries(
  entries: LayerCatalogEntry[],
  options: {
    category: LayerCatalogCategory;
    query: string;
  },
): LayerCatalogGroup[] {
  const { category, query } = options;
  const hasQuery = query.trim().length > 0;

  if (hasQuery || category !== "all") {
    const label =
      category === "all"
        ? "Results"
        : (LAYER_CATALOG_CATEGORIES.find((item) => item.key === category)?.label ??
          "Results");

    return entries.length > 0 ? [{ key: "results", label, items: entries }] : [];
  }

  const featured = entries.filter((entry) => entry.featured);
  const groups: LayerCatalogGroup[] = [];

  if (featured.length > 0) {
    groups.push({ key: "featured", label: "Featured", items: featured });
  }

  for (const cat of ["generator", "distortion", "effect"] as LayerCategory[]) {
    const items = entries.filter((entry) => entry.category === cat && !entry.featured);
    if (items.length > 0) {
      groups.push({
        key: cat,
        label: CATEGORY_LABELS[cat],
        items,
      });
    }
  }

  return groups;
}
