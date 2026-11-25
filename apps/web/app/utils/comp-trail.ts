/**
 * Nested-comp navigation ("drill in"), kept in the URL so reloads and the
 * back button work:
 *
 *   /shader/<child>?trail=<root>~<in>~<out>,<mid>~<in>~<out>&t=<seconds>
 *
 * Each step is an ancestor comp plus the timing of the layer in it that hosts
 * the next level: `in` maps parent time to child time (child = parent - in),
 * `out` (optional) is where that layer ends, so the child can show which part
 * of it the parent actually uses. A comp opened without a trail (tab, project
 * panel) is standalone: no breadcrumb, no time sync.
 */
export type TrailStep = { id: string; in: number; out: number | null };

export function parseTrail(raw: unknown): TrailStep[] {
  if (typeof raw !== "string" || !raw) return [];
  return raw
    .split(",")
    .map((part) => {
      const [id, inRaw, outRaw] = part.split("~");
      if (!id) return null;
      const inT = Number(inRaw);
      const outT = outRaw ? Number(outRaw) : NaN;
      return { id, in: Number.isFinite(inT) ? inT : 0, out: Number.isFinite(outT) ? outT : null };
    })
    .filter((s): s is TrailStep => s !== null);
}

export function serializeTrail(steps: TrailStep[]): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  return steps.map((s) => [s.id, n(s.in), s.out != null ? n(s.out) : ""].join("~")).join(",");
}

/** URL for a comp at `time`, reached through `trail` (empty = standalone). */
export function compUrl(compId: string, trail: TrailStep[] = [], time?: number): string {
  const q = new URLSearchParams();
  if (trail.length) q.set("trail", serializeTrail(trail));
  if (time != null && time > 0) q.set("t", String(Math.round(time * 1000) / 1000));
  const qs = q.toString();
  return `/shader/${compId}${qs ? `?${qs}` : ""}`;
}
