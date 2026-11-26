/** Hit-test the actual offscreen stage, including CSS transforms, stacking,
 * clipping and pointer-events. Translate only its host for a synchronous
 * probe; no paint, input dispatch or reparenting between move and restore. */
export function stageHit(
  root: HTMLElement,
  x: number,
  y: number,
): Element | null {
  const rect = root.getBoundingClientRect();
  if (x < 0 || x >= rect.width || y < 0 || y >= rect.height) return null;
  const host = root.parentElement!;
  const inert = host.inert;
  const translate = host.style.translate;
  const pointerEvents = root.style.pointerEvents;
  try {
    host.inert = false;
    host.style.translate =
      1 - rect.left - x + "px " + (1 - rect.top - y) + "px";
    root.style.pointerEvents = "auto";
    return (
      document
        .elementsFromPoint(1, 1)
        .find((el) => el !== root && root.contains(el)) ?? null
    );
  } finally {
    root.style.pointerEvents = pointerEvents;
    host.style.translate = translate;
    host.inert = inert;
  }
}

/** State, not a replay of clicks. A direct seek into a held press does not
 * depend on having crossed a down edge. Components needing JS can assign
 * the event detail to their view state without toggling or accumulating. */
export class StagePointer {
  private path = new Set<Element>();
  private pressed = false;

  update(root: Element | null, target: Element | null, pressed: boolean) {
    const next = new Set<Element>();
    for (let el = target; el && el !== root; el = el.parentElement)
      next.add(el);
    for (const el of new Set([...this.path, ...next])) {
      const hover = next.has(el);
      if (this.path.has(el) === hover && this.pressed === pressed) continue;
      el.toggleAttribute("data-stage-hover", hover);
      el.toggleAttribute("data-stage-active", hover && pressed);
      el.dispatchEvent(
        new CustomEvent("stagepointerstate", {
          detail: { hover, pressed: hover && pressed },
        }),
      );
    }
    this.path = next;
    this.pressed = pressed;
  }
}

// CSSOM keeps original specificity, source order, grouping and cascade layers.
// Leave escaped colons (e.g. utility class names) and quoted strings alone.
const prepared = new WeakSet<CSSStyleSheet>();
function prepareRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    if (
      rule instanceof CSSStyleRule &&
      /:(hover|active)/i.test(rule.selectorText)
    ) {
      rule.selectorText = rule.selectorText.replace(
        /\\.|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|:(hover|active)(?![a-z0-9_-])/gi,
        (token, state?: string) =>
          state
            ? ":is(" + token + ",[data-stage-" + state.toLowerCase() + "])"
            : token,
      );
    }
    // Tailwind v4 gates hover: behind @media (hover: hover), which is false
    // in headless browsers and in the capture's image context: open it up so
    // the timeline pointer's hover always applies.
    if (rule instanceof CSSMediaRule && /\(\s*hover\s*:\s*hover\s*\)/i.test(rule.media.mediaText)) {
      rule.media.mediaText = "all";
    }
    if ("cssRules" in rule) prepareRules((rule as CSSGroupingRule).cssRules);
  }
}

let revision = 0;
export function prepareStageStyles(): number {
  let changed = false;
  for (const sheet of Array.from(document.styleSheets)) {
    if (prepared.has(sheet)) continue;
    try {
      prepareRules(sheet.cssRules);
      changed = true;
    } catch {
      /* Cross-origin stylesheets cannot be edited. */
    }
    prepared.add(sheet);
  }
  if (changed) revision++;
  return revision;
}

/** Bumped whenever stylesheets were rewritten (DOM capture re-collects CSS). */
export function stageStylesRevision(): number {
  return revision;
}
