<script setup lang="ts">
// Demo "stageable" card: fully self-contained, no props, no external assets.
// Rendered off-screen (~640px wide) and captured into the WebGL compositor.

type Stat = {
  key: string;
  label: string;
  value: string;
  delta: string;
  deltaClass: string;
  stroke: string;
  points: number[];
};

const uid = Math.random().toString(36).slice(2, 8);

const stats: Stat[] = [
  {
    key: "requests",
    label: "Requests / min",
    value: "48.2k",
    delta: "+12.4%",
    deltaClass: "text-emerald-400",
    stroke: "#34d399",
    points: [14, 18, 16, 22, 20, 26, 24, 30, 28, 34, 31, 38],
  },
  {
    key: "latency",
    label: "p95 latency",
    value: "184ms",
    delta: "-8ms",
    deltaClass: "text-sky-400",
    stroke: "#38bdf8",
    points: [30, 26, 28, 22, 25, 20, 23, 18, 21, 16, 19, 14],
  },
  {
    key: "errors",
    label: "Error rate",
    value: "0.03%",
    delta: "+0.01",
    deltaClass: "text-rose-400",
    stroke: "#fb7185",
    points: [8, 6, 9, 7, 12, 8, 10, 22, 12, 9, 11, 10],
  },
];

const CHART_W = 100;
const CHART_H = 40;

function linePoints(points: number[]): string {
  const step = CHART_W / (points.length - 1);
  return points.map((p, i) => `${(i * step).toFixed(1)},${(CHART_H - p).toFixed(1)}`).join(" ");
}

function areaPath(points: number[]): string {
  const step = CHART_W / (points.length - 1);
  const line = points
    .map((p, i) => `L${(i * step).toFixed(1)} ${(CHART_H - p).toFixed(1)}`)
    .join(" ");
  return `M0 ${CHART_H} ${line.replace(/^L/, "L")} L${CHART_W} ${CHART_H} Z`;
}
</script>

<template>
  <div
    class="w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 bg-gradient-to-b from-zinc-900 to-zinc-950 shadow-[0_1px_2px_rgba(0,0,0,0.4),0_16px_40px_-12px_rgba(0,0,0,0.6)]"
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-zinc-800/80 px-5 py-4">
      <div class="flex items-center gap-3">
        <span class="relative flex size-2.5">
          <span class="stage-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span class="relative inline-flex size-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
        </span>
        <div class="flex flex-col">
          <span class="text-[14px] font-medium text-zinc-100">payments-api</span>
          <span class="text-[11px] text-zinc-500">production · v2.14.3</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="rounded-full border border-zinc-700/70 bg-zinc-800/60 px-2.5 py-0.5 font-mono text-[11px] tracking-wide text-zinc-400"
        >
          us-east-1
        </span>
        <span
          class="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400"
        >
          Healthy
        </span>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 divide-x divide-zinc-800/70">
      <div v-for="stat in stats" :key="stat.key" class="flex flex-col gap-1 px-5 pt-4 pb-3">
        <span class="text-[10.5px] font-medium tracking-[0.08em] text-zinc-500 uppercase">
          {{ stat.label }}
        </span>
        <div class="flex items-baseline gap-2">
          <span class="text-[26px] leading-8 font-semibold tracking-tight text-zinc-50 tabular-nums">
            {{ stat.value }}
          </span>
          <span class="text-[11px] font-medium tabular-nums" :class="stat.deltaClass">
            {{ stat.delta }}
          </span>
        </div>
        <svg
          class="mt-1 h-9 w-full"
          :viewBox="`0 0 ${CHART_W} ${CHART_H}`"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient :id="`spark-${uid}-${stat.key}`" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" :stop-color="stat.stroke" stop-opacity="0.35" />
              <stop offset="100%" :stop-color="stat.stroke" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path :d="areaPath(stat.points)" :fill="`url(#spark-${uid}-${stat.key})`" />
          <polyline
            :points="linePoints(stat.points)"
            :stroke="stat.stroke"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>

    <!-- Footer -->
    <div
      class="flex items-center justify-between border-t border-zinc-800/80 bg-zinc-900/50 px-5 py-2.5"
    >
      <div class="flex items-center gap-2 text-[11px] text-zinc-500">
        <svg class="size-3 text-zinc-600" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            d="M8 1a3 3 0 0 0-1 5.83v2.34A3.001 3.001 0 0 0 8 15a3 3 0 0 0 1-5.83V6.83A3.001 3.001 0 0 0 8 1ZM6.5 4a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm3 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"
          />
        </svg>
        <span>
          Last deploy
          <span class="font-mono text-zinc-400">e4f9c21</span>
          · 12 min ago
        </span>
      </div>
      <span class="text-[11px] text-zinc-600">deployed by mira@ops</span>
    </div>
  </div>
</template>

<style scoped>
.stage-pulse {
  animation: stage-card-pulse 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes stage-card-pulse {
  0% {
    transform: scale(1);
    opacity: 0.6;
  }
  70% {
    transform: scale(2.4);
    opacity: 0;
  }
  100% {
    transform: scale(2.4);
    opacity: 0;
  }
}
</style>
