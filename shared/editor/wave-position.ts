export const WAVE_POS_X = "cycleX" as const;
export const WAVE_POS_Y = "centerY" as const;
export const WAVE_AMPLITUDE = "amplitude" as const;
export const WAVE_CYCLE_WIDTH = "cycleWidth" as const;

/** Finer snap than slider steps so canvas dragging feels continuous. */
export const WAVE_GIZMO_STEPS = {
  position: 0.001,
  amplitude: 0.001,
  cycleWidth: 0.001,
} as const;

/**
 * Sine-shelf is flat at the cycle edges; the visible dome is much narrower than
 * cycleWidth. Gizmo ellipse/handles use this fraction of the shader value.
 */
export const WAVE_GIZMO_CYCLE_VISUAL = 0.4;

export function waveGizmoVisualCycleWidth(cycleWidth: number): number {
  return cycleWidth * WAVE_GIZMO_CYCLE_VISUAL;
}

export function waveGizmoVisualHalfWidth(cycleWidth: number): number {
  return waveGizmoVisualCycleWidth(cycleWidth) * 0.5;
}

export type ShaderNorm = { x: number; y: number };

export type DragMode = "move" | "n" | "s" | "e" | "w";

export type WaveGizmoRanges = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xStep: number;
  yStep: number;
  ampMin: number;
  ampMax: number;
  ampStep: number;
  widthMin: number;
  widthMax: number;
  widthStep: number;
};

export type WaveGizmoValues = {
  cycleX: number;
  centerY: number;
  amplitude: number;
  cycleWidth: number;
};

export function snap(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/** Shader space (y=0 bottom) → CSS top % for an overlay on the canvas. */
export function waveShaderYToCssPercent(shaderY: number): number {
  return (1 - shaderY) * 100;
}

export function clientToShaderNorm(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): ShaderNorm | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: (clientX - rect.left) / rect.width,
    y: 1 - (clientY - rect.top) / rect.height,
  };
}

export function hitWaveGizmoHandle(
  norm: ShaderNorm,
  rect: DOMRect,
  values: WaveGizmoValues,
  hitPx = 14,
): DragMode {
  const handles: { mode: Exclude<DragMode, "move">; x: number; y: number }[] = [
    { mode: "n", x: values.cycleX, y: values.centerY + values.amplitude },
    { mode: "s", x: values.cycleX, y: values.centerY - values.amplitude },
    {
      mode: "e",
      x: values.cycleX + waveGizmoVisualHalfWidth(values.cycleWidth),
      y: values.centerY,
    },
    {
      mode: "w",
      x: values.cycleX - waveGizmoVisualHalfWidth(values.cycleWidth),
      y: values.centerY,
    },
  ];

  const hitPxSq = hitPx * hitPx;
  for (const handle of handles) {
    const dx = (norm.x - handle.x) * rect.width;
    const dy = (norm.y - handle.y) * rect.height;
    if (dx * dx + dy * dy <= hitPxSq) return handle.mode;
  }

  return "move";
}

export type WaveGizmoDragOptions = {
  proportional?: boolean;
  dragStart?: WaveGizmoValues;
};

function withProportionalScale(
  start: WaveGizmoValues,
  primaryAxis: "amplitude" | "cycleWidth",
  amplitude: number,
  cycleWidth: number,
  ranges: WaveGizmoRanges,
  proportional: boolean,
): Pick<WaveGizmoValues, "amplitude" | "cycleWidth"> {
  if (!proportional) return { amplitude, cycleWidth };

  if (primaryAxis === "cycleWidth" && start.cycleWidth > 1e-6) {
    const ratio = cycleWidth / start.cycleWidth;
    return {
      cycleWidth,
      amplitude: snap(
        start.amplitude * ratio,
        ranges.ampMin,
        ranges.ampMax,
        ranges.ampStep,
      ),
    };
  }

  if (primaryAxis === "amplitude" && start.amplitude > 1e-6) {
    const ratio = amplitude / start.amplitude;
    return {
      amplitude,
      cycleWidth: snap(
        start.cycleWidth * ratio,
        ranges.widthMin,
        ranges.widthMax,
        ranges.widthStep,
      ),
    };
  }

  return { amplitude, cycleWidth };
}

export function dragWaveGizmo(
  mode: DragMode,
  norm: ShaderNorm,
  current: WaveGizmoValues,
  ranges: WaveGizmoRanges,
  options: WaveGizmoDragOptions = {},
): WaveGizmoValues {
  const { proportional = false, dragStart = current } = options;

  if (mode === "move") {
    return {
      ...current,
      cycleX: snap(norm.x, ranges.xMin, ranges.xMax, ranges.xStep),
      centerY: snap(norm.y, ranges.yMin, ranges.yMax, ranges.yStep),
    };
  }

  if (mode === "n") {
    const amplitude = snap(
      norm.y - current.centerY,
      ranges.ampMin,
      ranges.ampMax,
      ranges.ampStep,
    );
    const scaled = withProportionalScale(
      dragStart,
      "amplitude",
      amplitude,
      current.cycleWidth,
      ranges,
      proportional,
    );
    return { ...current, ...scaled };
  }

  if (mode === "s") {
    const amplitude = snap(
      current.centerY - norm.y,
      ranges.ampMin,
      ranges.ampMax,
      ranges.ampStep,
    );
    const scaled = withProportionalScale(
      dragStart,
      "amplitude",
      amplitude,
      current.cycleWidth,
      ranges,
      proportional,
    );
    return { ...current, ...scaled };
  }

  if (mode === "e") {
    const cycleWidth = snap(
      ((norm.x - current.cycleX) * 2) / WAVE_GIZMO_CYCLE_VISUAL,
      ranges.widthMin,
      ranges.widthMax,
      ranges.widthStep,
    );
    const scaled = withProportionalScale(
      dragStart,
      "cycleWidth",
      current.amplitude,
      cycleWidth,
      ranges,
      proportional,
    );
    return { ...current, ...scaled };
  }

  const cycleWidth = snap(
    ((current.cycleX - norm.x) * 2) / WAVE_GIZMO_CYCLE_VISUAL,
    ranges.widthMin,
    ranges.widthMax,
    ranges.widthStep,
  );
  const scaled = withProportionalScale(
    dragStart,
    "cycleWidth",
    current.amplitude,
    cycleWidth,
    ranges,
    proportional,
  );
  return { ...current, ...scaled };
}
