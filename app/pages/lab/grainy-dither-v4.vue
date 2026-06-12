<script setup lang="ts">
import * as THREE from "three";
import grainyDitherV4Frag from "#shared/shaders/grainy-dither-v4.frag";

useHead({ title: "Grainy dither v4 — Hybrid dissolve" });

const canvasRef = ref<HTMLCanvasElement | null>(null);
const showReference = ref(false);
const metrics = ref<string | null>(null);
const copied = ref(false);

const params = reactive({
  grainMix: 0.41,
  dissolveReach: 4,
  edgeWidth: 0.37,
  edgeBg: 0.6,
  edgePale: 0.44,
  edgeLime: 0.42,
  edgeBlue: 0.26,
  edgeBlack: 0.35,
  edgeBlue2: 0.56,
  edgeBlack2: 0.69,
  dotSize: 1.5,
  seed: 0.0,
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
});

const PARAM_RANGES = {
  grainMix: { min: 0, max: 1, step: 0.01 },
  dissolveReach: { min: 1, max: 4, step: 0.05 },
  edgeWidth: { min: 0.1, max: 0.9, step: 0.01 },
  edgeSeam: { min: 0.02, max: 1, step: 0.01 },
  dotSize: { min: 1, max: 4, step: 0.25 },
  bandY: { min: 0.5, max: 1, step: 0.01 },
  waveBase: { min: 0.15, max: 1, step: 0.01 },
  waveAmp: { min: 0, max: 0.4, step: 0.005 },
  waveFreq: { min: 0.08, max: 2, step: 0.01 },
  wavePhase: { min: -1, max: 2, step: 0.01 },
} as const;

const UNIFORM_MAP: Record<keyof typeof params, string> = {
  grainMix: "u_grainMix",
  dissolveReach: "u_dissolveReach",
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

type ShapeControl = {
  key: keyof typeof params;
  label: string;
  min: number;
  max: number;
  step: number;
};

const SHAPE_CONTROLS: { title: string; items: ShapeControl[] }[] = [
  {
    title: "Background",
    items: [
      { key: "bgBandY", label: "band Y", ...PARAM_RANGES.bandY },
      { key: "edgeBg", label: "edge", ...PARAM_RANGES.edgeSeam },
    ],
  },
  {
    title: "Bottom 1 · blue (back)",
    items: [
      { key: "blueBase", label: "center Y", ...PARAM_RANGES.waveBase },
      { key: "blueAmp", label: "amplitude", ...PARAM_RANGES.waveAmp },
      { key: "blueFreq", label: "cycleWidth", ...PARAM_RANGES.waveFreq },
      { key: "bluePhase", label: "cycleX", ...PARAM_RANGES.wavePhase },
      { key: "edgeBlue", label: "edge", ...PARAM_RANGES.edgeSeam },
    ],
  },
  {
    title: "Bottom 2 · pale",
    items: [
      { key: "paleBase", label: "center Y", ...PARAM_RANGES.waveBase },
      { key: "paleAmp", label: "amplitude", ...PARAM_RANGES.waveAmp },
      { key: "paleFreq", label: "cycleWidth", ...PARAM_RANGES.waveFreq },
      { key: "palePhase", label: "cycleX", ...PARAM_RANGES.wavePhase },
      { key: "edgePale", label: "edge", ...PARAM_RANGES.edgeSeam },
    ],
  },
  {
    title: "Bottom 3 · black",
    items: [
      { key: "blackBase", label: "center Y", ...PARAM_RANGES.waveBase },
      { key: "blackAmp", label: "amplitude", ...PARAM_RANGES.waveAmp },
      { key: "blackFreq", label: "cycleWidth", ...PARAM_RANGES.waveFreq },
      { key: "blackPhase", label: "cycleX", ...PARAM_RANGES.wavePhase },
      { key: "edgeBlack", label: "edge", ...PARAM_RANGES.edgeSeam },
    ],
  },
  {
    title: "Bottom 4 · lime",
    items: [
      { key: "limeBase", label: "center Y", ...PARAM_RANGES.waveBase },
      { key: "limeAmp", label: "amplitude", ...PARAM_RANGES.waveAmp },
      { key: "limeFreq", label: "cycleWidth", ...PARAM_RANGES.waveFreq },
      { key: "limePhase", label: "cycleX", ...PARAM_RANGES.wavePhase },
      { key: "edgeLime", label: "edge", ...PARAM_RANGES.edgeSeam },
    ],
  },
  {
    title: "Bottom 5 · blue 2",
    items: [
      { key: "blue2Base", label: "center Y", ...PARAM_RANGES.waveBase },
      { key: "blue2Amp", label: "amplitude", ...PARAM_RANGES.waveAmp },
      { key: "blue2Freq", label: "cycleWidth", ...PARAM_RANGES.waveFreq },
      { key: "blue2Phase", label: "cycleX", ...PARAM_RANGES.wavePhase },
      { key: "edgeBlue2", label: "edge", ...PARAM_RANGES.edgeSeam },
    ],
  },
  {
    title: "Bottom 6 · black 2 (front)",
    items: [
      { key: "black2Base", label: "center Y", ...PARAM_RANGES.waveBase },
      { key: "black2Amp", label: "amplitude", ...PARAM_RANGES.waveAmp },
      { key: "black2Freq", label: "cycleWidth", ...PARAM_RANGES.waveFreq },
      { key: "black2Phase", label: "cycleX", ...PARAM_RANGES.wavePhase },
      { key: "edgeBlack2", label: "edge", ...PARAM_RANGES.edgeSeam },
    ],
  },
];

let renderer: THREE.WebGLRenderer | null = null;
let material: THREE.ShaderMaterial | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | null = null;
let resizeObserver: ResizeObserver | null = null;
const shaderError = ref<string | null>(null);

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function resize() {
  const canvas = canvasRef.value;
  if (!canvas || !renderer || !material) return;

  const parent = canvas.parentElement;
  if (!parent) return;

  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(parent.clientWidth * dpr));
  const h = Math.max(1, Math.floor(parent.clientHeight * dpr));

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    renderer.setSize(w, h, false);
    material.uniforms.u_resolution!.value.set(w, h);
    analyzeCanvas();
  }
}

