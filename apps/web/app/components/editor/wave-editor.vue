<script setup lang="ts">
import type { LFOWaveShape, WavePoint } from "@shader-lab/core";
import { evaluateLfoWave } from "@shader-lab/core";
import { getOnCurveY, curveFromOnCurveY } from "~/composables/use-modulation-engine";

type Props = {
  color: string;
  waveShape?: LFOWaveShape;
  editable?: boolean;
  cursorPosition?: number;
};

const { color, waveShape = "custom", editable = true, cursorPosition } = defineProps<Props>();

const points = defineModel<WavePoint[]>({ required: true });

const history = useEditorHistory();

function sampleWave(t: number): number {
  return evaluateLfoWave(waveShape, points.value, t);
}

const canvasRef = ref<HTMLCanvasElement | null>(null);

// Interaction state
const hoveredIdx = ref<number | null>(null);
const hoveredType = ref<"anchor" | "curve" | null>(null);
const dragIdx = ref<number | null>(null);
const dragType = ref<"anchor" | "curve" | null>(null);

const HIT_RADIUS = 12;
const GRID_STEP = 24;
const ANCHOR_RADIUS = 3;
const CURVE_RING_RADIUS = 2.5;
const ACTIVE_DOT_RADIUS = 3;

type Rgb = { r: number; g: number; b: number };

function parseColor(hex: string): Rgb {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return { r: 236, g: 72, b: 153 };
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function colorAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Coordinate mapping ---

function toCanvasX(x: number, w: number): number {
  return x * w;
}

function toCanvasY(y: number, h: number): number {
  return (1 - y) * h;
}

function fromCanvasX(cx: number, w: number): number {
  return Math.max(0, Math.min(1, cx / w));
}

function fromCanvasY(cy: number, h: number): number {
  return Math.max(0, Math.min(1, 1 - cy / h));
}

// --- On-curve control point position (what user sees/drags) ---

function getCurveHandlePos(i: number, w: number, h: number): { x: number; y: number } {
  const p1 = points.value[i]!;
  const p2 = points.value[i + 1];
  if (!p2) return { x: 0, y: 0 };

  const midX = (p1.x + p2.x) / 2;
  const onCurve = getOnCurveY(p1.y, p2.y, p1.curve);

  return {
    x: toCanvasX(midX, w),
    y: toCanvasY(onCurve, h),
  };
}

function collectWaveSamples(w: number, h: number): { x: number; y: number; t: number }[] {
  const pts = points.value;
  const samples: { x: number; y: number; t: number }[] = [];

  if (waveShape === "sine") {
    const steps = Math.max(120, Math.floor(w));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const y = sampleWave(t);
      samples.push({ t, x: toCanvasX(t, w), y: toCanvasY(y, h) });
    }
    return samples;
  }

  if (pts.length < 2) return samples;

  samples.push({
    t: pts[0]!.x,
    x: toCanvasX(pts[0]!.x, w),
    y: toCanvasY(pts[0]!.y, h),
  });

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;

    if (Math.abs(p2.x - p1.x) < 0.001) {
      samples.push({
        t: p2.x,
        x: toCanvasX(p2.x, w),
        y: toCanvasY(p2.y, h),
      });
      continue;
    }

    const segSteps = Math.max(24, Math.floor((p2.x - p1.x) * w));
    for (let s = 1; s <= segSteps; s++) {
      const segT = s / segSteps;
      const t = p1.x + segT * (p2.x - p1.x);
      const y = sampleWave(t);
      samples.push({ t, x: toCanvasX(t, w), y: toCanvasY(y, h) });
    }
  }

  return samples;
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
  const step = GRID_STEP * dpr;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = dpr;

  for (let x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }

  for (let y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
}

