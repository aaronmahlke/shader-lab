import type { LayerCategory, LayerType } from "@shader-lab/core";
import type { LayerInstance, LFOSource, ModulationAssignment } from "@shader-lab/core";
import { LAYER_TEMPLATES } from "@shader-lab/core";
import { getLayerPreviewStack } from "./layer-previews";

export type LayerCatalogCategory = LayerCategory | "all";

/** UI-level sections, decoupled from core `LayerCategory`. */
export type LayerCatalogSection =
  | "content"
  | "generate"
  | "distort"
  | "stylize"
  | "camera";

export type LayerCatalogSectionFilter = LayerCatalogSection | "all";

export type LayerCatalogEntry = {
  type: LayerType;
  label: string;
  description: string;
  category: LayerCategory;
  section: LayerCatalogSection;
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

const SECTION_LABELS: Record<LayerCatalogSection, string> = {
  content: "Content",
  generate: "Generate",
  distort: "Distort",
  stylize: "Stylize",
  camera: "Camera",
};

/** Sections in display order. */
export const LAYER_CATALOG_SECTIONS: {
  key: LayerCatalogSection;
  label: string;
}[] = [
  { key: "content", label: SECTION_LABELS.content },
  { key: "generate", label: SECTION_LABELS.generate },
  { key: "distort", label: SECTION_LABELS.distort },
  { key: "stylize", label: SECTION_LABELS.stylize },
  { key: "camera", label: SECTION_LABELS.camera },
];

export const LAYER_CATALOG_CATEGORIES: {
  key: LayerCatalogCategory;
  label: string;
}[] = [
  { key: "all", label: "All" },
  { key: "generator", label: CATEGORY_LABELS.generator },
  { key: "distortion", label: CATEGORY_LABELS.distortion },
  { key: "effect", label: CATEGORY_LABELS.effect },
];

/**
 * Explicit section assignments. Keyed by plain string so future layer types
 * ("shape", "image", "video", …) can be listed before they exist in core;
 * only types present in LAYER_TEMPLATES ever produce catalog entries.
 */
const SECTION_BY_TYPE: Record<string, LayerCatalogSection> = {
  text: "content",
  component: "content",
  shape: "content",
  image: "content",
  video: "content",
  mesh: "generate",
  gradient: "generate",
  solid: "generate",
  noise: "generate",
  waveFill: "generate",
  bandFill: "generate",
  distortion: "distort",
  dither: "stylize",
  grain: "stylize",
  seam: "stylize",
  diffuse: "stylize",
  vignette: "stylize",
  chromaticAberration: "stylize",
  camera: "camera",
};

/** Fallback for unknown/future types: map the core category to a section. */
const SECTION_BY_CATEGORY: Record<LayerCategory, LayerCatalogSection> = {
  generator: "generate",
  distortion: "distort",
  effect: "stylize",
};

export function getSectionForLayerType(
  type: LayerType,
  category: LayerCategory,
): LayerCatalogSection {
  return SECTION_BY_TYPE[type] ?? SECTION_BY_CATEGORY[category];
}

export function getSectionLabel(section: LayerCatalogSection): string {
  return SECTION_LABELS[section];
}

const CATALOG_META: Partial<
  Record<LayerType, { tags?: string[]; featured?: boolean }>
> = {
  mesh: { tags: ["gradient", "color", "points", "blob"], featured: true },
  gradient: { tags: ["ramp", "linear", "color"] },
  solid: { tags: ["fill", "flat", "color"] },
  noise: { tags: ["procedural", "animated", "texture"] },
  text: { tags: ["type", "typography", "title", "word"], featured: true },
  component: { tags: ["ui", "vue", "dom", "live", "capture", "embed"], featured: true },
  image: { tags: ["photo", "picture", "media", "upload"], featured: true },
  video: { tags: ["movie", "clip", "media", "screen recording", "upload"], featured: true },
  camera: { tags: ["3d", "tilt", "lens", "dof", "bokeh", "bloom", "focus", "plate"], featured: true },
  shape: { tags: ["rectangle", "ellipse", "circle", "box", "sdf"], featured: true },
  waveFill: { tags: ["shape", "wave", "gradient"], featured: true },
  bandFill: { tags: ["shape", "band", "strip"] },
  distortion: { tags: ["wave", "displace", "warp", "uv"], featured: true },
  dither: { tags: ["posterize", "quantize", "retro"] },
  grain: { tags: ["noise", "film", "texture"], featured: true },
  seam: { tags: ["edge", "block", "sample"] },
  diffuse: { tags: ["scatter", "blur", "noise"], featured: true },
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
  section: LayerCatalogSection,
  tags: string[],
): string {
  return [label, description, CATEGORY_LABELS[category], SECTION_LABELS[section], ...tags]
    .join(" ")
    .toLowerCase();
}

export const LAYER_CATALOG: LayerCatalogEntry[] = Object.entries(LAYER_TEMPLATES).map(
  ([type, template]) => {
    const layerType = type as LayerType;
    const meta = CATALOG_META[layerType];
    const tags = meta?.tags ?? [];
    const section = getSectionForLayerType(layerType, template.category);

    return {
      type: layerType,
      label: template.label,
      description: template.description,
      category: template.category,
      section,
      tags,
      featured: meta?.featured ?? false,
      searchText: buildSearchText(
        template.label,
        template.description,
        template.category,
        section,
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
    section: LayerCatalogSectionFilter;
    query: string;
  },
): LayerCatalogGroup[] {
  const { section, query } = options;
  const hasQuery = query.trim().length > 0;

  if (hasQuery || section !== "all") {
    const label =
      section === "all"
        ? "Results"
        : (SECTION_LABELS[section] ?? "Results");

    return entries.length > 0 ? [{ key: "results", label, items: entries }] : [];
  }

  const groups: LayerCatalogGroup[] = [];

  for (const { key, label } of LAYER_CATALOG_SECTIONS) {
    const items = entries.filter((entry) => entry.section === key);
    if (items.length > 0) {
      groups.push({ key, label, items });
    }
  }

  return groups;
}
