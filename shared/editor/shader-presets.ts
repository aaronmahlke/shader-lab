import type { LayerInstance, LFOSource, ModulationAssignment } from "../types/editor";
import { LFO_COLORS } from "./lfo-colors";
import { clonePresetPoints } from "./lfo-presets";
import {
  MESH_BLOOM_POINTS,
  GRAINY_DITHER_MESH_POINTS,
  cloneMeshPoints,
  meshParamName,
} from "./mesh-uniforms";

import type { ShaderDocument } from "../types/artwork";

export type { ShaderDocument };

export type ShaderPreset = {
  id: string;
  name: string;
  description: string;
};

const DITHER_GRADIENT_LAYERS: LayerInstance[] = [
  { id: "vignette-1", type: "vignette", enabled: true, values: { shape: 0, vignetteIntensity: 1.0, vignetteRadius: 0.4, vignetteSoftness: 0.4 } },
  { id: "dither-1", type: "dither", enabled: true, values: { levels: 16, ditherScale: 4 } },
  { id: "grain-1", type: "grain", enabled: true, values: { grainIntensity: 0.02, ditherScale: 4.0, speed: 50.0 } },
  { id: "distortion-2", type: "distortion", enabled: true, values: { waveType: 0, freq: 1.9, amplitude: 0.4, sharpness: 1, pulseWidth: 0, skew: 0, direction: 0, coordMode: 0, centerX: 0, centerY: 0 } },
  { id: "distortion-1", type: "distortion", enabled: true, values: { waveType: 1, freq: 3, amplitude: 0.51, sharpness: 6.7, pulseWidth: 0.04, skew: 0, direction: 315, coordMode: 0, centerX: 0, centerY: 0 } },
  {
    id: "gradient-1",
    type: "gradient",
    enabled: true,
    values: {
      u_gradient: [
        { color: "#000000", position: 0 },
        { color: "#330d03", position: 0.15 },
        { color: "#f35a0d", position: 0.35 },
        { color: "#fff2d9", position: 0.6 },
        { color: "#0f3839", position: 0.85 },
        { color: "#000000", position: 1.0 },
      ],
      angle: 90,
      offsetX: 0,
    },
  },
];

const DITHER_GRADIENT_LFOS: LFOSource[] = [
  { id: "lfo-1", label: "Drift", color: LFO_COLORS[0]!, points: clonePresetPoints("sine"), rate: 0.1, phase: 0, mode: "loop" },
  { id: "lfo-2", label: "Pulse", color: LFO_COLORS[1]!, points: clonePresetPoints("sine"), rate: 0.13, phase: 0, mode: "loop" },
];

const DITHER_GRADIENT_ASSIGNMENTS: ModulationAssignment[] = [
  { sourceId: "lfo-1", layerId: "distortion-1", paramName: "direction", depth: 90 },
  { sourceId: "lfo-1", layerId: "gradient-1", paramName: "offsetX", depth: 0.5 },
  { sourceId: "lfo-2", layerId: "distortion-1", paramName: "amplitude", depth: 0.4 },
  { sourceId: "lfo-2", layerId: "distortion-1", paramName: "pulseWidth", depth: 0.25 },
];

