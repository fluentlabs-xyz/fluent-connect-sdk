import { expect, openDrawer, test } from "./fixtures";

test("lists the Fluent ID's balances when the drawer opens", async ({ signedIn: page }) => {
  const drawer = await openDrawer(page);
  const balances = drawer.getByLabel("Token balances");

  // A whole balance is shown as is; a fractional one is rounded, with the exact figure in its
  // label.
  await expect(balances.getByLabel("ETH balance: 1.5")).toBeVisible();
  await expect.poll(() => balances.innerText()).toMatch(/USDnr[\s\S]*\$250\s+250\b/);
  await expect.poll(() => balances.innerText()).toMatch(/BLEND[\s\S]*\$50\s+1,000\b/);
});

test("opens the Bridge with the Fluent ID as the deposit destination", async ({
  signedIn: page,
}) => {
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Bridge", exact: true }).click();

  await expect(drawer.getByLabel("Amount to deposit in ETH")).toBeVisible();
  await expect(drawer.getByText("Deposit to")).toBeVisible();
  await expect(drawer.getByText("0x092A...334A")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Connect a wallet" })).toBeVisible();

  await drawer.getByRole("button", { name: "Back" }).click();
  await expect(drawer.getByRole("button", { name: "Bridge", exact: true })).toBeVisible();
});
