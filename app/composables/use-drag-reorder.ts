type DragReorderOptions = {
  /** Transition duration in ms for non-dragged items sliding into place. Default: 200 */
  animation?: number;
};

/**
 * Composable for smooth drag-to-reorder on a vertical list.
 *
 * Usage:
 * ```ts
 * const { containerRef, draggingIndex } = useDragReorder(items)
 * ```
 *
 * Bind `containerRef` to a plain wrapper element.
 * Each direct child of that element becomes a draggable item.
 * Mark interactive controls with `data-drag-exclude`.
 */
export function useDragReorder<T>(
  list: Ref<T[]>,
  options: DragReorderOptions = {},
) {
  const { animation = 200 } = options;
  const containerRef = ref<HTMLElement | null>(null);
  const draggingIndex = ref<number | null>(null);

  function resolveEl(): HTMLElement | null {
    if (import.meta.server) return null;
    const v = containerRef.value;
    if (!v) return null;
    if (typeof HTMLElement !== "undefined" && v instanceof HTMLElement) return v;
    if ((v as { $el?: HTMLElement }).$el instanceof HTMLElement) {
      return (v as { $el: HTMLElement }).$el;
    }
    return null;
  }

  const easing = "cubic-bezier(0.19, 1, 0.22, 1)";

  let startY = 0;
  let dragFrom = -1;
  let currentTarget = -1;
  let rowRects: { top: number; height: number; midY: number }[] = [];
  let active = false;
  let didDrag = false;

  function getChildren(): HTMLElement[] {
    const el = resolveEl();
    if (!el) return [];
    return Array.from(el.children) as HTMLElement[];
  }

  function cacheRects() {
    const children = getChildren();
    rowRects = children.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, midY: r.top + r.height / 2 };
    });
  }

  function getTargetIndex(draggedCenterY: number): number {
    let target = dragFrom;

    for (let i = dragFrom + 1; i < rowRects.length; i++) {
      if (draggedCenterY > rowRects[i]!.top) target = i;
      else break;
    }

    if (target === dragFrom) {
      for (let i = dragFrom - 1; i >= 0; i--) {
        const bottomEdge = rowRects[i]!.top + rowRects[i]!.height;
        if (draggedCenterY < bottomEdge) target = i;
        else break;
      }
    }

    return target;
  }

  function applyTransforms(target: number) {
    const children = getChildren();
    const draggedHeight = rowRects[dragFrom]?.height ?? 0;

    for (let i = 0; i < children.length; i++) {
      if (i === dragFrom) continue;
      const el = children[i]!;

      let shift = 0;
      if (dragFrom < target) {
        if (i > dragFrom && i <= target) shift = -draggedHeight;
      } else if (dragFrom > target) {
        if (i >= target && i < dragFrom) shift = draggedHeight;
      }

      el.style.transition = `transform ${animation}ms ${easing}`;
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    }
  }

  function commitReorder(from: number, to: number) {
    if (from === to) return;
    const updated = [...list.value];
    const [moved] = updated.splice(from, 1);
    if (moved) {
      updated.splice(to, 0, moved);
      list.value = updated;
    }
  }

  function onDragStart(e: DragEvent) {
    e.preventDefault();
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;

    const container = resolveEl();
    if (!container) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-drag-exclude]")) return;

    const children = getChildren();
    let clickedChild: HTMLElement | null = null;
    let node: HTMLElement | null = target;
    while (node && node !== container) {
      if (children.includes(node)) {
        clickedChild = node;
        break;
      }
      node = node.parentElement;
    }
    if (!clickedChild) return;

    const index = children.indexOf(clickedChild);
    if (index === -1) return;

    startY = e.clientY;
    dragFrom = index;
    currentTarget = index;
    active = false;

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
  }

  function onPointerMove(e: PointerEvent) {
    const deltaY = e.clientY - startY;

    if (!active) {
      if (Math.abs(deltaY) < 4) return;
      active = true;
      didDrag = true;
      draggingIndex.value = dragFrom;
      cacheRects();
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }

    const children = getChildren();
    const draggedEl = children[dragFrom];
    if (draggedEl) {
      draggedEl.style.transform = `translateY(${deltaY}px)`;
      draggedEl.style.position = "relative";
      draggedEl.style.zIndex = "10";
      draggedEl.style.transition = "none";
    }

    const draggedCenterY = rowRects[dragFrom]!.midY + deltaY;
    const target = getTargetIndex(draggedCenterY);
    if (target !== currentTarget) {
      currentTarget = target;
      applyTransforms(target);
    }
  }

  function onPointerUp() {
    if (!active) {
      cleanup();
      return;
    }

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    const swapped = dragFrom !== currentTarget;

    const children = getChildren();
    const snapshot = new Map<HTMLElement, number>();
    for (const el of children) {
      snapshot.set(el, el.getBoundingClientRect().top);
    }

    for (const el of children) {
      el.style.transition = "none";
      el.style.transform = "";
      el.style.position = "";
      el.style.zIndex = "";
    }

    draggingIndex.value = null;

    if (!swapped) {
      const el = resolveEl();
      if (el) el.offsetHeight;
      for (const el of children) {
        el.style.transition = "";
      }
      cleanup();
      return;
    }

    commitReorder(dragFrom, currentTarget);

    nextTick(() => {
      const newChildren = getChildren();

      for (const el of newChildren) {
        const oldTop = snapshot.get(el);
        if (oldTop !== undefined) {
          const newTop = el.getBoundingClientRect().top;
          const dy = oldTop - newTop;
          if (Math.abs(dy) > 0.5) {
            el.style.transform = `translateY(${dy}px)`;
          }
        }
      }

      const el = resolveEl();
      if (el) el.offsetHeight;

      for (const el of newChildren) {
        if (el.style.transform) {
          el.style.transition = `transform ${animation}ms ${easing}`;
          el.style.transform = "";
        } else {
          el.style.transition = "";
        }
      }

      setTimeout(() => {
        for (const child of getChildren()) {
          child.style.transition = "";
          child.style.transform = "";
        }
        cleanup();
      }, animation + 20);
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      const children = getChildren();
      for (const el of children) {
        el.style.transition = "none";
        el.style.transform = "";
        el.style.position = "";
        el.style.zIndex = "";
      }
      const el = resolveEl();
      if (el) el.offsetHeight;
      for (const el of children) {
        el.style.transition = "";
      }
      cleanup();
    }
  }

  function onClickCapture(e: MouseEvent) {
    if (didDrag) {
      e.preventDefault();
      e.stopPropagation();
      didDrag = false;
    }
  }

  function cleanup() {
    active = false;
    draggingIndex.value = null;
    dragFrom = -1;
    currentTarget = -1;
    rowRects = [];
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
  }

  watch(containerRef, (el, _prev, onCleanup) => {
    if (import.meta.server) return;

    const node = el && typeof HTMLElement !== "undefined" && el instanceof HTMLElement
      ? el
      : (el as { $el?: HTMLElement } | null)?.$el;
    if (!node) return;

    node.addEventListener("pointerdown", onPointerDown, true);
    node.addEventListener("click", onClickCapture, true);
    node.addEventListener("dragstart", onDragStart);

    onCleanup(() => {
      node.removeEventListener("pointerdown", onPointerDown, true);
      node.removeEventListener("click", onClickCapture, true);
      node.removeEventListener("dragstart", onDragStart);
      cleanup();
    });
  }, { immediate: true });

  onUnmounted(cleanup);

  return { containerRef, draggingIndex };
}
