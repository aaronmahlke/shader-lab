import type { InjectionKey } from "vue";
import type {
  CompositionSettings,
  LayerInstance,
  LFOSource,
  ModulationAssignment,
  PropertyTrack,
} from "@shader-lab/core";
import type { KeyframeSelection } from "#shared/editor/keyframe-selection";

export type EditorSnapshot = {
  shaderName: string;
  layers: LayerInstance[];
  lfos: LFOSource[];
  assignments: ModulationAssignment[];
  settings: CompositionSettings;
  tracks: PropertyTrack[];
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  selectedLfoId: string | null;
  selectedKeyframes: KeyframeSelection[];
  selectionAnchorId: string | null;
  meshSelectedPointIndex: number;
};

export type EditorHistory = {
  record: () => void;
  beginGesture: () => void;
  commitGesture: () => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  canUndo: Readonly<Ref<boolean>>;
  canRedo: Readonly<Ref<boolean>>;
  isApplying: Readonly<Ref<boolean>>;
};

export const EDITOR_HISTORY_KEY: InjectionKey<EditorHistory> = Symbol("editorHistory");

/** Deep-clone editor state — JSON round-trip avoids structuredClone on Vue reactive proxies. */
export function cloneEditorSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
