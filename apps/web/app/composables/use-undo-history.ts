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
  let gestureDepth = 0;

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  function trimPast() {
    if (past.value.length > maxHistory) {
      past.value.splice(0, past.value.length - maxHistory);
    }
  }

  function record() {
    if (isApplying.value || gestureDepth > 0) return;
    const now = capture();
    if (snapshotsEqual(now, checkpoint)) return;
    past.value.push(cloneSnapshot(checkpoint));
    trimPast();
    future.value = [];
    checkpoint = cloneSnapshot(now);
  }

  function beginGesture() {
    if (isApplying.value) return;
    // Flush edits that never called record() (leaky mutation paths) as their
    // own step first, so this gesture's commit can't swallow unrelated work.
    if (gestureDepth === 0) record();
    gestureDepth++;
  }

  function commitGesture() {
    if (gestureDepth <= 0) return;
    gestureDepth--;
    if (gestureDepth > 0) return;

    const now = capture();
    if (!snapshotsEqual(now, checkpoint)) {
      past.value.push(cloneSnapshot(checkpoint));
      trimPast();
      future.value = [];
      checkpoint = cloneSnapshot(now);
    }
  }

  function cancelGesture() {
    gestureDepth = 0;
  }

  function undo() {
    // Same flush on undo: if unrecorded edits are pending, they become the
    // step being undone — instead of the undo jumping past them to an older
    // checkpoint and reverting more than the user expects.
    record();
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
    gestureDepth = 0;
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
