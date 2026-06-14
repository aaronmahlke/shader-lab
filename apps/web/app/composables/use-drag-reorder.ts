type DragReorderOptions = {
  /** Transition duration in ms for non-dragged items sliding into place. Default: 200 */
  animation?: number;
  /** Sorted indices in the active selection. Empty means drag only the clicked row. */
  getSelectedIndices?: () => number[];
  /** Called on pointer down before drag starts (e.g. ensure row is selected). */
  onDragStartIndex?: (index: number, e: PointerEvent) => void;
  /** Show live measurement overlay while dragging. Defaults to localStorage flag. */
  debug?: MaybeRef<boolean>;
};

export const LAYER_DRAG_DEBUG_KEY = "shader-lab:debug-layer-drag";

export function isLayerDragDebugEnabled(): boolean {
  return import.meta.client && localStorage.getItem(LAYER_DRAG_DEBUG_KEY) === "1";
}

export function setLayerDragDebug(enabled: boolean) {
  if (!import.meta.client) return;
  if (enabled) localStorage.setItem(LAYER_DRAG_DEBUG_KEY, "1");
  else localStorage.removeItem(LAYER_DRAG_DEBUG_KEY);
}

type RowRect = {
  top: number;
  height: number;
  headerTop: number;
  headerBottom: number;
  headerMidY: number;
  listBottom: number;
};

function arraysEqual<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function commitMultiReorder<T>(list: T[], indices: number[], targetIndex: number): T[] | null {
  const sorted = [...indices].sort((a, b) => a - b);
  const selectedSet = new Set(sorted);
  const selected = sorted.map((i) => list[i]!);
  const remaining = list.filter((_, i) => !selectedSet.has(i));
  const removedBefore = sorted.filter((i) => i < targetIndex).length;
  let insertAt = targetIndex - removedBefore;
  insertAt = Math.max(0, Math.min(remaining.length, insertAt));
  remaining.splice(insertAt, 0, ...selected);
  if (arraysEqual(remaining, list)) return null;
  return remaining;
}

/**
 * Composable for smooth drag-to-reorder on a vertical list.
 * Supports multi-select drag when `getSelectedIndices` is provided.
 */
