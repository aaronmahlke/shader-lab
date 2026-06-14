<script setup lang="ts">
import { NuxtLink } from "#components";
import type { Component } from "vue";
import type { RouteLocationRaw } from "vue-router";

defineOptions({ inheritAttrs: false });

const slots = useSlots();

type AtlasVariant = "primary" | "outline" | "secondary" | "transparent" | "ghost";
type LegacyVariant = "toolbar" | "action" | "option" | "filled";
type Variant = AtlasVariant | LegacyVariant;
type Size = "sm" | "md" | "inline";

type Props = {
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  loading?: boolean;
  active?: boolean;
  to?: RouteLocationRaw;
  iconLeft?: Component;
  iconRight?: Component;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
};

const {
  type = "button",
  disabled = false,
  loading = false,
  active = false,
  to,
  iconLeft,
  iconRight,
  variant = "outline",
  size = "md",
  fullWidth = false,
} = defineProps<Props>();

const LEGACY_VARIANTS: Record<LegacyVariant, AtlasVariant> = {
  toolbar: "outline",
  action: "secondary",
  option: "secondary",
  filled: "secondary",
};

const resolvedVariant = computed((): AtlasVariant => {
  if (variant in LEGACY_VARIANTS) return LEGACY_VARIANTS[variant as LegacyVariant];
  return variant as AtlasVariant;
});

const isOption = computed(() => variant === "option");
const isToolbar = computed(() => variant === "toolbar");

const isDisabled = computed(() => disabled || loading);

const attrs = useAttrs();

const buttonAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});

const variantBaseClass: Record<AtlasVariant, string> = {
  primary: "bg-primary",
  outline: "bg-layer-1 border border-neutral",
  secondary: "bg-tint",
  transparent: "bg-tint",
  ghost: "bg-tint",
};

const variantInteractiveClass: Record<AtlasVariant, string> = {
  primary: "bg-primary group-hover/h:opacity-90 group-active/h:opacity-80",
  outline: "group-hover/h:bg-tint",
  secondary: "group-hover/h:opacity-80 group-active/h:opacity-70",
  transparent: "group-active/h:opacity-80 has-[[data-state=open]]:opacity-100",
  ghost: "group-active/h:opacity-80 has-[[data-state=open]]:opacity-100",
};

const variantTextBaseClass: Record<AtlasVariant, string> = {
  primary: "text-on-primary",
  secondary: "text-neutral-strong",
  outline: "text-neutral-strong",
  transparent: "text-neutral-strong group-hover/h:text-neutral-strong",
  ghost: "text-neutral-subtle",
};

const variantTextInteractiveClass: Record<AtlasVariant, string> = {
  primary: "",
  secondary: "",
  outline: "",
  transparent: "group-hover/h:text-neutral-strong",
  ghost: "group-hover/h:text-neutral-strong",
};

const heightClasses: Record<Exclude<Size, "inline">, string> = {
  sm: "h-7",
  md: "h-8",
};

const widthClasses: Record<Exclude<Size, "inline">, string> = {
  sm: "size-7",
  md: "size-8",
};

const sizeClass = computed(() => {
  if (size === "inline") {
    return "h-auto min-h-0 px-0.5 py-0.5 text-sm font-medium leading-4";
  }

  if (slots.default) {
    return `${heightClasses[size]} p-1.5`;
  }

  return widthClasses[size];
});

const hoverActive = computed(() => {
  if (loading) return true;
  if (isOption.value) return true;
  return resolvedVariant.value !== "ghost" && resolvedVariant.value !== "transparent";
});

const hoverClassName = computed(() => {
  if (isOption.value) {
    return [
      active ? "bg-tint-strong" : "bg-tint-subtle",
      isDisabled.value ? "" : "group-hover/h:opacity-80 group-active/h:opacity-70",
    ];
  }
  return [
    variantBaseClass[resolvedVariant.value],
    isDisabled.value ? "" : variantInteractiveClass[resolvedVariant.value],
  ];
});

const textClass = computed(() => {
  const classes = [
    variantTextBaseClass[resolvedVariant.value],
    !isDisabled.value ? variantTextInteractiveClass[resolvedVariant.value] : "",
  ];
  if (isOption.value && !active) {
    classes[0] = "text-neutral-subtle";
  }
  return classes;
});

const hoverShellClass = computed(() => [
  isDisabled.value ? "opacity-60" : "",
  isToolbar.value ? "shadow-lg backdrop-blur-xl" : "",
  attrs.class,
]);
</script>

<template>
  <UiHover
    :active="hoverActive"
    :class="hoverShellClass"
    :class-name="hoverClassName"
    :clickable="!isDisabled"
    :hoverable="!isDisabled"
    :full-width="fullWidth"
    :radius="size === 'inline' ? 'rounded-md' : undefined"
  >
    <component
      :is="to ? NuxtLink : 'button'"
      v-bind="buttonAttrs"
      :type="to ? undefined : type"
      :to="to"
      :disabled="to ? undefined : isDisabled"
      :aria-busy="loading || undefined"
      class="relative inline-flex items-center justify-center text-sm text-nowrap outline-none select-none transition-colors duration-100 ease-out-expo motion-reduce:transition-none"
      :class="[
        sizeClass,
        textClass,
        isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
        fullWidth && 'w-full',
        to && isDisabled && 'pointer-events-none opacity-50',
      ]"
    >
      <div
        class="flex items-center justify-center transition-opacity duration-100 ease-out-expo motion-reduce:transition-none"
        :class="[
          size === 'inline' ? 'gap-0' : 'gap-0.5',
          loading ? 'opacity-0' : 'relative z-10',
          disabled && !loading && 'opacity-50',
        ]"
      >
        <component
          v-if="iconLeft"
          :is="iconLeft"
          class="size-4 shrink-0"
          aria-hidden="true"
        />
        <span v-if="slots.default" class="px-0.5"><slot /></span>
        <component
          v-if="iconRight"
          :is="iconRight"
          class="size-4 shrink-0"
          aria-hidden="true"
        />
      </div>

      <div
        v-if="loading"
        class="absolute inset-0 z-20 grid place-items-center text-inherit"
        aria-hidden="true"
      >
        <UiGridLoader small />
      </div>
    </component>
  </UiHover>
</template>
