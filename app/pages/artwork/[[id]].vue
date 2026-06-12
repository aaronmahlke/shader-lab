<script setup lang="ts">
import { DownloadIcon } from "lucide-vue-next";
import type {
  ArtworkDocument,
  ArtworkLayer,
  ArtworkShaderLayer,
  ShaderDocument,
} from "#shared/types/artwork";
import {
  buildArtworkPresetDocument,
  getArtworkPreset,
  DEFAULT_ARTWORK_PRESET_ID,
} from "#shared/editor/artwork-presets";
import { cloneShaderPreset } from "#shared/editor/shader-presets";
import { ArtworkTextEditKey, useArtworkTextEdit } from "~/composables/use-artwork-text-edit";

useHead({ title: "Artwork — Shader Lab" });

const route = useRoute();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const routeId = route.params.id as string | undefined;
const presetQuery = (route.query.preset as string | undefined) ?? DEFAULT_ARTWORK_PRESET_ID;
const shaderPresetQuery = route.query.shaderPreset as string | undefined;

const { document: initialBuilt } = buildArtworkPresetDocument(
  routeId ? DEFAULT_ARTWORK_PRESET_ID : presetQuery,
);

const artworkId = ref<string | null>(routeId ?? null);
const artworkName = ref(
  routeId ? "Untitled" : (getArtworkPreset(presetQuery)?.name ?? "Untitled"),
);
const artworkDoc = ref<ArtworkDocument>(initialBuilt);
const shaderCache = ref<Record<string, ShaderDocument & { name?: string }>>({});
const shaderNames = ref<Record<string, string>>({});
const bootstrapDone = ref(!!routeId);
const exportOpen = ref(false);

watch(exportOpen, (open) => {
  if (open) loadArtworkMedia();
});
const shaderPickerOpen = ref(false);
const shaderPickerMode = ref<"add" | "swap">("add");
const shaderSwapLayerId = ref<string | null>(null);

const selectedLayerId = ref<string | null>(
  artworkDoc.value.layers[0]?.id ?? null,
);

const selectedLayer = computed(() =>
  artworkDoc.value.layers.find((l) => l.id === selectedLayerId.value) ?? null,
);

const textEdit = useArtworkTextEdit(artworkDoc, selectedLayerId);
provide(ArtworkTextEditKey, textEdit);

async function loadShaderIntoCache(shaderId: string) {
  if (shaderCache.value[shaderId] || shaderId === "__pending__") return;
  try {
    const row = await $fetch(`/api/shaders/${shaderId}`) as {
      name: string;
      data: ShaderDocument;
    };
    shaderCache.value = { ...shaderCache.value, [shaderId]: row.data };
    shaderNames.value = { ...shaderNames.value, [shaderId]: row.name };
  } catch {
    // ignore
  }
}

async function bootstrapPendingShader() {
  if (bootstrapDone.value) return;

  const layer = artworkDoc.value.layers.find(
    (l): l is ArtworkShaderLayer => l.type === "shader" && l.shaderId === "__pending__",
  );
  const shaderPresetId = shaderPresetQuery ?? getArtworkPreset(presetQuery)?.shaderPresetId ?? "blank";

  if (layer && shaderPresetId !== "blank") {
    const created = await $fetch("/api/shaders", {
      method: "POST",
      body: {
        name: getArtworkPreset(presetQuery)?.name ?? "Background",
        data: cloneShaderPreset(shaderPresetId),
      },
    }) as { id: string; data: ShaderDocument };
    layer.shaderId = created.id;
    shaderCache.value = { ...shaderCache.value, [created.id]: created.data };
  }

  bootstrapDone.value = true;
}

if (routeId) {
  const { data } = await useFetch(`/api/artworks/${routeId}`);
  if (data.value) {
    const row = data.value as { id: string; name: string; data: ArtworkDocument };
    artworkId.value = row.id;
    artworkName.value = row.name;
    artworkDoc.value = row.data;
    bootstrapDone.value = true;
    for (const layer of row.data.layers) {
      if (layer.type === "shader") {
        await loadShaderIntoCache(layer.shaderId);
      }
    }
  }
}

onMounted(async () => {
  if (!routeId && !bootstrapDone.value) {
    await bootstrapPendingShader();
  }
});

const artworkData = computed(() => artworkDoc.value);

const {
  getDisplayCanvas,
  rendererControls,
  sampleLfosAtTime,
  layerCaches,
  imageCache,
  videoCache,
  loadArtworkMedia,
} = useArtworkPreview(canvasRef, artworkDoc, shaderCache, textEdit.editingLayerId);

