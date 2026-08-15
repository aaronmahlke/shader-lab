import type { LayerInstance, LayerType, MeshPoint } from "@shader-lab/core";
import { LAYER_TEMPLATES, buildLayerValues } from "@shader-lab/core";

/**
 * Curated preview stacks for the layer catalog. Every type gets a stack that
 * reads clearly at thumbnail size (~280x210): generators render standalone
 * with tasteful overrides, effects sit on a shared multi-hue mesh scene with
 * exaggerated parameters so the effect is obvious at a glance.
 *
 * The same stacks feed the live hover preview (DashboardCompositionPreview)
 * and the baked thumbnails in /public/previews (scripts/generate-catalog-previews.mjs).
 */

/**
 * Shared base scene for effect previews: a vivid mesh with distinct hue
 * regions and clear color boundaries, so edge-driven effects (seam, diffuse,
 * dither) and displacement have structure to act on.
 */
const PREVIEW_SCENE_MESH_POINTS: MeshPoint[] = [
  { x: 0.1, y: 0.88, color: "#16215c", radius: 0.95 }, // deep indigo, bottom-left
  { x: 0.88, y: 0.9, color: "#f35a0d", radius: 0.8 }, // brand orange, bottom-right
  { x: 0.46, y: 0.38, color: "#c73e77", radius: 1.0 }, // magenta core
  { x: 0.88, y: 0.1, color: "#fdf2d5", radius: 0.42 }, // cream highlight, top-right
  { x: 0.08, y: 0.1, color: "#0f3839", radius: 0.85 }, // dark teal, top-left
  { x: 0.42, y: 0.74, color: "#6b2cff", radius: 0.62 }, // violet accent
];

function previewLayer(
  type: LayerType,
  overrides: Record<string, unknown> = {},
  id = `preview-${type}`,
): LayerInstance {
  return {
    id,
    type,
    enabled: true,
    values: { ...buildLayerValues(type), ...overrides },
  };
}

/** The scene effect previews act on: structured hues, crisp-ish boundaries. */
function previewBaseScene(): LayerInstance {
  return previewLayer(
    "mesh",
    {
      u_meshPoints: PREVIEW_SCENE_MESH_POINTS.map((p) => ({ ...p })),
      softness: 1.0,
      gain: 1.05,
    },
    "preview-base-scene",
  );
}

/**
 * Fixed render time per type for the baked thumbnails. Animated layers
 * (noise, grain) get a time where the pattern looks settled; everything else
 * is time-independent and just needs a non-zero phase.
 */
export const DEFAULT_PREVIEW_TIME = 0.8;

export const PREVIEW_TIMES: Partial<Record<LayerType, number>> = {
  noise: 1.6,
  distortion: 0.4,
};

export function getLayerPreviewTime(type: LayerType): number {
  return PREVIEW_TIMES[type] ?? DEFAULT_PREVIEW_TIME;
}

/** Per-type parameter overrides, exaggerated so each effect reads at card size. */
const EFFECT_OVERRIDES: Partial<Record<LayerType, Record<string, unknown>>> = {
  // Chunky posterization: few levels, big bayer cells.
  dither: { levels: 3, ditherScale: 12 },
  // Heavy film grain, frozen so the baked frame matches the live loop.
  grain: { grainIntensity: 0.16, ditherScale: 7, speed: 0 },
  // Coarse two-color grain: low edge thresholds catch the mesh's soft
  // boundaries, wide spread makes the seams chunky.
  seam: { ditherScale: 12, edgeMin: 0.005, edgeMax: 0.08, sampleSpread: 14, speed: 0 },
  // Strong crunchy scatter at color transitions.
  diffuse: { amount: 140, grainHard: 1 },
  // Strong radial vignette that still leaves the scene readable.
  vignette: { shape: 1, vignetteIntensity: 0.95, vignetteRadius: 0.7, vignetteSoftness: 0.55 },
  // Single hard R/B shift: multi-step averaging smears at thumbnail size.
  chromaticAberration: { amount: 0.045, steps: 1, mode: 1, angle: 0 },
  // High-amplitude waves with a few visible periods so the warp reads as waves.
  distortion: { waveType: 0, freq: 4, amplitude: 1.6, direction: 30 },
  // Tilted plate with shallow focus and a little bloom lift.
  camera: {
    tilt: -14,
    yaw: 10,
    zoom: 1.05,
    aperture: 1.6,
    focus: 0.4,
    emission: 1.3,
  },
};

