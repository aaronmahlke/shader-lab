export type DesignCanvas = {
  width: number;
  height: number;
};

export const EXPORT_SCALE_MULTIPLIERS = [
  { label: "1×", multiplier: 1 },
  { label: "2×", multiplier: 2 },
  { label: "4×", multiplier: 4 },
] as const;

export function scaledExportSize(
  canvas: DesignCanvas,
  multiplier: number,
): DesignCanvas {
  return {
    width: Math.max(1, Math.round(canvas.width * multiplier)),
    height: Math.max(1, Math.round(canvas.height * multiplier)),
  };
}
