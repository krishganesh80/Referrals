import { defineConfig, devices } from "@playwright/test";

const PORT = 3501;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? "line" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    // A machine with a pinned Chromium (a hosted dev container, say) names it here; CI leaves
    // it unset and uses the browser Playwright installed.
    launchOptions: process.env["PW_CHROMIUM_PATH"] ? { executablePath: process.env["PW_CHROMIUM_PATH"] } : {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
