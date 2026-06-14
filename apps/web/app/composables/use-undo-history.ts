import {
  EDITOR_HISTORY_KEY,
  cloneEditorSnapshot,
  type EditorHistory,
  type EditorSnapshot,
} from "#shared/editor/editor-history";

const DEFAULT_MAX_HISTORY = 100;

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return cloneEditorSnapshot(snapshot);
}

function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useUndoHistory(
  capture: () => EditorSnapshot,
  apply: (snapshot: EditorSnapshot) => void,
  maxHistory = DEFAULT_MAX_HISTORY,
): EditorHistory {
  const past = ref<EditorSnapshot[]>([]);
  const future = ref<EditorSnapshot[]>([]);
  const isApplying = ref(false);
  let checkpoint = cloneSnapshot(capture());
  let gestureStart: EditorSnapshot | null = null;

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  function trimPast() {
    if (past.value.length > maxHistory) {
      past.value.splice(0, past.value.length - maxHistory);
    }
  }

  function record() {
    if (isApplying.value) return;
    const now = capture();
    if (snapshotsEqual(now, checkpoint)) return;
    past.value.push(cloneSnapshot(checkpoint));
    trimPast();
    future.value = [];
    checkpoint = cloneSnapshot(now);
  }

  function beginGesture() {
    if (isApplying.value || gestureStart) return;
    gestureStart = cloneSnapshot(capture());
  }

  function commitGesture() {
    if (isApplying.value || !gestureStart) return;
    const now = capture();
    if (!snapshotsEqual(now, gestureStart)) {
      past.value.push(gestureStart);
      trimPast();
      future.value = [];
      checkpoint = cloneSnapshot(now);
    }
    gestureStart = null;
  }

  function cancelGesture() {
    gestureStart = null;
  }

  function undo() {
    if (past.value.length === 0) return;
    const prev = past.value.pop()!;
    future.value.push(cloneSnapshot(capture()));
    isApplying.value = true;
    apply(prev);
    checkpoint = cloneSnapshot(prev);
    isApplying.value = false;
  }

  function redo() {
    if (future.value.length === 0) return;
    const next = future.value.pop()!;
    past.value.push(cloneSnapshot(capture()));
    isApplying.value = true;
    apply(next);
    checkpoint = cloneSnapshot(next);
    isApplying.value = false;
  }

  function reset() {
    past.value = [];
    future.value = [];
    gestureStart = null;
    checkpoint = cloneSnapshot(capture());
  }

  return {
    record,
    beginGesture,
    commitGesture,
    cancelGesture,
    undo,
    redo,
    reset,
    canUndo,
    canRedo,
    isApplying,
  };
}

export function provideEditorHistory(history: EditorHistory) {
  provide(EDITOR_HISTORY_KEY, history);
}

export function useEditorHistory(): EditorHistory | undefined {
  return inject(EDITOR_HISTORY_KEY, undefined);
}
