import { activityAmountTwd } from "./chart";
import {
  activityDateKey,
  compareActivityItems,
  groupActivitiesByDate,
  type ActivityDateGroup,
} from "./list";
import type { ActivityItem } from "./types";

export type ActivitySort =
  "time-desc" | "time-asc" | "amount-desc" | "amount-asc";

export const ACTIVITY_SORT_OPTIONS: ReadonlyArray<{
  value: ActivitySort;
  label: string;
}> = [
  { value: "time-desc", label: "時間：新到舊" },
  { value: "time-asc", label: "時間：舊到新" },
  { value: "amount-desc", label: "金額：大到小" },
  { value: "amount-asc", label: "金額：小到大" },
];

export interface SortedActivities {
  /** Time sorts keep the date headers; amount sorts are one flat list. */
  grouped: boolean;
  groups: ActivityDateGroup[];
}

/**
 * Amount sorts compare the TWD magnitude, so large income and large expenses
 * both rank high; use the flow filter to look at one side only. Items without
 * a convertible amount always go last.
 */
export function sortActivities(
  items: ActivityItem[],
  sort: ActivitySort,
  rates: Record<string, number>,
): SortedActivities {
  if (sort === "time-desc" || sort === "time-asc") {
    const dated = items.filter((item) => activityDateKey(item));
    const undated = items.filter((item) => !activityDateKey(item));
    const direction = sort === "time-desc" ? 1 : -1;
    const sorted = [
      ...dated.sort(
        (left, right) => direction * compareActivityItems(left, right),
      ),
      ...undated.sort(compareActivityItems),
    ];
    return { grouped: true, groups: groupActivitiesByDate(sorted) };
  }

  const magnitude = (item: ActivityItem) => {
    const amount = activityAmountTwd(item, rates);
    return amount == null ? undefined : Math.abs(amount);
  };
  const direction = sort === "amount-desc" ? -1 : 1;
  const sorted = [...items].sort((left, right) => {
    const leftAmount = magnitude(left);
    const rightAmount = magnitude(right);
    if (leftAmount == null || rightAmount == null) {
      if (leftAmount != null) return -1;
      if (rightAmount != null) return 1;
    } else if (leftAmount !== rightAmount) {
      return direction * (leftAmount - rightAmount);
    }
    return compareActivityItems(left, right);
  });
  return {
    grouped: false,
    groups: sorted.length ? [{ dateKey: "", items: sorted }] : [],
  };
}

/** Categories present in the given items, most frequent first. */
export function activityCategoryChoices(items: ActivityItem[]) {
  const counts = new Map<
    string,
    { id: string; label: string; count: number }
  >();
  for (const item of items) {
    const id = item.categoryId ?? item.source;
    const current = counts.get(id);
    if (current) current.count += 1;
    else counts.set(id, { id, label: item.category, count: 1 });
  }
  return [...counts.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.label.localeCompare(right.label, "zh-TW"),
  );
}