const PRESET_DATA: Record<string, ShaderDocument> = {
  blank: {
    version: 1,
    layers: [],
    lfos: [],
    assignments: [],
  },
  "gradient-only": {
    version: 1,
    layers: [
      {
        id: "gradient-1",
        type: "gradient",
        enabled: true,
        values: {
          u_gradient: [
            { color: "#000000", position: 0 },
            { color: "#330d03", position: 0.15 },
            { color: "#f35a0d", position: 0.35 },
            { color: "#fff2d9", position: 0.6 },
            { color: "#0f3839", position: 0.85 },
            { color: "#000000", position: 1.0 },
          ],
          angle: 90,
          offsetX: 0,
        },
      },
    ],
    lfos: [],
    assignments: [],
  },
  "dither-gradient": {
    version: 1,
    layers: DITHER_GRADIENT_LAYERS,
    lfos: DITHER_GRADIENT_LFOS,
    assignments: DITHER_GRADIENT_ASSIGNMENTS,
  },
  "mesh-bloom": {
    version: 1,
    layers: [
      {
        id: "grain-1",
        type: "grain",
        enabled: true,
        values: { grainIntensity: 0.028, ditherScale: 3.5, speed: 35 },
      },
      {
        id: "mesh-1",
        type: "mesh",
        enabled: true,
        values: {
          u_meshPoints: cloneMeshPoints(MESH_BLOOM_POINTS),
          softness: 1.35,
          gain: 1.02,
        },
      },
    ],
    lfos: [
      { id: "lfo-1", label: "Drift", color: LFO_COLORS[0]!, points: clonePresetPoints("sine"), rate: 0.06, phase: 0, mode: "loop" },
      { id: "lfo-2", label: "Bloom", color: LFO_COLORS[1]!, points: clonePresetPoints("sine"), rate: 0.09, phase: 120, mode: "loop" },
      { id: "lfo-3", label: "Sway", color: LFO_COLORS[2]!, points: clonePresetPoints("sine"), rate: 0.04, phase: 200, mode: "pingpong" },
    ],
    assignments: [
      { sourceId: "lfo-1", layerId: "mesh-1", paramName: meshParamName(3, "x"), depth: 0.06 },
      { sourceId: "lfo-1", layerId: "mesh-1", paramName: meshParamName(3, "y"), depth: 0.05 },
      { sourceId: "lfo-1", layerId: "mesh-1", paramName: meshParamName(2, "x"), depth: 0.025 },
      { sourceId: "lfo-2", layerId: "mesh-1", paramName: meshParamName(3, "radius"), depth: 0.18 },
      { sourceId: "lfo-2", layerId: "mesh-1", paramName: "gain", depth: 0.05 },
      { sourceId: "lfo-2", layerId: "mesh-1", paramName: "softness", depth: -0.22 },
      { sourceId: "lfo-3", layerId: "mesh-1", paramName: meshParamName(0, "x"), depth: 0.04 },
      { sourceId: "lfo-3", layerId: "mesh-1", paramName: meshParamName(1, "x"), depth: -0.04 },
      { sourceId: "lfo-3", layerId: "mesh-1", paramName: meshParamName(5, "y"), depth: 0.03 },
    ],
  },
  "grainy-dither-field": {
    version: 1,
    layers: [
      {
        id: "seam-1",
        type: "seam",
        enabled: true,
        values: {
          ditherScale: 3.5,
          edgeMin: 0.035,
          edgeMax: 0.2,
          sampleSpread: 5,
          speed: 0,
        },
      },
      {
        id: "distortion-1",
        type: "distortion",
        enabled: true,
        values: {
          waveType: 0,
          freq: 1.4,
          amplitude: 0.1,
          sharpness: 1,
          pulseWidth: 0,
          skew: 0,
          direction: 28,
          coordMode: 0,
          centerX: 0,
          centerY: 0,
        },
      },
      {
        id: "mesh-1",
        type: "mesh",
        enabled: true,
        values: {
          u_meshPoints: cloneMeshPoints(GRAINY_DITHER_MESH_POINTS),
          softness: 1.22,
          gain: 1.06,
        },
      },
    ],
    lfos: [
      { id: "lfo-1", label: "Drift", color: LFO_COLORS[0]!, points: clonePresetPoints("sine"), rate: 0.05, phase: 0, mode: "loop" },
      { id: "lfo-2", label: "Bloom", color: LFO_COLORS[1]!, points: clonePresetPoints("sine"), rate: 0.08, phase: 90, mode: "loop" },
      { id: "lfo-3", label: "Sway", color: LFO_COLORS[2]!, points: clonePresetPoints("sine"), rate: 0.035, phase: 180, mode: "pingpong" },
      { id: "lfo-4", label: "Warp", color: LFO_COLORS[3]!, points: clonePresetPoints("sine"), rate: 0.06, phase: 45, mode: "loop" },
    ],
    assignments: [
      { sourceId: "lfo-1", layerId: "mesh-1", paramName: meshParamName(1, "x"), depth: 0.05 },
      { sourceId: "lfo-1", layerId: "mesh-1", paramName: meshParamName(1, "y"), depth: 0.04 },
      { sourceId: "lfo-1", layerId: "mesh-1", paramName: meshParamName(2, "x"), depth: -0.03 },
      { sourceId: "lfo-2", layerId: "mesh-1", paramName: meshParamName(1, "radius"), depth: 0.2 },
      { sourceId: "lfo-2", layerId: "mesh-1", paramName: "gain", depth: 0.06 },
      { sourceId: "lfo-2", layerId: "mesh-1", paramName: meshParamName(3, "y"), depth: 0.04 },
      { sourceId: "lfo-3", layerId: "mesh-1", paramName: meshParamName(0, "x"), depth: 0.035 },
      { sourceId: "lfo-3", layerId: "mesh-1", paramName: meshParamName(4, "y"), depth: 0.03 },
      { sourceId: "lfo-3", layerId: "mesh-1", paramName: meshParamName(5, "x"), depth: 0.025 },
      { sourceId: "lfo-4", layerId: "distortion-1", paramName: "amplitude", depth: 0.04 },
      { sourceId: "lfo-4", layerId: "distortion-1", paramName: "direction", depth: 12 },
    ],
  },
  "wave-distort": {
    version: 1,
    layers: [
      {
        id: "distortion-1",
        type: "distortion",
        enabled: true,
        values: {
          waveType: 0,
          freq: 1.5,
          amplitude: 0.35,
          sharpness: 1,
          pulseWidth: 0,
          skew: 0,
          direction: 45,
          coordMode: 0,
          centerX: 0,
          centerY: 0,
        },
      },
      {
        id: "gradient-1",
        type: "gradient",
        enabled: true,
        values: {
          u_gradient: [
            { color: "#0f3839", position: 0 },
            { color: "#f35a0d", position: 0.45 },
            { color: "#fff2d9", position: 0.7 },
            { color: "#000000", position: 1 },
          ],
          angle: 90,
          offsetX: 0,
        },
      },
    ],
    lfos: [],
    assignments: [],
  },
};

