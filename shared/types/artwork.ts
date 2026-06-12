import type { LayerInstance, LFOSource, ModulationAssignment } from "./editor";

export type ArtworkCanvas = {
  width: number;
  height: number;
};

export type ArtworkShaderLayer = {
  id: string;
  type: "shader";
  shaderId: string;
  enabled: boolean;
};

export type ArtworkTextRunStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
};

export type ArtworkTextRun = {
  text: string;
  style?: ArtworkTextRunStyle;
};

export type ArtworkTextLayer = {
  id: string;
  type: "text";
  enabled: boolean;
  /** Flattened plain text (kept in sync with runs) */
  content: string;
  runs?: ArtworkTextRun[];
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  lineHeight?: number;
  color: string;
  x: number;
  y: number;
  align: "left" | "center" | "right";
  opacity: number;
};

export type ArtworkImageLayer = {
  id: string;
  type: "image";
  enabled: boolean;
  src: string;
  x: number;
  y: number;
  scale: number;
  /** Non-uniform scale; defaults to `scale` when omitted */
  scaleX?: number;
  scaleY?: number;
  /** Corner radius in design px (1080-tall reference), like fontSize */
  borderRadius?: number;
  opacity: number;
};

export type ArtworkVideoLayer = {
  id: string;
  type: "video";
  enabled: boolean;
  src: string;
  x: number;
  y: number;
  scale: number;
  scaleX?: number;
  scaleY?: number;
  borderRadius?: number;
  opacity: number;
  /** Loop during preview and export (default true) */
  loop?: boolean;
};

export type ArtworkLayer =
  | ArtworkShaderLayer
  | ArtworkTextLayer
  | ArtworkImageLayer
  | ArtworkVideoLayer;

export type ArtworkDocument = {
  version: 1;
  canvas: ArtworkCanvas;
  layers: ArtworkLayer[];
};

export type ShaderDocument = {
  version: 1;
  layers: LayerInstance[];
  lfos: LFOSource[];
  assignments: ModulationAssignment[];
};
