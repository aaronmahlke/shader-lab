import type { CompositionSettings, LayerInstance, PropertyTrack } from "@shader-lab/core";

/**
 * Mix versions: a snapshot of everything that makes the comp's SOUND (audio
 * layers + their keys, precomp bus settings + keys, master volume and
 * effects), so mixes can be A/B'd on the same picture. Stored in
 * `settings.mixVersions`; `settings.activeMix` names the one in use.
 */
export type MixVersion = {
  id: string;
  name: string;
  createdAt: string;
  audioLayers: LayerInstance[];
  /** Bus fields per precomp layer id. */
  buses: Record<string, Partial<Pick<LayerInstance, "audioEffects" | "audioMuted" | "audioSolo">> & { audioVolume?: unknown; audioPan?: unknown }>;
  /** Keys of audio layers, bus params (audioVolume/audioPan/fx:…) and master fx. */
  tracks: PropertyTrack[];
  masterVolume?: number;
  masterEffects?: CompositionSettings["masterEffects"];
};

const isBusParam = (p: string) => p === "audioVolume" || p === "audioPan" || p.startsWith("fx:");

export function snapshotMix(name: string, layers: readonly LayerInstance[], tracks: readonly PropertyTrack[], settings: CompositionSettings): MixVersion {
  const audio = layers.filter((l) => l.type === "audio");
  const audioIds = new Set(audio.map((l) => l.id));
  const buses: MixVersion["buses"] = {};
  for (const l of layers) {
    if (l.type !== "composition") continue;
    buses[l.id] = {
      audioVolume: l.values.audioVolume,
      audioPan: l.values.audioPan,
      audioEffects: l.audioEffects,
      audioMuted: l.audioMuted,
      audioSolo: l.audioSolo,
    };
  }
  return JSON.parse(
    JSON.stringify({
      id: Math.random().toString(36).slice(2, 10),
      name,
      createdAt: new Date().toISOString(),
      audioLayers: audio,
      buses,
      tracks: tracks.filter((t) => audioIds.has(t.layerId) || t.layerId === "master" || isBusParam(t.paramName)),
      masterVolume: settings.masterVolume,
      masterEffects: settings.masterEffects,
    } satisfies MixVersion),
  );
}

/** The comp with a mix version's sound swapped in (picture untouched). */
export function applyMix(v: MixVersion, layers: readonly LayerInstance[], tracks: readonly PropertyTrack[], settings: CompositionSettings) {
  const copy = JSON.parse(JSON.stringify(v)) as MixVersion;
  const nextLayers = layers
    .filter((l) => l.type !== "audio")
    .map((l) => {
      const bus = l.type === "composition" ? copy.buses[l.id] : undefined;
      if (!bus) return l;
      const next: LayerInstance = { ...l, values: { ...l.values, audioVolume: bus.audioVolume ?? 0, audioPan: bus.audioPan ?? 0 } };
      for (const k of ["audioEffects", "audioMuted", "audioSolo"] as const) {
        if (bus[k] === undefined) delete next[k];
        else (next as Record<string, unknown>)[k] = bus[k];
      }
      return next;
    });
  nextLayers.push(...copy.audioLayers);
  const oldAudio = new Set(layers.filter((l) => l.type === "audio").map((l) => l.id));
  const nextTracks = tracks.filter((t) => !oldAudio.has(t.layerId) && t.layerId !== "master" && !isBusParam(t.paramName)).concat(copy.tracks);
  const nextSettings: CompositionSettings = { ...settings, masterVolume: copy.masterVolume, masterEffects: copy.masterEffects, activeMix: copy.id } as CompositionSettings;
  return { layers: nextLayers, tracks: nextTracks, settings: nextSettings };
}
