import { expect, openDrawer, test } from "./fixtures";

async function openSettings(page: import("@playwright/test").Page) {
  const drawer = await openDrawer(page);
  await drawer.getByRole("combobox", { name: "Account actions" }).click();
  await page.getByRole("option", { name: "Settings" }).click();
  return drawer;
}

test("turning Quick sign off is saved to User settings", async ({ signedIn: page, network }) => {
  const drawer = await openSettings(page);
  const quickSign = drawer.getByRole("switch");
  await expect(quickSign).toBeEnabled();
  await expect(quickSign).toBeChecked();

  await quickSign.click();

  await expect(quickSign).not.toBeChecked();
  await expect.poll(() => network.callsTo("PATCH", "/me/settings").map((c) => c.body)).toEqual([
    { quick_sign: false },
  ]);
});

test("shows Quick sign off for a person whose User settings say so", async ({
  page,
  network,
}) => {
  network.settings.quick_sign = false;
  await page.goto("/?signedInAs=e2e%40fluent.test");
  const drawer = await openSettings(page);

  await expect(drawer.getByRole("switch")).not.toBeChecked();
});

test("choosing a Gas token is saved to User settings", async ({ signedIn: page, network }) => {
  const drawer = await openSettings(page);
  const gasToken = drawer.locator("#gas-payment");
  await expect(gasToken).toBeEnabled();

  await gasToken.click();
  await page.getByRole("option", { name: /USDnr/ }).click();

  await expect(gasToken).toContainText("USDnr");
  await expect.poll(() => network.callsTo("PATCH", "/me/settings").map((c) => c.body)).toEqual([
    { gas_token_symbol: "USDnr" },
  ]);
});
