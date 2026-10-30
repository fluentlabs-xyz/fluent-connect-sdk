import { expect, openDrawer, test } from "./fixtures";
import { SMART_ACCOUNT } from "./fakeNetwork";

const RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

test.describe("Send form", () => {
  test.beforeEach(async ({ signedIn: page }) => {
    const drawer = await openDrawer(page);
    await drawer.getByRole("button", { name: "Send", exact: true }).click();
    await expect(drawer.getByLabel("Send tokens")).toBeVisible();
  });

  test("rejects a recipient that is not an address", async ({ signedIn: page }) => {
    const form = page.getByLabel("Send tokens");
    await form.getByLabel("Recipient address").fill("0x1234");

    const error = "That’s not a valid Fluent address. It should start with 0x.";
    await expect(form.getByText(error)).toBeVisible();
  });

  test("rejects sending to the Fluent ID itself", async ({ signedIn: page }) => {
    const form = page.getByLabel("Send tokens");
    await form.getByLabel("Recipient address").fill(SMART_ACCOUNT);

    await expect(form.getByText("This is the address you are sending from.")).toBeVisible();
  });

  test("rejects an amount above the ETH balance", async ({ signedIn: page }) => {
    const form = page.getByLabel("Send tokens");
    await form.getByLabel("Recipient address").fill(RECIPIENT);
    await form.getByLabel("Amount of ETH to send").fill("2");

    await expect(form.getByText("Amount exceeds your ETH balance.")).toBeVisible();
    await expect(form.getByRole("button", { name: "Send ETH" })).toBeDisabled();
  });

  test("enables Send once the recipient and amount are valid", async ({ signedIn: page }) => {
    const form = page.getByLabel("Send tokens");
    await form.getByLabel("Recipient address").fill(RECIPIENT);
    await form.getByLabel("Amount of ETH to send").fill("0.1");

    await expect(form.getByRole("button", { name: "Send ETH" })).toBeEnabled();
  });
});
