/** Distinct colors for LFO modulation sources, oklch-based palette */
export const LFO_COLORS = [
  "#6CB4EE", // soft blue
  "#77DD77", // pastel green
  "#FFB347", // pastel orange
  "#FF6B6B", // soft red
  "#C39BD3", // soft purple
  "#F0E68C", // soft yellow
  "#87CEEB", // sky blue
  "#FFA07A", // light salmon
] as const;

export function nextLfoColor(existingColors: string[]): string {
  for (const color of LFO_COLORS) {
    if (!existingColors.includes(color)) return color;
  }
  return LFO_COLORS[existingColors.length % LFO_COLORS.length]!;
}
