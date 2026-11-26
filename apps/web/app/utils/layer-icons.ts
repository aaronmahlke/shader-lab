import type { LayerInstance } from "@shader-lab/core";
import type { StudioIconName } from "~/utils/studio-icons";

/** Studio icon per layer type (object fields, lists); undefined → no icon. */
const ICONS: Partial<Record<LayerInstance["type"], StudioIconName>> = {
  composition: "comp",
  component: "component",
  image: "image",
  video: "image",
  text: "text",
  shape: "shape",
  solid: "shape",
  audio: "audio",
  pointer: "cursor",
};

export function layerStudioIcon(type: LayerInstance["type"]): StudioIconName | undefined {
  return ICONS[type];
}