function drawWaveFill(
  ctx: CanvasRenderingContext2D,
  samples: { x: number; y: number }[],
  h: number,
) {
  if (samples.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(samples[0]!.x, samples[0]!.y);
  for (let i = 1; i < samples.length; i++) {
    ctx.lineTo(samples[i]!.x, samples[i]!.y);
  }
  ctx.lineTo(samples[samples.length - 1]!.x, h);
  ctx.lineTo(samples[0]!.x, h);
  ctx.closePath();

  const minY = Math.min(...samples.map((s) => s.y));
  const gradient = ctx.createLinearGradient(0, minY, 0, h);
  gradient.addColorStop(0, colorAlpha(color, 0.28));
  gradient.addColorStop(0.45, colorAlpha(color, 0.1));
  gradient.addColorStop(1, colorAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawWaveStroke(
  ctx: CanvasRenderingContext2D,
  samples: { x: number; y: number }[],
  dpr: number,
) {
  if (samples.length < 2) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(samples[0]!.x, samples[0]!.y);
  for (let i = 1; i < samples.length; i++) {
    ctx.lineTo(samples[i]!.x, samples[i]!.y);
  }
  ctx.stroke();
}

function drawAnchorHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dpr: number,
  active: boolean,
) {
  if (active) {
    ctx.fillStyle = colorAlpha(color, 0.12);
    ctx.beginPath();
    ctx.arc(x, y, HIT_RADIUS * dpr * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = colorAlpha(color, 0.55);
  ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
  ctx.shadowBlur = 2 * dpr;
  ctx.shadowOffsetY = dpr;
  ctx.beginPath();
  ctx.arc(x, y, ANCHOR_RADIUS * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawCurveHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dpr: number,
  active: boolean,
) {
  if (active) {
    ctx.fillStyle = colorAlpha(color, 0.1);
    ctx.beginPath();
    ctx.arc(x, y, HIT_RADIUS * dpr * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = colorAlpha(color, 0.85);
  ctx.lineWidth = dpr;
  ctx.shadowColor = "rgba(0, 0, 0, 0.08)";
  ctx.shadowBlur = 2 * dpr;
  ctx.shadowOffsetY = dpr;
  ctx.beginPath();
  ctx.arc(x, y, CURVE_RING_RADIUS * dpr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.beginPath();
  ctx.arc(x, y, 0.5 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

function drawActiveScrubber(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  h: number,
  dpr: number,
) {
  ctx.save();
  ctx.strokeStyle = colorAlpha(color, 0.45);
  ctx.lineWidth = dpr;
  ctx.shadowColor = colorAlpha(color, 0.55);
  ctx.shadowBlur = 8 * dpr;
  ctx.beginPath();
  ctx.moveTo(cx + 0.5, 0);
  ctx.lineTo(cx + 0.5, h);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = color;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, ACTIVE_DOT_RADIUS * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// --- Drawing ---

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

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  drawGrid(ctx, w, h, dpr);

  const pts = points.value;
  const samples = collectWaveSamples(w, h);

  drawWaveFill(ctx, samples, h);
  drawWaveStroke(ctx, samples, dpr);

  if (cursorPosition != null) {
    const cx = toCanvasX(cursorPosition, w);
    const cursorY = sampleWave(cursorPosition);
    const cy = toCanvasY(cursorY, h);
    drawActiveScrubber(ctx, cx, cy, h, dpr);
  }

  if (editable) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1];
      if (!p2 || Math.abs(p2.x - p1.x) < 0.001 || Math.abs(p2.y - p1.y) < 0.001) continue;

      const pos = getCurveHandlePos(i, w, h);
      const isHovered = hoveredType.value === "curve" && hoveredIdx.value === i;
      const isDragging = dragType.value === "curve" && dragIdx.value === i;
      drawCurveHandle(ctx, pos.x, pos.y, dpr, isHovered || isDragging);
    }

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const cx = toCanvasX(p.x, w);
      const cy = toCanvasY(p.y, h);
      const isHovered = hoveredType.value === "anchor" && hoveredIdx.value === i;
      const isDragging = dragType.value === "anchor" && dragIdx.value === i;
      drawAnchorHandle(ctx, cx, cy, dpr, isHovered || isDragging);
    }
  }
}

// --- Hit testing ---

function hitTest(e: PointerEvent | MouseEvent): { type: "anchor" | "curve"; idx: number } | null {
  if (!editable) return null;
  const canvas = canvasRef.value;
  if (!canvas) return null;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * dpr;
  const my = (e.clientY - rect.top) * dpr;
  const w = canvas.width;
  const h = canvas.height;
  const hitDist = HIT_RADIUS * dpr;

  // Check anchors first (higher priority)
  for (let i = 0; i < points.value.length; i++) {
    const p = points.value[i]!;
    const cx = toCanvasX(p.x, w);
    const cy = toCanvasY(p.y, h);
    const dx = mx - cx;
    const dy = my - cy;
    if (dx * dx + dy * dy < hitDist * hitDist) {
      return { type: "anchor", idx: i };
    }
  }

  // Check curve controls — skip zero-width segments
  for (let i = 0; i < points.value.length - 1; i++) {
    const p1 = points.value[i]!;
    const p2 = points.value[i + 1];
    if (!p2 || Math.abs(p2.x - p1.x) < 0.001 || Math.abs(p2.y - p1.y) < 0.001) continue;

    const pos = getCurveHandlePos(i, w, h);
    const dx = mx - pos.x;
    const dy = my - pos.y;
    if (dx * dx + dy * dy < hitDist * hitDist) {
      return { type: "curve", idx: i };
    }
  }

  return null;
}

// --- Pointer events ---

function onPointerMove(e: PointerEvent) {
  if (dragIdx.value !== null) return;
  const hit = hitTest(e);
  if (hit) {
    hoveredType.value = hit.type;
    hoveredIdx.value = hit.idx;
  } else {
    hoveredType.value = null;
    hoveredIdx.value = null;
  }
  requestAnimationFrame(draw);
}

function onPointerDown(e: PointerEvent) {
  if (e.button === 2) return;

  const hit = hitTest(e);
  if (!hit) return;

  e.preventDefault();
  dragIdx.value = hit.idx;
  dragType.value = hit.type;
  history?.beginGesture();

  const canvas = canvasRef.value!;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width;
  const h = canvas.height;

  function onMove(ev: PointerEvent) {
    if (dragIdx.value === null || !dragType.value) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (ev.clientX - rect.left) * dpr;
    const my = (ev.clientY - rect.top) * dpr;

    const pts = points.value;
    const i = dragIdx.value;

    if (dragType.value === "anchor") {
      const p = pts[i]!;
      const newY = fromCanvasY(my, h);

      if (i === 0 || i === pts.length - 1) {
        pts[0]!.y = newY;
        pts[pts.length - 1]!.y = newY;
      } else {
        const prevX = pts[i - 1]?.x ?? 0;
        const nextX = pts[i + 1]?.x ?? 1;
        const newX = fromCanvasX(mx, w);
        p.x = Math.max(prevX, Math.min(nextX, newX));
        p.y = newY;
      }
    } else if (dragType.value === "curve") {
      const p1 = pts[i]!;
      const p2 = pts[i + 1];
      if (!p2) return;

      let newY = fromCanvasY(my, h);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      const margin = Math.abs(p2.y - p1.y) * 0.01;
      newY = Math.max(minY + margin, Math.min(maxY - margin, newY));

      p1.curve = curveFromOnCurveY(p1.y, p2.y, newY);
    }

    requestAnimationFrame(draw);
  }

  function onUp() {
    dragIdx.value = null;
    dragType.value = null;
    history?.commitGesture();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function onDblClick(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const hit = hitTest(e);
  if (hit) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * dpr;
  const my = (e.clientY - rect.top) * dpr;
  const w = canvas.width;
  const h = canvas.height;

  const newX = fromCanvasX(mx, w);
  const newY = fromCanvasY(my, h);

  const pts = points.value;
  let insertIdx = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i]!.x > newX) {
      insertIdx = i;
      break;
    }
  }

  pts.splice(insertIdx, 0, { x: newX, y: newY, curve: 0 });
  requestAnimationFrame(draw);
  history?.record();
}

function onContextMenu(e: MouseEvent) {
  const hit = hitTest(e);
  if (!hit || hit.type !== "anchor") return;
  if (hit.idx === 0 || hit.idx === points.value.length - 1) return;

  e.preventDefault();
  points.value.splice(hit.idx, 1);
  hoveredIdx.value = null;
  hoveredType.value = null;
  requestAnimationFrame(draw);
  history?.record();
}

watch(() => [cursorPosition, points.value, waveShape, editable, color], () => {
  requestAnimationFrame(draw);
}, { deep: true });

onMounted(() => {
  requestAnimationFrame(draw);
});
</script>

<template>
  <canvas
    ref="canvasRef"
    class="h-24 w-full rounded-lg bg-black"
    :class="editable ? 'cursor-crosshair' : 'cursor-default'"
    @pointermove="onPointerMove"
    @pointerdown="onPointerDown"
    @pointerleave="hoveredIdx = null; hoveredType = null"
    @dblclick="onDblClick"
    @contextmenu="onContextMenu"
  />
</template>
