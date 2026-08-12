/**
 * Adapted from evlog's Render labs (apps/lab/app/utils/lab/dom-texture.ts),
 * MIT (c) Hugo Richard - https://github.com/HugoRCD/evlog
 *
 * Captures a live DOM element to a decoded image. The route is
 * `<svg><foreignObject>` -> `data:` URL -> `<img>`. An SVG rendered as an
 * image is a sealed document that cannot fetch anything, so every external
 * resource the element depends on (stylesheets, web fonts, images, canvases)
 * has to be inlined before serialization.
 *
 * The expensive half of that (reading every stylesheet, base64-ing every
 * font) is done once per document and cached. Per capture only the subtree is
 * re-serialized, which keeps this viable for animation frames rather than
 * one-off screenshots.
 */

export type CapturedFrame = {
  /** Decoded and ready for texImage2D. */
  image: HTMLImageElement;
  /** Layout size of the captured element in CSS px (the image itself is scale x larger). */
  cssWidth: number;
  cssHeight: number;
};

export type DomCaptureOptions = {
  /** Supersample factor for the raster. Default 2. */
  scale?: number;
};

const DEFAULT_SCALE = 2;

const FONT_MIME: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** Cap the inlined font payload; a runaway family would stall every capture. */
const MAX_FONT_BYTES = 6 * 1024 * 1024;

/**
 * The image must load from a `data:` URL, never a `blob:` one.
 *
 * Chrome treats an SVG image containing a `<foreignObject>` as not
 * origin-clean when it is served from a blob URL, so every downstream read
 * (`texImage2D`, `getImageData`, `toDataURL`) throws. The identical bytes as
 * a `data:` URL are clean; it is the URL scheme that decides, not the content.
 */
const DATA_PREFIX = "data:image/svg+xml;charset=utf-8,";

/**
 * Wrap the stylesheet in a CDATA section. The SVG is parsed as XML, where a
 * bare `&` or `<` inside CSS is a fatal parse error. CDATA suspends that; the
 * only sequence left to neutralize is the CDATA terminator itself.
 */
function styleElement(css: string): string {
  return `<style><![CDATA[${css.replace(/]]>/g, "]]&gt;")}]]></style>`;
}

async function fetchAsDataUrl(url: string, mime?: string): Promise<string | null> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > MAX_FONT_BYTES) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        // FileReader infers the MIME from the response, which is often
        // `application/octet-stream` for fonts served by a dev server.
        resolve(mime ? result.replace(/^data:[^;]*/, `data:${mime}`) : result);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Read every stylesheet in the document into one string.
 *
 * `cssRules` throws on cross-origin sheets, so those are re-fetched by href,
 * and skipped entirely when that fails too: a missing third-party sheet is
 * better than no capture at all.
 */
async function collectCss(): Promise<string> {
  const chunks: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      let text = "";
      for (const rule of Array.from(rules)) text += `${rule.cssText}\n`;
      chunks.push(text);
    } catch {
      if (!sheet.href) continue;
      try {
        const response = await fetch(sheet.href, { credentials: "same-origin" });
        if (response.ok) chunks.push(await response.text());
      } catch {
        // Unreadable and unfetchable; nothing left to try.
      }
    }
  }

  return chunks.join("\n");
}

/** Replace every `url(...)` inside `@font-face` blocks with a data URI. */
async function inlineFonts(css: string): Promise<string> {
  const seen = new Map<string, string | null>();
  const faces = css.match(/@font-face\s*\{[^}]*\}/g);
  if (!faces) return css;

  const urls = new Set<string>();
  for (const face of faces) {
    for (const match of face.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      const url = match[2];
      if (url && !url.startsWith("data:")) urls.add(url);
    }
  }

  await Promise.all(
    Array.from(urls).map(async (url) => {
      const absolute = new URL(url, document.baseURI);
      // A cross-origin font cannot be read into a data URI; the capture falls
      // back to whatever the family's next fallback is.
      if (absolute.origin !== location.origin) {
        seen.set(url, null);
        return;
      }
      const extension = absolute.pathname.split(".").pop()?.toLowerCase() ?? "";
      seen.set(url, await fetchAsDataUrl(absolute.href, FONT_MIME[extension]));
    }),
  );

  return css.replace(/@font-face\s*\{[^}]*\}/g, (face) =>
    face.replace(/url\((['"]?)([^'")]+)\1\)/g, (original: string, _quote: string, url: string) => {
      const inlined = seen.get(url);
      return inlined ? `url("${inlined}")` : original;
    }),
  );
}

