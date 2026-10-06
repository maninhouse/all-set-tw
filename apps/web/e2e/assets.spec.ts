import { expect, test, type Page } from "@playwright/test";

/** The institution view keeps bills, trades and manual asset workflows. */
async function useInstitutionView(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("taiwan-fin-hub-asset-ledger-view", "institution"),
  );
}

const bankData = {
  accounts: [
    {
      id: "taishin-deposit",
      connectorId: "taishin",
      sourceId: "deposit-812",
      institutionName: "台新銀行",
      bankCode: "812",
      accountName: "薪轉戶",
      accountType: "savings",
      balance: 742_880,
      currency: "TWD",
      asOfAt: "2026-08-08T14:30:00+08:00",
    },
    {
      id: "taishin-card",
      connectorId: "taishin",
      sourceId: "card-812",
      institutionName: "台新銀行",
      bankCode: "812",
      accountName: "台新信用卡",
      accountType: "credit",
      balance: -10_060,
      currency: "TWD",
      paymentDueDate: "2026-08-20",
    },
    {
      id: "obank-usd",
      connectorId: "obank",
      sourceId: "deposit-048",
      institutionName: "王道銀行",
      bankCode: "048",
      accountName: "美元活存",
      accountType: "savings",
      balance: 1_000,
      currency: "USD",
      asOfAt: "2026-08-08T12:00:00+08:00",
    },
    {
      id: "sinopac-jpy",
      connectorId: "sinopac",
      sourceId: "card-jpy",
      institutionName: "永豐銀行",
      bankCode: "807",
      accountName: "永豐信用卡（JPY）",
      accountType: "credit",
      balance: -10_000,
      currency: "JPY",
      paymentDueDate: "2026-10-08",
    },
    {
      id: "unknown-card",
      connectorId: "sinopac",
      sourceId: "card-unknown",
      institutionName: "永豐銀行",
      bankCode: "807",
      accountName: "餘額未知的信用卡",
      accountType: "credit",
      balance: null,
      currency: "TWD",
    },
  ],
  transactions: [],
};

test.beforeEach(async ({ page }) => {
  const manualAssets = [
    {
      id: "home",
      name: "自住房屋",
      category: "real_estate",
      note: null,
      currency: "TWD",
      createdAt: "2026-01-01",
      value: 1_600_000,
      date: "2026-08-03",
    },
  ];
  const manualAssetHistory = new Map([
    ["home", [{ date: "2026-08-03", value: 1_600_000 }]],
  ]);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown;
    if (path === "/api/runtime") body = { demoMode: true };
    else if (path === "/api/bank") body = bankData;
    else if (path === "/api/bank/bills")
      body = [
        {
          id: "sinopac-bill-jpy",
          connectorId: "sinopac",
          accountId: "sinopac-jpy",
          sourceId: "sinopac-bill-jpy",
          billingPeriod: "2026-09",
          statementAmount: 10_000,
          paidAmount: 0,
          isPaid: 0,
          paymentDueDate: "2026-10-08",
          currency: "JPY",
        },
        {
          id: "bill-1",
          connectorId: "taishin",
          accountId: "taishin-card",
          sourceId: "bill-1",
          billingPeriod: "2026-08",
          statementAmount: 10_060,
          isPaid: 0,
          paymentDueDate: "2026-08-20",
          currency: "TWD",
        },
        {
          id: "bill-2",
          connectorId: "taishin",
          accountId: "taishin-card",
          sourceId: "bill-2",
          billingPeriod: "2026-07",
          statementAmount: 8_000,
          isPaid: null,
          paymentDueDate: "2026-07-20",
          currency: "TWD",
        },
      ];
    else if (path === "/api/investments")
      body = [
        {
          id: "0050",
          assetType: "etf",
          symbol: "0050",
          name: "元大台灣50",
          quantity: 1_000,
          marketValue: 925_000,
          currency: "TWD",
          asOfDate: "2026-08-08",
        },
        {
          id: "00878",
          assetType: "etf",
          symbol: "00878",
          name: "國泰永續高股息",
          quantity: 10_000,
          marketValue: 268_800,
          currency: "TWD",
          asOfDate: "2026-08-08",
        },
      ];
    else if (path === "/api/manual-investments") body = [];
    else if (path === "/api/investment-transactions")
      body = [
        {
          id: "trade-1",
          connectorId: "tdcc",
          accountId: "tdcc",
          sourceId: "trade-1",
          name: "元大台灣50",
          assetType: "etf",
          transactionName: "買進",
          tradeDate: "2026-08-01",
          quantity: 100,
          currency: "TWD",
        },
      ];
    else if (path === "/api/manual-assets" && method === "GET")
      body = manualAssets;
    else if (path === "/api/manual-assets" && method === "POST") {
      const input = route.request().postDataJSON();
      const id = `manual-${manualAssets.length + 1}`;
      manualAssets.push({
        id,
        name: input.name,
        category: input.category,
        note: input.note || null,
        currency: input.currency,
        createdAt: "2026-08-09",
        value: input.value,
        date: input.date,
      });
      manualAssetHistory.set(id, [{ date: input.date, value: input.value }]);
      body = { id };
    } else if (
      path.match(/^\/api\/manual-assets\/[^/]+\/history$/) &&
      method === "GET"
    ) {
      const assetId = path.split("/")[3]!;
      body = manualAssetHistory.get(assetId) ?? [];
    } else if (path === "/api/exchange-rates")
      body = [
        { currency: "USD", rateTwd: 32, updatedAt: "2026-08-08" },
        { currency: "JPY", rateTwd: 0.2, updatedAt: "2026-08-08" },
      ];
    else throw new Error(`Unexpected assets E2E request: ${path}`);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
});

