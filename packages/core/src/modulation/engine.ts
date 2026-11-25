import type { PropertyTrack } from "../types/animation";
import type { CompositionConfig } from "../types/composition";
import type { EnvelopeSource, LayerInstance, LFOSource, ModulationAssignment } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";
import { evaluatePropertyTrack, findPropertyTrack, integrateKeyframes } from "../animation/property-tracks";
import { isZeroBaseDisabled } from "./modulation";
import { evaluateLfoWave, getLfoWaveShape } from "./lfo-wave";
import { evaluateEnvelope } from "./envelope";
import { computeEffectorInfluence, type EffectorInfluence, type ParamReader } from "./effectors";

/** Track `layerId` for a modulator's own params (LFO: rate, phase; envelope: attack, decay, sustain, gate, release). */
export function sourceTrackLayerId(sourceId: string): string {
  return `mod:${sourceId}`;
}

/** Stable key for a link; used for its keyframe tracks. */
export function linkKey(link: ModulationAssignment): string {
  return link.id ?? `${link.sourceId}>${link.layerId}>${link.paramName}`;
}

/** Track `layerId` for a link's params (`depth`, `enabled` — enabled is on when ≥ 0.5). */
export function linkTrackLayerId(link: ModulationAssignment): string {
  return `link:${linkKey(link)}`;
}

/** Links targeting a property, in stack order. */
export function linksFor(
  links: readonly ModulationAssignment[],
  layerId: string,
  paramName: string,
): ModulationAssignment[] {
  return links.filter((a) => a.layerId === layerId && a.paramName === paramName);
}

/** Wave phase (0..1, before playback mode) after `cycles` LFO cycles. */
function wavePosition(lfo: LFOSource, cycles: number): number {
  if (lfo.mode === "pingpong") {
    const raw = ((cycles % 2) + 2) % 2;
    return raw > 1 ? 2 - raw : raw;
  }
  return ((cycles % 1) + 1) % 1;
}

/**
 * Evaluates modulators (LFOs, envelopes) and stacks their links on top of a
 * property's base value. Modulator params and link depth/enabled read from
 * keyframe tracks when present, so everything on a link is animatable.
 */
export class ModulationEngine {
  private lfos: LFOSource[] = [];
  private envelopes: EnvelopeSource[] = [];
  private assignments: ModulationAssignment[] = [];
  private tracks: PropertyTrack[] = [];
  private layerIn = new Map<string, number>();
  private layersById = new Map<string, LayerInstance>();
  private effectors: LayerInstance[] = [];
  private aspect = 16 / 9;
  /** Per-frame cache: target layer id → effector influence (null = untouched). */
  private influenceCache = new Map<string, EffectorInfluence | null>();
  private lfoValues: Record<string, number> = {};
  private time = 0;
  private sampled = false;
  /** Per-frame cache: `${sourceId}@${localTime}` → signal. */
  private cache = new Map<string, number>();

  setLfos(lfos: LFOSource[]): void {
    this.lfos = lfos;
    this.invalidate();
  }

  setEnvelopes(envelopes: EnvelopeSource[]): void {
    this.envelopes = envelopes;
    this.invalidate();
  }

  setAssignments(assignments: ModulationAssignment[]): void {
    this.assignments = assignments;
  }

  /** Keyframe tracks (link + modulator param tracks are read from here). */
  setTracks(tracks: PropertyTrack[]): void {
    if (tracks === this.tracks) return;
    this.tracks = tracks;
    this.invalidate();
  }

  /** Layers, for links on the "layer" time base (offset by the layer's in-point). */
  setLayers(layers: LayerInstance[]): void {
    this.layerIn = new Map(layers.map((l) => [l.id, l.timing?.in ?? 0]));
    this.layersById = new Map(layers.map((l) => [l.id, l]));
    this.effectors = layers.filter((l) => l.type === "effector");
    this.influenceCache.clear();
  }

