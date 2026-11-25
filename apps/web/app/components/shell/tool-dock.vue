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
  <!-- Tools in the top bar (Live keeps tools in its control bar): tile buttons on the frame. -->
  <div class="flex items-center gap-[2px]">
    <StudioButton variant="tile" square class="!h-[18px] !w-[18px]" :active="tool === 'select'" aria-label="Select" title="Select (V)" @pointerdown.prevent @click="tool = 'select'">
      <StudioIcon name="cursor" />
    </StudioButton>
    <StudioButton variant="tile" square class="!h-[18px] !w-[18px]" :active="tool === 'text'" aria-label="Text" title="Text (T)" @pointerdown.prevent @click="tool = 'text'">
      <StudioIcon name="text" />
    </StudioButton>
    <EditorLayerAddBar ref="addBarRef" variant="tile" @select="emit('add-layer', $event)" />
  </div>
</template>
