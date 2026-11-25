import { contextBridge, ipcRenderer } from "electron";

/**
 * The editor checks `window.shaderlab` to show desktop-only actions.
 * Each action resolves to the composition id to open, or null if cancelled.
 */
contextBridge.exposeInMainWorld("shaderlab", {
  desktop: true,
  platform: process.platform,
  openProject: (): Promise<string | null> => ipcRenderer.invoke("project:open"),
  newProject: (): Promise<string | null> => ipcRenderer.invoke("project:new"),
});
