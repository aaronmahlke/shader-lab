import {
  applyCompProps,
  evaluatePropertyTrack,
  staticParamValue,
  type CompositionConfig,
  type LayerInstance,
  type PropertyTrack,
} from "@shader-lab/core";
import { cuesForLayer } from "~/composables/use-stage-cues";

/**
 * Everything sound (or an agent) can sync to, in COMP time:
 *   - motion: per animated transform segment, start / speed peak / end
 *     (position combines X/Y/Z into one move per layer)
 *   - press / release: pointer layers (and older cursor images)
 *   - in / out: layer in and out points
 *   - cue: component cues (useStageCues), e.g. keystrokes
 *   - marker: comp markers (settings.markers)
 * Nested comps are walked (props applied), their times shifted into the
 * root comp; every event names its layer path.
 */
export type CompEvent = {
  time: number;
  type: "motion" | "press" | "release" | "in" | "out" | "cue" | "marker";
  layer?: string;
  layerId?: string;
  name?: string;
  /** motion: segment start / end and the speed peak (time + value per second). */
  start?: number;
  end?: number;
  peakSpeed?: number;
  param?: string;
  data?: Record<string, unknown>;
};

const MOTION_PARAMS = [
  "layerScale",
  "layerRotation",
  "layerRotationX",
  "layerRotationY",
  "layerOpacity",
] as const;
const POSITION = ["layerPositionX", "layerPositionY", "layerPositionZ"] as const;

type Ctx = {
  resolveComposition: (id: string) => CompositionConfig | null | undefined;
  /** Comp px for position speeds (root frame). */
  frame: { width: number; height: number };
};

/** Speed peak of a value curve over [a, b] (finite differences, 120 steps). */
function peakOf(f: (t: number) => number, a: number, b: number) {
  const n = 120;
  const dt = (b - a) / n;
  let best = { time: a, speed: 0 };
  let prev = f(a);
  for (let i = 1; i <= n; i++) {
    const t = a + i * dt;
    const v = f(t);
    const speed = Math.abs(v - prev) / dt;
    if (speed > best.speed) best = { time: t - dt / 2, speed };
    prev = v;
  }
  return best;
}

export function collectCompEvents(config: CompositionConfig, ctx: Ctx): CompEvent[] {
  const out: CompEvent[] = [];
  walk(config, "", 0, "", new Set(), 0, ctx, out);
  return out.sort((a, b) => a.time - b.time || a.type.localeCompare(b.type));
}

function walk(
  config: CompositionConfig,
  prefix: string,
  offset: number,
  path: string,
  visited: Set<string>,
  depth: number,
  ctx: Ctx,
  out: CompEvent[],
) {
  const tracks = config.tracks ?? [];
  const trackOf = (layerId: string, param: string): PropertyTrack | undefined =>
    tracks.find((t) => t.layerId === layerId && t.paramName === param && t.enabled && t.keys.length > 1);

  for (const m of (config.settings as { markers?: { time: number; name: string }[] } | undefined)?.markers ?? []) {
    out.push({ time: offset + m.time, type: "marker", name: m.name, layer: path || undefined });
  }

  for (const layer of config.layers) {
    if (!layer.enabled) continue;
    const name = `${path}${layer.name ?? layer.type}`;
    const id = `${prefix}${layer.id}`;
    const base = { layer: name, layerId: id };
    if (layer.timing?.in != null) out.push({ ...base, time: offset + layer.timing.in, type: "in" });
    if (layer.timing?.out != null) out.push({ ...base, time: offset + layer.timing.out, type: "out" });

    // Motion: position as one move (union of X/Y/Z key intervals), the rest per param.
    const pos = POSITION.map((p) => trackOf(layer.id, p));
    const posKeys = [...new Set(pos.flatMap((t) => t?.keys.map((k) => k.time) ?? []))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < posKeys.length; i++) {
      const a = posKeys[i]!;
      const b = posKeys[i + 1]!;
      const at = (t: number, k: number) => {
        const tr = pos[k];
        const p = POSITION[k]!;
        return tr ? evaluatePropertyTrack(tr, t, staticParamValue(layer, p)) : staticParamValue(layer, p);
      };
      const dist = (t: number) => [at(t, 0) * ctx.frame.width, at(t, 1) * ctx.frame.height, at(t, 2) * ctx.frame.height];
      // Speed magnitude in comp px/s.
      const n = 120;
      const dt = (b - a) / n;
      let best = { time: a, speed: 0 };
      let prev = dist(a);
      for (let s = 1; s <= n; s++) {
        const t = a + s * dt;
        const cur = dist(t);
        const speed = Math.hypot(cur[0]! - prev[0]!, cur[1]! - prev[1]!, cur[2]! - prev[2]!) / dt;
        if (speed > best.speed) best = { time: t - dt / 2, speed };
        prev = cur;
      }
      if (best.speed > 1) {
        out.push({ ...base, type: "motion", param: "position", time: offset + best.time, start: offset + a, end: offset + b, peakSpeed: Math.round(best.speed) });
      }
    }
    for (const p of MOTION_PARAMS) {
      const tr = trackOf(layer.id, p);
      if (!tr) continue;
      for (let i = 0; i + 1 < tr.keys.length; i++) {
        const a = tr.keys[i]!.time;
        const b = tr.keys[i + 1]!.time;
        if (tr.keys[i]!.value === tr.keys[i + 1]!.value) continue;
        const peak = peakOf((t) => evaluatePropertyTrack(tr, t, staticParamValue(layer, p)), a, b);
        out.push({ ...base, type: "motion", param: p, time: offset + peak.time, start: offset + a, end: offset + b, peakSpeed: Math.round(peak.speed * 100) / 100 });
      }
    }

    // Pointer presses (pointer layers; older cursor images use cursorPress).
    const pressParam = layer.type === "pointer" ? "press" : Number(layer.values.timelineCursor) === 1 ? "cursorPress" : null;
    if (pressParam) {
      const tr = tracks.find((t) => t.layerId === layer.id && t.paramName === pressParam && t.enabled);
      let down = false;
      for (const k of tr?.keys ?? []) {
        const now = k.value >= 0.5;
        if (now !== down) out.push({ ...base, time: offset + k.time, type: now ? "press" : "release" });
        down = now;
      }
    }

    // Component cues (declared in layer time).
    if (layer.type === "component") {
      for (const c of cuesForLayer(id)) {
        out.push({ ...base, time: offset + (layer.timing?.in ?? 0) + c.time, type: "cue", name: c.name, data: c.data });
      }
    }

    // Nested comps: their own clock starts at the host's in point.
    if (layer.type === "composition" && depth < 4) {
      const compId = typeof layer.values.compRefId === "string" ? layer.values.compRefId : "";
      const nested = compId && !visited.has(compId) ? ctx.resolveComposition(compId) : null;
      if (nested) {
        walk(
          applyCompProps(nested, layer as LayerInstance),
          `${id}::`,
          offset + (layer.timing?.in ?? 0),
          `${name} › `,
          new Set([...visited, compId]),
          depth + 1,
          ctx,
          out,
        );
      }
    }
  }
}
