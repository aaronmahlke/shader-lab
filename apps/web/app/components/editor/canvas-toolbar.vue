<script setup lang="ts">
import type { CanvasTool } from "#shared/editor/canvas-tool";
import {
  EditorKeyboardPriority,
  useEditorKeyboard,
} from "~/composables/use-editor-keyboard";

const tool = defineModel<CanvasTool>("tool", { required: true });

const tools = [
  { id: "select", label: "Select", shortcut: "V", icon: "i-lucide-mouse-pointer-2" },
  { id: "text", label: "Text", shortcut: "T", icon: "i-lucide-type" },
] as const;

const { register } = useEditorKeyboard();

register({
  id: "canvas-toolbar:shortcuts",
  // Above the timeline's AE-style reveal shortcuts: T switches to the text
  // tool (Figma-style); opacity reveal stays reachable via the layer rows.
  priority: EditorKeyboardPriority.layer - 10,
  handle(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    const key = e.key.toLowerCase();
    if (key === "v") {
      tool.value = "select";
      return true;
    }
    if (key === "t") {
      tool.value = "text";
      return true;
    }
    if (key === "escape" && tool.value !== "select") {
      tool.value = "select";
      return true;
    }
    return false;
  },
});
</script>

<template>
  <div class="flex items-center gap-0.5 rounded-lg border border-neutral bg-layer-1/90 p-0.5 backdrop-blur">
    <button
      v-for="t in tools"
      :key="t.id"
      type="button"
      class="flex size-7 items-center justify-center rounded-md transition-colors"
      :class="tool === t.id
        ? 'bg-accent/25 text-neutral-strong ring-1 ring-accent/50'
        : 'text-neutral-subtle hover:bg-control hover:text-neutral-strong'"
      :title="`${t.label} (${t.shortcut})`"
      :aria-pressed="tool === t.id"
      @pointerdown.prevent
      @click="tool = t.id"
    >
      <UIcon :name="t.icon" class="size-4" />
    </button>
  </div>
</template>
