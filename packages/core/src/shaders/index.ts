import type { LayerType } from "../types/editor";
import gradientFrag from "./layers/gradient.frag";
import meshFrag from "./layers/mesh.frag";
import solidFrag from "./layers/solid.frag";
import noiseFrag from "./layers/noise.frag";
import distortionFrag from "./layers/distortion.frag";
import ditherFrag from "./layers/dither.frag";
import grainFrag from "./layers/grain.frag";
import seamFrag from "./layers/seam.frag";
import diffuseFrag from "./layers/diffuse.frag";
import vignetteFrag from "./layers/vignette.frag";
import chromaticAberrationFrag from "./layers/chromatic-aberration.frag";
import waveFillFrag from "./layers/wave-fill.frag";
import bandFillFrag from "./layers/band-fill.frag";
import resolveFrag from "./layers/resolve.frag";
import outputFrag from "./layers/output.frag";
import layerCompositeFrag from "./layers/layer-composite.frag";
import textSourceFrag from "./layers/text-source.frag";
import componentSourceFrag from "./layers/component-source.frag";
import cameraStageFrag from "./layers/camera-stage.frag";
import cameraDofFrag from "./layers/camera-dof.frag";
import bloomPrefilterFrag from "./layers/bloom-prefilter.frag";
import bloomDownFrag from "./layers/bloom-down.frag";
import bloomUpFrag from "./layers/bloom-up.frag";
import cameraCompositeFrag from "./layers/camera-composite.frag";
import fullscreenVert from "./layers/fullscreen.vert";
import type { RenderPassType } from "../types/editor";

export const FRAG_SHADERS: Record<Exclude<RenderPassType, "camera">, string> & { camera?: undefined } = {
  gradient: gradientFrag,
  mesh: meshFrag,
  solid: solidFrag,
  noise: noiseFrag,
  text: textSourceFrag,
  component: componentSourceFrag,
  waveFill: waveFillFrag,
  bandFill: bandFillFrag,
  distortion: distortionFrag,
  dither: ditherFrag,
  grain: grainFrag,
  seam: seamFrag,
  diffuse: diffuseFrag,
  vignette: vignetteFrag,
  chromaticAberration: chromaticAberrationFrag,
  resolve: resolveFrag,
  blit: outputFrag,
  layerComposite: layerCompositeFrag,
  cameraStage: cameraStageFrag,
  cameraDof: cameraDofFrag,
  bloomPrefilter: bloomPrefilterFrag,
  bloomDown: bloomDownFrag,
  bloomUp: bloomUpFrag,
  cameraComposite: cameraCompositeFrag,
};

export const FULLSCREEN_VERT = fullscreenVert;

export const RAW_VERT = `
attribute vec2 aPosition;
attribute vec2 aUV;
varying vec2 vUv;
void main() {
  vUv = aUV;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const STBN_LAYER_TYPES = new Set<LayerType>([]);

export const INT_UNIFORMS = new Set([
  "waveType",
  "shape",
  "coordMode",
  "mode",
  "steps",
  // camera DOF sample count: declared `uniform int` in camera-dof.frag.
  // Uploading it as float is silently ignored by WebGL, leaving it 0 and
  // making the DOF pass early-out on every pixel (no blur at any aperture).
  "dofSamples",
  "layerBlendMode",
]);

export const GRADIENT_RESOLUTION = 256;
