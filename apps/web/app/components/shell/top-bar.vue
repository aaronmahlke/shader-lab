<script setup lang="ts">
/**
 * Top bar (Studio): grey tile controls directly on the dark frame, like Live's
 * control bar. Dashboard, project panel toggle, project name, comp tabs,
 * preview, export.
 */
defineProps<{
  projectId: string | null;
  projectName?: string;
  compId: string | null;
  compName: string;
  rootCompId: string | null;
  projectPanelOpen: boolean;
}>();

const emit = defineEmits<{
  "toggle-project-panel": [];
  preview: [];
  export: [];
}>();

const tabsRef = ref<{ refresh: () => Promise<void> } | null>(null);
defineExpose({ refresh: () => tabsRef.value?.refresh() });
</script>

<template>
  <header class="flex h-[18px] shrink-0 items-center gap-[2px]">
    <span class="flex h-[18px] w-[24px] items-center justify-center bg-[var(--s-tile)]" aria-hidden="true">
      <span class="flex h-[10px] w-[12px] gap-[2px]"><i class="flex-1 bg-[var(--s-accent)]" /><i class="flex-1 bg-[var(--s-accent)]" /></span>
    </span>
    <StudioButton variant="tile" square class="!h-[18px] !w-[18px]" aria-label="All projects" title="All projects" @click="navigateTo('/')">
      <StudioIcon name="back" />
    </StudioButton>
    <StudioButton
      v-if="projectId"
      variant="tile"
      square
      class="!h-[18px] !w-[18px]"
      :active="projectPanelOpen"
      :aria-label="projectPanelOpen ? 'Hide project' : 'Show project'"
      :title="projectPanelOpen ? 'Hide project' : 'Show project'"
      @click="emit('toggle-project-panel')"
    >
      <StudioIcon name="folder" />
    </StudioButton>
    <span class="flex h-[18px] max-w-[200px] items-center truncate bg-[var(--s-tile)] px-[7px] text-[var(--s-bright)]">
      {{ projectName ?? compName }}
    </span>

    <span class="w-[10px] shrink-0" />

    <ShellCompTabs
      v-if="projectId"
      ref="tabsRef"
      class="min-w-0 flex-1"
      :project-id="projectId"
      :active-comp-id="compId"
      :active-comp-name="compName"
      :root-comp-id="rootCompId"
    />
    <div v-else class="flex-1" />

    <span class="w-[10px] shrink-0" />

    <StudioButton variant="tile" class="!h-[18px]" title="Preview (full screen)" @click="emit('preview')">
      <StudioIcon name="play" /> Preview
    </StudioButton>
    <StudioButton variant="tile" active class="!h-[18px]" @click="emit('export')">
      <StudioIcon name="export" /> Export
    </StudioButton>
  </header>
</template>
