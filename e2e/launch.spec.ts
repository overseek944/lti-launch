import { expect, test } from "@playwright/test";

const TOOL = process.env["TOOL_URL"] ?? "https://lti-launch.pretoni.com";

test.describe("LTI 1.3 launch, end to end across two deployed services", () => {
  test("a student launches from the platform and reaches the activity", async ({ page }) => {
    await page.goto("/platform/");
    await expect(page.getByRole("heading", { name: "Reference LTI 1.3 Platform" })).toBeVisible();

    // The whole OIDC dance happens here: platform -> tool login -> platform
    // auth -> signed id_token form-posted back to the tool.
    await page.getByRole("button", { name: /Aaliyah Okafor/ }).click();
    await page.waitForURL(new RegExp(`${TOOL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/lti/launch`));

    await expect(page.getByRole("heading", { name: "Slope and intercept" })).toBeVisible();
    await expect(page.getByText("Signed in as Aaliyah Okafor")).toBeVisible();
  });

  test("the activity is operable by keyboard alone", async ({ page }) => {
    await page.goto("/platform/");
    await page.getByRole("button", { name: /Mateo Bennett/ }).click();
    await page.waitForURL(/\/lti\/launch/);

    const slope = page.getByLabel(/Slope/);
    await slope.focus();
    const before = await slope.inputValue();

    // Arrow keys make a fine adjustment.
    await page.keyboard.press("ArrowRight");
    expect(await slope.inputValue()).not.toBe(before);

    // Page Up is the documented large step. Without it, crossing a range of
    // -5 to 5 in 0.1 increments is a hundred key presses.
    const beforeBig = Number(await slope.inputValue());
    await page.keyboard.press("PageUp");
    expect(Number(await slope.inputValue())).toBeGreaterThan(beforeBig);
  });

  test("state is announced in a live region, not just drawn", async ({ page }) => {
    await page.goto("/platform/");
    await page.getByRole("button", { name: /Mateo Bennett/ }).click();
    await page.waitForURL(/\/lti\/launch/);

    const status = page.locator("#status");
    await expect(status).toContainText(/passes through \d of \d points/);

    // The announcement carries meaning rather than a bare number.
    await page.getByLabel(/Slope/).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#live")).toContainText(/Slope .*y-intercept .*Passes through/, { timeout: 5000 });
  });

  test("the graph has a text alternative carrying the same information", async ({ page }) => {
    await page.goto("/platform/");
    await page.getByRole("button", { name: /Mateo Bennett/ }).click();
    await page.waitForURL(/\/lti\/launch/);

    // Not alt="chart". A real description, plus a data table.
    await expect(page.locator("#graphdesc")).toContainText(/slope .* y-intercept/);
    const rows = page.locator("#tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText(/yes|no/);
  });

  test("equations are MathML so a screen reader can read them", async ({ page }) => {
    await page.goto("/platform/");
    await page.getByRole("button", { name: /Mateo Bennett/ }).click();
    await page.waitForURL(/\/lti\/launch/);
    await expect(page.locator("#equation math")).toHaveCount(1);
  });

  test("a correct submission reaches the platform gradebook", async ({ page }) => {
    await page.goto("/platform/");
    await page.getByRole("button", { name: /Aaliyah Okafor/ }).click();
    await page.waitForURL(/\/lti\/launch/);

    // Solve challenge one by setting the controls directly, then submit.
    await page.evaluate(() => {
      const m = document.getElementById("m") as HTMLInputElement;
      const b = document.getElementById("b") as HTMLInputElement;
      m.value = "2"; m.dispatchEvent(new Event("input"));
      b.value = "1"; b.dispatchEvent(new Event("input"));
    });
    await expect(page.locator("#status")).toContainText("Solved");

    await page.getByRole("button", { name: "Submit all answers" }).click();
    await expect(page.locator("#result")).toContainText(/Score \d of 3/, { timeout: 20_000 });
    await expect(page.locator("#result")).toContainText(/gradebook/i);

    // And it is actually in the platform's gradebook, not just claimed.
    await page.goto("/platform/");
    await expect(page.locator("table")).toContainText("Aaliyah Okafor");
  });

  test("a teacher launching deep linking gets the content picker", async ({ page }) => {
    await page.goto("/platform/");
    await page.getByRole("button", { name: /add content/ }).click();
    await page.waitForURL(/\/lti\/launch/);
    await expect(page.getByRole("heading", { name: "Choose an activity" })).toBeVisible();
  });
});
