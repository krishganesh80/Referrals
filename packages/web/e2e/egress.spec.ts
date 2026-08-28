// Constraint 2, tested rather than asserted.
//
// The claim is that nothing the GP selects leaves their machine. That claim is only worth as much
// as the evidence for it, so this records EVERY network event the page produces while a match is
// running and fails on any request to a host that is not the origin the bundle came from.
//
// It watches four surfaces, because a leak can happen on any of them and three of the four would
// be invisible to a test that only listened for `request`:
//
//   ordinary requests, including ones the browser never completes
//   fetch and XHR started by page script
//   WebSocket opens
//   navigations away from the origin
//
// The dev server's own HMR socket is the one allowed exception, and it is allowed by ORIGIN, not
// by being a WebSocket — a socket to anywhere else still fails.

import { expect, test, type Page } from "@playwright/test";

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1"]);

interface Egress {
  readonly kind: string;
  readonly url: string;
}

function watch(page: Page, sink: Egress[]) {
  const note = (kind: string, url: string) => {
    try {
      const host = new URL(url).hostname;
      if (!ALLOWED_HOSTS.has(host)) sink.push({ kind, url });
    } catch {
      /* data: and blob: URLs carry no host and leave the machine no faster than a string does */
    }
  };
  page.on("request", (r) => note(`request:${r.resourceType()}`, r.url()));
  page.on("websocket", (ws) => note("websocket", ws.url()));
  page.on("framenavigated", (frame) => note("navigation", frame.url()));
}

test("a match produces no request to any host but the bundle origin", async ({ page }) => {
  const egress: Egress[] = [];
  watch(page, egress);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /surgeons matching your criteria/i })).toBeVisible();

  // Drive a real match: change the region, the category, the payer and the postcode.
  await page.getByLabel("Anatomical region").selectOption("shoulder");
  await page.getByRole("button", { name: "Joint replacement" }).click();
  await page.getByRole("button", { name: "TAC", exact: true }).click();
  await page.getByLabel("Patient postcode").fill("3121");
  await page.getByLabel("No-gap fund").selectOption("HCF");
  await page.getByRole("button", { name: "Private" }).click();

  await expect(page.locator(".card").first()).toBeVisible();
  await page.waitForTimeout(500);

  expect(egress, `unexpected egress:\n${egress.map((e) => `  ${e.kind}  ${e.url}`).join("\n")}`).toEqual([]);
});

test("typing criteria never reaches the network at all", async ({ page }) => {
  await page.goto("/");
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  // Everything after first paint should be answered from memory.
  await page.getByLabel("Patient postcode").fill("3144");
  await page.getByRole("button", { name: "Trauma & fracture" }).click();
  await expect(page.locator(".card").first()).toBeVisible();

  const nonHmr = requests.filter((u) => !u.includes("/@vite/") && !u.includes("node_modules"));
  expect(nonHmr, `criteria changes caused requests:\n${nonHmr.join("\n")}`).toEqual([]);
});

test("no outcome ping fires during a match", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") posts.push(`${r.method()} ${r.url()}`);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Nerve compression" }).click();
  await expect(page.locator(".card").first()).toBeVisible();
  await page.waitForTimeout(500);

  // Signals submission is batched weekly and is refused on any cycle where a match is in flight.
  expect(posts).toEqual([]);
});
