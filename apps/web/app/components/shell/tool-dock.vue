<script setup lang="ts">
import type { LayerType } from "@shader-lab/core";
import type { CanvasTool } from "#shared/editor/canvas-tool";
import { EditorKeyboardPriority, useEditorKeyboard } from "~/composables/use-editor-keyboard";

/** Floating tool dock at the bottom of the canvas: tools + add layer. */
const tool = defineModel<CanvasTool>("tool", { required: true });
const emit = defineEmits<{ "add-layer": [type: LayerType] }>();

const addBarRef = ref<{ openPanel: () => void } | null>(null);
defineExpose({ openAddLayer: () => addBarRef.value?.openPanel() });

const { register } = useEditorKeyboard();
register({
  id: "shell:tool-dock",
  // Above the timeline's AE-style reveal shortcuts: T is the text tool (Figma-style).
  priority: EditorKeyboardPriority.layer - 10,
  handle(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    const key = e.key.toLowerCase();
    if (key === "v") return (tool.value = "select"), true;
    if (key === "t") return (tool.value = "text"), true;
    if (key === "escape" && tool.value !== "select") return (tool.value = "select"), true;
    return false;
  },
});

const btn = "flex size-8 items-center justify-center rounded-lg transition-colors [&>svg]:size-4";
</script>

<template>
  <div class="material-lg flex items-center gap-0.5 rounded-xl p-1">
    <d-tooltip content="Select (V)">
      <button
        type="button"
        aria-label="Select"
        :aria-pressed="tool === 'select'"
        :class="[btn, tool === 'select' ? 'bg-accent text-on-accent' : 'text-neutral-subtle hover:bg-tint hover:text-neutral-strong']"
        @pointerdown.prevent
        @click="tool = 'select'"
      >
        <d-icon-cursor-default />
      </button>
    </d-tooltip>
    <d-tooltip content="Text (T)">
      <button
        type="button"
        aria-label="Text"
        :aria-pressed="tool === 'text'"
        :class="[btn, tool === 'text' ? 'bg-accent text-on-accent' : 'text-neutral-subtle hover:bg-tint hover:text-neutral-strong']"
        @pointerdown.prevent
        @click="tool = 'text'"
      >
        <d-icon-text />
      </button>
    </d-tooltip>
    <span class="mx-0.5 h-5 w-px bg-neutral-subtle" />
    <EditorLayerAddBar ref="addBarRef" @select="emit('add-layer', $event)" />
  </div>
</template>