test("資產清冊區分待繳與未知金額，並可新增手動資產", async ({ page }) => {
  await useInstitutionView(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/assets");

  await expect(
    page.getByRole("heading", { name: "資產清冊", exact: true }),
  ).toBeVisible();

  const ledger = page
    .locator('section[aria-label="資產清冊"]')
    .filter({ visible: true });
  await expect(ledger.getByText("薪轉戶", { exact: true })).toBeVisible();
  await ledger.getByRole("button", { name: /^永豐銀行/ }).click();
  const jpyCard = ledger
    .getByText("永豐信用卡（JPY）", { exact: true })
    .filter({ visible: true })
    .locator("../..");
  await expect(jpyCard).toContainText("−JP¥10,000");
  await expect(jpyCard).toContainText("帳單待繳");
  await expect(
    ledger.getByText("餘額未知的信用卡", { exact: true }).locator("../.."),
  ).toContainText("剩餘應繳金額未取得");
  await ledger.getByRole("button", { name: /^台新銀行/ }).click();
  await ledger
    .locator("summary")
    .filter({ hasText: "查看信用卡帳單" })
    .first()
    .click();
  await expect(
    ledger.getByText("2026-08 · 期限 2026/8/20 · 待繳"),
  ).toBeVisible();
  await expect(
    ledger.getByText("2026-07 · 期限 2026/7/20 · 狀態未提供"),
  ).toBeVisible();
  await ledger.getByRole("button", { name: /^投資/ }).click();
  await expect(
    page.getByRole("heading", { name: "投資組合", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "交易紀錄", exact: true }).click();
  await expect(page.getByText("買進 · 2026/8/1")).toBeVisible();

  await ledger.getByRole("button", { name: /^其他資產/ }).click();
  await expect(ledger.getByRole("button", { name: /^自住房屋/ })).toBeVisible();
  const manageHistory = ledger.getByRole("button", {
    name: "管理估值歷史",
    exact: true,
  });
  await manageHistory.click();
  await expect(
    ledger.getByRole("heading", { name: "估值歷史", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/assets$/);

  const addAsset = ledger.getByRole("button", {
    name: "新增資產",
    exact: true,
  });
  await addAsset.click();
  const editor = page.getByRole("dialog", { name: "新增資產" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("名稱").fill("緊急預備金");
  await editor.getByLabel("目前估值").fill("300000");
  await editor.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(ledger.getByText("緊急預備金", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/assets$/);
});

test("adds a manual overseas holding from the asset ledger", async ({
  page,
}) => {
  const holdings: unknown[] = [];
  let created: Record<string, unknown> | undefined;
  // Registered after beforeEach, so it takes precedence for this endpoint.
  await page.route("**/api/manual-investments", async (route) => {
    if (route.request().method() === "POST") {
      created = route.request().postDataJSON();
      holdings.push({
        id: "manual-inv:1",
        ...created,
        symbol: "AAPL",
        currency: "USD",
        manualPrice: null,
        manualPriceDate: null,
        quotePrice: 200,
        quoteAt: "2026-08-08T06:00:00.000Z",
        note: null,
        updatedAt: "2026-08-08T06:00:00.000Z",
        price: 200,
        priceSource: "quote",
        marketValue: 2_000,
        quoteStale: false,
        supersededBy: null,
      });
      await route.fulfill({ json: { id: "manual-inv:1" } });
      return;
    }
    await route.fulfill({ json: holdings });
  });
  await useInstitutionView(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/assets");

  const ledger = page
    .locator('section[aria-label="資產清冊"]')
    .filter({ visible: true });
  await ledger.getByRole("button", { name: /^投資/ }).click();
  await ledger.getByRole("button", { name: "新增持倉", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新增持倉" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("代號").fill("aapl");
  await editor.getByLabel("名稱").fill("Apple");
  await editor.getByLabel("股數").fill("10");
  await editor.getByRole("button", { name: "儲存", exact: true }).click();

  await expect(editor).toBeHidden();
  expect(created).toMatchObject({
    broker: "fubon",
    market: "US",
    symbol: "aapl",
    quantity: 10,
    manualPrice: null,
  });
  await expect(
    ledger.getByRole("button", { name: "編輯 AAPL", exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 320]) {
  test(`groups assets by category with collapsible subtotals at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/assets");

    const view = page.getByRole("group", { name: "清冊檢視" });
    await expect(
      view.getByRole("button", { name: "依類別", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const ledger = page
      .locator('section[aria-label="資產清冊"]')
      .filter({ visible: true });
    const category = (label: string) =>
      ledger.getByRole("button", { name: new RegExp(`^${label}`) });
    await expect(category("活存")).toContainText("NT$774,880");
    await expect(category("台股")).toContainText("NT$1,193,800");
    await expect(category("其他資產")).toContainText("NT$1,600,000");
    await expect(category("信用卡負債")).toContainText("−NT$12,060");
    await expect(category("CRYPTO")).toHaveCount(0);

    const tw = category("台股");
    await expect(tw).toHaveAttribute("aria-expanded", "false");
    await expect(ledger.getByText("0050 元大台灣50")).toBeHidden();
    await tw.click();
    await expect(tw).toHaveAttribute("aria-expanded", "true");
    await expect(ledger.getByText("0050 元大台灣50")).toBeVisible();
    await category("活存").click();
    await expect(ledger.getByText("王道銀行 · USD")).toBeVisible();
    await expect(ledger.getByText("US$1,000")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);

    await view.getByRole("button", { name: "依機構", exact: true }).click();
    await expect(
      page
        .locator('section[aria-label="資產清冊"]')
        .filter({ visible: true })
        .getByRole("button", { name: /^台新銀行/ }),
    ).toBeVisible();
    await page.reload();
    await expect(
      view.getByRole("button", { name: "依機構", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });
}

for (const view of ["category", "institution"] as const) {
  test(`hides small accounts and holdings in the ${view} view`, async ({
    page,
  }) => {
    await page.route("**/api/bank", (route) =>
      route.fulfill({
        json: {
          ...bankData,
          accounts: [
            ...bankData.accounts,
            {
              ...bankData.accounts[0],
              id: "taishin-dust",
              sourceId: "dust-812",
              accountName: "零錢戶",
              balance: 3,
            },
          ],
        },
      }),
    );
    await page.addInitScript(
      (value) =>
        localStorage.setItem("taiwan-fin-hub-asset-ledger-view", value),
      view,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/assets");

    const hideSmall = page.getByRole("checkbox", { name: /^隱藏小額項目/ });
    await expect(hideSmall).toBeChecked();
    await expect(page.getByTestId("hide-small-items")).toContainText(
      "隱藏小額項目（1 筆）",
    );
    const ledger = page
      .locator('section[aria-label="資產清冊"]')
      .filter({ visible: true });
    if (view === "category")
      await ledger.getByRole("button", { name: /^活存/ }).click();
    else await ledger.getByRole("button", { name: /^台新銀行/ }).click();
    await expect(ledger.getByText("薪轉戶", { exact: true })).toBeVisible();
    await expect(ledger.getByText("零錢戶", { exact: true })).toBeHidden();

    await hideSmall.uncheck();
    await expect(ledger.getByText("零錢戶", { exact: true })).toBeVisible();
  });
}

for (const width of [1280, 390, 320]) {
  test(`shows time deposit dates separately from sync time at ${width}px`, async ({
    page,
  }) => {
    await useInstitutionView(page);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/bank", (route) =>
      route.fulfill({
        json: {
          accounts: [
            {
              ...bankData.accounts[2],
              id: "td",
              currency: "TWD",
              accountType: "time_deposit",
              accountName: "新資金9個月新台幣定存年利率2.35% · 末四碼 1900",
              balance: 52736,
              openedDate: "2026-09-07",
              maturityDate: "2027-06-07",
              asOfAt: "2026-09-08T01:00:00Z",
            },
            {
              ...bankData.accounts[2],
              id: "legacy-td",
              accountType: "time_deposit",
              accountName: "舊定存",
            },
          ],
          transactions: [],
        },
      }),
    );
    await page.goto("/#/assets");
    const ledger = page
      .locator('section[aria-label="資產清冊"]')
      .filter({ visible: true });
    if (width < 768)
      await ledger.getByRole("button", { name: /王道銀行/ }).click();
    await expect(
      page
        .getByText("起息日 2026/9/7 · 到期日 2027/6/7")
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText("起息日 尚未取得 · 到期日 尚未取得")
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/更新 2026\/9\/8/).filter({ visible: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page.screenshot({
      path: `/tmp/obank-assets-${width}.png`,
      fullPage: true,
    });
  });
}