function syncUniforms() {
  if (!material) return;
  for (const [key, uniformName] of Object.entries(UNIFORM_MAP)) {
    const uniform = material.uniforms[uniformName];
    if (uniform) uniform.value = params[key as keyof typeof params];
  }
}

function renderFrame() {
  if (!renderer || !material || !scene || !camera) return;
  renderer.render(scene, camera);
}

function analyzeCanvas() {
  const canvas = canvasRef.value;
  if (!renderer || !canvas || canvas.width < 16) return;

  renderFrame();

  const w = canvas.width;
  const h = canvas.height;
  const pixels = new Uint8Array(w * h * 4);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const qstep = 18;
  const x0 = Math.floor(0.35 * w);
  const x1 = Math.floor(0.65 * w);
  const y0 = Math.floor(0.35 * h);
  const y1 = Math.floor(0.55 * h);

  let three = 0;
  let four = 0;
  let total = 0;

  const sample = (x: number, y: number) => {
    const row = h - 1 - y;
    const i = (row * w + x) * 4;
    const qr = Math.floor(pixels[i]! / qstep) * qstep;
    const qg = Math.floor(pixels[i + 1]! / qstep) * qstep;
    const qb = Math.floor(pixels[i + 2]! / qstep) * qstep;
    return `${qr},${qg},${qb}`;
  };

  for (let y = y0 + 1; y < y1 - 1; y += 2) {
    for (let x = x0 + 1; x < x1 - 1; x += 2) {
      const pts = [
        sample(x, y),
        sample(x - 1, y),
        sample(x + 1, y),
        sample(x, y - 1),
        sample(x, y + 1),
      ];
      const u = new Set(pts).size;
      if (u >= 3) three++;
      if (u >= 4) four++;
      total++;
    }
  }

  metrics.value = `mid seam 3+: ${((100 * three) / total).toFixed(1)}% · 4+: ${((100 * four) / total).toFixed(1)}% (ref ~92% / ~39%)`;
}

function reseed() {
  params.seed = Math.random() * 100;
  syncUniforms();
  renderFrame();
  analyzeCanvas();
}

function formatParams() {
  return JSON.stringify({ ...params }, null, 2);
}

async function copyValues() {
  await navigator.clipboard.writeText(formatParams());
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

watch(params, () => {
  syncUniforms();
  renderFrame();
  analyzeCanvas();
}, { deep: true });

function disposeRenderer() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  material?.dispose();
  renderer?.dispose();
  material = null;
  renderer = null;
  scene = null;
  camera = null;
}

function initRenderer(canvas: HTMLCanvasElement) {
  disposeRenderer();

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);

  material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: grainyDitherV4Frag,
    uniforms: {
      u_resolution: { value: new THREE.Vector2(1, 1) },
      ...Object.fromEntries(
        Object.entries(UNIFORM_MAP).map(([key, name]) => [name, { value: params[key as keyof typeof params] }]),
      ),
    },
  });

  scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const parent = canvas.parentElement;
  if (parent) {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(parent);
  }

  nextTick(() => {
    resize();
    renderFrame();
    analyzeCanvas();
  });

  const program = (
    material as THREE.ShaderMaterial & {
      program?: { fragmentShader: WebGLShader; program: WebGLProgram };
    }
  ).program;
  if (program?.fragmentShader && renderer) {
    const gl = renderer.getContext();
    if (!gl.getShaderParameter(program.fragmentShader, gl.COMPILE_STATUS)) {
      shaderError.value = gl.getShaderInfoLog(program.fragmentShader) ?? "Fragment shader failed";
    } else if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      shaderError.value = gl.getProgramInfoLog(program.program) ?? "Shader link failed";
    }
  }
}

