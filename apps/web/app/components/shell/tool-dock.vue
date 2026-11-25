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

</script>

<template>
  <!-- Studio: a band-colored strip of buttons; active tool in accent. -->
  <div class="flex items-center gap-[2px] bg-[var(--s-band)] p-[2px] shadow-[0_0_0_1px_var(--s-edge)]">
    <StudioButton square :active="tool === 'select'" aria-label="Select" title="Select (V)" @pointerdown.prevent @click="tool = 'select'">
      <StudioIcon name="cursor" />
    </StudioButton>
    <StudioButton square :active="tool === 'text'" aria-label="Text" title="Text (T)" @pointerdown.prevent @click="tool = 'text'">
      <StudioIcon name="text" />
    </StudioButton>
    <span class="mx-[2px] h-[12px] w-px bg-[var(--s-edge)]" />
    <EditorLayerAddBar ref="addBarRef" @select="emit('add-layer', $event)" />
  </div>
</template>
