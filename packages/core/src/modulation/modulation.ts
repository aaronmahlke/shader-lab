/** Params where base 0 should fully disable the effect (LFO does not add on top). */
const ZERO_BASE_PARAMS = new Set([
  "amplitude",
  "grainIntensity",
  "vignetteIntensity",
  "vignetteRadius",
  "vignetteSoftness",
  "amount",
  "blend",
  "ditherScale",
  "levels",
]);

export function applyModulation(
  baseValue: number,
  paramName: string,
  lfoValue: number,
  depth: number,
): number {
  if (ZERO_BASE_PARAMS.has(paramName) && Math.abs(baseValue) < 1e-6) {
    return 0;
  }
  return baseValue + lfoValue * depth;
}
