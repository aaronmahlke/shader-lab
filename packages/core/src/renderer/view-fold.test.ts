import { describe, expect, test } from "bun:test";
import { composeSim, foldSim, type Sim } from "./view-fold";

/** Screen point of layer uv L under a Sim (x in aspect units), like the composite shader's inverse. */
function apply(t: Sim, lx: number, ly: number, aspect: number): [number, number] {
  const th = (-t.r * Math.PI) / 180;
  const dx = (lx - t.ax) * aspect;
  const dy = ly - t.ay;
  const rx = Math.cos(th) * dx - Math.sin(th) * dy;
  const ry = Math.sin(th) * dx + Math.cos(th) * dy;
  return [t.cx + (t.s * rx) / aspect, t.cy + t.s * ry];
}

describe("view folding", () => {
  const aspect = 16 / 9;
  const cam: Sim = { cx: 0.5, cy: 0.5, ax: 0.5, ay: 0.5, s: 2.4, r: 0 };
  const host: Sim = { cx: 0.47, cy: 0.59, ax: 0.4, ay: 0.55, s: 1.3, r: 15 };
  const layer: Sim = { cx: 0.6, cy: 0.45, ax: 0.5, ay: 0.5, s: 0.9, r: -8 };

  test("composed transform = applying inner then outer", () => {
    const folded = composeSim(cam, composeSim(host, layer, aspect), aspect);
    for (const [lx, ly] of [[0, 0], [1, 0], [0.3, 0.8], [1, 1]] as const) {
      const step = apply(cam, ...apply(host, ...apply(layer, lx, ly, aspect), aspect), aspect);
      const once = apply(folded, lx, ly, aspect);
      expect(once[0]).toBeCloseTo(step[0], 9);
      expect(once[1]).toBeCloseTo(step[1], 9);
    }
  });

  test("folds stop at the first owner that can't fold", () => {
    const states = new Map<string, Sim | null>([["host", null], ["cam", cam]]);
    expect(foldSim(layer, ["host", "cam"], states, aspect)).toEqual(layer);
    states.set("host", host);
    expect(foldSim(layer, ["host", "cam"], states, aspect).s).toBeCloseTo(2.4 * 1.3 * 0.9, 9);
  });
});
