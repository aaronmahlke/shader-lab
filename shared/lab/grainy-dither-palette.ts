export type PaletteRgb = readonly [number, number, number];

/** Reference palette for chromatic diffusion dither. */
export const GRAINY_DITHER_PALETTE: PaletteRgb[] = [
  [36, 32, 36],
  [52, 34, 158],
  [224, 128, 192],
  [232, 198, 180],
  [248, 240, 232],
  [168, 198, 58],
];
