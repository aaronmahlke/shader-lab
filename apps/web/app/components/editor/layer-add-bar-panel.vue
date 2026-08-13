<script setup lang="ts">
import { MagnifyingGlassIcon } from "@heroicons/vue/16/solid";
import {
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxViewport,
  injectComboboxRootContext,
  useFilter,
} from "reka-ui";
import type { LayerType } from "@shader-lab/core";
import {
  LAYER_CATALOG,
  LAYER_CATALOG_SECTIONS,
  groupCatalogEntries,
  type LayerCatalogEntry,
  type LayerCatalogSectionFilter,
} from "#shared/editor/layer-catalog";

const SECTION_FILTERS: { key: LayerCatalogSectionFilter; label: string }[] = [
  { key: "all", label: "All" },
  ...LAYER_CATALOG_SECTIONS,
];

const activeSection = ref<LayerCatalogSectionFilter>("all");
const hoveredType = ref<LayerType | null>(null);
const query = ref("");

const { contains } = useFilter({ sensitivity: "base" });
const combobox = injectComboboxRootContext();

function resetPanel() {
  activeSection.value = "all";
  hoveredType.value = null;
  query.value = "";
  combobox.filterSearch.value = "";
}

watch(
  () => combobox.open.value,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    resetPanel();
    // Programmatic opens (e.g. ⌘K) bypass reka's trigger focus handling.
    combobox.inputElement.value?.focus();
  },
);

const filteredEntries = computed(() => {
  const search = query.value.trim();

  return LAYER_CATALOG.filter((entry) => {
    if (activeSection.value !== "all" && entry.section !== activeSection.value) {
      return false;
    }

    if (!search) return true;

    return (
      contains(entry.label, search)
      || contains(entry.description, search)
      || entry.tags.some((tag) => contains(tag, search))
      || contains(entry.searchText, search)
    );
  });
});

const catalogGroups = computed(() =>
  groupCatalogEntries(filteredEntries.value, {
    section: activeSection.value,
    query: query.value,
  }),
);

const hasResults = computed(() => filteredEntries.value.length > 0);

function setSection(section: LayerCatalogSectionFilter) {
  activeSection.value = section;
}

function onItemHover(entry: LayerCatalogEntry) {
  hoveredType.value = entry.type;
}

function onItemLeave() {
  hoveredType.value = null;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 flex-col gap-3 border-b border-neutral p-3">
      <div class="relative">
        <MagnifyingGlassIcon
          class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-tertiary"
          aria-hidden="true"
        />
        <ComboboxInput
          v-model="query"
          placeholder="Search layers…"
          class="h-8 w-full rounded-lg border border-edge bg-base-1 pr-3 pl-8 text-copy-sm text-primary outline-none transition-colors duration-150 placeholder:text-tertiary focus:border-edge-strong"
        />
      </div>

      <div class="flex flex-wrap gap-1.5">
        <UiButton
          v-for="section in SECTION_FILTERS"
          :key="section.key"
          variant="option"
          size="sm"
          :active="activeSection === section.key"
          @click="setSection(section.key)"
        >
          {{ section.label }}
        </UiButton>
      </div>
    </div>

    <ComboboxViewport class="min-h-0 flex-1 overflow-y-auto p-3">
      <div class="min-h-full">
        <template v-if="hasResults">
          <ComboboxGroup
            v-for="group in catalogGroups"
            :key="group.key"
            class="not-first:mt-5"
          >
            <ComboboxLabel class="mb-2 block px-0.5 text-copy-sm text-tertiary uppercase select-none">
              {{ group.label }}
            </ComboboxLabel>

            <div class="flex flex-col gap-0.5">
              <ComboboxItem
                v-for="entry in group.items"
                :key="entry.type"
                :value="entry.type"
                :text-value="entry.searchText"
                class="group flex cursor-pointer items-center gap-3 rounded-lg p-1.5 outline-none transition-colors duration-150 select-none data-[highlighted]:bg-surface-1"
                @pointerenter="onItemHover(entry)"
                @pointerleave="onItemLeave"
              >
                <EditorLayerCatalogRow :entry="entry" />
              </ComboboxItem>
            </div>
          </ComboboxGroup>
        </template>

        <ComboboxEmpty class="flex min-h-full items-center justify-center py-10 text-center text-copy-sm text-tertiary">
          No layers match your search.
        </ComboboxEmpty>
      </div>
    </ComboboxViewport>
  </div>
</template>
