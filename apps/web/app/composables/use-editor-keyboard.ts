import { onUnmounted, useId, type Ref } from "vue";

/** Higher priority handlers run first. */
export const EditorKeyboardPriority = {
  focusedWidget: 100,
  keyframe: 80,
  layer: 60,
  timeline: 40,
  transport: 20,
} as const;

type EditorKeyboardHandler = {
  id: string;
  priority: number;
  when?: (e: KeyboardEvent) => boolean;
  /** Return true when the event is consumed. */
  handle: (e: KeyboardEvent) => boolean;
};

const handlers = new Map<string, EditorKeyboardHandler>();
let listening = false;

export function isTypingTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest(
    "input, textarea, select, [contenteditable='true']",
  );
}

export function isDeleteKey(e: KeyboardEvent): boolean {
  return e.code === "Backspace" || e.code === "Delete";
}

function dispatchKeydown(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return;

  const sorted = [...handlers.values()].sort((a, b) => b.priority - a.priority);
  for (const handler of sorted) {
    if (handler.when && !handler.when(e)) continue;
    if (handler.handle(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
  }
}

function ensureListener() {
  if (listening || import.meta.server) return;
  listening = true;
  window.addEventListener("keydown", dispatchKeydown, true);
}

export function useEditorKeyboard() {
  function register(handler: EditorKeyboardHandler) {
    handlers.set(handler.id, handler);
    ensureListener();
    onUnmounted(() => {
      handlers.delete(handler.id);
    });
  }

  return { register };
}

type FocusedKeyboardBinding = {
  priority?: number;
  when?: (e: KeyboardEvent) => boolean;
  handle: (e: KeyboardEvent) => boolean;
};

/** Shortcuts that only run while focus is inside `rootRef`. */
export function useFocusedKeyboardScope(
  rootRef: Ref<HTMLElement | null | undefined>,
  bindings: FocusedKeyboardBinding | FocusedKeyboardBinding[],
) {
  const { register } = useEditorKeyboard();
  const scopeId = useId();
  const list = Array.isArray(bindings) ? bindings : [bindings];

  list.forEach((binding, index) => {
    register({
      id: `${scopeId}:${index}`,
      priority: binding.priority ?? EditorKeyboardPriority.focusedWidget,
      when(e) {
        const root = rootRef.value;
        const active = document.activeElement;
        if (!root || !active || !root.contains(active)) return false;
        return binding.when ? binding.when(e) : true;
      },
      handle: binding.handle,
    });
  });
}
