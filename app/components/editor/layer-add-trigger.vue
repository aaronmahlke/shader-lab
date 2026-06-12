<script setup lang="ts">
import { Primitive } from "reka-ui";
import type { Component } from "vue";

defineOptions({ inheritAttrs: false });

type Props = {
  label: string;
  icon: Component;
};

const { label, icon } = defineProps<Props>();
</script>

<template>
  <UiTooltip
    :label="label"
    side="bottom"
    disable-closing-trigger
  >
    <UiHover
      :active="true"
      class-name="bg-layer-1 border border-neutral group-hover/h:bg-tint"
    >
      <Primitive
        v-bind="$attrs"
        as="button"
        type="button"
        :aria-label="label"
        class="relative inline-flex size-7 cursor-pointer items-center justify-center rounded-lg text-neutral-strong shadow-lg backdrop-blur-xl outline-none transition-colors duration-100 ease-out-expo"
      >
        <component :is="icon" class="size-4 shrink-0" aria-hidden="true" />
      </Primitive>
    </UiHover>
  </UiTooltip>
</template>
