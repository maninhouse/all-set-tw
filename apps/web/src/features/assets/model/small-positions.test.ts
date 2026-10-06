import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSmallAmount,
  readHideSmallItems,
  writeHideSmallItems,
} from "./small-positions";

describe("isSmallAmount", () => {
  const rates = { JPY: 0.2 };

  it("uses 1 USD for USD amounts, including zero", () => {
    expect(isSmallAmount(0, "USD", rates)).toBe(true);
    expect(isSmallAmount(0.99, "USD", rates)).toBe(true);
    expect(isSmallAmount(1, "USD", rates)).toBe(false);
    expect(isSmallAmount(-0.5, "USD", rates)).toBe(true);
  });

  it("uses NT$10 for TWD amounts", () => {
    expect(isSmallAmount(0, "TWD", rates)).toBe(true);
    expect(isSmallAmount(9.99, "TWD", rates)).toBe(true);
    expect(isSmallAmount(10, "TWD", rates)).toBe(false);
  });

  it("converts other currencies and never hides without a rate", () => {
    expect(isSmallAmount(49, "JPY", rates)).toBe(true);
    expect(isSmallAmount(50, "JPY", rates)).toBe(false);
    expect(isSmallAmount(0, "EUR", rates)).toBe(false);
  });
});

describe("hide small items preference", () => {
  // Unit tests run in Node, so the browser storage is stubbed.
  function stubStorage(blocked = false) {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem(key: string) {
        if (blocked) throw new Error("blocked");
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (blocked) throw new Error("blocked");
        values.set(key, value);
      },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to hiding and persists the choice", () => {
    stubStorage();
    expect(readHideSmallItems()).toBe(true);
    writeHideSmallItems(false);
    expect(readHideSmallItems()).toBe(false);
    writeHideSmallItems(true);
    expect(readHideSmallItems()).toBe(true);
  });

  it("falls back to hiding when storage is unavailable", () => {
    stubStorage(true);
    expect(() => writeHideSmallItems(false)).not.toThrow();
    expect(readHideSmallItems()).toBe(true);
  });
});
