import { app, BrowserWindow, dialog, ipcMain, Menu, shell, utilityProcess, type UtilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { basename, join } from "node:path";

/**
 * Shader Lab desktop.
 *
 * The editor is the same Nuxt app as the hosted version, run locally in
 * "local mode" (projects are folders, no database, no login). In production
 * the built Nitro server runs in a utility process on a free localhost port;
 * in development `SHADERLAB_DEV_URL` points at a running `nuxt dev`
 * (started with NUXT_LOCAL_MODE=1).
 */

const DEV_URL = process.env.SHADERLAB_DEV_URL;
let serverUrl = "";
let server: UtilityProcess | null = null;

app.setName("Shader Lab");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Stable per-install secret for the local session cookie. */
function sessionSecret(): string {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/** Built Nitro server: bundled resources when packaged, the monorepo build otherwise. */
function serverEntry(): string {
  if (process.env.SHADERLAB_SERVER_ENTRY) return process.env.SHADERLAB_SERVER_ENTRY;
  if (app.isPackaged) return join(process.resourcesPath, "server", "server", "index.mjs");
  return join(app.getAppPath(), "..", "web", ".output", "server", "index.mjs");
}

async function waitForServer(url: string, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/local/info`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Local server did not start at ${url}`);
}

async function startServer(): Promise<string> {
  if (DEV_URL) return DEV_URL.replace(/\/$/, "");
  const entry = serverEntry();
  if (!existsSync(entry)) {
    throw new Error(`Editor build not found at ${entry}. Run \`bun run build\` first.`);
  }
  const port = await freePort();
  server = utilityProcess.fork(entry, [], {
    env: {
      ...process.env,
      NUXT_LOCAL_MODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(port),
      NITRO_PORT: String(port),
      NUXT_SESSION_PASSWORD: sessionSecret(),
    },
    stdio: "inherit",
  });
  server.on("exit", (code) => {
    server = null;
    if (code !== 0 && !quitting) {
      dialog.showErrorBox("Shader Lab", `The local editor server stopped (exit ${code}).`);
    }
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return url;
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.statusMessage ?? detail.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Pick a project folder and register it; returns the first composition id. */
async function openProject(win?: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: "Open Shader Lab project",
    buttonLabel: "Open",
    properties: ["openDirectory"],
  });
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return null;
  try {
    const opened = await api<{ firstCompositionId: string | null }>("/api/local/open", { path: folder });
    return opened.firstCompositionId;
  } catch (err) {
    await dialog.showMessageBox(win ?? undefined!, {
      type: "warning",
      message: "That folder isn't a Shader Lab project",
      detail: `${(err as Error).message}\n\nPick a folder that contains shaderlab.json, or create a new project.`,
    });
    return null;
  }
}

/** Choose where to create a new project folder; returns its first composition id. */
async function newProject(win?: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showSaveDialog(win ?? undefined!, {
    title: "New Shader Lab project",
    buttonLabel: "Create",
    nameFieldLabel: "Project",
    defaultPath: join(app.getPath("documents"), "Shader Lab", "Untitled"),
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return null;
  try {
    const created = await api<{ compositions: { id: string }[] }>("/api/projects", {
      name: basename(result.filePath),
      path: result.filePath,
    });
    return created.compositions[0]?.id ?? null;
  } catch (err) {
    dialog.showErrorBox("Couldn't create project", (err as Error).message);
    return null;
  }
}

function openComposition(win: BrowserWindow, compId: string | null) {
  if (compId) void win.loadURL(`${serverUrl}/shader/${compId}`);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b0b0c",
    show: false,
    webPreferences: {
      // Not __dirname: the bundler inlines it at build time.
      preload: join(app.getAppPath(), "dist", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.on("preload-error", (_e, path, error) => console.error("[preload-error]", path, error));
  // Debug: SHADERLAB_SCREENSHOT=<file.png> captures the window after load.
  const shot = process.env.SHADERLAB_SCREENSHOT;
  if (shot) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        writeFileSync(shot, image.toPNG());
      }, 3500);
    });
  }
  // External links open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(serverUrl)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadURL(serverUrl);
  return win;
}

function buildMenu() {
  const focused = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "New Project…",
          accelerator: "CmdOrCtrl+Shift+N",
          click: async () => {
            const win = focused() ?? createWindow();
            openComposition(win, await newProject(win));
          },
        },
        {
          label: "Open Project…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const win = focused() ?? createWindow();
            openComposition(win, await openProject(win));
          },
        },
        { type: "separator" },
        {
          label: "All Projects",
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => void (focused() ?? createWindow()).loadURL(serverUrl),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("project:open", (event) => openProject(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle("project:new", (event) => newProject(BrowserWindow.fromWebContents(event.sender)));

let quitting = false;
app.on("before-quit", () => {
  quitting = true;
  server?.kill();
});

app.whenReady().then(async () => {
  try {
    serverUrl = await startServer();
  } catch (err) {
    dialog.showErrorBox("Shader Lab couldn't start", (err as Error).message);
    app.quit();
    return;
  }
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
