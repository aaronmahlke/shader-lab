import { describe, expect, it } from "bun:test";
import type { CompositionConfig } from "../types/composition";
import type { LayerInstance } from "../types/editor";
import { applyCompProps } from "./comp-props";

const inner: CompositionConfig = {
  version: 1,
  layers: [
    { id: "front", type: "image", enabled: true, values: { src: "/a.png" } },
    { id: "title", type: "text", enabled: true, values: { text: "Hello", layerOpacity: 100 } },
  ],
  lfos: [],
  assignments: [],
  settings: {
    duration: 2, fps: 30, width: 100, height: 100,
    props: [
      { id: "img", name: "Image", layerId: "front", param: "src" },
      { id: "op", name: "Opacity", layerId: "title", param: "layerOpacity" },
    ],
  },
  tracks: [{ layerId: "title", paramName: "layerOpacity", enabled: true, keys: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }],
};
const host = (props?: Record<string, unknown>): LayerInstance => ({ id: "h", type: "composition", enabled: true, values: { compRefId: "c", props } });

describe("applyCompProps", () => {
  it("keeps the comp as is without values", () => {
    expect(applyCompProps(inner, host())).toBe(inner);
  });
  it("substitutes per-instance values and drops overridden tracks", () => {
    const a = applyCompProps(inner, host({ img: "/b.png", op: 50 }));
    expect(a.layers[0]!.values.src).toBe("/b.png");
    expect(a.layers[1]!.values.layerOpacity).toBe(50);
    expect(a.tracks).toEqual([]);
    expect(inner.layers[0]!.values.src).toBe("/a.png"); // original untouched
    expect(applyCompProps(inner, host({ img: "/b.png", op: 50 }))).toBe(a); // stable identity
  });
});
