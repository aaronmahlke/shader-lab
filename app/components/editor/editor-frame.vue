<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-layer-0 p-1">
    <div class="flex min-h-0 flex-1 gap-1">
      <aside
        v-if="$slots.left"
        class="flex w-editor-panel shrink-0 flex-col overflow-hidden rounded-lg bg-layer-1"
      >
        <slot name="left" />
      </aside>

      <main class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg">
        <slot />
      </main>

      <aside
        v-if="$slots.right"
        class="flex w-editor-panel shrink-0 flex-col overflow-hidden rounded-lg bg-layer-1"
      >
        <slot name="right" />
      </aside>
    </div>
  </div>
</template>