/**
 * Copy the document's custom properties onto the capture wrapper.
 *
 * Design tokens are declared on `:root`, but inside the foreignObject the
 * root is the `<svg>`, so `:root` rules never match the cloned subtree and
 * every `var(--x)` resolves to nothing. Snapshotting the computed values onto
 * the wrapper puts them back in scope.
 */
function collectCustomProperties(): string {
  const declarations: string[] = [];
  for (const element of [document.documentElement, document.body]) {
    const computed = getComputedStyle(element);
    for (const name of Array.from(computed)) {
      if (!name.startsWith("--")) continue;
      const value = computed.getPropertyValue(name);
      if (value) declarations.push(`${name}:${value}`);
    }
  }
  return declarations.join(";");
}

/** `strokeDashoffset` -> `stroke-dashoffset`, keeping vendor prefixes intact. */
function toKebab(property: string): string {
  const kebab = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return /^(webkit|moz|ms|o)-/.test(kebab) ? `-${kebab}` : kebab;
}

/**
 * Freeze in-flight animations at their current value.
 *
 * A clone carries the *target* of an animation, not its current frame: a bar
 * whose width is set to its final value and interpolated by a CSS transition
 * clones as already full, so every captured frame shows the animation done.
 * Computed style, unlike the clone, reflects where the interpolation actually
 * is. Only properties some animation is currently touching get copied, so
 * this stays a handful of declarations per capture, not a full style dump.
 */
function bakeAnimatedStyles(source: HTMLElement, clone: HTMLElement): void {
  const animations = source.getAnimations({ subtree: true });
  if (!animations.length) return;

  const properties = new Map<Element, Set<string>>();
  for (const animation of animations) {
    const { effect } = animation;
    if (!(effect instanceof KeyframeEffect)) continue;
    const { target, pseudoElement } = effect;
    // A pseudo-element has no node in the clone to carry an inline style.
    if (!target || pseudoElement) continue;

    const set = properties.get(target) ?? new Set<string>();
    for (const frame of effect.getKeyframes()) {
      for (const key of Object.keys(frame)) {
        if (key === "offset" || key === "computedOffset" || key === "easing" || key === "composite") continue;
        set.add(toKebab(key));
      }
    }
    properties.set(target, set);
  }
  if (!properties.size) return;

  // `cloneNode(true)` preserves document order, so the two flat lists line up
  // index for index. This must run before any node substitution (canvas ->
  // img), which would break that correspondence.
  const sourceNodes = [source, ...Array.from(source.querySelectorAll("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];

  sourceNodes.forEach((node, index) => {
    const animated = properties.get(node);
    const target = cloneNodes[index];
    if (!animated || !(target instanceof HTMLElement || target instanceof SVGElement)) return;
    const computed = getComputedStyle(node);
    for (const property of animated) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  });
}

/**
 * Swap non-serializable nodes in the clone for static equivalents.
 *
 * A `<canvas>` carries its pixels in a context, not in markup, so a clone
 * comes out blank; its current contents have to be baked into an `<img>`.
 * Same for images pointing at URLs the sealed SVG will not be allowed to
 * fetch.
 */
async function inlineNodes(
  source: HTMLElement,
  clone: HTMLElement,
  cache: Map<string, string | null>,
): Promise<void> {
  const sourceCanvases = Array.from(source.querySelectorAll("canvas"));
  const cloneCanvases = Array.from(clone.querySelectorAll("canvas"));
  cloneCanvases.forEach((canvasClone, index) => {
    const original = sourceCanvases[index];
    if (!original) return;
    const replacement = document.createElement("img");
    try {
      replacement.src = original.toDataURL();
    } catch {
      // Tainted canvas; leave a transparent hole rather than failing the frame.
      return;
    }
    replacement.setAttribute("style", canvasClone.getAttribute("style") ?? "");
    replacement.style.width = `${original.clientWidth || original.width}px`;
    replacement.style.height = `${original.clientHeight || original.height}px`;
    canvasClone.replaceWith(replacement);
  });

  const images = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      if (!cache.has(src)) {
        const absolute = new URL(src, document.baseURI);
        cache.set(src, absolute.origin === location.origin ? await fetchAsDataUrl(absolute.href) : null);
      }
      const inlined = cache.get(src);
      if (inlined) image.setAttribute("src", inlined);
      else image.removeAttribute("src");
    }),
  );
}

