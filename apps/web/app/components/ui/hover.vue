<script lang="ts" setup>
defineOptions({ inheritAttrs: false });

type Props = {
  className?: string[] | string;
  active?: boolean;
  clickable?: boolean;
  hoverable?: boolean;
  radius?: string;
  fullWidth?: boolean;
  focusable?: boolean;
};

const {
  className = "bg-tint",
  active = false,
  clickable = true,
  hoverable = true,
  radius = "rounded-lg",
  fullWidth = false,
  focusable = true,
} = defineProps<Props>();

const attrs = useAttrs();

const rootAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
</script>

<template>
  <div
    v-bind="rootAttrs"
    class="group/h relative flex items-center"
    :class="[fullWidth ? 'w-full' : 'w-fit', attrs.class]"
  >
    <div
      class="pointer-events-none absolute transition-all duration-100 ease-out-expo motion-reduce:transition-none"
      :class="[
        className,
        active ? 'inset-0 opacity-100' : 'inset-1 opacity-0',
        hoverable ? 'group-hover/h:inset-0 group-hover/h:opacity-100' : '',
        clickable ? 'group-active/h:inset-px' : '',
        focusable
          ? 'group-has-focus-visible/h:inset-0 group-has-focus-visible/h:opacity-100 group-has-focus-visible/h:ring-2 group-has-focus-visible/h:ring-focus group-has-focus-visible/h:ring-offset-2 group-has-focus-visible/h:ring-offset-layer-1'
          : '',
        radius,
      ]"
    />
    <div
      class="relative z-10 w-full min-w-0"
      :class="fullWidth ? '[&>*]:w-full' : 'flex items-center'"
    >
      <slot />
    </div>
  </div>
</template>
