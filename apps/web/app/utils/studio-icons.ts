/**
 * Studio icon set: 12×12 grid, 1px strokes on half-pixel coordinates so lines
 * land on whole pixels (crisp like Live's icons). Filled glyphs for
 * transport and triangles.
 */
export type Glyph = { d: string; fill?: boolean; extra?: { d: string; fill?: boolean }[] };

export const STUDIO_ICONS = {
  // animation
  stopwatch: { d: "M6 2.5v1M4.5 1.5h3M9 3.5l1-1M6 7V5", extra: [{ d: "M6 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" }] },
  key: { d: "M6 1.5 10.5 6 6 10.5 1.5 6z" },
  "key-filled": { d: "M6 1.5 10.5 6 6 10.5 1.5 6z", fill: true },
  "key-prev": { d: "M8 2.5v7L3.5 6z", fill: true },
  "key-next": { d: "M4 2.5v7L8.5 6z", fill: true },
  graph: { d: "M1.5 10.5c4 0 4.5-9 9-9" },
  // transport
  play: { d: "M3 1.5v9l7.5-4.5z", fill: true },
  stop: { d: "M2.5 2.5h7v7h-7z", fill: true },
  loop: { d: "M5.5 3.5h3a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2", extra: [{ d: "M5 1.5v4l2.5-2z", fill: true }] },
  // triangles
  "tri-down": { d: "M2 4h8L6 8.5z", fill: true },
  "tri-right": { d: "M4 2v8l4.5-4z", fill: true },
  // layer switches
  eye: { d: "M.5 6C2 3.5 4 2.5 6 2.5s4 1 5.5 3.5C10 8.5 8 9.5 6 9.5S2 8.5.5 6z", extra: [{ d: "M6 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", fill: true }] },
  "eye-off": { d: "M.5 6C2 3.5 4 2.5 6 2.5s4 1 5.5 3.5C10 8.5 8 9.5 6 9.5S2 8.5.5 6zM1.5 10.5l9-9" },
  lock: { d: "M2.5 5.5h7v5h-7zM4 5.5V4a2 2 0 0 1 4 0v1.5" },
  unlock: { d: "M2.5 5.5h7v5h-7zM4 5.5V4a2 2 0 0 1 3.8-.9" },
  solo: { d: "M8.5 3.5C8 2.5 7 2 6 2 4.6 2 3.5 2.8 3.5 4c0 2.5 5 1.5 5 4 0 1.2-1.1 2-2.5 2-1.1 0-2.1-.5-2.5-1.5" },
  pickwhip: { d: "M7.25 5.4a1.25 1.25 0 0 1-2.5 0 2.5 2.5 0 0 1 5 0 3.75 3.75 0 0 1-7.5 0" },
  // tools
  cursor: { d: "M3.5 1.5v8l2-2 1.5 3 1.5-.7-1.5-3h3z" },
  text: { d: "M2.5 2.5h7M6 2.5v8M4.5 10.5h3" },
  shape: { d: "M2.5 2.5h7v7h-7z" },
  // items
  comp: { d: "M1.5 3.5h9v6h-9zM1.5 5.5h9M3.5 1.5h5" },
  component: { d: "M4 3 1.5 6 4 9M8 3l2.5 3L8 9" },
  image: { d: "M1.5 2.5h9v7h-9zM1.5 8 4 5.5l2 2L7.5 6l3 3" },
  audio: { d: "M1.5 6h1M4 4v4M6 2v8M8 4v4M10.5 6h-1" },
  folder: { d: "M1.5 2.5h3l1 1.5h5v5.5h-9z" },
  // actions
  plus: { d: "M6 2v8M2 6h8" },
  minus: { d: "M2 6h8" },
  close: { d: "M2.5 2.5l7 7M9.5 2.5l-7 7" },
  search: { d: "M5 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM7.5 7.5l3 3" },
  magnet: { d: "M2.5 3.5v2.5a3.5 3.5 0 0 0 7 0V3.5M4.5 3.5v2.5a1.5 1.5 0 0 0 3 0V3.5", extra: [{ d: "M2 1h3v2.5H2zM7 1h3v2.5H7z", fill: true }] },
  trash: { d: "M1.5 3h9M4.5 3V1.5h3V3M2.5 3l.5 7.5h6l.5-7.5" },
  dots: { d: "M2.5 6h1M5.5 6h1M8.5 6h1" },
  fit: { d: "M1.5 4V1.5H4M8 1.5h2.5V4M10.5 8v2.5H8M4 10.5H1.5V8" },
  back: { d: "M7.5 2 3.5 6l4 4" },
  forward: { d: "M4.5 2l4 4-4 4" },
  export: { d: "M6 7.5V1.5M3.5 4 6 1.5 8.5 4M1.5 7v3.5h9V7" },
} satisfies Record<string, Glyph>;

export type StudioIconName = keyof typeof STUDIO_ICONS;


