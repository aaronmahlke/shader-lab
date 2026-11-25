/** Studio kitchen navigation (like Dokedu UI's playground): groups of component pages. */
export const KITCHEN_GROUPS: { label: string; pages: { slug: string; title: string }[] }[] = [
  { label: "Foundations", pages: [{ slug: "colors", title: "Colors" }, { slug: "typography", title: "Typography" }, { slug: "icons", title: "Icons" }] },
  { label: "Actions", pages: [{ slug: "button", title: "Button" }, { slug: "segmented", title: "Segmented" }] },
  { label: "Values", pages: [{ slug: "value", title: "Value box" }, { slug: "knob", title: "Knob" }, { slug: "input", title: "Input" }, { slug: "select", title: "Select" }] },
  { label: "Navigation", pages: [{ slug: "tabs", title: "Tabs" }, { slug: "list-row", title: "List row" }] },
  { label: "Layout", pages: [{ slug: "tile", title: "Tile" }, { slug: "section", title: "Section" }, { slug: "field", title: "Field" }] },
];

export function useKitchen() {
  const route = useRoute();
  const sequence = KITCHEN_GROUPS.flatMap((g) => g.pages);
  const slug = computed(() => route.path.replace(/^\/kitchen\/?/, ""));
  const index = computed(() => sequence.findIndex((p) => p.slug === slug.value));
  return {
    groups: KITCHEN_GROUPS,
    slug,
    previous: computed(() => sequence[index.value - 1]),
    next: computed(() => sequence[index.value + 1]),
  };
}
