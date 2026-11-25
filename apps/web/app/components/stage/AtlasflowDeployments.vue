<script setup lang="ts">
/**
 * Atlasflow deployments page (launch video, scene "03 Dashboard").
 *
 * Markup follows Atlasflow's real page (apps/web/app/pages/[workspace]/
 * [project]/[environment]/index.vue: DHeader + deployment rows, DNavbar,
 * DDeploymentStatus) on the Dokedu tokens both apps share. Everything is a
 * pure function of the layer time `t` (useStageTime), so scrubbing and
 * export are deterministic:
 *
 *   0–3 s     only the first row's status ("Building", counter 0s → 3s)
 *   3–4 s     header, tabs, card and the other rows fade in
 *   4–4.5 s   "Building" rolls up and out, "Running" rolls in, dot turns green
 */
import { CubeTransparentIcon, Cog8ToothIcon, Bars3BottomLeftIcon } from "@heroicons/vue/16/solid";

const t = useStageTime();

/** AE ease (out-influence 14 %, in-influence 66 %) as a cubic bezier. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, s = x;
    for (let i = 0; i < 24; i++) {
      s = (lo + hi) / 2;
      if (sx(s) < x) lo = s;
      else hi = s;
    }
    return sy(s);
  };
}
const easeAE = bezier(0.14, 0, 0.34, 1);
const ramp = (from: number, to: number) => easeAE((t.value - from) / (to - from));

/** Everything except the first row's status. */
const reveal = computed(() => ramp(3, 4));
/** Building → Running roll. */
const roll = computed(() => ramp(4, 4.5));
/** Dot color blend (AE 4.0–4.3, linear). */
const dot = computed(() => Math.min(1, Math.max(0, (t.value - 4) / 0.3)));

/** Counter: each second rolls over in the last 1/6 s (AE 0.833 → 1.0). */
const counter = computed(() => {
  const s = Math.max(0, t.value);
  const whole = Math.floor(s);
  const frac = s - whole;
  const step = easeAE(Math.max(0, (frac - 5 / 6) * 6));
  return { value: whole, next: whole + 1, step };
});

/** Ring pulse (Atlasflow: 1.4 s ease-out, scale 1 → 2.25, fade out), as a function of t. */
const pulse = computed(() => {
  const p = (Math.max(0, t.value) % 1.4) / 1.4;
  const e = 1 - (1 - p) ** 2;
  return { scale: 1 + 1.25 * e, opacity: 1 - e };
});

