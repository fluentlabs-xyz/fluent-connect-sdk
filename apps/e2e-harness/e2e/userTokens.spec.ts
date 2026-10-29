import { expect, openDrawer, test } from "./fixtures";

const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

test("adds a User token read from its contract", async ({ signedIn: page, network }) => {
  network.contracts.set(TOKEN.toLowerCase(), { symbol: "E2E", name: "E2E Token", decimals: 18 });
  const drawer = await openDrawer(page);

  await drawer.getByRole("button", { name: "Add token" }).click();
  const form = drawer.getByLabel("Add a token");
  await form.getByLabel("Token contract address").fill(TOKEN);
  await expect(form.getByText("E2E", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Add token" }).click();

  const balances = drawer.getByLabel("Token balances");
  const actions = balances.getByRole("combobox", { name: "Token address actions for E2E" });
  await expect(actions).toBeVisible();
  await expect(balances).toContainText("Added by you");
  expect(network.callsTo("PUT", `/me/tokens/20994/${TOKEN}`).map((c) => c.body)).toEqual([
    { symbol: "E2E", name: "E2E Token", decimals: 18 },
  ]);
});

test("refuses an address with no token behind it", async ({ signedIn: page }) => {
  const drawer = await openDrawer(page);

  await drawer.getByRole("button", { name: "Add token" }).click();
  const form = drawer.getByLabel("Add a token");
  await form.getByLabel("Token contract address").fill(TOKEN);

  await expect(form.getByText(/^No token found at this address\./)).toBeVisible();
  await expect(form.getByRole("button", { name: "Add token" })).toBeDisabled();
});