export const SHADER_PRESETS: ShaderPreset[] = [
  {
    id: "blank",
    name: "Blank",
    description: "Empty canvas — add layers with + in the stack.",
  },
  {
    id: "grainy-dither-field",
    name: "Grainy dither field",
    description: "Mesh ramp + light warp + boundary seam dither, animated LFOs.",
  },
  {
    id: "mesh-bloom",
    name: "Mesh bloom",
    description: "Soft mesh gradient, slow LFO drift, and light grain.",
  },
  {
    id: "gradient-only",
    name: "Gradient",
    description: "Warm multi-stop gradient, no effects.",
  },
  {
    id: "dither-gradient",
    name: "Dither gradient",
    description: "Full stack: gradient, dual distort, grain, dither, vignette, LFOs.",
  },
  {
    id: "wave-distort",
    name: "Wave distort",
    description: "Gradient with one sine distortion layer.",
  },
];

export const DEFAULT_PRESET_ID = "dither-gradient";

function cloneDocument(doc: ShaderDocument): ShaderDocument {
  return JSON.parse(JSON.stringify(doc)) as ShaderDocument;
}

export function getShaderPreset(id: string): ShaderPreset | undefined {
  return SHADER_PRESETS.find((p) => p.id === id);
}

export function cloneShaderPreset(id: string): ShaderDocument {
  const data = PRESET_DATA[id] ?? PRESET_DATA[DEFAULT_PRESET_ID]!;
  return cloneDocument(data);
}
