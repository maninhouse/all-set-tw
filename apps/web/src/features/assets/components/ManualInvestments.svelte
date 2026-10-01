<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { Pencil, Plus, RefreshCw, Trash2 } from "@lucide/svelte";
  import {
    MANUAL_INVESTMENT_BROKERS,
    MANUAL_INVESTMENT_MARKETS,
    type ManualInvestmentBroker,
    type ManualInvestmentMarket,
  } from "@taiwan-fin-hub/shared";
  import Button from "@/shared/ui/Button.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import Textarea from "@/shared/ui/Textarea.svelte";
  import { messageFromError, type ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { manualInvestmentsQuery } from "@/data/investments/queries";
  import type { ManualInvestmentRow } from "@/data/investments/types";
  import {
    formatCurrency,
    formatDate,
    formatDateTime,
    formatNumber,
    todayStr,
  } from "@/shared/format/financial";

  let { api }: { api: ApiClient } = $props();
  const SYMBOL_PLACEHOLDER: Record<ManualInvestmentMarket, string> = {
    US: "AAPL",
    JP: "7203",
    UK: "VWRA",
  };

  const qc = useQueryClient();
  const holdings = createQuery(manualInvestmentsQuery(() => api));

  let adding = $state(false);
  let editing = $state<ManualInvestmentRow | null>(null);
  let deleting = $state<ManualInvestmentRow | null>(null);
  let formError = $state("");
  let editorDialog = $state<HTMLDivElement>();
  let deleteDialog = $state<HTMLDivElement>();
  let returnFocus: HTMLElement | null = null;
  const emptyForm = () => ({
    broker: "fubon" as ManualInvestmentBroker,
    market: "US" as ManualInvestmentMarket,
    symbol: "",
    name: "",
    assetType: "stock" as "stock" | "etf",
    quantity: "",
    manualPrice: "",
    manualPriceDate: todayStr(),
    note: "",
  });
  let form = $state(emptyForm());

  function invalidate() {
    // Prefix also refreshes the merged investments list and its totals.
    qc.invalidateQueries({ queryKey: queryKeys.investments });
  }
  function payload() {
    const manualPrice =
      form.manualPrice === "" ? null : Number(form.manualPrice);
    return {
      broker: form.broker,
      market: form.market,
      symbol: form.symbol.trim(),
      name: form.name.trim(),
      assetType: form.assetType,
      quantity: Number(form.quantity),
      manualPrice,
      manualPriceDate: manualPrice === null ? null : form.manualPriceDate,
      note: form.note.trim() || null,
    };
  }
  const save = createMutation({
    mutationFn: () =>
      editing
        ? api.put(`/api/manual-investments/${editing.id}`, payload())
        : api.post("/api/manual-investments", payload()),
    onSuccess: () => {
      invalidate();
      closeEditor();
    },
    onError: (error) => {
      formError = messageFromError(error);
    },
  });
  const remove = createMutation({
    mutationFn: (id: string) => api.delete(`/api/manual-investments/${id}`),
    onSuccess: () => {
      invalidate();
      closeDelete();
    },
  });
  const refresh = createMutation({
    mutationFn: () => api.post("/api/manual-investments/quotes/refresh"),
    onSuccess: invalidate,
  });

  function rememberFocus() {
    returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  async function focusFirst(dialog: "editor" | "delete") {
    await tick();
    (dialog === "editor" ? editorDialog : deleteDialog)
      ?.querySelector<HTMLElement>(
        dialog === "editor" ? "input, select, textarea" : "button",
      )
      ?.focus();
  }
  function restoreFocus() {
    const target = returnFocus;
    returnFocus = null;
    void tick().then(() => target?.focus());
  }
  function openAdd() {
    rememberFocus();
    editing = null;
    form = emptyForm();
    formError = "";
    adding = true;
    void focusFirst("editor");
  }
  function startEdit(row: ManualInvestmentRow) {
    rememberFocus();
    adding = false;
    editing = row;
    formError = "";
    form = {
      broker: row.broker,
      market: row.market,
      symbol: row.symbol,
      name: row.name,
      assetType: row.assetType,
      quantity: String(row.quantity),
      manualPrice: row.manualPrice === null ? "" : String(row.manualPrice),
      manualPriceDate: row.manualPriceDate ?? todayStr(),
      note: row.note ?? "",
    };
    void focusFirst("editor");
  }
  function closeEditor() {
    adding = false;
    editing = null;
    formError = "";
    restoreFocus();
  }
  function requestDelete(row: ManualInvestmentRow) {
    rememberFocus();
    deleting = row;
    void focusFirst("delete");
  }
  function closeDelete() {
    deleting = null;
    restoreFocus();
  }
  function submit() {
    if (!form.symbol.trim() || !form.name.trim()) {
      formError = "請輸入代號與名稱。";
      return;
    }
    if (!/^[A-Za-z0-9.\-]{1,16}$/.test(form.symbol.trim())) {
      formError =
        "代號只能包含英數字、點或連字號，且不含市場後綴（例如 AAPL、7203）。";
      return;
    }
    if (!(Number(form.quantity) > 0)) {
      formError = "股數必須大於 0。";
      return;
    }
    if (form.manualPrice !== "" && !(Number(form.manualPrice) > 0)) {
      formError = "手動價格必須大於 0，或留空改用自動報價。";
      return;
    }
    formError = "";
    $save.mutate();
  }
  function priceLabel(row: ManualInvestmentRow) {
    if (row.priceSource === "manual")
      return `手動 ${formatDate(row.manualPriceDate ?? undefined)}`;
    if (row.priceSource === "quote")
      return row.quoteStale
        ? `報價過期 ${formatDateTime(row.quoteAt ?? undefined)}`
        : `報價 ${formatDateTime(row.quoteAt ?? undefined)}`;
    return "尚未取得報價";
  }

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleting) closeDelete();
      else if (adding || editing) closeEditor();
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });

  $effect(() => {
    if (!adding && !editing && !deleting) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  });
