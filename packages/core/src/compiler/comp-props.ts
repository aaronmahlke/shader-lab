import type { CompositionConfig } from "../types/composition";
import type { LayerInstance } from "../types/editor";

/**
 * Comp props: a comp exposes chosen layer settings (an image's source, a
 * text, a number, a component's pointer…) and every precomp layer using it
 * can set its own value — same motion, different content per instance.
 *
 * Declared on the comp (`settings.props`), set on the host composition layer
 * (`values.props[propId]`); unset props keep the inner value. Applied by
 * substituting the bound layers' values when the nested comp is expanded, so
 * compile, rendering, media and component staging all see the same thing.
 */
export type CompProp = {
  id: string;
  /** Shown on the precomp layer. */
  name: string;
  /** Inner layer + setting the prop drives. */
  layerId: string;
  param: string;
};

export function compPropsOf(config: Pick<CompositionConfig, "settings"> | null | undefined): CompProp[] {
  const list = (config?.settings as { props?: unknown } | undefined)?.props;
  return Array.isArray(list)
    ? list.filter(
        (p): p is CompProp =>
          !!p && typeof p.id === "string" && typeof p.layerId === "string" && typeof p.param === "string",
      )
    : [];
}

/** The host layer's prop values (propId → value). */
export function hostPropValues(host: LayerInstance | null | undefined): Record<string, unknown> {
  const raw = host?.values.props;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

const cache = new WeakMap<CompositionConfig, Map<string, CompositionConfig>>();

/**
 * The nested comp as this host instance sees it: bound layer values replaced
 * by the host's prop values. Returns the config itself when nothing applies;
 * cached per (config, values) so identities stay stable frame to frame.
 */
export function applyCompProps(config: CompositionConfig, host: LayerInstance | null | undefined): CompositionConfig {
  const props = compPropsOf(config);
  if (!props.length) return config;
  const values = hostPropValues(host);
  const overrides = props.filter((p) => values[p.id] !== undefined && values[p.id] !== "");
  if (!overrides.length) return config;

  const key = JSON.stringify(overrides.map((p) => [p.layerId, p.param, values[p.id]]));
  let byKey = cache.get(config);
  if (!byKey) cache.set(config, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;

  const perLayer = new Map<string, Record<string, unknown>>();
  for (const p of overrides) {
    const v = perLayer.get(p.layerId) ?? {};
    v[p.param] = values[p.id];
    perLayer.set(p.layerId, v);
  }
  const next: CompositionConfig = {
    ...config,
    layers: config.layers.map((l) => {
      const o = perLayer.get(l.id);
      return o ? { ...l, values: { ...l.values, ...o } } : l;
    }),
  };
  // A prop that's keyframed inside: the instance value wins (drop that track).
  const overridden = new Set(overrides.map((p) => `${p.layerId}\u0000${p.param}`));
  if (next.tracks?.some((t) => overridden.has(`${t.layerId}\u0000${t.paramName}`))) {
    next.tracks = next.tracks.filter((t) => !overridden.has(`${t.layerId}\u0000${t.paramName}`));
  }
  if (byKey.size > 64) byKey.clear();
  byKey.set(key, next);
  return next;
}
