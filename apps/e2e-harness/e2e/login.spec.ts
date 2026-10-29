import { EMAIL, LOGIN_CODE, expect, openDrawer, test } from "./fixtures";

test("signs in with an email code and shows the Fluent ID on the button", async ({
  page,
  network,
}) => {
  void network;
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Wallet" }).click();

  // The sign-in dialog's accessible name follows its step, so it is found by its slot.
  const dialog = page.locator("[role=dialog][data-slot=dialog-content]");
  await dialog.getByRole("button", { name: "Continue with email" }).click();
  await dialog.getByLabel("Email address").fill(EMAIL);
  await dialog.getByRole("button", { name: "Send code" }).click();

  await expect(dialog.getByText(`Enter the code sent to ${EMAIL}.`)).toBeVisible();
  await dialog.getByLabel("Verification code").fill(LOGIN_CODE);
  await dialog.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("button", { name: "0x092A...334A" })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test("refuses a wrong code and keeps the person on the code step", async ({ page, network }) => {
  void network;
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Wallet" }).click();

  const dialog = page.locator("[role=dialog][data-slot=dialog-content]");
  await dialog.getByRole("button", { name: "Continue with email" }).click();
  await dialog.getByLabel("Email address").fill(EMAIL);
  await dialog.getByRole("button", { name: "Send code" }).click();
  await dialog.getByLabel("Verification code").fill("000000");
  await dialog.getByRole("button", { name: "Sign in" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("Invalid code. Please try again.");
  await expect(dialog.getByLabel("Verification code")).toBeVisible();
});

test("signs out from the account menu", async ({ signedIn: page, network }) => {
  const drawer = await openDrawer(page);
  await drawer.getByRole("combobox", { name: "Account actions" }).click();
  await page.getByRole("option", { name: "Disconnect" }).click();

  await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
  // A Fluent ID that never asked for an Auth token holds no refresh credential to revoke.
  expect(network.callsTo("POST", "/auth/revoke")).toEqual([]);
});
