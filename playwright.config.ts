import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the deployed services rather than a local stub.
 *
 * The point of these tests is that the LTI exchange works between two
 * independently deployed systems, so pointing them at a mock would test
 * nothing worth testing.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env["PLATFORM_URL"] ?? "https://lti-platform.pretoni.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Uses the Chrome already on the machine rather than downloading a
  // Playwright build. CI installs its own with `npx playwright install`.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env["CI"] ? undefined : "chrome" },
    },
  ],
});
