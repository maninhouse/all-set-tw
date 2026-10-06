import { connectorCatalog } from "@taiwan-fin-hub/shared";
import { describe, expect, it } from "vitest";
import { connectorHint } from "./connector-hints";

describe("connectorHint", () => {
  it("does not ask for a password on connectors without one", () => {
    for (const { id, credentialFields } of Object.values(connectorCatalog)) {
      if ((credentialFields as readonly string[]).includes("password"))
        continue;
      expect(connectorHint(id), id).not.toContain("帳號密碼");
    }
  });

  it("tells Flow Wallet users that only the public address is needed", () => {
    expect(connectorHint("flowwallet")).toContain("公開的 Flow 錢包地址");
    expect(connectorHint("flowwallet")).toContain("私鑰");
  });

  it("keeps the generic credential hint for password connectors", () => {
    expect(connectorHint("linebank")).toContain("帳號密碼");
    expect(connectorHint("linebank")).toContain("儲存憑證");
  });
});