function mix(a: [number, number, number], b: [number, number, number], k: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * k)).join(",")})`;
}
const dotInner = computed(() => mix([225, 113, 0], [0, 166, 62], dot.value));
const dotOuter = computed(() => mix([70, 25, 1], [3, 46, 21], dot.value));

type Row = {
  commit: string;
  message: string;
  status: "RUNNING" | "STOPPED" | "FAILED";
  duration: string;
  branch: string;
  time: string;
};
const rows: Row[] = [
  { commit: "b7e2a1d", message: "Add new feature to export reports in PDF format", status: "RUNNING", duration: "34s", branch: "main", time: "2 min ago" },
  { commit: "c8f4b2e", message: "Improve loading speed on the dashboard", status: "STOPPED", duration: "34s", branch: "feat/primary-filters", time: "1 hour ago" },
  { commit: "d1a3c5b", message: "Update user profile page layout to enhance usability", status: "FAILED", duration: "34s", branch: "chore/default-env", time: "3 hours ago" },
  { commit: "e6b7d8f", message: "Refactor notification system to support webhooks", status: "STOPPED", duration: "34s", branch: "feat/central-hooks", time: "1 day ago" },
  { commit: "f3c9e4a", message: "Fix typo in settings menu and update help links", status: "STOPPED", duration: "34s", branch: "main", time: "1 day ago" },
  { commit: "a7d5f2c", message: "Implement dark mode option for better accessibility", status: "FAILED", duration: "34s", branch: "main", time: "2 days ago" },
  { commit: "b2e8c6d", message: "Add unit tests for payment processing", status: "STOPPED", duration: "34s", branch: "main", time: "2 days ago" },
];
const LABEL = { RUNNING: "Running", STOPPED: "Stopped", FAILED: "Failed" } as const;
// Atlasflow (flow-ui) dark theme: success green-500/950, idle neutral-600/800, danger red-500/950.
const DOT = { RUNNING: "bg-[#00c950]", STOPPED: "bg-[#525252]", FAILED: "bg-[#fb2c36]" } as const;
const DOT_RING = { RUNNING: "bg-[#032e15]", STOPPED: "bg-[#262626]", FAILED: "bg-[#460809]" } as const;

/** flow-ui [data-theme="dark"] values (Tailwind palette), so the capture matches Atlasflow, not Dokedu. */
const ATLASFLOW_DARK = {
  "--text-color-neutral-strong": "#ffffff",
  "--text-color-neutral": "#e5e5e5",
  "--text-color-neutral-subtle": "#a1a1a1",
  "--text-color-neutral-weak": "#737373",
  "--border-color-neutral": "#262626",
  "--background-color-layer-1": "#0a0a0a",
  "--background-color-tint": "rgb(255 255 255 / 0.08)",
  "--background-color-primary": "#fafafa",
  "--text-color-on-primary": "#171717",
};

const GRID = "grid h-12 grid-cols-[minmax(0,180px)_minmax(0,150px)_minmax(240px,1fr)_140px_112px] items-stretch gap-3 px-2";
</script>

<template>
  <!-- Atlasflow's own dark theme (flow-ui tokens) on top of the shared Dokedu utilities. -->
  <div class="flex flex-col font-sans text-sm text-neutral" :style="ATLASFLOW_DARK">
    <!-- App header + tabs (Atlasflow DAppHeader / DNavbar) -->
    <div :style="{ opacity: reveal }">
      <header class="flex h-12 items-center gap-2 px-3 text-neutral">
        <span class="flex items-center gap-2 rounded-md p-1.5">
          <span class="flex size-5 items-center justify-center rounded-[5px] bg-white text-[11px] font-bold text-black">D</span>
          <span>Dokedu</span>
          <svg class="size-4 text-neutral-subtle" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 3.5 5.5 6h5L8 3.5Zm0 9L10.5 10h-5L8 12.5Z" /></svg>
        </span>
        <span class="text-neutral-weak">/</span>
        <span class="flex items-center gap-2 rounded-md p-1.5">
          <span>Dokedu Backend</span>
          <svg class="size-4 text-neutral-subtle" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 3.5 5.5 6h5L8 3.5Zm0 9L10.5 10h-5L8 12.5Z" /></svg>
        </span>
      </header>
      <nav class="flex h-12 items-center gap-2 px-3">
        <span class="flex h-8 items-center gap-0.5 rounded-md bg-tint p-1.5 text-neutral-strong">
          <span class="flex size-5 items-center justify-center"><CubeTransparentIcon class="size-4" /></span>
          <span class="px-0.5">Deployments</span>
        </span>
        <span class="flex h-8 items-center gap-0.5 p-1.5 text-neutral-subtle">
          <span class="flex size-5 items-center justify-center"><Bars3BottomLeftIcon class="size-4" /></span>
          <span class="px-0.5">Logs</span>
        </span>
        <span class="flex h-8 items-center gap-0.5 p-1.5 text-neutral-subtle">
          <span class="flex size-5 items-center justify-center"><Cog8ToothIcon class="size-4" /></span>
          <span class="px-0.5">Settings</span>
        </span>
      </nav>
    </div>

    <!-- Content card -->
    <div class="relative mx-2 mb-2 rounded-xl">
      <div class="absolute inset-0 rounded-xl border border-neutral bg-layer-1" :style="{ opacity: reveal }" />
      <div class="relative">
        <!-- DHeader -->
        <header class="flex h-12 items-center justify-between gap-2 border-b border-neutral px-2" :style="{ opacity: reveal }">
          <div class="flex min-w-0 flex-1 items-center gap-2 px-2">
            <span class="shrink-0 text-neutral-strong">Deployments</span>
            <span class="shrink-0 text-neutral-subtle">Automatically created for pushes to</span>
            <span class="flex items-center gap-1 text-neutral">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M6.97914 0C3.11986 0 0 3.20833 0 7.17748C0 10.3502 1.999 13.0359 4.77214 13.9864C5.11886 14.0579 5.24586 13.832 5.24586 13.642C5.24586 13.4756 5.23443 12.9052 5.23443 12.311C3.293 12.7388 2.88871 11.4554 2.88871 11.4554C2.57671 10.6235 2.11443 10.4097 2.11443 10.4097C1.479 9.97004 2.16071 9.97004 2.16071 9.97004C2.86557 10.0176 3.23543 10.7068 3.23543 10.7068C3.85929 11.8 4.86457 11.4911 5.269 11.3009C5.32671 10.8375 5.51171 10.5166 5.70814 10.3384C4.15971 10.172 2.53057 9.55413 2.53057 6.79715C2.53057 6.01285 2.80771 5.37119 3.24686 4.87215C3.17757 4.69394 2.93486 3.95704 3.31629 2.97077C3.31629 2.97077 3.90557 2.7806 5.23429 3.70752C5.80316 3.55041 6.38982 3.47049 6.97914 3.46981C7.56843 3.46981 8.16914 3.55308 8.72386 3.70752C10.0527 2.7806 10.642 2.97077 10.642 2.97077C11.0234 3.95704 10.7806 4.69394 10.7113 4.87215C11.162 5.37119 11.4277 6.01285 11.4277 6.79715C11.4277 9.55413 9.79857 10.1601 8.23857 10.3384C8.49286 10.5642 8.71229 10.9919 8.71229 11.6693C8.71229 12.6318 8.70086 13.4043 8.70086 13.6418C8.70086 13.832 8.828 14.0579 9.17457 13.9866C11.9477 13.0358 13.9467 10.3502 13.9467 7.17748C13.9581 3.20833 10.8269 0 6.97914 0Z" fill="currentColor" /></svg>
              dokedu/dokedu
            </span>
          </div>
          <span class="flex h-8 items-center rounded-lg bg-primary px-3 text-on-primary">Create deployment</span>
        </header>

        <!-- First row: the status animates; the rest of the row fades in with the page -->
        <div :class="GRID" class="relative">
          <div class="absolute inset-x-0 bottom-0 border-b border-neutral" :style="{ opacity: reveal }" />
          <div class="flex items-center overflow-hidden px-2">
            <span class="inline-flex items-center gap-1.5">
              <span class="relative flex size-5 shrink-0 items-center justify-center">
                <span
                  class="absolute size-2 rounded-full"
                  :style="{ background: dotOuter, transform: `scale(${pulse.scale})`, opacity: pulse.opacity * (1 - dot) }"
                />
                <span class="absolute size-3.5 rounded-full" :style="{ background: dotOuter, opacity: dot }" />
                <span class="relative size-2 rounded-full" :style="{ background: dotInner }" />
              </span>
              <!-- Label roll: Building leaves upward, Running arrives from below -->
              <span class="relative h-5 overflow-visible">
                <span class="invisible">Building</span>
                <span class="absolute inset-0 text-neutral" :style="{ transform: `translateY(${-roll * 70}%)`, opacity: 1 - roll }">Building</span>
                <span class="absolute inset-0 text-neutral" :style="{ transform: `translateY(${(1 - roll) * 70}%)`, opacity: roll }">Running</span>
              </span>
              <!-- Counter: digits roll up once a second; scales out with the roll -->
              <span
                class="relative inline-flex h-5 overflow-hidden tabular-nums text-neutral-subtle"
                :style="{ opacity: 1 - roll, transform: `scale(${1 - 0.3 * roll})` }"
              >
                <span class="relative">
                  <span class="block" :style="{ transform: `translateY(${-counter.step * 100}%)` }">{{ counter.value }}</span>
                  <span class="absolute top-full left-0 block" :style="{ transform: `translateY(${-counter.step * 100}%)` }">{{ counter.next }}</span>
                </span>
                <span>s</span>
              </span>
            </span>
          </div>
          <div class="flex min-w-0 items-center gap-1 px-2 text-neutral-subtle" :style="{ opacity: reveal }">
            <svg class="size-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.66667 11.3333C9.66667 12.2538 10.4129 13 11.3333 13C12.2538 13 13 12.2538 13 11.3333C13 10.4129 12.2538 9.66667 11.3333 9.66667C10.4129 9.66667 9.66667 10.4129 9.66667 11.3333ZM9.66667 11.3333C8.34058 11.3333 7.06881 10.8065 6.13113 9.86887C5.19345 8.93119 4.66667 7.65942 4.66667 6.33333M4.66667 6.33333C5.58714 6.33333 6.33333 5.58714 6.33333 4.66667C6.33333 3.74619 5.58714 3 4.66667 3C3.74619 3 3 3.74619 3 4.66667C3 5.58714 3.74619 6.33333 4.66667 6.33333ZM4.66667 6.33333V13" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="round" /></svg>
            <span class="truncate">feat/login-redesign</span>
          </div>
          <div class="flex min-w-0 items-center gap-2 px-2" :style="{ opacity: reveal }">
            <span class="flex shrink-0 items-center gap-1 font-[Geist_Mono,monospace] text-neutral-subtle">
              <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 8C10 9.10457 9.10457 10 8 10C6.89543 10 6 9.10457 6 8M10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8M10 8H14M6 8H2" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="round" /></svg>
              7c167e3
            </span>
            <span class="min-w-0 flex-1 truncate">Polish auth layout: shared page stack, logo, and card chrome</span>
          </div>
          <div class="flex min-w-0 items-center gap-1.5 px-2" :style="{ opacity: reveal }">
            <span class="flex size-6 shrink-0 items-center justify-center rounded-full border border-neutral bg-tint text-[10px] text-neutral-strong">AM</span>
            <span class="truncate">aaronmahlke</span>
          </div>
          <div class="flex items-center whitespace-nowrap px-2 tabular-nums" :style="{ opacity: reveal }">now</div>
        </div>

        <!-- Other rows -->
        <div :style="{ opacity: reveal }">
          <div v-for="row in rows" :key="row.commit" :class="GRID" class="border-b border-neutral last:border-b-0">
            <div class="flex items-center overflow-hidden px-2">
              <span class="inline-flex items-center gap-1.5">
                <span class="relative flex size-5 shrink-0 items-center justify-center">
                  <span class="absolute size-3.5 rounded-full" :class="DOT_RING[row.status]" />
                  <span class="relative size-2 rounded-full" :class="DOT[row.status]" />
                </span>
                <span>{{ LABEL[row.status] }}</span>
                <span class="tabular-nums text-neutral-subtle">{{ row.duration }}</span>
              </span>
            </div>
            <div class="flex min-w-0 items-center gap-1 px-2 text-neutral-subtle">
              <svg class="size-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.66667 11.3333C9.66667 12.2538 10.4129 13 11.3333 13C12.2538 13 13 12.2538 13 11.3333C13 10.4129 12.2538 9.66667 11.3333 9.66667C10.4129 9.66667 9.66667 10.4129 9.66667 11.3333ZM9.66667 11.3333C8.34058 11.3333 7.06881 10.8065 6.13113 9.86887C5.19345 8.93119 4.66667 7.65942 4.66667 6.33333M4.66667 6.33333C5.58714 6.33333 6.33333 5.58714 6.33333 4.66667C6.33333 3.74619 5.58714 3 4.66667 3C3.74619 3 3 3.74619 3 4.66667C3 5.58714 3.74619 6.33333 4.66667 6.33333ZM4.66667 6.33333V13" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="round" /></svg>
              <span class="truncate">{{ row.branch }}</span>
            </div>
            <div class="flex min-w-0 items-center gap-2 px-2">
              <span class="flex shrink-0 items-center gap-1 font-[Geist_Mono,monospace] text-neutral-subtle">
                <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 8C10 9.10457 9.10457 10 8 10C6.89543 10 6 9.10457 6 8M10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8M10 8H14M6 8H2" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="round" /></svg>
                {{ row.commit }}
              </span>
              <span class="min-w-0 flex-1 truncate">{{ row.message }}</span>
            </div>
            <div class="flex min-w-0 items-center gap-1.5 px-2">
              <span class="flex size-6 shrink-0 items-center justify-center rounded-full border border-neutral bg-tint text-[10px] text-neutral-strong">AM</span>
              <span class="truncate">aaronmahlke</span>
            </div>
            <div class="flex items-center whitespace-nowrap px-2 tabular-nums">{{ row.time }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
