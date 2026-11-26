import { createApp, ref } from "vue";
import {
  createAnimatedModulationFn,
  ModulationEngine,
  type LayerInstance,
} from "@shader-lab/core";
import { useComponentCapture } from "../app/composables/use-component-capture";
import { StagePointer } from "../app/utils/stage-pointer";
import { seekTimelinePointer } from "../app/utils/timeline-pointer";

const layers = [
  {
    type: "image",
    id: "cursor",
    enabled: true,
    values: { timelineCursor: 1, layerPositionY: -0.2 },
  },
  {
    type: "component",
    id: "ui",
    enabled: true,
    values: { layerScale: 200, layerRotation: 90 },
  },
] as LayerInstance[];
const engine = new ModulationEngine();
engine.setLayers(layers);
const tracks = [
  ["layerPositionX", [0.4, 0, 0, 0, 0.4]],
  ["cursorPress", [0, 0, 1, 0, 0]],
] as const;
const keys = tracks.map(([paramName, values]) => ({
  paramName,
  layerId: "cursor",
  enabled: true,
  keys: values.map((value, time) => ({ value, time })),
}));
const pointer = new StagePointer();
const root = document.getElementById("root")!;
let time = 0;
createApp({
  setup() {
    const api = useComponentCapture({
      layers: ref(layers),
      getElement: () => root,
      samplePointer: (t = time) =>
        seekTimelinePointer(
          pointer,
          layers,
          t,
          { width: 500, height: 200 },
          () => root,
          createAnimatedModulationFn(t, keys, engine),
        ),
      setComponentSource: (_, source) => {
        if (!source) return;
        const ctx = document.querySelector("canvas")!.getContext("2d")!;
        ctx.drawImage(source.frame as HTMLImageElement, 0, 0, 120, 40);
      },
      requestRender() {},
    });
    Object.assign(window, {
      live: (t: number) => {
        time = t;
      },
      capture: async (t: number) => {
        api.pause();
        await api.captureAll(t);
      },
    });
    return () => null;
  },
}).mount("#app");
