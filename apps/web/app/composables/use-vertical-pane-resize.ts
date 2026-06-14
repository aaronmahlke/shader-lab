type Options = {
  height: Ref<number>;
  min?: number;
  getMax?: () => number;
  onResizeEnd?: () => void;
};

export function useVerticalPaneResize({ height, min = 120, getMax, onResizeEnd }: Options) {
  function onPointerDown(e: PointerEvent) {
    e.preventDefault();

    const startY = e.clientY;
    const startHeight = height.value;

    function onMove(ev: PointerEvent) {
      const max = getMax?.() ?? 720;
      const next = startHeight + (startY - ev.clientY);
      height.value = Math.min(max, Math.max(min, next));
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onResizeEnd?.();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return { onPointerDown };
}
