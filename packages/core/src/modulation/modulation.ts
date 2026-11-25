/** Params where base 0 should fully disable the effect (LFO does not add on top). */
const ZERO_BASE_PARAMS = new Set([
  "amplitude",
  "grainIntensity",
  "vignetteIntensity",
  "vignetteRadius",
  "vignetteSoftness",
  "amount",
  "ditherScale",
  "levels",
]);

/** True when a zero base switches the param off, so modulators must not lift it. */
export function isZeroBaseDisabled(paramName: string, baseValue: number): boolean {
  return ZERO_BASE_PARAMS.has(paramName) && Math.abs(baseValue) < 1e-6;
}

export function applyModulation(
  baseValue: number,
  paramName: string,
  lfoValue: number,
  depth: number,
): number {
  if (isZeroBaseDisabled(paramName, baseValue)) {
    return 0;
  }
  return baseValue + lfoValue * depth;
}
