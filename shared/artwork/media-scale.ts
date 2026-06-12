import type { ArtworkImageLayer, ArtworkVideoLayer } from "../types/artwork";

export type RasterMediaLayer = ArtworkImageLayer | ArtworkVideoLayer;

export function mediaScaleX(layer: RasterMediaLayer): number {
  return layer.scaleX ?? layer.scale;
}

export function mediaScaleY(layer: RasterMediaLayer): number {
  return layer.scaleY ?? layer.scale;
}

export function setUniformMediaScale(layer: RasterMediaLayer, value: number) {
  layer.scale = value;
  layer.scaleX = value;
  layer.scaleY = value;
}
