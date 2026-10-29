import { test as base, expect, type Page } from "@playwright/test";
import { FakeNetwork } from "./fakeNetwork";

export const EMAIL = "e2e@fluent.test";
/** The code `apps/e2e-harness/src/fakePrivy.tsx` accepts. */
export const LOGIN_CODE = "123456";

type Fixtures = {
  network: FakeNetwork;
  /** The page with the person already signed in, and the drawer still closed. */
  signedIn: Page;
};

export const test = base.extend<Fixtures>({
  network: async ({ page }, use) => {
    const network = new FakeNetwork(page);
    await network.install();
    await use(network);
    expect(network.unhandled, "requests to hosts the test does not fake").toEqual([]);
  },
  signedIn: async ({ page, network }, use) => {
    void network;
    await page.goto(`/?signedInAs=${encodeURIComponent(EMAIL)}`);
    await expect(page.getByRole("button", { name: "0x092A...334A" })).toBeVisible();
    await use(page);
  },
});

/** Opens the drawer from the connect button, signed in. */
export async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "0x092A...334A" }).click();
  // Found by its slot: a sub-page such as Send renames the dialog after its own title.
  const drawer = page.locator("[data-slot=drawer-popup]");
  await expect(drawer).toBeVisible();
  return drawer;
}

export { expect };
