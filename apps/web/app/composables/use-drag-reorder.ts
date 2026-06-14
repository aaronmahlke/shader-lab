type DragReorderOptions = {
  /** Transition duration in ms for non-dragged items sliding into place. Default: 200 */
  animation?: number;
  /** Duration in ms for non-contiguous stack collapse. Default: 120 */
  stackAnimation?: number;
  /** Sorted indices in the active selection. Empty means drag only the clicked row. */
  getSelectedIndices?: () => number[];
  /** Called on pointer down before drag starts (e.g. ensure row is selected). */
  onDragStartIndex?: (index: number, e: PointerEvent) => void;
};

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

/** Insert selected block at `insertAt` in the list with selected rows removed. */
function commitBlockAtInsert<T>(list: T[], indices: number[], insertAt: number): T[] | null {
  const sorted = [...indices].sort((a, b) => a - b);
  const selectedSet = new Set(sorted);
  const selected = sorted.map((i) => list[i]!);
  const remaining = list.filter((_, i) => !selectedSet.has(i));
  const at = Math.max(0, Math.min(remaining.length, insertAt));
  remaining.splice(at, 0, ...selected);
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
  const { animation = 200, stackAnimation = 120, getSelectedIndices, onDragStartIndex } = options;
  const containerRef = ref<HTMLElement | null>(null);
  const draggingIndices = ref<Set<number>>(new Set());

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
  /** Original selection at pointer down — used for drop commit when stack animates. */
  let originalIndices: number[] = [];
  let originalDragFrom = -1;
  let dragIndices: number[] = [];
  let dragIndexSet = new Set<number>();
  let currentTarget = -1;
  /** Insert slot for the virtual block in remaining-list space. */
  let virtualBlockStart = -1;
  let rowRects: RowRect[] = [];
  let stackTargetOffsets = new Map<number, number>();
  let stackProgress = 1;
  let stackStartMs = 0;
  let stackRafId = 0;
  /** Visual stack in progress — slot swaps gated until complete. */
  let stackPhase = false;
  /** Row center Y synced to the current preview layout. */
  let rowCenters: number[] = [];
  let previewDeltaY = 0;
  /** After swapping up past row R, block down-swap on R until it unstraddles R's center. */
  let gateDownRow = -1;
  let active = false;
  let didDrag = false;

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

  function computeVirtualBlockStart(): number {
    const sorted = sortedSelection();
    if (sorted.length <= 1) return dragFrom;
    return dragFrom - sorted.indexOf(dragFrom);
  }

  function appliedStackOffset(i: number): number {
    const target = stackTargetOffsets.get(i);
    if (target === undefined) return 0;
    return target * stackProgress;
  }

  /** Target Y offsets to visually stack non-adjacent rows at the grab anchor. */
  function computeStackTargetOffsets(): Map<number, number> {
    const offsets = new Map<number, number>();
    const sorted = sortedSelection();
    if (sorted.length <= 1 || isContiguousSelection()) return offsets;

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

  function cancelStackRaf() {
    if (stackRafId) {
      cancelAnimationFrame(stackRafId);
      stackRafId = 0;
    }
  }

  function refreshPreviewSlot() {
    let slot = currentTarget;
    for (let pass = 0; pass < rowRects.length + 1; pass++) {
      applyTransforms(slot);
      syncRowCenters(slot);
      const block = measureDragBlockBoundsComputed();
      const { aboveIdx } = crossingNeighbors(block, slot);
      const next = computeTargetSlot(slot);
      if (next === slot) break;
      if (next < slot && aboveIdx >= 0) gateDownRow = aboveIdx;
      slot = next;
    }
    currentTarget = slot;
  }

  function updateStackProgress() {
    if (!stackPhase) return;
    stackProgress = Math.min(1, (performance.now() - stackStartMs) / stackAnimation);
    if (stackProgress >= 1) {
      stackProgress = 1;
      stackPhase = false;
      cancelStackRaf();
      syncRowCenters(currentTarget);
      refreshPreviewSlot();
    }
  }

  function stackAnimationFrame() {
    stackRafId = 0;
    if (!stackPhase) return;
    updateStackProgress();
    applyDragTransforms(previewDeltaY);
    if (stackPhase) {
      stackRafId = requestAnimationFrame(stackAnimationFrame);
    }
  }

  function startStackPhase() {
    stackTargetOffsets = computeStackTargetOffsets();
    stackProgress = 0;
    stackStartMs = performance.now();
    stackPhase = true;
    stackAnimationFrame();
  }

  function beginDrag() {
    cacheRects();
    virtualBlockStart = computeVirtualBlockStart();
    currentTarget = virtualBlockStart;
    stackTargetOffsets = new Map();
    stackProgress = 1;
    stackPhase = false;

    if (dragIndices.length > 1 && !isContiguousSelection()) {
      startStackPhase();
    }

    syncRowCenters(currentTarget);
  }

  /** Bounding box of dragged block from drag-start geometry + pointer delta. */
  function measureDragBlockBoundsComputed(): { top: number; bottom: number; center: number } {
    let top = Infinity;
    let bottom = -Infinity;
    for (const i of dragIndices) {
      const r = rowRects[i];
      if (!r) continue;
      const shift = previewDeltaY + appliedStackOffset(i);
      top = Math.min(top, r.top + shift);
      bottom = Math.max(bottom, r.top + r.height + shift);
    }
    if (!Number.isFinite(top)) return { top: 0, bottom: 0, center: 0 };
    return { top, bottom, center: (top + bottom) / 2 };
  }

  /**
   * Next rows to cross in preview — header bands vs block bbox edges.
   * Rows shifted into the gap straddle an edge and count as that neighbor.
   */
  function crossingNeighbors(
    block: { top: number; bottom: number },
    slot: number,
  ): { aboveIdx: number; belowIdx: number } {
    let aboveIdx = -1;
    let aboveBottom = -Infinity;
    let belowIdx = -1;
    let belowTop = Infinity;

    for (let i = 0; i < rowRects.length; i++) {
      if (dragIndexSet.has(i)) continue;
      const header = rowPreviewHeaderBounds(i, slot);
      const top = header.top;
      const bottom = header.bottom;

      if (top < block.top && bottom > block.top) {
        aboveIdx = i;
        aboveBottom = Infinity;
        continue;
      }
      if (bottom <= block.top && bottom > aboveBottom) {
        aboveBottom = bottom;
        aboveIdx = i;
      }

      if (top < block.bottom && bottom > block.bottom) {
        belowIdx = i;
        belowTop = -Infinity;
        continue;
      }
      if (top >= block.bottom && top < belowTop) {
        belowTop = top;
        belowIdx = i;
      }
    }
    return { aboveIdx, belowIdx };
  }

  function buildVirtualOrder(slot: number): number[] {
    const sorted = sortedSelection();
    const remaining: number[] = [];
    for (let i = 0; i < rowRects.length; i++) {
      if (!dragIndexSet.has(i)) remaining.push(i);
    }
    const order: number[] = [];
    for (let r = 0; r < remaining.length; r++) {
      if (r === slot) order.push(...sorted);
      order.push(remaining[r]!);
    }
    if (slot >= remaining.length) order.push(...sorted);
    return order;
  }

  /** Per-row preview shifts from cumulative heights (handles expanded rows). */
  function previewLayoutShifts(slot: number): number[] {
    const n = rowRects.length;
    const shifts = new Array<number>(n).fill(0);
    const order = buildVirtualOrder(slot);
    if (order.length === 0) return shifts;

    let y = rowRects[0]!.top;
    for (const idx of order) {
      shifts[idx] = y - rowRects[idx]!.top;
      y += rowRects[idx]!.height;
    }
    return shifts;
  }

  function rowPreviewShift(i: number, slot: number): number {
    if (dragIndexSet.has(i)) {
      return previewDeltaY + appliedStackOffset(i);
    }
    return previewLayoutShifts(slot)[i] ?? 0;
  }

  function rowPreviewHeaderBounds(
    i: number,
    slot: number,
  ): { top: number; bottom: number; midY: number } {
    const r = rowRects[i];
    if (!r) return { top: 0, bottom: 0, midY: 0 };
    const shift = rowPreviewShift(i, slot);
    return {
      top: r.headerTop + shift,
      bottom: r.headerBottom + shift,
      midY: r.headerMidY + shift,
    };
  }

  function rowCrossingCenterY(i: number, slot: number): number {
    if (dragIndexSet.has(i)) {
      const r = rowRects[i];
      if (!r) return 0;
      return r.top + r.height / 2 + rowPreviewShift(i, slot);
    }
    return rowPreviewHeaderBounds(i, slot).midY;
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
   * Single-step adjacent swap: selection bbox edges vs neighbor full-row centers.
   * rowCenters must already be synced to the current preview layout.
   */
  function clearDownGate(block: { top: number; bottom: number }) {
    if (gateDownRow < 0) return;
    const y = rowCenters[gateDownRow];
    if (y === undefined || block.top >= y || block.bottom <= y) gateDownRow = -1;
  }

  function computeTargetSlot(baseSlot: number): number {
    const block = measureDragBlockBoundsComputed();
    clearDownGate(block);
    const { aboveIdx, belowIdx } = crossingNeighbors(block, baseSlot);
    const n = rowRects.length;

    if (
      belowIdx >= 0 &&
      belowIdx < n &&
      belowIdx !== gateDownRow &&
      block.bottom > rowCenters[belowIdx]!
    ) {
      return baseSlot + 1;
    }
    if (aboveIdx >= 0 && aboveIdx < n && block.top < rowCenters[aboveIdx]!) {
      return baseSlot - 1;
    }
    return baseSlot;
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
      const collapse = appliedStackOffset(i);
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
    originalIndices = selected;
    originalDragFrom = index;
    dragIndices = selected;
    dragIndexSet = new Set(selected);
    virtualBlockStart = computeVirtualBlockStart();
    cacheRects();
    currentTarget = virtualBlockStart;
    active = false;

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
  }

  function onPointerMove(e: PointerEvent) {
    const deltaY = e.clientY - startY;
    previewDeltaY = deltaY;

    if (!active) {
      if (Math.abs(deltaY) < 4) return;
      active = true;
      didDrag = true;
      draggingIndices.value = new Set(dragIndices);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      beginDrag();
    }

    updateStackProgress();
    applyDragTransforms(deltaY);

    if (!stackPhase) {
      refreshPreviewSlot();
    }
  }

  function cancelStackPhase() {
    cancelStackRaf();
    stackPhase = false;
    stackProgress = 1;
    stackTargetOffsets = new Map();
  }

  function onPointerUp() {
    if (stackPhase) {
      cancelStackRaf();
      stackProgress = 1;
      stackPhase = false;
      stackTargetOffsets = new Map();
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
      originalIndices.length > 1
        ? commitBlockAtInsert(list.value, originalIndices, currentTarget)
        : commitSingleReorder(list.value, originalDragFrom, currentTarget);

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
      if (stackPhase) cancelStackPhase();
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
    originalIndices = [];
    originalDragFrom = -1;
    dragIndices = [];
    dragIndexSet = new Set();
    currentTarget = -1;
    virtualBlockStart = -1;
    rowRects = [];
    stackTargetOffsets = new Map();
    stackProgress = 1;
    stackStartMs = 0;
    cancelStackRaf();
    stackPhase = false;
    rowCenters = [];
    previewDeltaY = 0;
    gateDownRow = -1;
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
  });

  return { containerRef, draggingIndices };
}