</script>

<section class="min-w-0 border-t border-ink/10 pt-5" aria-label="手動持倉">
  <div class="flex flex-wrap items-center justify-between gap-3 pb-2">
    <div>
      <h2 class="text-base font-semibold">手動持倉</h2>
      <p class="mt-1 text-caption text-subtle">
        尚未支援同步的海外股。之後券商開始同步同一檔股票時，會以同步資料為準。
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        disabled={$refresh.isPending || ($holdings.data ?? []).length === 0}
        onclick={() => $refresh.mutate()}
        ><RefreshCw class="size-4" />{$refresh.isPending
          ? "更新中…"
          : "更新報價"}</Button
      >
      <Button variant="primary" onclick={openAdd}
        ><Plus class="size-4" />新增持倉</Button
      >
    </div>
  </div>
  {#if $refresh.isError}
    <p class="pb-2 text-sm text-coral" role="alert">
      報價更新失敗：{messageFromError($refresh.error)}
    </p>
  {/if}

  {#if $holdings.isPending}
    <p class="py-6 text-center text-sm text-subtle">正在載入手動持倉。</p>
  {:else if $holdings.isError}
    <p class="py-6 text-center text-sm text-coral">手動持倉暫時無法載入。</p>
  {:else if ($holdings.data ?? []).length === 0}
    <p class="py-6 text-center text-sm text-subtle">尚無手動持倉。</p>
  {:else}
    <div class="divide-y divide-ink/8">
      {#each $holdings.data ?? [] as row (row.id)}
        <div
          class={`flex items-center gap-3 py-3 ${row.supersededBy ? "opacity-60" : ""}`}
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">
              {row.symbol}
              {row.name}
            </p>
            <p class="mt-1 truncate text-caption text-subtle">
              {MANUAL_INVESTMENT_BROKERS[row.broker]} ·
              {MANUAL_INVESTMENT_MARKETS[row.market].label} ·
              {formatNumber(row.quantity)} 股 ·
              {#if row.price !== null}
                {formatCurrency(row.price, row.currency)}（{priceLabel(row)}）
              {:else}
                {priceLabel(row)}
              {/if}
            </p>
            {#if row.supersededBy}
              <p class="mt-1 text-caption font-medium text-steel">
                已由{MANUAL_INVESTMENT_BROKERS[
                  row.supersededBy.connectorId as ManualInvestmentBroker
                ] ?? row.supersededBy.connectorId}同步取代（{formatDate(
                  row.supersededBy.asOfDate,
                )}），不再計入總額，可刪除。
              </p>
            {/if}
          </div>
          <p class="shrink-0 text-right text-sm font-medium tabular-nums">
            {row.marketValue === null
              ? "—"
              : formatCurrency(row.marketValue, row.currency)}
          </p>
          <button
            class="rounded-sm p-1 text-subtle hover:text-steel"
            aria-label={`編輯 ${row.symbol}`}
            onclick={() => startEdit(row)}><Pencil class="size-4" /></button
          ><button
            class="rounded-sm p-1 text-subtle hover:text-coral"
            aria-label={`刪除 ${row.symbol}`}
            onclick={() => requestDelete(row)}><Trash2 class="size-4" /></button
          >
        </div>
      {/each}
    </div>
  {/if}
</section>

{#if adding || editing}<div
    class="fixed inset-0 z-[70] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6"
  >
    <div
      aria-labelledby="manual-investment-editor-title"
      aria-modal="true"
      bind:this={editorDialog}
      class="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl md:max-w-lg md:rounded-2xl"
      role="dialog"
      tabindex="-1"
    >
      <div class="flex items-center justify-between">
        <h2 id="manual-investment-editor-title" class="text-xl font-semibold">
          {editing ? "編輯持倉" : "新增持倉"}
        </h2>
        <Button
          aria-label="關閉"
          class="rounded-full text-xl"
          size="icon"
          variant="ghost"
          onclick={closeEditor}>×</Button
        >
      </div>
      <div class="mt-5 grid grid-cols-2 gap-3">
        <label class="grid gap-1 text-sm"
          >券商<Select bind:value={form.broker}
            >{#each Object.entries(MANUAL_INVESTMENT_BROKERS) as [key, label] (key)}<option
                value={key}>{label}</option
              >{/each}</Select
          ></label
        ><label class="grid gap-1 text-sm"
          >市場<Select bind:value={form.market}
            >{#each Object.entries(MANUAL_INVESTMENT_MARKETS) as [key, market] (key)}<option
                value={key}>{market.label}（{market.currency}）</option
              >{/each}</Select
          ></label
        ><label class="grid gap-1 text-sm"
          >代號<Input
            required
            placeholder={SYMBOL_PLACEHOLDER[form.market]}
            bind:value={form.symbol}
          /></label
        ><label class="grid gap-1 text-sm"
          >類型<Select bind:value={form.assetType}
            ><option value="stock">股票</option><option value="etf">ETF</option
            ></Select
          ></label
        ><label class="col-span-2 grid gap-1 text-sm"
          >名稱<Input required bind:value={form.name} /></label
        ><label class="col-span-2 grid gap-1 text-sm"
          >股數<Input
            required
            type="number"
            min="0"
            step="any"
            bind:value={form.quantity}
          /></label
        ><label class="grid gap-1 text-sm"
          >手動價格（{MANUAL_INVESTMENT_MARKETS[form.market]
            .currency}，選填）<Input
            type="number"
            min="0"
            step="any"
            placeholder="留空使用自動報價"
            bind:value={form.manualPrice}
          /></label
        ><label class="grid gap-1 text-sm"
          >價格日期<Input
            type="date"
            disabled={form.manualPrice === ""}
            bind:value={form.manualPriceDate}
          /></label
        ><label class="col-span-2 grid gap-1 text-sm"
          >備註<Textarea rows="2" bind:value={form.note} /></label
        >
        {#if formError}<p
            class="col-span-2 text-sm font-medium text-coral"
            role="alert"
          >
            {formError}
          </p>{/if}
      </div>
      <div class="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" onclick={closeEditor}>取消</Button><Button
          disabled={$save.isPending}
          onclick={submit}>{$save.isPending ? "儲存中…" : "儲存"}</Button
        >
      </div>
    </div>
  </div>{/if}

{#if deleting}<div
    class="fixed inset-0 z-[80] flex items-center justify-center bg-ink/45 p-5"
  >
    <div
      aria-labelledby="manual-investment-delete-title"
      aria-modal="true"
      bind:this={deleteDialog}
      class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
      role="dialog"
      tabindex="-1"
    >
      <h2 id="manual-investment-delete-title" class="text-lg font-semibold">
        確定刪除持倉？
      </h2>
      <p class="mt-2 text-sm leading-6 text-subtle">
        「{deleting.symbol}
        {deleting.name}」將永久刪除，無法復原。
      </p>
      <div class="mt-5 grid grid-cols-2 gap-3">
        <Button
          variant="secondary"
          disabled={$remove.isPending}
          onclick={closeDelete}>取消</Button
        ><Button
          class="bg-coral text-white hover:bg-coral/90"
          disabled={$remove.isPending}
          onclick={() => deleting && $remove.mutate(deleting.id)}
          >{$remove.isPending ? "刪除中…" : "確認刪除"}</Button
        >
      </div>
    </div>
  </div>{/if}
