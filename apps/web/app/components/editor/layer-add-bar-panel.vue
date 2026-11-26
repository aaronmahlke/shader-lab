<script setup lang="ts">
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
    <div class="flex shrink-0 flex-col gap-[6px] bg-[var(--s-band)] p-[6px]">
      <div class="flex h-[22px] items-center gap-[6px] bg-[var(--s-inset)] px-[6px] shadow-[inset_0_0_0_1px_var(--s-edge)] focus-within:shadow-[inset_0_0_0_1px_var(--s-ring)]">
        <StudioIcon name="search" class="text-[var(--s-dim)]" />
        <ComboboxInput
          v-model="query"
          placeholder="Search layers…"
          class="min-w-0 flex-1 bg-transparent text-[var(--s-txt)] outline-none placeholder:text-[var(--s-dim)]"
        />
      </div>
      <div class="flex flex-wrap gap-[2px]">
        <StudioButton
          v-for="section in SECTION_FILTERS"
          :key="section.key"
          :active="activeSection === section.key"
          @click="setSection(section.key)"
        >
          {{ section.label }}
        </StudioButton>
      </div>
    </div>

    <ComboboxViewport class="min-h-0 flex-1 overflow-y-auto p-[4px]">
      <div class="min-h-full">
        <template v-if="hasResults">
          <ComboboxGroup
            v-for="group in catalogGroups"
            :key="group.key"
            class="not-first:mt-[8px]"
          >
            <ComboboxLabel class="block px-[4px] pt-[4px] pb-[3px] text-[var(--s-dim)] select-none">
              {{ group.label }}
            </ComboboxLabel>

            <div class="flex flex-col">
              <ComboboxItem
                v-for="entry in group.items"
                :key="entry.type"
                :value="entry.type"
                :text-value="entry.searchText"
                class="group flex cursor-default items-center gap-[8px] p-[3px] text-[var(--s-txt)] outline-none select-none data-[highlighted]:bg-[var(--s-select)] data-[highlighted]:text-[var(--s-select-txt)]"
                @pointerenter="onItemHover(entry)"
                @pointerleave="onItemLeave"
              >
                <EditorLayerCatalogRow :entry="entry" />
              </ComboboxItem>
            </div>
          </ComboboxGroup>
        </template>

        <ComboboxEmpty class="flex min-h-full items-center justify-center py-10 text-center text-[var(--s-dim)]">
          No layers match your search.
        </ComboboxEmpty>
      </div>
    </ComboboxViewport>
  </div>
</template>
