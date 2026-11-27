import type { LayerInstance, RenderPass } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";
import { buildLayerUniforms } from "../compiler/compile-passes";
import { buildUniversalUniforms, layerTimingFactor } from "../compiler/universal-uniforms";

/**
 * View folding: keep layers sharp under zoom.
 *
 * A flat 2D camera magnifies its finished plate, and a precomp's composite
 * magnifies its finished stack — both rasterize first and scale after, so a
 * 2.4× push-in turns UI soft. Instead, each owner's similarity transform is
 * folded into the composites underneath it (screen = owner ∘ layer), the
 * owner stops magnifying (camera zoom 1 / host samples screen space with its
 * frame as a clip), and content windows + capture scale see the real
 * on-screen size. Decided per frame: an owner that can't fold (tilted
 * camera, DOF, partial opacity, 3D/blurred precomp…) renders as before.
 *
 * Transforms live in the composite shader's terms: center C = anchor + pos
 * (uv), scale s, rotation r (deg), anchor A; screen = C + s·Rot(−r)·(L − A)
 * with x in aspect units.
 */
export type Sim = { cx: number; cy: number; ax: number; ay: number; s: number; r: number };

/** outer ∘ inner. */
export function composeSim(o: Sim, i: Sim, aspect: number): Sim {
  const th = (-o.r * Math.PI) / 180;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  // (C_i − A_o) in aspect space, rotated by −r_o, scaled by s_o.
  const dx = (i.cx - o.ax) * aspect;
  const dy = i.cy - o.ay;
  const rx = c * dx - sn * dy;
  const ry = sn * dx + c * dy;
  return {
    cx: o.cx + (o.s * rx) / aspect,
    cy: o.cy + o.s * ry,
    ax: i.ax,
    ay: i.ay,
    s: o.s * i.s,
    r: o.r + i.r,
  };
}

const n = (u: Record<string, unknown>, k: string, d: number) => {
  const v = u[k];
  return typeof v === "number" && Number.isFinite(v) ? v : d;
};

export function simFromUniforms(u: Record<string, unknown>): Sim {
  const ax = n(u, "layerAnchorX", 0.5);
  const ay = n(u, "layerAnchorY", 0.5);
  return { cx: ax + n(u, "layerPositionX", 0), cy: ay + n(u, "layerPositionY", 0), ax, ay, s: n(u, "layerScale", 100) / 100, r: n(u, "layerRotation", 0) };
}

/** Write a Sim back as composite uniforms (anchor unchanged). */
export function simToUniforms(sim: Sim, u: Record<string, unknown>): void {
  u.layerPositionX = sim.cx - sim.ax;
  u.layerPositionY = sim.cy - sim.ay;
  u.layerScale = sim.s * 100;
  u.layerRotation = sim.r;
}

type Ctx = {
  findLayer?: (pass: RenderPass) => LayerInstance | undefined;
  gateTime?: number;
  time: number;
};

/** Owner id → its fold transform for one modulation fn (null = can't fold now). */
export type FoldStates = Map<string, Sim | null>;

/**
 * Fold states of every owner in the pass list. Cameras and hosts are found
 * by their passes (cameraStage with `foldable`, host composite with
 * `foldsContent`). Gating uses the frame time even for shutter samples.
 */
export function computeFoldStates(passes: readonly RenderPass[], ctx: Ctx, fn: ModulationFn | null, gateOnly?: FoldStates): FoldStates {
  const out: FoldStates = new Map();
  // Escape hatch / A-B: globalThis.__SHADERLAB_NO_VIEW_FOLD = true renders the old way.
  if ((globalThis as { __SHADERLAB_NO_VIEW_FOLD?: boolean }).__SHADERLAB_NO_VIEW_FOLD) return out;
  const gate = ctx.gateTime ?? ctx.time;
  for (const p of passes) {
    if (p.layerType === "cameraStage") {
      const id = p.sourceLayerId ?? p.layerId;
      if (gateOnly && gateOnly.get(id) == null) {
        out.set(id, null);
        continue;
      }
      const cam = ctx.findLayer?.(p);
      if (!p.foldable || !cam) {
        out.set(id, null);
        continue;
      }
      const u = buildLayerUniforms(cam, fn) as Record<string, unknown>;
      const flat =
        Math.abs(n(u, "tilt", 0)) < 1e-3 && Math.abs(n(u, "yaw", 0)) < 1e-3 && Math.abs(n(u, "roll", 0)) < 1e-3 &&
        // DOF reads the stage's depth (which depends on zoom): keep DOF cameras unfolded.
        n(u, "aperture", 0) <= 0 && u.drive3d !== true &&
        n(u, "layerOpacity", 100) >= 99.99 && layerTimingFactor(cam, gate) === 1;
      out.set(id, flat ? { cx: 0.5, cy: 0.5, ax: 0.5, ay: 0.5, s: Math.max(1e-3, n(u, "zoom", 1)), r: 0 } : null);
    } else if (p.layerType === "layerComposite" && p.foldsContent) {
      const id = p.colorSourceLayerId ?? p.sourceLayerId ?? "";
      if (gateOnly && gateOnly.get(id) == null) {
        out.set(id, null);
        continue;
      }
      const host = ctx.findLayer?.(p);
      if (!host) {
        out.set(id, null);
        continue;
      }
      const u = buildUniversalUniforms(host, fn) as Record<string, unknown>;
      const twoD = Math.abs(n(u, "layerRotationX", 0)) < 1e-3 && Math.abs(n(u, "layerRotationY", 0)) < 1e-3 && n(u, "layerBlur", 0) <= 0.01;
      out.set(id, twoD ? simFromUniforms(u) : null);
    }
  }
  // An owner folds only if every owner inside its scope folds too: a
  // composite that stops at an inner owner never receives the outer fold, so
  // the outer owner must keep magnifying as before.
  // Passes that don't render this frame (outside their / a host's in/out) don't count.
  const activeCache = new Map<string, boolean>();
  const layerActive = (id: string) => {
    let a = activeCache.get(id);
    if (a === undefined) {
      const l = ctx.findLayer?.({ layerId: id, layerType: "layerComposite", uniforms: {}, inputLayerId: null, sourceLayerId: id, isOutput: false });
      a = !l || layerTimingFactor(l, gate) > 0;
      activeCache.set(id, a);
    }
    return a;
  };
  const renders = (p: RenderPass) => {
    const parts = (p.sourceLayerId ?? p.layerId).split("::");
    for (let i = 1; i <= parts.length; i++) if (!layerActive(parts.slice(0, i).join("::"))) return false;
    return true;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of passes) {
      const folds = p.viewFolds;
      if (!folds || !renders(p)) continue;
      const i = folds.findIndex((f) => !out.get(f));
      if (i < 0) continue;
      for (let j = i + 1; j < folds.length; j++) {
        if (out.get(folds[j]!)) {
          out.set(folds[j]!, null);
          changed = true;
        }
      }
    }
  }
  return out;
}

/**
 * Fold a composite's own transform through its owners (inner → outer),
 * stopping at the first owner that can't fold this frame (that owner keeps
 * magnifying, and everything outside it applies to it, not to us).
 */
export function foldSim(layer: Sim, folds: readonly string[] | undefined, states: FoldStates, aspect: number): Sim {
  let t = layer;
  for (const f of folds ?? []) {
    const s = states.get(f);
    if (!s) break;
    t = composeSim(s, t, aspect);
  }
  return t;
}
