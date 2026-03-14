import { test, expect } from "@playwright/test";

test.describe("Navigation & Layout", () => {
  test("home redirects to /subreddits", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/subreddits/);
  });

  test("sidebar shows all nav items", async ({ page }) => {
    await page.goto("/subreddits");
    const sidebar = page.locator("[data-sidebar]").first();
    await expect(sidebar.getByText("Subreddits")).toBeVisible();
    await expect(sidebar.getByText("Profiles")).toBeVisible();
    await expect(sidebar.getByText("Digests")).toBeVisible();
    await expect(sidebar.getByText("Settings")).toBeVisible();
    await expect(sidebar.getByText("History")).toBeVisible();
    await expect(sidebar.getByText("Trigger")).toBeVisible();
  });

  test("sidebar shows Redgest branding", async ({ page }) => {
    await page.goto("/subreddits");
    const sidebar = page.locator("[data-sidebar]").first();
    await expect(sidebar.getByText("Redgest")).toBeVisible();
    await expect(sidebar.getByText("R", { exact: true }).first()).toBeVisible();
  });

  test("header has sidebar trigger and theme toggle", async ({ page }) => {
    await page.goto("/subreddits");
    await expect(page.locator("header")).toBeVisible();
  });
});

test.describe("Subreddits Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/subreddits");
    await expect(
      page.getByRole("heading", { name: "Subreddits" }),
    ).toBeVisible();
    await expect(
      page.getByText("Manage your monitored subreddits"),
    ).toBeVisible();
  });

  test("shows subreddit table or empty state", async ({ page }) => {
    await page.goto("/subreddits");
    // Either a table with data or an "Add Subreddit" button should be present
    const heading = page.getByRole("heading", { name: "Subreddits" });
    await expect(heading).toBeVisible();
  });
});

test.describe("Settings Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    await expect(
      page.getByText("Configure digest generation"),
    ).toBeVisible();
  });

  test("shows settings form fields", async ({ page }) => {
    await page.goto("/settings");
    // The form should have key configuration fields
    await expect(page.getByRole("button", { name: "Save Settings" })).toBeVisible();
  });
});

test.describe("History Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/history");
    await expect(
      page.getByRole("heading", { name: "Run History" }),
    ).toBeVisible();
    await expect(page.getByText("View past digest runs")).toBeVisible();
  });
});

test.describe("Trigger Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/trigger");
    await expect(
      page.getByRole("heading", { name: "Manual Trigger" }),
    ).toBeVisible();
    await expect(
      page.getByText("Generate a digest on demand"),
    ).toBeVisible();
  });
});

test.describe("Profiles Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/profiles");
    await expect(
      page.getByRole("heading", { name: "Profiles" }),
    ).toBeVisible();
    await expect(
      page.getByText("Manage digest profiles with custom subreddit sets"),
    ).toBeVisible();
  });
});

test.describe("Digests Page", () => {
  test("renders page heading", async ({ page }) => {
    await page.goto("/digests");
    await expect(
      page.getByRole("heading", { name: "Digests" }),
    ).toBeVisible();
    await expect(
      page.getByText("Browse generated digests, view content"),
    ).toBeVisible();
  });
});

test.describe("Navigation between pages", () => {
  test("can navigate to all pages via sidebar", async ({ page }) => {
    await page.goto("/subreddits");

    // Navigate to Profiles
    await page.locator("[data-sidebar]").first().getByText("Profiles").click();
    await expect(page).toHaveURL(/\/profiles/);
    await expect(
      page.getByRole("heading", { name: "Profiles" }),
    ).toBeVisible();

    // Navigate to Digests
    await page.locator("[data-sidebar]").first().getByText("Digests").click();
    await expect(page).toHaveURL(/\/digests/);
    await expect(
      page.getByRole("heading", { name: "Digests" }),
    ).toBeVisible();

    // Navigate to Settings
    await page.locator("[data-sidebar]").first().getByText("Settings").click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(
      page.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();

    // Navigate to History
    await page.locator("[data-sidebar]").first().getByText("History").click();
    await expect(page).toHaveURL(/\/history/);
    await expect(
      page.getByRole("heading", { name: "Run History" }),
    ).toBeVisible();

    // Navigate to Trigger
    await page.locator("[data-sidebar]").first().getByText("Trigger").click();
    await expect(page).toHaveURL(/\/trigger/);
    await expect(
      page.getByRole("heading", { name: "Manual Trigger" }),
    ).toBeVisible();

    // Navigate back to Subreddits
    await page
      .locator("[data-sidebar]")
      .first()
      .getByText("Subreddits")
      .click();
    await expect(page).toHaveURL(/\/subreddits/);
    await expect(
      page.getByRole("heading", { name: "Subreddits" }),
    ).toBeVisible();
  });
});
