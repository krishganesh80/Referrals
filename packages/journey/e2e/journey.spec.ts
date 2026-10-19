// What a person actually gets. The rules that have to hold on screen, not just in the modules:
// nothing is chosen without a Yes, the direct path is the whole product, the demo label is never
// out of sight, and the page talks to nobody.

import { expect, test, type Page } from "@playwright/test";

async function pushUntilPrompt(page: Page, maxSeconds = 40) {
  const stage = page.locator(".stage");
  await stage.focus();
  await page.keyboard.down("ArrowRight");
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: maxSeconds * 1000 });
  await page.keyboard.up("ArrowRight");
}

test.describe("the ride", () => {
  test("a signpost stops the rider and asks; only Yes records a choice", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start the ride" }).click();
    await expect(page.locator(".chips-empty")).toBeVisible();

    await pushUntilPrompt(page);
    await expect(page.getByRole("dialog")).toContainText("video or phone");
    // Rolling up to the signpost chose nothing.
    await expect(page.locator(".chip")).toHaveCount(0);

    await page.getByRole("button", { name: "Not for me" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator(".chip")).toHaveCount(0);

    await pushUntilPrompt(page);
    await expect(page.getByRole("dialog")).toContainText("bulk billed");
    await page.getByRole("button", { name: "Yes, this matters" }).click();
    await expect(page.locator(".chip")).toHaveCount(1);
    await expect(page.locator(".chip").first()).toContainText("Bulk billed");

    // Reversible: the chip's remove button takes it back.
    await page.getByRole("button", { name: "Remove Bulk billed" }).click();
    await expect(page.locator(".chip")).toHaveCount(0);
  });

  test("the whole ride reaches the clearing and the results, with the keyboard alone", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Start the ride" }).click();
    const answers = ["Yes, this matters", "Not for me", "Yes, this matters", "Not for me", "Yes, this matters"];
    for (const name of answers) {
      await pushUntilPrompt(page, 60);
      await page.getByRole("button", { name }).click();
    }
    await pushUntilPrompt(page, 60);
    await expect(page.getByRole("dialog")).toContainText("language");
    await page.getByRole("button", { name: /^Yes, / }).click();
    await expect(page.locator(".chip")).toHaveCount(4);

    const stage = page.locator(".stage");
    await stage.focus();
    await page.keyboard.down("ArrowRight");
    await expect(page.getByRole("button", { name: "See who fits" })).toBeVisible({ timeout: 90_000 });
    await page.keyboard.up("ArrowRight");
    await page.getByRole("button", { name: "See who fits" }).click();
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(page.locator(".demo-banner")).toBeVisible();
  });

  test("the on-screen Push button moves the rider by touch", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Start the ride" }).click();
    const push = page.getByRole("button", { name: "Push" });
    const box = (await push.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 40_000 });
    await page.mouse.up();
  });
});

test.describe("the direct path", () => {
  test("choosing directly reaches the same results, and can be changed and restarted", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Skip the ride — choose directly" }).click();
    await page.getByLabel(/bulk billed/).check();
    await page.getByLabel(/language other than English/).check();
    await page.getByLabel("Which language").selectOption("Greek");
    await page.getByRole("button", { name: "See who fits" }).click();

    await expect(page.locator(".demo-banner")).toBeVisible();
    await expect(page.locator(".chip")).toHaveCount(2);
    const fits = page.locator(".card:not(.card-close)");
    await expect(fits).toHaveCount(1);
    await expect(fits.first()).toContainText("Dr Pip Kunzea");
    // Every card explains itself with chosen things only.
    for (const card of await page.locator(".card").all()) {
      await expect(card.locator(".tag")).toHaveText("Demo");
      await expect(card.locator(".reasons li")).not.toHaveCount(0);
    }
    await expect(page.locator(".card-close .missing").first()).toBeVisible();

    await page.getByRole("button", { name: "Change what matters" }).click();
    await expect(page.getByLabel(/bulk billed/)).toBeChecked();
    await page.getByLabel(/bulk billed/).uncheck();
    await page.getByRole("button", { name: "See who fits" }).click();
    await expect(page.locator(".card:not(.card-close)")).toHaveCount(2);

    await page.getByRole("button", { name: "Start again" }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("mountain");
  });

  test("reduced motion removes the ride and keeps everything else", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Start the ride" })).toHaveCount(0);
    await page.getByRole("button", { name: "Choose what matters" }).click();
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "See who fits" }).click();
    await expect(page.locator(".card")).toHaveCount(10);
  });

  test("the switch in the masthead does the same without a system setting", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Reduce motion" }).click();
    await expect(page.getByRole("button", { name: "Start the ride" })).toHaveCount(0);
  });
});

test.describe("the page itself", () => {
  test("makes no network request to any other host, and logs no error", async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const foreign: string[] = [];
    const errors: string[] = [];
    page.on("request", (req) => {
      if (!req.url().startsWith(origin)) foreign.push(req.url());
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Start the ride" }).click();
    await pushUntilPrompt(page);
    await page.getByRole("button", { name: "Yes, this matters" }).click();
    await page.getByRole("button", { name: "Skip the ride — choose directly" }).click();
    await page.getByRole("button", { name: "See who fits" }).click();
    await expect(page.locator(".card").first()).toBeVisible();
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("every link off the page goes to the company site", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Skip the ride — choose directly" }).click();
    await page.getByRole("button", { name: "See who fits" }).click();
    for (const href of await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      expect(href.startsWith("https://wattlehealth.vercel.app/")).toBe(true);
    }
  });

  test("nothing is clipped at a phone width", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await page.getByRole("button", { name: "Start the ride" }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Push" })).toBeVisible();
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow2).toBe(false);
  });
});
