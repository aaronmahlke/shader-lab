export function maxLayerNumericSuffix(layers: { id: string }[]): number {
  let max = 0;
  for (const layer of layers) {
    const match = layer.id.match(/-(\d+)$/);
    if (!match) continue;
    const n = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

export function createUniqueLayerId(
  type: string,
  existing: { id: string }[],
  counter: { value: number },
): string {
  const taken = new Set(existing.map((layer) => layer.id));
  let id: string;
  do {
    id = `${type}-${++counter.value}`;
  } while (taken.has(id));
  return id;
}

export function syncLayerIdCounter(
  layers: { id: string }[],
  counter: { value: number },
  floor = 100,
) {
  counter.value = Math.max(floor, maxLayerNumericSuffix(layers));
}
