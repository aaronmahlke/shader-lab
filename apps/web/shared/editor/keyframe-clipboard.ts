import type { KeyframePasteItem } from "@shader-lab/core";

type KeyframeClipboard = {
  items: KeyframePasteItem[];
  anchorTime: number;
};

let clipboard: KeyframeClipboard | null = null;

export function setKeyframeClipboard(items: KeyframePasteItem[]) {
  if (items.length === 0) {
    clipboard = null;
    return;
  }
  clipboard = {
    items,
    anchorTime: Math.min(...items.map((item) => item.time)),
  };
}

export function getKeyframeClipboard(): KeyframeClipboard | null {
  return clipboard;
}
