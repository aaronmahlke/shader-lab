import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import createGL from "gl";
import * as THREE from "three";
import { createCanvas } from "@napi-rs/canvas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const W = 1320;
const H = 742;

const params = {
  grainMix: 0.41,
  edgeWidth: 0.74,
  edgeBg: 0.44,
  edgePale: 0.38,
  edgeLime: 0.42,
  edgeBlue: 0.3,
  edgeBlack: 0.3,
  edgeBlue2: 0.56,
  edgeBlack2: 0.69,
  dotSize: 1.5,
  seed: 0,
  bgBandY: 0.88,
  paleBase: 0.43,
  paleAmp: 0.215,
  paleFreq: 0.86,
  palePhase: 0.97,
  limeBase: 0.28,
  limeAmp: 0.17,
  limeFreq: 1.53,
  limePhase: 0.99,
  blueBase: 0.74,
  blueAmp: 0.145,
  blueFreq: 1.41,
  bluePhase: 0.14,
  blackBase: 0.56,
  blackAmp: 0.325,
  blackFreq: 2,
  blackPhase: -0.08,
  blue2Base: 0.31,
  blue2Amp: 0.075,
  blue2Freq: 1.2,
  blue2Phase: 0.18,
  black2Base: 0.29,
  black2Amp: 0.325,
  black2Freq: 1.67,
  black2Phase: 1.15,
};

const UNIFORM_MAP = {
  grainMix: "u_grainMix",
  edgeWidth: "u_edge",
  edgeBg: "u_edgeBg",
  edgePale: "u_edgePale",
  edgeLime: "u_edgeLime",
  edgeBlue: "u_edgeBlue",
  edgeBlack: "u_edgeBlack",
  edgeBlue2: "u_edgeBlue2",
  edgeBlack2: "u_edgeBlack2",
  dotSize: "u_dot",
  seed: "u_seed",
  bgBandY: "u_bgBandY",
  paleBase: "u_paleBase",
  paleAmp: "u_paleAmp",
  paleFreq: "u_paleFreq",
  palePhase: "u_palePhase",
  limeBase: "u_limeBase",
  limeAmp: "u_limeAmp",
  limeFreq: "u_limeFreq",
  limePhase: "u_limePhase",
  blueBase: "u_blueBase",
  blueAmp: "u_blueAmp",
  blueFreq: "u_blueFreq",
  bluePhase: "u_bluePhase",
  blackBase: "u_blackBase",
  blackAmp: "u_blackAmp",
  blackFreq: "u_blackFreq",
  blackPhase: "u_blackPhase",
  blue2Base: "u_blue2Base",
  blue2Amp: "u_blue2Amp",
  blue2Freq: "u_blue2Freq",
  blue2Phase: "u_blue2Phase",
  black2Base: "u_black2Base",
  black2Amp: "u_black2Amp",
  black2Freq: "u_black2Freq",
  black2Phase: "u_black2Phase",
};

const frag = readFileSync(join(root, "shared/shaders/grainy-dither-v4.frag"), "utf8");
const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const gl = createGL(W, H, { preserveDrawingBuffer: true });
const canvas = {
  width: W,
  height: H,
  clientWidth: W,
  clientHeight: H,
  style: {},
  addEventListener() {},
  removeEventListener() {},
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  context: gl,
  antialias: false,
  alpha: false,
});

const uniforms = {
  u_resolution: { value: new THREE.Vector2(W, H) },
  ...Object.fromEntries(
    Object.entries(UNIFORM_MAP).map(([key, name]) => [name, { value: params[key] }]),
  ),
};

const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: frag,
  uniforms,
});

const scene = new THREE.Scene();
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

renderer.setSize(W, H, false);
renderer.render(scene, camera);

const pixels = new Uint8Array(W * H * 4);
gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

// WebGL origin is bottom-left; flip to top-left PNG
const flipped = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  flipped.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
}

const outPath = join(root, "scripts/.grainy-dither-v4-render.png");
const outCanvas = createCanvas(W, H);
outCanvas.getContext("2d").putImageData(new ImageData(flipped, W, H), 0, 0);
writeFileSync(outPath, outCanvas.toBuffer("image/png"));
console.log(`wrote ${outPath}`);

gl.getExtension("STACKGL_destroy_context")?.destroy();
renderer.dispose();
material.dispose();