export function useDragReorder<T>(
  list: Ref<T[]>,
  options: DragReorderOptions = {},
) {
  const { animation = 200, getSelectedIndices, onDragStartIndex, debug } = options;
  const containerRef = ref<HTMLElement | null>(null);
  const draggingIndices = ref<Set<number>>(new Set());
  const debugEnabled = () =>
    debug !== undefined ? unref(debug) : isLayerDragDebugEnabled();

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
  let dragIndices: number[] = [];
  let dragIndexSet = new Set<number>();
  let currentTarget = -1;
  let rowRects: RowRect[] = [];
  let collapseOffsets = new Map<number, number>();
  let groupingAnimating = false;
  let preGroupList: T[] | null = null;
  /** Row center Y synced to the current preview layout. */
  let rowCenters: number[] = [];
  let previewDeltaY = 0;
  let active = false;
  let didDrag = false;
  let debugRoot: HTMLElement | null = null;

  function readRowRect(el: HTMLElement): RowRect {
    const r = el.getBoundingClientRect();
    const handle = el.querySelector("[data-drag-handle]");
    const hr = handle?.getBoundingClientRect();
    const headerTop = hr?.top ?? r.top;
    const headerBottom = hr?.bottom ?? r.top + Math.min(r.height, 28);
    return {
      top: r.top,
      height: r.height,
      headerTop,
      headerBottom,
      headerMidY: (headerTop + headerBottom) / 2,
      listBottom: r.top + r.height,
    };
  }

  function getChildren(): HTMLElement[] {
    const el = resolveEl();
    if (!el) return [];
    return Array.from(el.children) as HTMLElement[];
  }

  function cacheRects() {
    rowRects = getChildren().map((el) => readRowRect(el));
  }

  function sortedSelection(): number[] {
    return [...dragIndices].sort((a, b) => a - b);
  }

  function isContiguousSelection(): boolean {
    const sorted = sortedSelection();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! !== sorted[i - 1]! + 1) return false;
    }
    return true;
  }

  /** Collapse non-adjacent selection into a contiguous block with FLIP animation. */
  function animateSelectionGrouping(pointerY: number, onDone: () => void) {
    const sorted = sortedSelection();
    const grabPos = sorted.indexOf(dragFrom);
    const blockStart = dragFrom - grabPos;
    const children = getChildren();
    const snapshot = new Map<HTMLElement, number>();
    for (const el of children) {
      snapshot.set(el, el.getBoundingClientRect().top);
    }

    const next = commitMultiReorder(list.value, dragIndices, dragFrom);
    if (!next) {
      onDone();
      return;
    }

    preGroupList = [...list.value];
    list.value = next;
    dragIndices = sorted.map((_, i) => blockStart + i);
    dragIndexSet = new Set(dragIndices);
    draggingIndices.value = new Set(dragIndices);
    currentTarget = blockStart;
    groupingAnimating = true;

    nextTick(() => {
      const newChildren = getChildren();
      let animated = 0;

      for (const el of newChildren) {
        const oldTop = snapshot.get(el);
        if (oldTop === undefined) continue;
        const dy = oldTop - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 0.5) {
          el.style.transition = "none";
          el.style.transform = `translateY(${dy}px)`;
          animated++;
        }
      }

      const container = resolveEl();
      if (container) container.offsetHeight;

      for (const el of newChildren) {
        if (!el.style.transform) continue;
        el.style.transition = `transform ${animation}ms ${easing}`;
        el.style.transform = "";
      }

      const finish = () => {
        for (const child of getChildren()) {
          child.style.transition = "";
          child.style.transform = "";
        }
        groupingAnimating = false;
        preGroupList = null;
        startY = pointerY;
        previewDeltaY = 0;
        onDone();
      };

      if (animated === 0) {
        finish();
        return;
      }

      setTimeout(finish, animation + 20);
    });
  }

  /** Close gaps between selected rows (computed once at drag start, no pointer delta). */
  function computeCollapseOffsets(): Map<number, number> {
    const offsets = new Map<number, number>();
    const sorted = sortedSelection();
    if (sorted.length <= 1) return offsets;

    const grabPos = sorted.indexOf(dragFrom);
    let stackTop = rowRects[dragFrom]!.top;
    for (let j = grabPos - 1; j >= 0; j--) {
      stackTop -= rowRects[sorted[j]!]!.height;
    }

    let y = stackTop;
    for (const i of sorted) {
      offsets.set(i, y - rowRects[i]!.top);
      y += rowRects[i]!.height;
    }
    return offsets;
  }

  /** Bounding box of dragged block from drag-start geometry + pointer delta. */
  function measureDragBlockBoundsComputed(): { top: number; bottom: number; center: number } {
    let top = Infinity;
    let bottom = -Infinity;
    for (const i of dragIndices) {
      const r = rowRects[i];
      if (!r) continue;
      const shift = previewDeltaY + (collapseOffsets.get(i) ?? 0);
      top = Math.min(top, r.top + shift);
      bottom = Math.max(bottom, r.top + r.height + shift);
    }
    if (!Number.isFinite(top)) return { top: 0, bottom: 0, center: 0 };
    return { top, bottom, center: (top + bottom) / 2 };
  }

  /** Crossing anchor — always the grabbed row header (single layer or stack). */
  function measureCrossingCenter(): number {
    const r = rowRects[dragFrom];
    if (r) {
      return r.headerMidY + previewDeltaY + (collapseOffsets.get(dragFrom) ?? 0);
    }
    return measureDragBlockBoundsComputed().center;
  }

  function compactHeight(): number {
    return dragIndices.reduce((sum, i) => sum + (rowRects[i]?.height ?? 0), 0);
  }

  function rowPreviewShift(i: number, slot: number): number {
    if (dragIndexSet.has(i)) {
      return previewDeltaY + (collapseOffsets.get(i) ?? 0);
    }

    const sorted = sortedSelection();
    const lo = sorted[0] ?? dragFrom;
    const hi = sorted[sorted.length - 1] ?? dragFrom;
    const height = compactHeight();
    const single = sorted.length === 1;

    if (single) {
      const from = dragFrom;
      const to = slot;
      if (to > from && i > from && i <= to) return -height;
      if (to < from && i >= to && i < from) return height;
      return 0;
    }
    if (slot > hi && i > hi && i < slot) return -height;
    if (slot < lo && i >= slot && i < lo) return height;
    return 0;
  }

  function rowCrossingCenterY(i: number, slot: number): number {
    const r = rowRects[i];
    if (!r) return 0;
    return r.headerMidY + rowPreviewShift(i, slot);
  }

  function syncRowCenters(slot: number) {
    const n = rowRects.length;
    if (n === 0) {
      rowCenters = [];
      return;
    }

    rowCenters = rowRects.map((_, i) => rowCrossingCenterY(i, slot));
  }

  /**
   * Target slot from geometry — count how many row centers the crossing point
   * has passed. Uses rowCenters already synced to the current preview layout.
   */
  function computeTargetSlot(): number {
    const n = rowRects.length;
    if (n === 0) return 0;

    const center = measureCrossingCenter();

    if (dragIndices.length === 1) {
      let target = 0;
      for (let i = 0; i < n; i++) {
        if (i === dragFrom) continue;
        if (center > rowCenters[i]!) target++;
      }
      return target;
    }

    const sorted = sortedSelection();
    const lo = sorted[0]!;
    const hi = sorted[sorted.length - 1]!;

    let target = lo;
    for (let i = 0; i < n; i++) {
      if (dragIndexSet.has(i)) continue;
      if (i < lo && center < rowCenters[i]!) target = Math.min(target, i);
      if (i > hi && center > rowCenters[i]!) target = Math.max(target, i + 1);
    }
    return target;
  }

  function laneRect(): { left: number; width: number } {
    const container = resolveEl();
    const r = container?.getBoundingClientRect();
    return { left: r?.left ?? 0, width: r?.width ?? 240 };
  }

  function lineStyle(
    top: number,
    left: number,
    width: number,
    color: string,
    dashed = false,
  ): string {
    return [
      "position:fixed",
      `top:${top}px`,
      `left:${left}px`,
      `width:${width}px`,
      "height:0",
      `border-top:2px ${dashed ? "dashed" : "solid"} ${color}`,
      "pointer-events:none",
      "z-index:9999",
    ].join(";");
  }

  function boxStyle(top: number, left: number, width: number, height: number, color: string): string {
    return [
      "position:fixed",
      `top:${top}px`,
      `left:${left}px`,
      `width:${width}px`,
      `height:${height}px`,
      `border:2px solid ${color}`,
      "background:transparent",
      "pointer-events:none",
      "box-sizing:border-box",
      "z-index:9998",
    ].join(";");
  }

  function removeDebugOverlay() {
    debugRoot?.remove();
    debugRoot = null;
  }

  function updateDebugOverlay(insertSlot: number) {
    if (!debugEnabled() || !active) return;

    const children = getChildren();
    const n = children.length;
    const lane = laneRect();
    const block = measureDragBlockBoundsComputed();
    const crossingCenter = measureCrossingCenter();
    const slot = currentTarget;

    if (!debugRoot) {
      debugRoot = document.createElement("div");
      debugRoot.setAttribute("data-layer-drag-debug", "");
      document.body.appendChild(debugRoot);
    }

    const parts: string[] = [];

    for (let i = 0; i < n; i++) {
      const r = rowRects[i];
      if (!r) continue;
      const shift = rowPreviewShift(i, slot);
      const top = r.top + shift;
      const selected = dragIndexSet.has(i);
      parts.push(
        `<div style="${boxStyle(top, lane.left, lane.width, r.height, selected ? "#22c55e" : "rgb(255 255 255 / 0.2)")}" title="layer ${i}"></div>`,
      );
    }

    if (Number.isFinite(block.top)) {
      parts.push(
        `<div style="${boxStyle(block.top, lane.left, lane.width, block.bottom - block.top, "#22c55e")}" title="drag block union"></div>`,
        `<div style="${lineStyle(crossingCenter, lane.left, lane.width, "#22c55e")}" title="crossing anchor (grabbed row header)"></div>`,
      );
    }

    for (let i = 0; i < n; i++) {
      const y = rowCenters[i];
      if (y === undefined) continue;
      const crossed =
        dragIndexSet.has(i)
          ? " (selected)"
          : crossingCenter > y
            ? " ✓ crossed down"
            : crossingCenter < y
              ? " ✓ crossed up"
              : "";
      parts.push(
        `<div style="${lineStyle(y, lane.left, lane.width, "#eab308", true)}" title="row ${i} center${crossed}"></div>`,
      );
    }

    const centerText = rowCenters
      .map((y, i) => {
        const mark = dragIndexSet.has(i)
          ? " sel"
          : crossingCenter > y
            ? " ↓"
            : crossingCenter < y
              ? " ↑"
              : "";
        return `  ${i} @ ${Math.round(y)}px${mark}`;
      })
      .join("\n");

    parts.push(`
      <div style="position:fixed;top:8px;right:8px;z-index:10000;max-width:280px;padding:8px 10px;border-radius:8px;background:rgb(0 0 0 / 0.85);color:#f5f5f5;font:11px/1.45 ui-monospace,Menlo,monospace;pointer-events:none;white-space:pre">
<b style="color:#22c55e">layer drag debug</b>
insertSlot: ${insertSlot}  currentTarget: ${currentTarget}
crossing center: ${Math.round(crossingCenter)}px
block top/bottom: ${Math.round(block.top)} / ${Math.round(block.bottom)}px
selected: [${sortedSelection().join(", ")}]
row centers (yellow, synced to preview):
${centerText || "  —"}
swap when green passes a yellow line (target = rows above crossing point)

localStorage.removeItem('${LAYER_DRAG_DEBUG_KEY}') to hide
      </div>
    `);

    debugRoot.innerHTML = parts.join("");
  }

  function restingSlot(): number {
    return Math.min(...dragIndices);
  }

  function applyTransforms(slot: number) {
    const children = getChildren();

    for (let i = 0; i < children.length; i++) {
      if (dragIndexSet.has(i)) continue;
      const el = children[i]!;
      const shift = rowPreviewShift(i, slot);

      el.style.transition = `transform ${animation}ms ${easing}`;
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    }
  }

  function applyDragTransforms(deltaY: number) {
    const children = getChildren();

    for (const i of dragIndices) {
      const el = children[i];
      if (!el) continue;
      const collapse = collapseOffsets.get(i) ?? 0;
      el.style.transform = `translateY(${deltaY + collapse}px)`;
      el.style.position = "relative";
      el.style.zIndex = "10";
      el.style.transition = "none";
    }
  }

  function clearChildStyles(children: HTMLElement[]) {
    for (const el of children) {
      el.style.transition = "none";
      el.style.transform = "";
      el.style.position = "";
      el.style.zIndex = "";
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

    const handle = target.closest("[data-drag-handle]");
    if (!handle) return;

    const children = getChildren();
    let clickedChild: HTMLElement | null = null;
    let node: HTMLElement | null = handle as HTMLElement;
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

    onDragStartIndex?.(index, e);

    let selected = getSelectedIndices?.() ?? [index];
    if (!selected.includes(index)) selected = [index];
    selected = [...selected].sort((a, b) => a - b);

    startY = e.clientY;
    dragFrom = index;
    dragIndices = selected;
    dragIndexSet = new Set(selected);
    cacheRects();
    currentTarget = restingSlot();
    active = false;

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
  }

  function onPointerMove(e: PointerEvent) {
    if (groupingAnimating) return;

    const deltaY = e.clientY - startY;
    previewDeltaY = deltaY;

    if (!active) {
      if (Math.abs(deltaY) < 4) return;
      active = true;
      didDrag = true;
      draggingIndices.value = new Set(dragIndices);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      const beginDrag = () => {
        cacheRects();
        collapseOffsets = computeCollapseOffsets();
        currentTarget = restingSlot();
        syncRowCenters(currentTarget);
      };

      if (dragIndices.length > 1 && !isContiguousSelection()) {
        animateSelectionGrouping(e.clientY, beginDrag);
        return;
      }

      beginDrag();
    }

    applyDragTransforms(deltaY);

    let slot = currentTarget;
    for (let pass = 0; pass < rowRects.length + 1; pass++) {
      applyTransforms(slot);
      syncRowCenters(slot);
      const next = computeTargetSlot();
      if (next === slot) break;
      slot = next;
    }
    currentTarget = slot;

    updateDebugOverlay(currentTarget);
  }

  function cancelGroupingAnimation() {
    if (preGroupList) list.value = preGroupList;
    preGroupList = null;
    groupingAnimating = false;
    for (const child of getChildren()) {
      child.style.transition = "";
      child.style.transform = "";
    }
  }

  function onPointerUp() {
    if (groupingAnimating) {
      cancelGroupingAnimation();
      cleanup();
      return;
    }

    if (!active) {
      cleanup();
      return;
    }

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    const children = getChildren();
    const snapshot = new Map<HTMLElement, number>();
    for (const el of children) {
      snapshot.set(el, el.getBoundingClientRect().top);
    }

    clearChildStyles(children);
    draggingIndices.value = new Set();

    const next =
      dragIndexSet.size > 1
        ? commitMultiReorder(list.value, dragIndices, currentTarget)
        : commitSingleReorder(list.value, dragFrom, currentTarget);

    if (!next) {
      const el = resolveEl();
      if (el) el.offsetHeight;
      for (const el of children) {
        el.style.transition = "";
      }
      cleanup();
      return;
    }

    list.value = next;

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

  function commitSingleReorder(items: T[], from: number, to: number): T[] | null {
    if (from === to) return null;
    const updated = [...items];
    const [moved] = updated.splice(from, 1);
    if (!moved) return null;
    updated.splice(to, 0, moved);
    return updated;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (groupingAnimating) cancelGroupingAnimation();
      clearChildStyles(getChildren());
      const el = resolveEl();
      if (el) el.offsetHeight;
      for (const el of getChildren()) {
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
    draggingIndices.value = new Set();
    dragFrom = -1;
    dragIndices = [];
    dragIndexSet = new Set();
    currentTarget = -1;
    rowRects = [];
    collapseOffsets = new Map();
    groupingAnimating = false;
    preGroupList = null;
    rowCenters = [];
    previewDeltaY = 0;
    removeDebugOverlay();
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

  onUnmounted(() => {
    cleanup();
    removeDebugOverlay();
  });

  return { containerRef, draggingIndices, debugEnabled };
}
