import { describe, expect, it } from "bun:test";
import { computed, ref } from "vue";

// The composable relies on Nuxt auto-imports; provide them for bun test.
(globalThis as Record<string, unknown>).ref = ref;
(globalThis as Record<string, unknown>).computed = computed;

const { useUndoHistory } = await import("./use-undo-history");

type Snap = { value: number };

function harness(initial = 0) {
  const state: Snap = { value: initial };
  const history = useUndoHistory(
    () => ({ value: state.value }) as never,
    (snap) => {
      state.value = (snap as unknown as Snap).value;
    },
  );
  return { state, history };
}

describe("useUndoHistory pending-edit flushing", () => {
  it("flushes unrecorded edits as their own step when a gesture begins", () => {
    const { state, history } = harness(0);
    state.value = 1; // leaky edit: no record()
    history.beginGesture();
    state.value = 2; // the gesture's own change
    history.commitGesture();

    history.undo();
    expect(state.value).toBe(1); // gesture undone, leaky edit preserved
    history.undo();
    expect(state.value).toBe(0); // leaky edit undone separately
  });

  it("flushes unrecorded edits on undo so undo reverts exactly them", () => {
    const { state, history } = harness(0);
    state.value = 5; // leaky edit, then immediate undo
    history.undo();
    expect(state.value).toBe(0);
  });

  it("keeps normal gesture behavior for recorded flows", () => {
    const { state, history } = harness(0);
    state.value = 1;
    history.record();
    history.beginGesture();
    state.value = 2;
    history.commitGesture();
    history.undo();
    expect(state.value).toBe(1);
    history.redo();
    expect(state.value).toBe(2);
  });
});
