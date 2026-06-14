export type EditorLayoutPreferences = {
  timelineHeight: number;
  timelinePxPerSecond: number;
};

export const EDITOR_LAYOUT_DEFAULTS: EditorLayoutPreferences = {
  timelineHeight: 224,
  timelinePxPerSecond: 96,
};

const COOKIE_NAME = "shader-lab-editor-layout";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function clampTimelineHeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return EDITOR_LAYOUT_DEFAULTS.timelineHeight;
  }
  return Math.min(800, Math.max(120, Math.round(value)));
}

export function clampPxPerSecond(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return EDITOR_LAYOUT_DEFAULTS.timelinePxPerSecond;
  }
  return Math.min(640, Math.max(16, value));
}

export function normalizeEditorLayoutPreferences(
  value: Partial<EditorLayoutPreferences> | null | undefined,
): EditorLayoutPreferences {
  return {
    timelineHeight: clampTimelineHeight(value?.timelineHeight),
    timelinePxPerSecond: clampPxPerSecond(value?.timelinePxPerSecond),
  };
}

export function useEditorLayoutPreferences() {
  const cookie = useCookie<EditorLayoutPreferences>(COOKIE_NAME, {
    default: () => ({ ...EDITOR_LAYOUT_DEFAULTS }),
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  const prefs = computed(() => normalizeEditorLayoutPreferences(cookie.value));

  function updatePrefs(patch: Partial<EditorLayoutPreferences>) {
    cookie.value = normalizeEditorLayoutPreferences({ ...cookie.value, ...patch });
  }

  return { prefs, updatePrefs };
}
