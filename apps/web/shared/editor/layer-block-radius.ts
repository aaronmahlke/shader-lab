export type LayerBlockRole = "none" | "single" | "top" | "middle" | "bottom";

export type LayerBlockMode = "contiguous-runs" | "single-block";

/** Role of a row inside a selected / dragged visual block. */
export function layerBlockRole(
  index: number,
  indices: number[],
  mode: LayerBlockMode,
): LayerBlockRole {
  if (!indices.includes(index)) return "none";

  const sorted = [...indices].sort((a, b) => a - b);
  if (mode === "single-block") {
    if (sorted.length === 1) return "single";
    const pos = sorted.indexOf(index);
    if (pos === 0) return "top";
    if (pos === sorted.length - 1) return "bottom";
    return "middle";
  }

  let run: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const idx = sorted[i]!;
    if (idx === sorted[i - 1]! + 1) {
      run.push(idx);
      continue;
    }
    const role = roleInRun(index, run);
    if (role !== "none") return role;
    run = [idx];
  }
  return roleInRun(index, run);
}

function roleInRun(index: number, run: number[]): LayerBlockRole {
  const pos = run.indexOf(index);
  if (pos === -1) return "none";
  if (run.length === 1) return "single";
  if (pos === 0) return "top";
  if (pos === run.length - 1) return "bottom";
  return "middle";
}

export function layerBlockRadiusClass(role: LayerBlockRole): string {
  switch (role) {
    case "top":
      return "rounded-t-lg rounded-b-none";
    case "middle":
      return "rounded-none";
    case "bottom":
      return "rounded-b-lg rounded-t-none";
    case "single":
      return "rounded-lg";
    default:
      return "rounded-lg";
  }
}

/** Pull row up to hide flex gap between connected block members. */
export function layerBlockOverlapClass(
  index: number,
  indices: number[],
  mode: LayerBlockMode,
): string {
  const role = layerBlockRole(index, indices, mode);
  if (role !== "middle" && role !== "bottom") return "";

  if (mode === "single-block") {
    const sorted = [...indices].sort((a, b) => a - b);
    const pos = sorted.indexOf(index);
    if (pos <= 0 || sorted[pos]! !== sorted[pos - 1]! + 1) return "";
  } else if (!indices.includes(index - 1)) {
    return "";
  }

  return "-mt-px";
}

export function layerHeaderBlockRole(
  index: number,
  selectedIndices: number[],
  draggingIndices: number[],
): LayerBlockRole {
  if (draggingIndices.includes(index)) {
    return layerBlockRole(index, draggingIndices, "single-block");
  }
  if (selectedIndices.includes(index)) {
    return layerBlockRole(index, selectedIndices, "contiguous-runs");
  }
  return "none";
}

export function layerBlockOverlapsPrevious(
  index: number,
  indices: number[],
  mode: LayerBlockMode,
): boolean {
  return layerBlockOverlapClass(index, indices, mode) === "-mt-px";
}