const {
  getExportControls,
  canvasVideoDuration,
  ensureMediaLoaded,
} = useArtworkExport(
  artworkDoc,
  shaderCache,
  rendererControls,
  sampleLfosAtTime,
  { imageCache, videoCache },
);

const exportControls = computed(() =>
  getExportControls(artworkId.value ?? "artwork"),
);

const saveEnabled = computed(() => bootstrapDone.value);

useAutoSave(artworkId, artworkName, artworkData, {
  kind: "artwork",
  getCanvas: () => getDisplayCanvas(),
  enabled: saveEnabled,
});

watch(
  () => artworkDoc.value.layers,
  (layers) => {
    for (const layer of layers) {
      if (layer.type === "shader") {
        loadShaderIntoCache(layer.shaderId);
      }
    }
  },
  { deep: true, immediate: true },
);

function layerLabel(layer: ArtworkLayer): string {
  if (layer.type === "shader") {
    const name = shaderNames.value[layer.shaderId];
    return name ? `Shader · ${name}` : "Shader";
  }
  if (layer.type === "text") return "Text";
  if (layer.type === "video") return "Video";
  return "Image";
}

function addTextLayer() {
  const id = `text-${Date.now()}`;
  artworkDoc.value.layers.unshift({
    id,
    type: "text",
    enabled: true,
    content: "Your headline",
    runs: [{ text: "Your headline" }],
    fontFamily: "Inter",
    fontSize: 48,
    fontWeight: 400,
    fontStyle: "normal",
    lineHeight: 1.25,
    letterSpacing: 0,
    color: "#ffffff",
    x: 0.5,
    y: 0.55,
    align: "center",
    opacity: 1,
  });
  selectedLayerId.value = id;
}

function addImageLayer() {
  const id = `image-${Date.now()}`;
  artworkDoc.value.layers.unshift({
    id,
    type: "image",
    enabled: true,
    src: "",
    x: 0.5,
    y: 0.5,
    scale: 1,
    borderRadius: 0,
    opacity: 1,
  });
  selectedLayerId.value = id;
}

function addVideoLayer() {
  const id = `video-${Date.now()}`;
  artworkDoc.value.layers.unshift({
    id,
    type: "video",
    enabled: true,
    src: "",
    x: 0.5,
    y: 0.5,
    scale: 1,
    borderRadius: 0,
    opacity: 1,
    loop: true,
  });
  selectedLayerId.value = id;
}

function addShaderLayer(shaderId: string) {
  const id = `shader-${Date.now()}`;
  artworkDoc.value.layers.unshift({
    id,
    type: "shader",
    shaderId,
    enabled: true,
  });
  selectedLayerId.value = id;
  loadShaderIntoCache(shaderId);
}

function openShaderPickerAdd() {
  shaderPickerMode.value = "add";
  shaderSwapLayerId.value = null;
  shaderPickerOpen.value = true;
}

function openShaderPickerSwap(layer: ArtworkShaderLayer) {
  shaderPickerMode.value = "swap";
  shaderSwapLayerId.value = layer.id;
  shaderPickerOpen.value = true;
}

function onShaderPickerSelect(shaderId: string) {
  if (shaderPickerMode.value === "swap" && shaderSwapLayerId.value) {
    const layer = artworkDoc.value.layers.find((l) => l.id === shaderSwapLayerId.value);
    if (layer?.type === "shader") {
      layer.shaderId = shaderId;
      loadShaderIntoCache(shaderId);
    }
    return;
  }
  addShaderLayer(shaderId);
}

const shaderPickerCurrentId = computed(() => {
  if (shaderPickerMode.value !== "swap" || !shaderSwapLayerId.value) return undefined;
  const layer = artworkDoc.value.layers.find((l) => l.id === shaderSwapLayerId.value);
  return layer?.type === "shader" ? layer.shaderId : undefined;
});

function removeLayer(id: string) {
  const idx = artworkDoc.value.layers.findIndex((l) => l.id === id);
  if (idx === -1) return;
  artworkDoc.value.layers.splice(idx, 1);
  if (selectedLayerId.value === id) {
    selectedLayerId.value = artworkDoc.value.layers[0]?.id ?? null;
  }
}

function editShaderLayer(layer: ArtworkShaderLayer) {
  if (layer.shaderId === "__pending__") return;
  navigateTo({
    path: `/shader/${layer.shaderId}`,
    query: artworkId.value ? { fromArtwork: artworkId.value } : {},
  });
}

