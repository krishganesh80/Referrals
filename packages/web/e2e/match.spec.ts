// What a GP actually sees. The product rules that have to hold on screen, not just in core.

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".card").first()).toBeVisible();
});

test("an unconfirmed field reads as not confirmed, never as a blank or a No", async ({ page }) => {
  const unknowns = page.locator(".fact-unknown");
  await expect(unknowns.first()).toBeVisible();
  for (const text of await unknowns.allInnerTexts()) {
    expect(text.trim()).toContain("not confirmed");
    expect(text.trim()).not.toBe("");
    expect(text.trim()).not.toMatch(/^No$/);
  }
});

test("every result explains its own position", async ({ page }) => {
  const cards = page.locator(".card");
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(cards.nth(i).locator(".reasons li")).not.toHaveCount(0);
  }
});

test("staleness is words, not colour alone", async ({ page }) => {
  const facts = await page.locator(".fact-age").allInnerTexts();
  expect(facts.length).toBeGreaterThan(0);
  for (const text of facts) expect(text).toMatch(/confirmed .+ ago|confirmed today|confirmed yesterday/);
});

test("there is no free-text clinical field anywhere on the page", async ({ page }) => {
  const textInputs = page.locator('input[type="text"], textarea, input:not([type])');
  const count = await textInputs.count();
  for (let i = 0; i < count; i++) {
    // The only free typing on the page is a four-digit postcode.
    await expect(textInputs.nth(i)).toHaveAttribute("id", "postcode");
  }
  await expect(page.locator("textarea")).toHaveCount(0);
});

test("the disclaimer is always present", async ({ page }) => {
  await expect(page.locator(".footer")).toContainText("does not provide clinical advice");
  await expect(page.locator(".footer")).toContainText("referral decision remains yours");
});

test("a self-reported wait says it was ranked conservatively", async ({ page }) => {
  await page.getByRole("button", { name: "Any", exact: true }).first().click();
  const reasons = await page.locator(".reasons li").allInnerTexts();
  const selfReported = reasons.filter((r) => r.includes("self-reported"));
  if (selfReported.length > 0) {
    expect(reasons.some((r) => r === "Self-reported wait ranked conservatively")).toBe(true);
  }
});

test("narrowing the criteria narrows the list", async ({ page }) => {
  const before = await page.locator(".card").count();
  await page.getByLabel("Maximum travel").fill("5");
  const after = await page.locator(".card").count();
  expect(after).toBeLessThanOrEqual(before);
});

test("the empty state names the filters to loosen", async ({ page }) => {
  await page.getByLabel("Patient postcode").fill("3806");
  await page.getByLabel("Maximum travel").fill("5");
  const empty = page.locator(".empty");
  if (await empty.isVisible()) {
    await expect(empty).toContainText("Widen the travel radius");
  }
});

test("reset returns the criteria to their defaults", async ({ page }) => {
  await page.getByLabel("Anatomical region").selectOption("spine");
  await expect(page.getByLabel("Anatomical region")).toHaveValue("spine");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByLabel("Anatomical region")).toHaveValue("knee");
});

test("the same criteria always produce the same order", async ({ page }) => {
  const first = await page.locator(".card .name").allInnerTexts();
  await page.reload();
  await expect(page.locator(".card").first()).toBeVisible();
  expect(await page.locator(".card .name").allInnerTexts()).toEqual(first);
});

test("no position number appears beside any clinician's name", async ({ page }) => {
  // A numbered badge reads as a score for the person. The list is ordered; the order is a
  // statement about the record's match and freshness, and nothing on screen may imply otherwise.
  await expect(page.locator(".rank")).toHaveCount(0);
  for (const name of await page.locator(".card .name").allInnerTexts()) {
    expect(name.trim()).not.toMatch(/^\d+[.)]?\s/);
  }
});

test("the ordering says what it is, and what it is not", async ({ page }) => {
  await expect(page.locator(".page-order")).toContainText("not a measure of skill");
  await expect(page.locator(".footer")).toContainText("does not rate or compare surgeons");
});

test("the reasons block does not claim the position means anything", async ({ page }) => {
  await expect(page.locator(".block-label").filter({ hasText: /how this surgeon matches/i }).first()).toBeVisible();
  await expect(page.getByText("Why this position")).toHaveCount(0);
});
