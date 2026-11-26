<script setup lang="ts">
import { compUrl, type TrailStep } from "~/utils/comp-trail";
import { EditorKeyboardPriority, useEditorKeyboard } from "~/composables/use-editor-keyboard";

/**
 * Where you are when drilled into nested comps: root › … › current. Going up
 * keeps the playhead on the same moment (parent time = child time + in).
 * Right-click or middle-click a crumb opens that comp in its own tab.
 */
const props = defineProps<{
  trail: TrailStep[];
  compName: string;
  names: Record<string, string>;
  currentTime: number;
}>();

/** Go to trail level `i` (0 = root), mapping the playhead into its time. */
function goTo(i: number) {
  const step = props.trail[i];
  if (!step) return;
  const shift = props.trail.slice(i).reduce((sum, s) => sum + s.in, 0);
  navigateTo(compUrl(step.id, props.trail.slice(0, i), props.currentTime + shift));
}

function openInTab(id: string) {
  navigateTo(`/shader/${id}`);
}

const { register } = useEditorKeyboard();
register({
  id: "shell:breadcrumbs",
  priority: EditorKeyboardPriority.layer - 20,
  handle(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key !== "ArrowUp" || props.trail.length === 0) return false;
    goTo(props.trail.length - 1);
    return true;
  },
});
</script>

<template>
  <!-- Studio: band strip with a back button and crumbs; right-click / middle-click opens in a tab. -->
  <div
    v-if="trail.length"
    class="flex items-center gap-[2px] bg-[var(--s-band)] p-[2px] shadow-[0_0_0_1px_var(--s-edge)]"
    @pointerdown.stop
  >
    <StudioButton square aria-label="Up one level" title="Up one level (⌘↑)" @click="goTo(trail.length - 1)">
      <StudioIcon name="back" />
    </StudioButton>
    <template v-for="(step, i) in trail" :key="`${step.id}-${i}`">
      <UiContextMenu>
          <StudioButton variant="ghost" @click="goTo(i)" @pointerdown.middle.prevent="openInTab(step.id)">
            {{ names[step.id] ?? "Comp" }}
          </StudioButton>
        <template #menu>
          <UiContextMenuItem @click="goTo(i)">Go to</UiContextMenuItem>
          <UiContextMenuItem @click="openInTab(step.id)">Open in new tab</UiContextMenuItem>
        </template>
    </UiContextMenu>
      <StudioIcon name="forward" class="text-[var(--s-dim)]" />
    </template>
    <span class="px-[5px] text-[var(--s-bright)]">{{ compName }}</span>
  </div>
</template>