async function duplicateShaderLayer(layer: ArtworkShaderLayer) {
  if (layer.shaderId === "__pending__") return;
  const source = await $fetch(`/api/shaders/${layer.shaderId}`) as {
    name: string;
    data: ShaderDocument;
  };
  const created = await $fetch("/api/shaders", {
    method: "POST",
    body: { name: `${source.name} Copy`, data: source.data },
  }) as { id: string; data: ShaderDocument };
  layer.shaderId = created.id;
  shaderCache.value[created.id] = created.data;
  shaderNames.value[created.id] = `${source.name} Copy`;
}

function createNewShaderFromArtwork() {
  const query: Record<string, string> = {};
  if (artworkId.value) query.fromArtwork = artworkId.value;
  navigateTo({ path: "/shader", query });
}
</script>

<template>
  <EditorFrame>
    <template #header>
      <NuxtLink
        to="/"
        class="text-copy-sm text-tertiary transition-colors duration-150 hover:text-primary"
      >
        Shader Lab
      </NuxtLink>
      <div class="h-4 w-px bg-surface-1" />
      <UiEditableText v-model="artworkName" fill class="min-w-0 flex-1 text-copy-sm text-secondary" />
      <ArtworkCanvasSizeControl v-model:canvas="artworkDoc.canvas" />
      <UiButton variant="ghost" size="sm" :icon-left="DownloadIcon" @click="exportOpen = true">
        Export
      </UiButton>
    </template>

    <template #left>
      <ArtworkLayerStack
        v-model:layers="artworkDoc.layers"
        v-model:selected-layer-id="selectedLayerId"
        :layer-label="layerLabel"
        @add-text="addTextLayer"
        @add-image="addImageLayer"
        @add-video="addVideoLayer"
        @pick-shader="openShaderPickerAdd"
        @remove-layer="removeLayer"
      />
    </template>

    <ClientOnly>
      <div class="flex size-full min-h-0 items-center justify-center p-6">
        <ArtworkCanvasStage
          v-model:selected-layer-id="selectedLayerId"
          :artwork="artworkDoc"
          :layer-caches="layerCaches"
          class="max-h-full max-w-full"
          @delete-layer="removeLayer"
        >
          <canvas
            ref="canvasRef"
            class="block size-full rounded-lg border border-edge shadow-lg"
          />
        </ArtworkCanvasStage>
      </div>
    </ClientOnly>

    <template #right>
      <div
        v-if="selectedLayer"
        class="flex h-full min-h-0 flex-col"
      >
        <div class="shrink-0 border-b border-edge px-3 py-2.5">
          <span class="text-copy-sm text-primary">{{ layerLabel(selectedLayer) }}</span>
        </div>
        <div class="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          <ArtworkShaderLayerInspector
            v-if="selectedLayer.type === 'shader'"
            :layer="selectedLayer"
            :shader-name="shaderNames[selectedLayer.shaderId]"
            @swap-shader="openShaderPickerSwap(selectedLayer)"
            @edit-shader="editShaderLayer(selectedLayer)"
            @duplicate-shader="duplicateShaderLayer(selectedLayer)"
          />
          <ArtworkTextInspector
            v-else-if="selectedLayer.type === 'text'"
            :layer="selectedLayer"
          />
          <ArtworkImageInspector
            v-else-if="selectedLayer.type === 'image'"
            :layer="selectedLayer"
          />
          <ArtworkVideoInspector
            v-else-if="selectedLayer.type === 'video'"
            :layer="selectedLayer"
          />
        </div>
      </div>
      <div
        v-else
        class="flex flex-1 items-center justify-center p-6 text-center"
      >
        <p class="text-copy-sm text-tertiary">
          Select a layer to edit its properties.
        </p>
      </div>
    </template>
  </EditorFrame>

  <ArtworkShaderPickerDialog
    v-model:open="shaderPickerOpen"
    :mode="shaderPickerMode"
    :current-shader-id="shaderPickerCurrentId"
    @select="onShaderPickerSelect"
    @create-new="createNewShaderFromArtwork"
  />

  <ControlsExportDialog
    v-model:open="exportOpen"
    :experiment-id="artworkId ?? 'artwork'"
    :shader="exportControls"
    :design-canvas="artworkDoc.canvas"
    :canvas-video-duration="canvasVideoDuration"
    :before-export="ensureMediaLoaded"
  />
</template>
