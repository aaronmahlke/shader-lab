<script lang="ts" setup>
defineOptions({ inheritAttrs: false });

type BlockRole = "none" | "single" | "top" | "middle" | "bottom";

type Props = {
  className?: string[] | string;
  /** Solid surface at rest (full inset, opaque). Use bg-layer-1 / bg-control, not tints. */
  solid?: boolean;
  /** Background when `active` (defaults to className). */
  activeClassName?: string[] | string;
  active?: boolean;
  clickable?: boolean;
  hoverable?: boolean;
  /** Connected-list rounding — classes live here so Tailwind can scan them. */
  blockRole?: BlockRole;
  radius?: string;
  fullWidth?: boolean;
  focusable?: boolean;
  /** Keyboard focus ring (often clips inside overflow panels). */
  focusRing?: boolean;
};

const {
  className = "bg-tint",
  solid = false,
  activeClassName,
  active = false,
  clickable = true,
  hoverable = true,
  blockRole = "none",
  radius = "rounded-lg",
  fullWidth = false,
  focusable = true,
  focusRing = false,
} = defineProps<Props>();

const surfaceClass = computed(() => {
  if (active && activeClassName !== undefined) return activeClassName;
  return className;
});

const surfaceRadius = computed(() => {
  switch (blockRole) {
    case "top":
      return "rounded-t-lg rounded-b-none";
    case "middle":
      return "rounded-none";
    case "bottom":
      return "rounded-b-lg rounded-t-none";
    case "single":
      return "rounded-lg";
    default:
      return radius;
  }
});

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
    :data-active="active ? 'true' : undefined"
  >
    <div
      class="pointer-events-none absolute transition-all duration-100 ease-out-expo motion-reduce:transition-none"
      :class="[
        surfaceClass,
        solid
          ? 'inset-0 opacity-100'
          : active
            ? 'inset-0 opacity-100'
            : 'inset-1 opacity-0',
        !solid && hoverable ? 'group-hover/h:inset-0 group-hover/h:opacity-100' : '',
        clickable ? 'group-active/h:inset-px' : '',
        focusable
          ? [
              'group-has-focus-visible/h:inset-0 group-has-focus-visible/h:opacity-100',
              focusRing &&
                'group-has-focus-visible/h:ring-2 group-has-focus-visible/h:ring-focus group-has-focus-visible/h:ring-offset-2 group-has-focus-visible/h:ring-offset-layer-1',
            ]
          : '',
        surfaceRadius,
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
