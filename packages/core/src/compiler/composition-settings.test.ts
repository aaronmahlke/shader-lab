import { describe, expect, it } from "bun:test";
import { normalizeComposition } from "./normalize-composite-layers";
import { DEFAULT_COMPOSITION_SETTINGS, type CompositionSettings } from "../types/animation";
import type { CompositionConfig } from "../types/composition";

describe("composition size settings", () => {
  it("defaults to 1920x1080", () => {
    expect(DEFAULT_COMPOSITION_SETTINGS.width).toBe(1920);
    expect(DEFAULT_COMPOSITION_SETTINGS.height).toBe(1080);
  });

  it("backfills width/height on documents saved before sizes existed", () => {
    const config: CompositionConfig = {
      version: 1,
      layers: [],
      lfos: [],
      assignments: [],
      settings: { duration: 3, fps: 30 } as CompositionSettings,
    };
    normalizeComposition(config);
    expect(config.settings).toEqual({ duration: 3, fps: 30, width: 1920, height: 1080 });
  });

  it("keeps explicit sizes", () => {
    const config: CompositionConfig = {
      version: 1,
      layers: [],
      lfos: [],
      assignments: [],
      settings: { duration: 5, fps: 60, width: 1080, height: 1920 },
    };
    normalizeComposition(config);
    expect(config.settings!.width).toBe(1080);
    expect(config.settings!.height).toBe(1920);
  });
});
