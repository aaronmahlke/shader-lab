import type { CompositionSettings, LayerInstance, PropertyTrack } from "@shader-lab/core";

/**
 * Sound rules: "on <event> play <sound>". Not clips, so not on the timeline.
 *
 *   Project rules: <project>/sound-rules.json  { "rules": [...] }  (a sound kit for every comp)
 *   Comp rules:    settings.soundRules                             (extras / overrides)
 *
 * A comp rule with the same id as a project rule replaces it (enabled: false
 * turns it off for this comp). Rules only run in the comp being played or
 * rendered; events from its precomps are collected into it, so a nested
 * press still sounds exactly once.
 *
 * Internally each rule becomes a virtual audio layer (id "rule:<id>") with a
 * trigger, so the mixer, effects, ducking, export and meter treat it like any
 * strip. Keys / fx automation use layerId "rule:<id>".
 */
export type SoundRule = {
  id: string;
  /** Display name. */
  label?: string;
  enabled?: boolean;
  /** Sound: a media URL or "synth:{…}". */
  src: string;
  on: "press" | "release" | "motionPeak" | "motionStart" | "motionEnd" | "in" | "out" | "cue" | "marker";
  /** Only events of this layer (or anything inside this precomp). */
  target?: string;
  /** Cue / marker name filter. */
  name?: string;
  anchor?: "onset" | "peak" | "end";
  offsetMs?: number;
  fit?: boolean;
  minMs?: number;
  alternates?: string[];
  pitchJitter?: number;
  gainJitter?: number;
  seed?: number;
  /** dB. */
  volume?: number;
  /** −1 … 1. */
  pan?: number;
  effects?: unknown[];
  muted?: boolean;
  solo?: boolean;
  /** Only events in this comp-time window fire (pick one move / one moment). */
  window?: { from?: number; to?: number };
};

export const RULE_LAYER_PREFIX = "rule:";
export const ruleLayerId = (ruleId: string) => `${RULE_LAYER_PREFIX}${ruleId}`;
export const isRuleLayerId = (id: string) => id.startsWith(RULE_LAYER_PREFIX);

/** Project rules + comp rules (comp wins by id), enabled ones in order. */
export function effectiveRules(project: readonly SoundRule[], comp: readonly SoundRule[]): { rule: SoundRule; scope: "project" | "comp" }[] {
  const compById = new Map(comp.map((r) => [r.id, r]));
  const out: { rule: SoundRule; scope: "project" | "comp" }[] = [];
  for (const r of project) {
    const o = compById.get(r.id);
    out.push(o ? { rule: o, scope: "comp" } : { rule: r, scope: "project" });
  }
  const projectIds = new Set(project.map((r) => r.id));
  for (const r of comp) if (!projectIds.has(r.id)) out.push({ rule: r, scope: "comp" });
  return out.filter((x) => x.rule.enabled !== false && !!x.rule.src);
}

/**
 * Virtual audio layer for a rule. `values` IS the rule object, so mixer
 * edits (volume, pan) write straight into the rule.
 */
export function ruleLayer(rule: SoundRule): LayerInstance {
  return {
    id: ruleLayerId(rule.id),
    type: "audio",
    name: rule.label || defaultRuleLabel(rule),
    enabled: true,
    ...(rule.window ? { timing: { in: rule.window.from ?? -1e6, out: rule.window.to ?? 1e6 } } : {}),
    values: rule as unknown as LayerInstance["values"],
    trigger: rule as unknown as LayerInstance["trigger"],
    audioEffects: rule.effects as LayerInstance["audioEffects"],
    audioMuted: rule.muted,
    audioSolo: rule.solo,
  } as LayerInstance;
}

export function defaultRuleLabel(rule: SoundRule): string {
  const what = rule.on === "cue" || rule.on === "marker" ? `${rule.on}${rule.name ? ` "${rule.name}"` : ""}` : rule.on;
  return `On ${what}`;
}

/**
 * Old comps: audio layers with a `trigger` become comp rules (same ids).
 * Their tracks and duck sources move to "rule:<id>". Mutates; returns
 * whether anything changed.
 */
export function migrateTriggerLayers(doc: { layers: LayerInstance[]; tracks: PropertyTrack[]; settings: CompositionSettings }): boolean {
  const triggered = doc.layers.filter((l) => l.type === "audio" && l.trigger && typeof (l.trigger as { on?: unknown }).on === "string");
  if (!triggered.length) return false;
  const rules: SoundRule[] = [...((doc.settings.soundRules as SoundRule[] | undefined) ?? [])];
  const moved = new Set<string>();
  for (const l of triggered) {
    const t = l.trigger as Omit<SoundRule, "id" | "src">;
    const v = l.values;
    const rule: SoundRule = {
      ...t,
      id: l.id,
      label: l.name,
      src: String(v.src ?? ""),
      volume: typeof v.volume === "number" ? v.volume : undefined,
      pan: typeof v.pan === "number" ? v.pan : undefined,
      effects: l.audioEffects as unknown[] | undefined,
      muted: l.audioMuted || undefined,
      solo: l.audioSolo || undefined,
      enabled: l.enabled === false ? false : undefined,
    };
    // A trigger layer's in/out limited where it may fire; keep that as a window.
    if (l.timing && (l.timing.in != null || l.timing.out != null)) {
      rule.window = {};
      if (l.timing.in != null && l.timing.in > 0) rule.window.from = l.timing.in;
      if (l.timing.out != null) rule.window.to = l.timing.out;
      if (rule.window.from == null && rule.window.to == null) delete rule.window;
    }
    for (const k of Object.keys(rule) as (keyof SoundRule)[]) if (rule[k] === undefined) delete rule[k];
    rules.push(rule);
    moved.add(l.id);
  }
  doc.layers.splice(0, doc.layers.length, ...doc.layers.filter((l) => !moved.has(l.id)));
  for (const t of doc.tracks) if (moved.has(t.layerId)) t.layerId = ruleLayerId(t.layerId);
  // Duck effects pointing at a moved layer follow it.
  const fixFx = (fx: unknown) => {
    for (const e of (fx as { source?: string }[] | undefined) ?? []) if (e.source && moved.has(e.source)) e.source = ruleLayerId(e.source);
  };
  for (const l of doc.layers) fixFx(l.audioEffects);
  for (const r of rules) fixFx(r.effects);
  fixFx(doc.settings.masterEffects);
  doc.settings.soundRules = rules as CompositionSettings["soundRules"];
  return true;
}