/** Generators that read best standalone, with hand-picked values. */
function generatorStack(type: LayerType): LayerInstance[] {
  switch (type) {
    case "mesh":
      // Template default (MESH_BLOOM_POINTS) is the warm signature look and
      // stays visually distinct from the multi-hue effect base scene.
      return [previewLayer(type)];

    case "gradient":
      return [
        previewLayer(type, {
          angle: 135,
          u_gradient: [
            { color: "#0b1026", position: 0 },
            { color: "#3e1f8f", position: 0.28 },
            { color: "#e84393", position: 0.55 },
            { color: "#ff9f43", position: 0.8 },
            { color: "#fff3d6", position: 1 },
          ],
        }),
      ];

    case "solid":
      return [previewLayer(type, { u_color: "#6b2cff" })];

    case "composition":
      // Previews cannot resolve a real nested comp (no registry in the
      // preview renderer) — stage the LOOK of a precomp: a scaled comp card
      // floating over the project background.
      return [
        previewLayer("gradient", {
          layerScale: 58,
          layerRotation: -4,
          angle: 135,
          u_gradient: [
            { color: "#1b1036", position: 0 },
            { color: "#7048e8", position: 0.5 },
            { color: "#ffd43b", position: 1 },
          ],
        }, "preview-comp-card"),
        previewLayer("solid", { u_color: "#101014" }, "preview-comp-bg"),
      ];

    case "object3d":
      // Lit cube at a readable angle over a dark base.
      return [
        previewLayer("light", { azimuth: -45, elevation: 40, intensity: 1.5 }, "preview-obj-light"),
        previewLayer(type, {
          u_shape: 0,
          albedo: "#e8590c",
          layerRotationY: 32,
          layerRotationX: 18,
          u_sizeX: 0.42,
          u_sizeY: 0.42,
          u_sizeZ: 0.42,
        }),
        previewLayer("solid", { u_color: "#101014" }, "preview-obj-bg"),
      ];

    case "light":
      // A light is invisible on its own — show it shading a sphere.
      return [
        previewLayer(type, { azimuth: -55, elevation: 35, intensity: 1.8, lightColor: "#ffe9c4" }),
        previewLayer("object3d", {
          u_shape: 1,
          albedo: "#3b82f6",
          u_sizeX: 0.45,
          u_sizeY: 0.45,
          u_sizeZ: 0.45,
          specular: 0.8,
          shininess: 64,
        }, "preview-light-sphere"),
        previewLayer("solid", { u_color: "#101014" }, "preview-light-bg"),
      ];

    case "noise":
      return [previewLayer(type, { scale: 3, octaves: 5, persistence: 0.55, speed: 0.4 })];

    case "text":
      // Layer order is UI order: top first, background last.
      return [
        previewLayer(type, {
          content: "Aa",
          // DejaVu resolves in the node rasterizer (no app webfonts there);
          // browsers skip it and use the app font.
          fontFamily: "DejaVu Sans, Inter Variable, sans-serif",
          fontSize: 300,
          fontWeight: 700,
          u_color: "#ffffff",
        }),
        previewLayer("solid", { u_color: "#17151f" }, "preview-text-bg"),
      ];

    case "component":
      // The renderer cannot capture live DOM, so fake the "UI card" look with
      // primitives: dark stage, centered light card, bold label.
      return [
        previewLayer(
          "text",
          {
            content: "UI",
            fontFamily: "DejaVu Sans, Inter Variable, sans-serif",
            fontSize: 170,
            fontWeight: 700,
            u_color: "#18181b",
          },
          "preview-component-label",
        ),
        previewLayer(
          "solid",
          { u_color: "#f4f4f5", layerScale: 58 },
          "preview-component-card",
        ),
        previewLayer("solid", { u_color: "#101014" }, "preview-component-stage"),
      ];

    case "image":
      // Headless previews cannot fetch/decode media, so fake a media card the
      // way the component preview does: dark stage, charcoal card, bold label.
      return [
        previewLayer(
          "text",
          {
            content: "IMG",
            fontFamily: "DejaVu Sans, Inter Variable, sans-serif",
            fontSize: 120,
            fontWeight: 700,
            u_color: "#f4f4f5",
          },
          "preview-image-label",
        ),
        previewLayer(
          "solid",
          { u_color: "#26262e", layerScale: 58 },
          "preview-image-card",
        ),
        previewLayer("solid", { u_color: "#101014" }, "preview-image-stage"),
      ];

    case "video":
      // Same faked media card as image; the play triangle reads as "video".
      // DejaVu Sans covers U+25B6 in the node rasterizer.
      return [
        previewLayer(
          "text",
          {
            content: "▶",
            fontFamily: "DejaVu Sans, Inter Variable, sans-serif",
            fontSize: 150,
            fontWeight: 700,
            u_color: "#f4f4f5",
          },
          "preview-video-label",
        ),
        previewLayer(
          "solid",
          { u_color: "#26262e", layerScale: 58 },
          "preview-video-card",
        ),
        previewLayer("solid", { u_color: "#101014" }, "preview-video-stage"),
      ];

    case "waveFill":
      return [
        previewLayer(type, {
          amplitude: 0.26,
          cycleWidth: 1.15,
          edge: 0.12,
          centerY: 0.55,
        }),
        previewLayer("solid", { u_color: "#0d0b1e" }, "preview-wave-bg"),
      ];

    case "bandFill":
      return [previewLayer(type, { bandY: 0.5, edge: 0.06 })];

    default:
      return [previewLayer(type)];
  }
}

export function getLayerPreviewStack(type: LayerType): LayerInstance[] {
  const template = LAYER_TEMPLATES[type];
  if (!template) return [previewBaseScene()];

  if (template.category === "generator") {
    return generatorStack(type);
  }

  // Chromatic aberration barely shows on the smooth mesh; a hard-edged card
  // in the scene gives the R/B shift crisp fringes to split.
  if (type === "chromaticAberration") {
    return [
      previewLayer(type, EFFECT_OVERRIDES[type] ?? {}),
      previewLayer(
        "solid",
        { u_color: "#f6f2ea", layerScale: 46, layerRotation: 6 },
        "preview-ca-card",
      ),
      previewBaseScene(),
    ];
  }

  // Effects and distortions act on the shared base scene with exaggerated
  // parameters so each treatment is legible at thumbnail size. Layer order is
  // UI order (top first), so the effect sits above the scene it processes.
  return [previewLayer(type, EFFECT_OVERRIDES[type] ?? {}), previewBaseScene()];
}
