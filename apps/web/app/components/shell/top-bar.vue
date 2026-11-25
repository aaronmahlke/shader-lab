<script setup lang="ts">
/** Top bar: dashboard, project panel toggle, project name, comp tabs, preview, export. */
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
  <header class="flex h-11 shrink-0 items-center gap-1 border-b border-neutral-subtle bg-layer-1 px-2">
    <d-tooltip content="All projects" side="bottom">
      <d-button variant="ghost" size="sm" to="/" aria-label="All projects">
        <template #leading><d-icon-arrow-left /></template>
      </d-button>
    </d-tooltip>
    <d-tooltip v-if="projectId" :content="projectPanelOpen ? 'Hide project' : 'Show project'" side="bottom">
      <d-button
        variant="ghost"
        size="sm"
        aria-label="Toggle project panel"
        :data-state="projectPanelOpen ? 'open' : 'closed'"
        @click="emit('toggle-project-panel')"
      >
        <template #leading><d-icon-sidebar-left /></template>
      </d-button>
    </d-tooltip>
    <span class="max-w-48 truncate px-1.5 text-sm font-medium text-neutral-strong">
      {{ projectName ?? compName }}
    </span>
    <span class="mx-1 h-4 w-px bg-neutral-subtle" />

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

    <d-tooltip content="Preview (full screen)" side="bottom">
      <d-button variant="ghost" size="sm" aria-label="Preview" @click="emit('preview')">
        <template #leading><d-icon-play-progress /></template>
      </d-button>
    </d-tooltip>
    <d-button variant="solid" size="sm" @click="emit('export')">Export</d-button>
  </header>
</template>
