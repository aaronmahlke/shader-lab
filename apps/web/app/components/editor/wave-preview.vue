<script setup lang="ts">
type Props = {
  waveType: number;
  freq?: number;
  amplitude?: number;
  sharpness?: number;
  pulseWidth?: number;
  skew?: number;
};

const { waveType, freq = 3, amplitude = 0.5, sharpness = 6.7, pulseWidth = 0, skew = 0 } = defineProps<Props>();

const canvasRef = ref<HTMLCanvasElement | null>(null);

const TAU = Math.PI * 2;

function fastTanh(x: number): number {
  return Math.max(-1, Math.min(1, x * (27 + x * x) / (27 + 9 * x * x)));
}

function waveSine(x: number): number {
  return Math.sin(x);
}

function waveSquare(x: number, sharp: number, width: number): number {
  const m = Math.max(0.3, Math.min(2.0, 1.0 + Math.sin(x * 0.5) * width));
  return fastTanh(Math.sin(x * m) * sharp);
}

function waveTriangle(x: number, sk: number): number {
  const t = ((x / TAU + 0.25) % 1 + 1) % 1;
  const rise = Math.max(0.01, Math.min(0.99, 0.5 + sk * 0.49));
  if (t < rise) {
    return 2 * t / rise - 1;
  }
  return 1 - 2 * (t - rise) / (1 - rise);
}

function computeWave(x: number): number {
  switch (waveType) {
    case 0: return waveSine(x);
    case 1: return waveSquare(x, sharpness, pulseWidth);
    case 2: return waveTriangle(x, skew);
    default: return waveSine(x);
  }
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width * dpr;
  const h = rect.height * dpr;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);

  const style = getComputedStyle(canvas);
  const strokeColor = style.getPropertyValue("color").trim() || "rgba(255,255,255,0.4)";

  // Draw zero line
  ctx.strokeStyle = strokeColor;
  ctx.globalAlpha = 0.08;
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Amplitude scales wave height proportionally to max range (5)
  const ampNorm = Math.min(amplitude / 5, 1);

  // Draw wave
  ctx.strokeStyle = strokeColor;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  const periods = 2.5;
  const padding = 6 * dpr;

  for (let px = 0; px < w; px++) {
    const t = px / w;
    const x = t * periods * TAU;
    const y = computeWave(x * freq / 3) * ampNorm;
    const canvasY = padding + (1 - (y * 0.5 + 0.5)) * (h - padding * 2);
    if (px === 0) ctx.moveTo(px, canvasY);
    else ctx.lineTo(px, canvasY);
  }

  ctx.stroke();
  ctx.globalAlpha = 1;
}

watch(() => [waveType, freq, amplitude, sharpness, pulseWidth, skew], () => {
  requestAnimationFrame(draw);
}, { immediate: false });

onMounted(() => {
  requestAnimationFrame(draw);
});
</script>

<template>
  <canvas
    ref="canvasRef"
    class="h-14 w-full rounded-lg text-secondary"
  />
</template>
