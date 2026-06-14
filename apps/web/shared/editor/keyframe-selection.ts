export type KeyframeSelection = {
  layerId: string;
  paramName: string;
  time: number;
};

export function isSameKeyframe(
  a: KeyframeSelection | null | undefined,
  b: KeyframeSelection | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.layerId === b.layerId &&
    a.paramName === b.paramName &&
    Math.abs(a.time - b.time) < 1e-6
  );
}

export function isKeyframeInSelection(
  selection: KeyframeSelection[],
  layerId: string,
  paramName: string,
  time: number,
): boolean {
  return selection.some((k) => isSameKeyframe(k, { layerId, paramName, time }));
}

export function toggleKeyframeInSelection(
  selection: KeyframeSelection[],
  key: KeyframeSelection,
): KeyframeSelection[] {
  const idx = selection.findIndex((k) => isSameKeyframe(k, key));
  if (idx >= 0) {
    return selection.filter((_, i) => i !== idx);
  }
  return [...selection, key];
}

export function keyframeKey(key: KeyframeSelection): string {
  return `${key.layerId}:${key.paramName}:${key.time}`;
}
