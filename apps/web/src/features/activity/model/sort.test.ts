import { describe, expect, it } from "vitest";
import { activityCategoryChoices, sortActivities } from "./sort";
import type { ActivityItem } from "./types";

function item(
  id: string,
  date: string,
  amount?: number,
  overrides: Partial<ActivityItem> = {},
): ActivityItem {
  return {
    id,
    source: "bank",
    date,
    title: id,
    subtitle: "",
    amount,
    currency: "TWD",
    category: "未分類",
    status: "posted",
    ...overrides,
  };
}

const ids = (result: ReturnType<typeof sortActivities>) =>
  result.groups.flatMap((group) => group.items.map((entry) => entry.id));

describe("sortActivities", () => {
  const items = [
    item("old", "2026-09-01", -500),
    item("new", "2026-09-20", 3_000),
    item("mid", "2026-09-10", -12_000),
    item("undated", "", -1),
  ];

  it("groups by date, newest first by default", () => {
    const result = sortActivities(items, "time-desc", {});
    expect(result.grouped).toBe(true);
    expect(result.groups.map((group) => group.dateKey)).toEqual([
      "2026-09-20",
      "2026-09-10",
      "2026-09-01",
      "",
    ]);
  });

  it("reverses dated items for oldest first but keeps undated items last", () => {
    expect(ids(sortActivities(items, "time-asc", {}))).toEqual([
      "old",
      "mid",
      "new",
      "undated",
    ]);
  });

  it("sorts by TWD magnitude in one flat list", () => {
    const withForeign = [
      ...items,
      item("usd", "2026-09-05", -100, { currency: "USD" }),
      item("no-rate", "2026-09-06", -100, { currency: "JPY" }),
      item("no-amount", "2026-09-07"),
    ];
    const result = sortActivities(withForeign, "amount-desc", { USD: 32 });
    expect(result.grouped).toBe(false);
    expect(result.groups).toHaveLength(1);
    expect(ids(result)).toEqual([
      "mid",
      "usd",
      "new",
      "old",
      "undated",
      // Unconvertible amounts go last, newest first.
      "no-amount",
      "no-rate",
    ]);
    expect(ids(sortActivities(withForeign, "amount-asc", { USD: 32 }))).toEqual(
      ["undated", "old", "new", "usd", "mid", "no-amount", "no-rate"],
    );
  });

  it("returns no groups for an empty list", () => {
    expect(sortActivities([], "amount-desc", {}).groups).toEqual([]);
  });
});

describe("activityCategoryChoices", () => {
  it("counts categories by id, most frequent first", () => {
    expect(
      activityCategoryChoices([
        item("a", "2026-09-01", -1, { categoryId: "food", category: "餐飲" }),
        item("b", "2026-09-01", -1, { categoryId: "food", category: "餐飲" }),
        item("c", "2026-09-01", -1, {
          categoryId: "transfer",
          category: "轉帳",
        }),
        item("d", "2026-09-01", -1, { source: "invoice", category: "發票" }),
      ]),
    ).toEqual([
      { id: "food", label: "餐飲", count: 2 },
      { id: "invoice", label: "發票", count: 1 },
      { id: "transfer", label: "轉帳", count: 1 },
    ]);
  });
});
