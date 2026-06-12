<script setup lang="ts">
import {
  CameraIcon,
  CubeIcon,
  ArrowPathIcon,
  Cog6ToothIcon,
  ShareIcon,
  XMarkIcon,
} from "@heroicons/vue/16/solid";
import type { Experiment, GradientStop, UniformValue } from "#shared/types";

type ShaderControls = {
  capture: (width: number, height: number) => Promise<void>;
  pause: () => void;
  resume: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  configureRenderer: (width: number, height: number) => void;
  restoreRenderer: () => void;
  renderFrame: (time: number) => void;
};

type Props = {
  experiment: Experiment;
  shader: ShaderControls | null;
};

type Emits = {
  capture: [];
};

const { experiment, shader = null } = defineProps<Props>();
const emit = defineEmits<Emits>();

const values = defineModel<Record<string, UniformValue>>({ required: true });

const panelOpen = ref(false);
const copied = ref(false);
const exportOpen = ref(false);

function copyUrl() {
  navigator.clipboard.writeText(window.location.href);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

function resetToDefaults() {
  for (const group of experiment.groups) {
    for (const def of group.uniforms) {
      if (def.type === "gradient") {
        values.value[def.name] = (def.default as GradientStop[]).map((s) => ({ ...s }));
      } else {
        values.value[def.name] = def.default;
      }
    }
  }
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function randomInRange(min: number, max: number, step?: number): number {
  // Constrain to middle 60% of range to avoid extremes
  const padding = (max - min) * 0.2;
  const raw = (min + padding) + Math.random() * (max - min - padding * 2);
  if (step && step > 0) {
    return Math.round(raw / step) * step;
  }
  return raw;
}

function randomGradient(stops: GradientStop[]): GradientStop[] {
  const baseHue = Math.random() * 360;

  return stops.map((s, i) => {
    const isEdge = i === 0 || i === stops.length - 1;

    if (isEdge) {
      // Dark near-black with a hint of the base hue
      const hue = baseHue + (Math.random() - 0.5) * 30;
      const sat = 20 + Math.random() * 20;
      const lit = 2 + Math.random() * 6;
      return { color: hslToHex(hue, sat, lit), position: s.position };
    }

    // Middle stops: saturated, lighter, varied around base hue
    const hue = baseHue + (Math.random() - 0.5) * 120;
    const sat = 50 + Math.random() * 40;
    const lit = 30 + Math.random() * 40;
    return { color: hslToHex(hue, sat, lit), position: s.position };
  });
}

function randomizeGroup(group: Experiment["groups"][number]) {
  for (const def of group.uniforms) {
    switch (def.type) {
      case "float":
        values.value[def.name] = randomInRange(def.min!, def.max!, def.step);
        break;
      case "int":
        values.value[def.name] = Math.floor(randomInRange(def.min!, def.max!, 1));
        break;
      case "bool":
        values.value[def.name] = Math.random() > 0.5;
        break;
      case "color": {
        const hue = Math.random() * 360;
        const sat = 40 + Math.random() * 50;
        const lit = 30 + Math.random() * 40;
        values.value[def.name] = hslToHex(hue, sat, lit);
        break;
      }
      case "vec2":
        values.value[def.name] = [
          randomInRange(def.min!, def.max!, def.step),
          randomInRange(def.min!, def.max!, def.step),
        ];
        break;
      case "gradient": {
        const current = values.value[def.name] as GradientStop[];
        values.value[def.name] = randomGradient(current);
        break;
      }
    }
  }
}

function randomize() {
  for (const group of experiment.groups) {
    randomizeGroup(group);
  }
}
</script>

<template>
  <div class="fixed right-4 top-4 z-50 flex gap-2">
    <UiTooltip :label="copied ? 'Copied!' : 'Copy settings URL'" :force-open="copied">
      <UiButton variant="toolbar" @click="copyUrl">
        Share
      </UiButton>
    </UiTooltip>
    <UiTooltip label="Capture screenshot">
      <UiButton variant="toolbar" :icon-left="CameraIcon" @click="emit('capture')" />
    </UiTooltip>
    <UiTooltip label="Export">
      <UiButton variant="toolbar" :icon-left="ShareIcon" @click="exportOpen = true" />
    </UiTooltip>
    <ControlsExportDialog
      v-model:open="exportOpen"
      :experiment-id="experiment.id"
      :shader="shader"
    />
    <UiTooltip :label="panelOpen ? 'Close settings' : 'Settings'">
      <UiButton variant="toolbar" :icon-left="panelOpen ? XMarkIcon : Cog6ToothIcon" @click="panelOpen = !panelOpen" />
    </UiTooltip>
  </div>

  <Transition
    enter-active-class="transition-all duration-300 ease-out-expo"
    enter-from-class="translate-x-4 opacity-0"
    enter-to-class="translate-x-0 opacity-100"
    leave-active-class="transition-all duration-200 ease-out-expo"
    leave-from-class="translate-x-0 opacity-100"
    leave-to-class="translate-x-4 opacity-0"
  >
    <div
      v-if="panelOpen"
      class="fixed right-4 top-16 bottom-4 z-40 flex w-72 flex-col"
    >
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-edge bg-base-1/80 shadow-2xl backdrop-blur-xl">
        <div class="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2.5">
          <div class="flex flex-col">
            <span class="text-copy-sm text-primary">{{ experiment.name }}</span>
            <span class="text-copy-sm text-tertiary">{{ experiment.description }}</span>
          </div>
          <div class="flex items-center gap-0.5">
            <UiButton variant="ghost" size="sm" :icon-left="CubeIcon" title="Randomize" @click="randomize" />
            <UiButton variant="ghost" size="sm" :icon-left="ArrowPathIcon" title="Reset to defaults" @click="resetToDefaults" />
          </div>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div class="flex flex-col divide-y divide-edge">
            <ControlsControlGroup
              v-for="group in experiment.groups"
              :key="group.label"
              :label="group.label"
              @randomize="randomizeGroup(group)"
            >
              <ControlsUniformControl
                v-for="uniform in group.uniforms"
                :key="uniform.name"
                v-model="values[uniform.name]"
                :uniform="uniform"
              />
            </ControlsControlGroup>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
