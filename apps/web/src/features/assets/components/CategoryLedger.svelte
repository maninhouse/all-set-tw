<script lang="ts">
  import { ChevronRight } from "@lucide/svelte";
  import { formatCurrency } from "@/shared/format/financial";
  import type { AssetCategoryGroup, AssetCategoryKey } from "../model/summary";

  let {
    groups,
    grossAssets,
    hiddenIds = new Set(),
  }: {
    groups: AssetCategoryGroup[];
    grossAssets: number;
    /** Small items hidden by the page-level checkbox. */
    hiddenIds?: ReadonlySet<string>;
  } = $props();

  const EXPANDED_KEY = "taiwan-fin-hub-asset-category-expanded";
  let expanded = $state<AssetCategoryKey[]>(readExpanded());

  function readExpanded(): AssetCategoryKey[] {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(EXPANDED_KEY) ?? "[]",
      );
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function toggle(key: AssetCategoryKey) {
    expanded = expanded.includes(key)
      ? expanded.filter((item) => item !== key)
      : [...expanded, key];
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
    } catch {
      // Expanded state is a convenience only.
    }
  }

  function share(group: AssetCategoryGroup) {
    if (group.kind !== "asset" || grossAssets <= 0) return null;
    const percent = (group.subtotalTwd / grossAssets) * 100;
    return `${percent < 0.1 && percent > 0 ? "<0.1" : percent.toFixed(1)}%`;
  }
</script>

<section class="grid min-w-0 border-t border-ink/10" aria-label="資產清冊">
  {#each groups as group (group.key)}
    {@const open = expanded.includes(group.key)}
    {@const items = group.items.filter((item) => !hiddenIds.has(item.id))}
    {@const hiddenCount = group.items.length - items.length}
    {@const panelId = `asset-category-${group.key}`}
    {@const percent = share(group)}
    <div class={open ? "border-b border-ink/15" : "border-b border-ink/8"}>
      <button
        class="grid min-h-[64px] w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 px-1 py-2 text-left transition hover:bg-ink/3 md:px-3"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onclick={() => toggle(group.key)}
      >
        <span class="min-w-0">
          <strong class="block truncate text-sm">{group.label}</strong>
          <small class="mt-1 block truncate text-caption text-subtle">
            {group.items.length} 筆{hiddenCount
              ? `（隱藏 ${hiddenCount}）`
              : ""}{percent ? ` · 佔 ${percent}` : ""}{group.missingCurrencies
              .length
              ? ` · 未含 ${group.missingCurrencies.join("、")}`
              : ""}{group.hasUnknownBalance ? " · 資料不完整" : ""}
          </small>
        </span>
        <strong
          class={`text-right text-sm tabular-nums md:text-base ${group.kind === "liability" ? "text-coral" : "text-steel"}`}
        >
          {formatCurrency(group.subtotalTwd)}
        </strong>
        <ChevronRight
          class={`size-4 text-subtle transition ${open ? "rotate-90" : ""}`}
        />
      </button>
      {#if open}
        <div
          id={panelId}
          class="border-t border-ink/8 pb-3 pl-4 pr-1 md:pr-3"
          data-testid={panelId}
        >
          {#if items.length === 0}
            <p class="py-3 text-sm text-subtle">小額項目已全部隱藏。</p>
          {/if}
          <div class="divide-y divide-border">
            {#each items as item (item.id)}
              <div
                class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
              >
                <div class="min-w-0">
                  <p class="break-words text-sm font-semibold">{item.title}</p>
                  {#if item.detail}
                    <p class="mt-1 text-caption text-subtle">{item.detail}</p>
                  {/if}
                  <p class="mt-1 text-caption text-subtle">{item.subtitle}</p>
                </div>
                <p
                  class={`text-right text-sm font-medium tabular-nums ${group.kind === "liability" ? "text-coral" : "text-steel"}`}
                >
                  {item.unknownAmount
                    ? "金額尚未取得"
                    : item.unpriced
                      ? "尚無報價"
                      : formatCurrency(item.amount, item.currency)}
                </p>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/each}
  <p class="px-1 py-4 text-caption text-subtle md:px-3">
    信用卡帳單、投資交易紀錄、新增手動持倉與其他資產，請切換到「依機構」。
  </p>
</section>
