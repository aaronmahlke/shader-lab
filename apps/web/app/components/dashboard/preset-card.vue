<script setup lang="ts">
import type { CompositionPreset } from "#shared/editor/composition-presets";
import { cloneCompositionPreset } from "#shared/editor/composition-presets";

const props = defineProps<{
  preset: CompositionPreset;
  active?: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const doc = cloneCompositionPreset(props.preset.id);
</script>

<template>
  <button
    type="button"
    class="group flex cursor-default flex-col gap-2.5 rounded-2xl p-1 text-left transition-colors duration-150 hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
    @click="emit('select')"
  >
    <div
      class="relative aspect-video w-full overflow-hidden rounded-xl border border-edge bg-base-0 transition-colors duration-150 group-hover:border-white/[0.08]"
    >
      <ClientOnly>
        <DashboardCompositionPreview
          :layers="doc.layers"
          :lfos="doc.lfos"
          :assignments="doc.assignments"
          :active="active"
        />
        <template #fallback>
          <div class="flex size-full items-center justify-center">
            <span class="text-copy-sm text-tertiary">Loading…</span>
          </div>
        </template>
      </ClientOnly>
    </div>

    <div class="flex min-w-0 flex-col gap-0.5 px-1 pb-1">
      <span class="text-copy-sm text-primary">{{ preset.name }}</span>
      <span class="line-clamp-2 text-copy-sm text-tertiary">{{ preset.description }}</span>
    </div>
  </button>
</template>
