import { useDebounceFn } from "@vueuse/core";

type AutoSaveOptions = {
  getCanvas?: () => HTMLCanvasElement | null;
};

export function useAutoSave(
  documentId: Ref<string | null>,
  documentName: Ref<string>,
  data: Ref<unknown>,
  options: AutoSaveOptions = {},
) {
  const apiBase = "/api/shaders";
  const editorPath = "/shader";

  let hasCapturedThumbnail = false;

  async function save() {
    try {
      if (!documentId.value) {
        const result = await $fetch(apiBase, {
          method: "POST",
          body: { name: documentName.value, data: toRaw(data.value) },
        });
        documentId.value = (result as { id: string }).id;
        history.replaceState(null, "", `${editorPath}/${documentId.value}`);
      } else {
        await $fetch(`${apiBase}/${documentId.value}`, {
          method: "PATCH",
          body: { name: documentName.value, data: toRaw(data.value) },
        });
      }

      if (!hasCapturedThumbnail && options.getCanvas) {
        hasCapturedThumbnail = true;
        setTimeout(() => captureThumbnail(), 500);
      }
    } catch (e) {
      console.error("Auto-save failed:", e);
    }
  }

  async function captureThumbnail() {
    if (!documentId.value || !options.getCanvas) return;
    const canvas = options.getCanvas();
    if (!canvas) return;

    try {
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = 400;
      thumbCanvas.height = 300;
      const ctx = thumbCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(canvas, 0, 0, 400, 300);

      const blob = await new Promise<Blob | null>((resolve) => {
        thumbCanvas.toBlob(resolve, "image/png");
      });
      if (!blob) return;

      const formData = new FormData();
      formData.append("file", blob, "thumbnail.png");

      await $fetch(`${apiBase}/${documentId.value}/thumbnail`, {
        method: "POST",
        body: formData,
      });
    } catch {
      // Best-effort
    }
  }

  const debouncedSave = useDebounceFn(save, 300);

  onMounted(() => {
    if (!documentId.value) {
      save();
    }
  });

  watch(data, () => debouncedSave(), { deep: true });
  watch(documentName, () => debouncedSave());

  return { save };
}
