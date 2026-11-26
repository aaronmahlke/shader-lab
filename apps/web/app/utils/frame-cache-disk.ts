/**
 * Disk layer of the RAM preview: cached frames survive full reloads.
 *
 * IndexedDB (works in the browser and the desktop app). Frames are stored as
 * high-quality WebP under `${entryKey}|${frame}`; an `entries` store tracks
 * when each render state was last used so old states get pruned.
 */

const DB_NAME = "shaderlab-frame-cache";
const DB_VERSION = 1;
const FRAMES = "frames";
const ENTRIES = "entries";
/** Render states kept on disk (each can be hundreds of frames). */
const MAX_DISK_ENTRIES = 6;

type FrameRecord = { key: string; entry: string; frame: number; blob: Blob };
type EntryRecord = { entry: string; usedAt: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FRAMES)) {
        const s = db.createObjectStore(FRAMES, { keyPath: "key" });
        s.createIndex("entry", "entry");
      }
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: "entry" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Encode a bitmap off the main thread where possible (OffscreenCanvas.convertToBlob). */
async function encode(bmp: ImageBitmap): Promise<Blob | null> {
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d")?.drawImage(bmp, 0, 0);
      return await c.convertToBlob({ type: "image/webp", quality: 0.95 });
    }
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")?.drawImage(bmp, 0, 0);
    return await new Promise((r) => c.toBlob((b) => r(b), "image/webp", 0.95));
  } catch {
    return null;
  }
}

/** Save one frame (fire-and-forget; failures just mean no disk copy). */
export async function saveFrame(entry: string, frame: number, bmp: ImageBitmap): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const blob = await encode(bmp);
  if (!blob) return;
  try {
    const tx = db.transaction([FRAMES, ENTRIES], "readwrite");
    tx.objectStore(FRAMES).put({ key: `${entry}|${frame}`, entry, frame, blob } satisfies FrameRecord);
    tx.objectStore(ENTRIES).put({ entry, usedAt: Date.now() } satisfies EntryRecord);
    await done(tx);
  } catch {
    // Quota or a closing DB: the RAM copy still works.
  }
}

/** Load every stored frame of a render state, decoded. */
export async function loadFrames(entry: string): Promise<Map<number, ImageBitmap>> {
  const out = new Map<number, ImageBitmap>();
  const db = await openDb();
  if (!db) return out;
  const records = await new Promise<FrameRecord[]>((resolve) => {
    try {
      const req = db.transaction(FRAMES, "readonly").objectStore(FRAMES).index("entry").getAll(entry);
      req.onsuccess = () => resolve(req.result as FrameRecord[]);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  await Promise.all(
    records.map(async (r) => {
      try {
        out.set(r.frame, await createImageBitmap(r.blob));
      } catch {
        // Corrupt record: skip.
      }
    }),
  );
  if (records.length) void touchEntry(entry);
  return out;
}

async function touchEntry(entry: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(ENTRIES, "readwrite");
    tx.objectStore(ENTRIES).put({ entry, usedAt: Date.now() } satisfies EntryRecord);
    await done(tx);
  } catch {}
}

/** Drop render states beyond the newest MAX_DISK_ENTRIES (and their frames). */
export async function pruneDisk(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const entries = await new Promise<EntryRecord[]>((resolve) => {
    try {
      const req = db.transaction(ENTRIES, "readonly").objectStore(ENTRIES).getAll();
      req.onsuccess = () => resolve(req.result as EntryRecord[]);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  const stale = entries.sort((a, b) => b.usedAt - a.usedAt).slice(MAX_DISK_ENTRIES);
  for (const { entry } of stale) {
    try {
      const tx = db.transaction([FRAMES, ENTRIES], "readwrite");
      const idx = tx.objectStore(FRAMES).index("entry");
      const req = idx.openKeyCursor(IDBKeyRange.only(entry));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        tx.objectStore(FRAMES).delete(cur.primaryKey);
        cur.continue();
      };
      tx.objectStore(ENTRIES).delete(entry);
      await done(tx);
    } catch {}
  }
}