/**
 * The stylesheet payload, shared by every session.
 *
 * Reading each sheet and base64-ing every font is the expensive half of a
 * capture and the result is identical for every element, so it is resolved
 * once per document. A change in `document.styleSheets.length` (new component
 * styles, HMR, a theme swap) invalidates it.
 */
let stylePromise: Promise<string> | null = null;
let encodedStyle: string | null = null;
let styleSheetCount = -1;
const imageCache = new Map<string, string | null>();

function styles(): Promise<string> {
  if (stylePromise && document.styleSheets.length !== styleSheetCount) {
    stylePromise = null;
    encodedStyle = null;
    imageCache.clear();
  }
  if (!stylePromise) {
    styleSheetCount = document.styleSheets.length;
    stylePromise = collectCss().then(inlineFonts);
  }
  return stylePromise;
}

/** Await the decode; `decode()` can reject where a plain load still succeeds. */
async function loadAndDecode(image: HTMLImageElement): Promise<void> {
  try {
    await image.decode();
    return;
  } catch {
    // Fall back to load events before giving up.
  }
  if (image.complete) {
    if (image.naturalWidth > 0) return;
    throw new Error("dom-capture: the SVG frame failed to decode.");
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("dom-capture: the SVG frame failed to load."));
  });
}

/** One session per captured element/layer. Holds the markup-dedupe cache. */
export class DomCaptureSession {
  private readonly scale: number;
  private lastMarkup = "";

  constructor(options: DomCaptureOptions = {}) {
    this.scale = options.scale ?? DEFAULT_SCALE;
  }

  /**
   * Returns "unchanged" when the element's serialized markup is identical to
   * the previous capture, null when the element has no layout box, else a frame.
   */
  async capture(element: HTMLElement): Promise<CapturedFrame | "unchanged" | null> {
    // Guard for SSR callers; there is nothing to lay out without a document.
    if (typeof document === "undefined") return null;

    const rect = element.getBoundingClientRect();
    const cssWidth = Math.ceil(rect.width);
    const cssHeight = Math.ceil(rect.height);
    if (cssWidth < 1 || cssHeight < 1) return null;

    const css = await styles();

    const clone = element.cloneNode(true) as HTMLElement;
    bakeAnimatedStyles(element, clone);
    await inlineNodes(element, clone, imageCache);

    // Class names from <html> and <body> carry the color scheme (`.dark`) and
    // any font classes, which class-based rules in the payload need to match.
    const hostClasses = `${document.documentElement.className} ${document.body.className}`.trim();
    const bodyStyle = getComputedStyle(document.body);

    const wrapper = document.createElement("div");
    wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrapper.setAttribute("class", hostClasses);
    wrapper.setAttribute(
      "style",
      [
        collectCustomProperties(),
        `width:${cssWidth}px`,
        `height:${cssHeight}px`,
        `font-family:${bodyStyle.fontFamily}`,
        `color:${bodyStyle.color}`,
        "background:transparent",
      ].join(";"),
    );
    wrapper.appendChild(clone);

    const serialized = new XMLSerializer().serializeToString(wrapper);
    const pixelWidth = Math.round(cssWidth * this.scale);
    const pixelHeight = Math.round(cssHeight * this.scale);

    // The foreignObject is laid out in CSS pixels while the SVG rasterizes at
    // scale x, so the viewBox does the upscaling: layout stays identical and
    // only the rasterization gets denser.
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${cssWidth} ${cssHeight}">`;
    const body = `<foreignObject x="0" y="0" width="${cssWidth}" height="${cssHeight}">${serialized}</foreignObject></svg>`;

    // When the markup has not moved, the raster cannot have either. Skipping
    // the decode (and the caller's upload) is most of the per-frame cost, and
    // it is pure waste on a frame that is identical to the last one.
    const signature = head + body;
    if (signature === this.lastMarkup) return "unchanged";
    this.lastMarkup = signature;

    // `encodeURIComponent` maps each character independently, so encoding the
    // parts separately and joining them is identical to encoding the whole.
    // That lets the stylesheet, by far the largest and the only constant
    // part, be encoded once per document instead of on every capture.
    encodedStyle ??= encodeURIComponent(styleElement(css));

    const image = new Image();
    image.decoding = "sync";
    image.width = pixelWidth;
    image.height = pixelHeight;
    image.src = DATA_PREFIX + encodeURIComponent(head) + encodedStyle + encodeURIComponent(body);
    await loadAndDecode(image);

    return { image, cssWidth, cssHeight };
  }

  /** Drop the dedupe cache so the next capture always yields a frame. */
  reset(): void {
    this.lastMarkup = "";
  }
}
