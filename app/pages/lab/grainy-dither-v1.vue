<script setup lang="ts">
import * as THREE from "three";
import grainyDitherV1Frag from "#shared/shaders/grainy-dither-v1.frag";

useHead({ title: "Grainy dither v1 — Shader Lab" });

const canvasRef = ref<HTMLCanvasElement | null>(null);
const showReference = ref(true);
const splitRatio = ref(50);

const params = reactive({
  softness: 1.0,
  gain: 1.08,
  grainSize: 1.35,
  sampleSpread: 7.0,
  edgeMin: 0.012,
  edgeMax: 0.075,
  seamStrength: 1.0,
  warpAmount: 0.055,
  warpFreq: 1.12,
  lightAmount: 0.68,
  filmGrain: 0.03,
});

let renderer: THREE.WebGLRenderer | null = null;
let material: THREE.ShaderMaterial | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.OrthographicCamera | null = null;
let animationId: number | null = null;
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
    material.uniforms.u_scale!.value = dpr;
  }
}

function renderFrame(time: number) {
  if (!renderer || !material || !scene || !camera) return;
  material.uniforms.u_time!.value = time * 0.001;
  renderer.render(scene, camera);
}

function syncUniforms() {
  if (!material) return;
  for (const [key, val] of Object.entries(params)) {
    const u = material.uniforms[key];
    if (u) u.value = val;
  }
}

watch(params, syncUniforms, { deep: true });

function disposeRenderer() {
  window.removeEventListener("resize", resize);
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  material?.dispose();
  renderer?.dispose();
  material = null;
  renderer = null;
  scene = null;
  camera = null;
}

function initRenderer(canvas: HTMLCanvasElement) {
  disposeRenderer();

  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement!;
  const w = Math.max(1, Math.floor(parent.clientWidth * dpr));
  const h = Math.max(1, Math.floor(parent.clientHeight * dpr));

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 1);

  material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: grainyDitherV1Frag,
    uniforms: {
      u_time: { value: 0 },
      u_resolution: { value: new THREE.Vector2(w, h) },
      u_scale: { value: dpr },
      softness: { value: params.softness },
      gain: { value: params.gain },
      grainSize: { value: params.grainSize },
      sampleSpread: { value: params.sampleSpread },
      edgeMin: { value: params.edgeMin },
      edgeMax: { value: params.edgeMax },
      seamStrength: { value: params.seamStrength },
      filmGrain: { value: params.filmGrain },
      warpAmount: { value: params.warpAmount },
      warpFreq: { value: params.warpFreq },
      lightAmount: { value: params.lightAmount },
    },
  });

  scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  resize();
  renderFrame(0);

  const program = material.program;
  if (program?.fragmentShader) {
    const gl = renderer.getContext();
    if (!gl.getShaderParameter(program.fragmentShader, gl.COMPILE_STATUS)) {
      shaderError.value = gl.getShaderInfoLog(program.fragmentShader) ?? "Fragment shader failed";
    } else if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      shaderError.value = gl.getProgramInfoLog(program.program) ?? "Shader link failed";
    }
  }

  const loop = (time: number) => {
    resize();
    renderFrame(time);
    animationId = requestAnimationFrame(loop);
  };
  animationId = requestAnimationFrame(loop);
  window.addEventListener("resize", resize);
}

watch(
  canvasRef,
  (canvas) => {
    if (canvas) initRenderer(canvas);
  },
  { flush: "post" },
);

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
      <span class="text-copy-sm text-white/80">Grainy dither v1</span>
      <NuxtLink
        to="/lab/grainy-dither-v2"
        class="text-copy-sm text-white/40 transition-colors hover:text-white/70"
      >
        v2
      </NuxtLink>
      <NuxtLink
        to="/lab/grainy-dither-v3"
        class="text-copy-sm text-white/40 transition-colors hover:text-white/70"
      >
        v3
      </NuxtLink>
      <NuxtLink
        to="/lab/grainy-dither-v4"
        class="text-copy-sm text-white/40 transition-colors hover:text-white/70"
      >
        v4
      </NuxtLink>
      <div class="flex-1" />
      <label class="flex items-center gap-2 text-copy-sm text-white/60">
        <input v-model="showReference" type="checkbox" class="accent-white">
        Show reference
      </label>
    </header>

    <div class="flex min-h-0 flex-1">
      <aside class="w-64 shrink-0 overflow-y-auto border-r border-white/10 p-3">
        <p class="mb-3 text-copy-sm text-white/40">
          Single-shader prototype. Tune until it matches the reference, then split into layers.
        </p>
        <div class="flex flex-col gap-3">
          <label
            v-for="(val, key) in params"
            :key="key"
            class="flex flex-col gap-1"
          >
            <span class="text-copy-sm text-white/50">{{ key }}</span>
            <input
              v-model.number="params[key as keyof typeof params]"
              type="range"
              :min="key === 'edgeMin' || key === 'edgeMax' ? 0.01 : key === 'grainSize' || key === 'sampleSpread' ? 1 : 0"
              :max="key === 'softness' ? 2 : key === 'gain' ? 1.5 : key === 'grainSize' ? 5 : key === 'sampleSpread' ? 20 : key === 'edgeMin' || key === 'edgeMax' ? 0.35 : key === 'seamStrength' ? 1 : key === 'warpAmount' ? 0.15 : key === 'warpFreq' ? 3 : key === 'filmGrain' ? 0.05 : 2"
              :step="key === 'grainSize' || key === 'sampleSpread' ? 0.5 : 0.01"
              class="w-full"
            >
            <span class="text-copy-sm tabular-nums text-white/70">
              {{ params[key as keyof typeof params].toFixed(2) }}
            </span>
          </label>
        </div>
      </aside>

      <div class="relative flex min-w-0 flex-1">
        <div
          v-if="showReference"
          class="relative h-full shrink-0 overflow-hidden border-r border-white/10"
          :style="{ width: `${splitRatio}%` }"
        >
          <img
            src="/lab/grainy-dither-reference.png"
            alt="Grainy gradient reference"
            class="size-full object-cover"
          >
          <span class="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-copy-sm text-white/80">
            Reference
          </span>
        </div>

        <div
          class="relative min-w-0 flex-1"
          :style="showReference ? { width: `${100 - splitRatio}%` } : undefined"
        >
          <ClientOnly>
            <canvas ref="canvasRef" class="block size-full" />
          </ClientOnly>
          <span class="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-copy-sm text-white/80">
            Shader
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
</template>