  /** Comp width / height, so effector radii are round on screen. */
  setAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0 || aspect === this.aspect) return;
    this.aspect = aspect;
    this.influenceCache.clear();
  }

  getLayer(id: string): LayerInstance | undefined {
    return this.layersById.get(id);
  }

  hasEffectors(): boolean {
    return this.effectors.length > 0;
  }

  /**
   * Combined effector influence on a layer at the sampled time. `read` must
   * return params after keyframes + links (not effectors), so effector
   * positions can be animated without feeding back into themselves.
   */
  effectorInfluence(layerId: string, read: ParamReader): EffectorInfluence | null {
    if (this.effectors.length === 0) return null;
    const cached = this.influenceCache.get(layerId);
    if (cached !== undefined) return cached;
    const layer = this.layersById.get(layerId);
    const influence = layer
      ? computeEffectorInfluence(layer, this.effectors, read, this.aspect, this.time)
      : null;
    this.influenceCache.set(layerId, influence);
    return influence;
  }

  /** Load everything modulation reads from a composition. */
  setConfig(
    config: Pick<CompositionConfig, "layers" | "lfos" | "envelopes" | "assignments" | "tracks"> &
      Partial<Pick<CompositionConfig, "settings">>,
  ): void {
    this.lfos = config.lfos ?? [];
    this.envelopes = config.envelopes ?? [];
    this.assignments = config.assignments ?? [];
    this.tracks = config.tracks ?? [];
    this.setLayers(config.layers ?? []);
    const settings = config.settings;
    if (settings && settings.height > 0) this.setAspect(settings.width / settings.height);
    this.invalidate();
  }

  sampleAt(clockSeconds: number): void {
    this.time = clockSeconds;
    this.sampled = true;
    this.cache.clear();
    this.influenceCache.clear();

    const values: Record<string, number> = {};
    for (const lfo of this.lfos) values[lfo.id] = this.signal(lfo.id, clockSeconds);
    for (const env of this.envelopes) values[env.id] = this.signal(env.id, clockSeconds);
    this.lfoValues = values;
  }

  /** Sample only if `clockSeconds` differs from the current sample time. */
  ensureSampled(clockSeconds: number): void {
    if (!this.sampled || this.time !== clockSeconds) this.sampleAt(clockSeconds);
  }

  getModulatedValue: ModulationFn = (layerId, paramName, baseValue) => {
    let value = baseValue;
    let touched = false;

    for (const link of this.assignments) {
      if (link.layerId !== layerId || link.paramName !== paramName) continue;
      if (!touched) {
        if (isZeroBaseDisabled(paramName, baseValue)) return 0;
        touched = true;
      }

      const trackLayer = linkTrackLayerId(link);
      const enabled = this.trackValue(trackLayer, "enabled", link.enabled === false ? 0 : 1);
      if (enabled < 0.5) continue;

      const depth = this.trackValue(trackLayer, "depth", link.depth);
      const local = link.timeBase === "layer" ? this.time - (this.layerIn.get(layerId) ?? 0) : this.time;
      value += this.signal(link.sourceId, local) * depth;
    }

    return value;
  };

  /** Modulator signals (0..1) at the sampled comp time, keyed by source id. */
  getLfoValues(): Record<string, number> {
    return { ...this.lfoValues };
  }

  createModulationFn(clockSeconds: number): ModulationFn {
    this.sampleAt(clockSeconds);
    return this.getModulatedValue;
  }

  /** Signal (0..1) of a modulator at `time` on its own clock; 0 for unknown ids. */
  signal(sourceId: string, time: number): number {
    const key = `${sourceId}@${time}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    let value = 0;
    const lfo = this.lfos.find((l) => l.id === sourceId);
    if (lfo) {
      value = this.lfoSignal(lfo, time);
    } else {
      const env = this.envelopes.find((e) => e.id === sourceId);
      if (env) value = this.envelopeSignal(env, time);
    }

    this.cache.set(key, value);
    return value;
  }

  private lfoSignal(lfo: LFOSource, time: number): number {
    const trackLayer = sourceTrackLayerId(lfo.id);
    const rateTrack = findPropertyTrack(this.tracks, trackLayer, "rate");
    // Phase accumulates ∫ rate dt so a keyframed rate never makes the wave jump.
    const cycles = rateTrack?.enabled && rateTrack.keys.length > 0
      ? integrateKeyframes(rateTrack.keys, 0, time, lfo.rate)
      : time * lfo.rate;
    const phase = this.trackValue(trackLayer, "phase", lfo.phase, time);
    const t = Math.max(0, Math.min(1, wavePosition(lfo, cycles + phase / 360)));
    return evaluateLfoWave(getLfoWaveShape(lfo), lfo.points, t);
  }

  private envelopeSignal(env: EnvelopeSource, time: number): number {
    const trackLayer = sourceTrackLayerId(env.id);
    const shape = {
      attack: this.trackValue(trackLayer, "attack", env.attack, time),
      decay: this.trackValue(trackLayer, "decay", env.decay, time),
      sustain: this.trackValue(trackLayer, "sustain", env.sustain, time),
      gate: this.trackValue(trackLayer, "gate", env.gate, time),
      release: this.trackValue(trackLayer, "release", env.release, time),
    };
    return evaluateEnvelope(shape, env.triggers ?? [0], time);
  }

  private trackValue(layerId: string, paramName: string, fallback: number, time = this.time): number {
    const track = findPropertyTrack(this.tracks, layerId, paramName);
    return evaluatePropertyTrack(track, time, fallback);
  }

  private invalidate(): void {
    this.cache.clear();
    this.influenceCache.clear();
    if (this.sampled) this.sampleAt(this.time);
  }
}

export function createModulationFn(
  lfos: LFOSource[],
  assignments: ModulationAssignment[],
  clockSeconds: number,
): ModulationFn {
  const engine = new ModulationEngine();
  engine.setLfos(lfos);
  engine.setAssignments(assignments);
  return engine.createModulationFn(clockSeconds);
}
