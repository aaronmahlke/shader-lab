/** Bridge exposed by the desktop app's preload (absent in the browser). */
export type DesktopBridge = {
  desktop: true;
  platform: string;
  /** Pick a project folder; resolves to the composition id to open, or null. */
  openProject: () => Promise<string | null>;
  /** Choose where to create a new project folder; resolves to its composition id, or null. */
  newProject: () => Promise<string | null>;
};

/** The desktop bridge on the client inside Electron, else null (SSR/browser). */
export function useDesktop() {
  const bridge = ref<DesktopBridge | null>(null);
  onMounted(() => {
    bridge.value = (window as unknown as { shaderlab?: DesktopBridge }).shaderlab ?? null;
  });
  return bridge;
}