watch(canvasRef, (canvas) => {
  if (canvas) initRenderer(canvas);
}, { flush: "post" });

onUnmounted(disposeRenderer);
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-[#0a0a0a]">
    <header class="flex shrink-0 items-center gap-4 border-b border-white/10 px-4 py-2">
      <NuxtLink
        to="/"
        class="text-copy-sm text-white/50 transition-colors hover:text-white/80"
      >
        Shader Lab
      </NuxtLink>
      <span class="text-copy-sm text-white/30">/</span>
      <span class="text-copy-sm text-white/80">Grainy dither v4</span>
      <NuxtLink
        to="/lab/grainy-dither-v3"
        class="text-copy-sm text-white/40 transition-colors hover:text-white/70"
      >
        v3
      </NuxtLink>
      <div class="flex-1" />
      <label class="flex items-center gap-2 text-copy-sm text-white/60">
        <input v-model="showReference" type="checkbox" class="accent-white">
        Show reference
      </label>
    </header>

    <div class="flex min-h-0 flex-1">
      <aside class="w-80 shrink-0 overflow-y-auto border-r border-white/10 p-3">
        <p class="mb-2 text-copy-sm font-medium text-white/70">
          Hybrid dissolve
        </p>
        <p class="mb-2 text-copy-sm leading-relaxed text-white/40">
          Each layer has an internal color gradient (not flat fill). Hybrid dissolve: cs = smooth edge, cd = stipple.
        </p>
        <p
          v-if="metrics"
          class="mb-3 rounded bg-white/5 px-2 py-1.5 font-mono text-xs text-emerald-400/90"
        >
          {{ metrics }}
        </p>
        <div class="flex flex-col gap-3">
          <UiSliderField
            v-model="params.grainMix"
            label="grainMix"
            :min="PARAM_RANGES.grainMix.min"
            :max="PARAM_RANGES.grainMix.max"
            :step="PARAM_RANGES.grainMix.step"
          />
          <UiSliderField
            v-model="params.dissolveReach"
            label="dissolveReach"
            :min="PARAM_RANGES.dissolveReach.min"
            :max="PARAM_RANGES.dissolveReach.max"
            :step="PARAM_RANGES.dissolveReach.step"
          />
          <UiSliderField
            v-model="params.edgeWidth"
            label="edgeWidth (global)"
            :min="PARAM_RANGES.edgeWidth.min"
            :max="PARAM_RANGES.edgeWidth.max"
            :step="PARAM_RANGES.edgeWidth.step"
          />
          <UiSliderField
            v-model="params.dotSize"
            label="dotSize"
            :min="PARAM_RANGES.dotSize.min"
            :max="PARAM_RANGES.dotSize.max"
            :step="PARAM_RANGES.dotSize.step"
          />
          <section
            v-for="group in SHAPE_CONTROLS"
            :key="group.title"
            class="flex flex-col gap-3 border-t border-white/10 pt-3"
          >
            <p class="text-copy-sm font-medium text-white/55">
              {{ group.title }}
            </p>
            <UiSliderField
              v-for="control in group.items"
              :key="control.key"
              v-model="params[control.key]"
              :label="control.label"
              :min="control.min"
              :max="control.max"
              :step="control.step"
            />
          </section>
          <div class="flex flex-col gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              class="rounded border border-white/15 bg-white/5 px-3 py-2 text-copy-sm text-white/80 transition-colors hover:bg-white/10"
              @click="reseed"
            >
              Reseed grain
            </button>
            <button
              type="button"
              class="rounded border border-white/15 bg-white/5 px-3 py-2 text-copy-sm text-white/80 transition-colors hover:bg-white/10"
              @click="copyValues"
            >
              {{ copied ? "Copied!" : "Copy values" }}
            </button>
          </div>
        </div>
      </aside>

      <div class="relative flex min-h-0 min-w-0 flex-1">
        <div
          v-if="showReference"
          class="relative flex h-full shrink-0 items-center justify-center border-r border-white/10 p-4 [container-type:size]"
          :style="{ width: '50%' }"
        >
          <img
            src="/lab/grainy-dither-reference.png"
            alt="Grainy gradient reference"
            class="aspect-video w-[min(100cqw,calc(100cqh*16/9))] max-h-full object-contain"
          >
          <span class="absolute left-6 top-6 rounded bg-black/60 px-2 py-0.5 text-copy-sm text-white/80">
            Reference
          </span>
        </div>

        <div
          class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 [container-type:size]"
          :style="showReference ? { width: '50%' } : undefined"
        >
          <div class="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] max-h-full">
            <ClientOnly>
              <canvas ref="canvasRef" class="block size-full" />
            </ClientOnly>
            <span class="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-copy-sm text-white/80">
              v4 hybrid
            </span>
            <p
              v-if="shaderError"
              class="absolute inset-x-2 bottom-2 rounded bg-red-950/90 p-2 font-mono text-xs text-red-200"
            >
              {{ shaderError }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
