<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle } from "reka-ui";
import { XMarkIcon } from "@heroicons/vue/16/solid";
import type { ShaderDocument } from "#shared/types/artwork";

type ShaderRow = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  data: ShaderDocument;
};

type PickerMode = "add" | "swap";

const props = withDefaults(
  defineProps<{
    mode?: PickerMode;
    currentShaderId?: string;
  }>(),
  { mode: "add" },
);

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
  select: [shaderId: string];
  createNew: [];
}>();

const shaders = ref<ShaderRow[]>([]);
const loading = ref(false);

const title = computed(() =>
  props.mode === "swap" ? "Swap shader" : "Add shader layer",
);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  loading.value = true;
  try {
    const rows = await $fetch<ShaderRow[]>("/api/shaders");
    shaders.value = rows.map((row) => ({
      id: row.id,
      name: row.name,
      thumbnailUrl: row.thumbnailUrl ?? null,
      data: row.data,
    }));
  } catch {
    shaders.value = [];
  } finally {
    loading.value = false;
  }
});

function pick(id: string) {
  emit("select", id);
  open.value = false;
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60" />
      <DialogContent
        class="fixed left-1/2 top-[8%] z-50 flex max-h-[84vh] w-[min(92vw,42rem)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-base-1 shadow-2xl"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
          <DialogTitle class="text-copy-sm text-primary">
            {{ title }}
          </DialogTitle>
          <UiButton variant="ghost" size="sm" :icon-left="XMarkIcon" @click="open = false" />
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <UiButton
            v-if="mode === 'add'"
            variant="action"
            class="shrink-0"
            @click="emit('createNew'); open = false"
          >
            Create new shader
          </UiButton>
          <p
            v-else
            class="shrink-0 text-copy-sm text-tertiary"
          >
            Choose a shader from your library. The artwork links to it; your previous shader stays unchanged.
          </p>

          <p
            v-if="loading"
            class="py-12 text-center text-copy-sm text-tertiary"
          >
            Loading library…
          </p>

          <div
            v-else-if="shaders.length"
            class="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            <ArtworkShaderGalleryTile
              v-for="item in shaders"
              :key="item.id"
              :id="item.id"
              :name="item.name"
              :thumbnail-url="item.thumbnailUrl"
              :data="item.data"
              :is-current="item.id === currentShaderId"
              @select="pick(item.id)"
            />
          </div>

          <p
            v-else
            class="py-12 text-center text-copy-sm text-tertiary"
          >
            No saved shaders yet. Create one from the shader editor first.
          </p>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
