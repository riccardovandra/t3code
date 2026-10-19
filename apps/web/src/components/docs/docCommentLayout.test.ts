import { describe, expect, it } from "vite-plus/test";

import { layoutCommentCards } from "./docCommentLayout";

const slot = (id: string, anchorTop: number, height = 100) => ({ id, anchorTop, height });

describe("layoutCommentCards", () => {
  it("keeps cards beside their quotes when they fit", () => {
    expect([...layoutCommentCards([slot("b", 400), slot("a", 50)], null)]).toEqual([
      ["a", 50],
      ["b", 400],
    ]);
  });

  it("pushes crowded cards down in quote order", () => {
    const tops = layoutCommentCards([slot("a", 50), slot("b", 60), slot("c", 70)], null);
    expect([...tops.values()]).toEqual([50, 158, 266]);
  });

  it("pins the active card to its quote and moves earlier cards up", () => {
    const tops = layoutCommentCards([slot("a", 200), slot("b", 210)], "b");
    expect(tops.get("b")).toBe(210);
    expect(tops.get("a")).toBe(102);
  });

  it("never places a card above the top edge", () => {
    const tops = layoutCommentCards([slot("a", 10), slot("b", 20)], "b");
    expect(Math.min(...tops.values())).toBe(0);
    expect(tops.get("b")! - tops.get("a")!).toBe(108);
  });
});
