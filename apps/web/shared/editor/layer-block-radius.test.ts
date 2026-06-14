import { describe, expect, test } from "bun:test";
import { layerBlockRole, layerHeaderBlockRole, layerBlockOverlapsPrevious } from "./layer-block-radius";

describe("layerBlockRole contiguous-runs", () => {
  test("single selection", () => {
    expect(layerBlockRole(2, [2], "contiguous-runs")).toBe("single");
  });

  test("adjacent pair", () => {
    expect(layerBlockRole(1, [1, 2], "contiguous-runs")).toBe("top");
    expect(layerBlockRole(2, [1, 2], "contiguous-runs")).toBe("bottom");
  });

  test("non-adjacent selections are separate singles", () => {
    expect(layerBlockRole(1, [1, 3], "contiguous-runs")).toBe("single");
    expect(layerBlockRole(3, [1, 3], "contiguous-runs")).toBe("single");
  });

  test("triple contiguous block", () => {
    expect(layerBlockRole(2, [1, 2, 3], "contiguous-runs")).toBe("middle");
  });
});

describe("layerBlockRole single-block", () => {
  test("stacked drag treats scattered indices as one block", () => {
    expect(layerBlockRole(1, [1, 4, 7], "single-block")).toBe("top");
    expect(layerBlockRole(4, [1, 4, 7], "single-block")).toBe("middle");
    expect(layerBlockRole(7, [1, 4, 7], "single-block")).toBe("bottom");
  });
});

describe("layerHeaderBlockRole", () => {
  test("drag block overrides selection role", () => {
    expect(layerHeaderBlockRole(4, [1, 4, 7], [1, 4, 7])).toBe("middle");
    expect(layerHeaderBlockRole(1, [1, 4, 7], [1, 4, 7])).toBe("top");
    expect(layerHeaderBlockRole(7, [1, 4, 7], [1, 4, 7])).toBe("bottom");
  });
});

describe("layerBlockOverlapsPrevious", () => {
  test("overlap only when list-adjacent", () => {
    expect(layerBlockOverlapsPrevious(2, [1, 2], "contiguous-runs")).toBe(true);
    expect(layerBlockOverlapsPrevious(1, [1, 2], "contiguous-runs")).toBe(false);
    expect(layerBlockOverlapsPrevious(4, [1, 4, 7], "single-block")).toBe(false);
  });
});
