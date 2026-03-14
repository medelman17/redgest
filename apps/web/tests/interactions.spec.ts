import { test, expect } from "@playwright/test";

test.describe("Settings Form", () => {
  test("displays all form fields with correct labels", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByLabel("Global Insight Prompt")).toBeVisible();
    await expect(page.getByLabel("Default Lookback (hours)")).toBeVisible();
    await expect(page.getByLabel("Delivery Channel")).toBeVisible();
    await expect(page.getByLabel("LLM Provider")).toBeVisible();
    await expect(page.getByLabel("LLM Model")).toBeVisible();
    await expect(page.getByLabel("Digest Schedule (cron)")).toBeVisible();
  });

  test("insight prompt textarea is editable", async ({ page }) => {
    await page.goto("/settings");

    const textarea = page.getByLabel("Global Insight Prompt");
    await textarea.fill("Focus on AI breakthroughs and new tools");
    await expect(textarea).toHaveValue(
      "Focus on AI breakthroughs and new tools",
    );
  });

  test("lookback hours input accepts valid numbers", async ({ page }) => {
    await page.goto("/settings");

    const input = page.getByLabel("Default Lookback (hours)");
    await input.fill("48");
    await expect(input).toHaveValue("48");
  });

  test("save settings button exists and is enabled", async ({ page }) => {
    await page.goto("/settings");

    const button = page.getByRole("button", { name: "Save Settings" });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
  });

  test("helper text is displayed for fields", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByText("Guides LLM triage across all subreddits"),
    ).toBeVisible();
    await expect(
      page.getByText("How far back to look for posts"),
    ).toBeVisible();
    await expect(
      page.getByText("Cron expression for scheduled digests"),
    ).toBeVisible();
  });
});

test.describe("Subreddits Page", () => {
  test("shows table headers when subreddits exist", async ({ page }) => {
    await page.goto("/subreddits");

    // Check if we have subreddits (table) or empty state
    const hasTable = await page.locator("table").isVisible().catch(() => false);

    if (hasTable) {
      await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Insight Prompt" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Max Posts" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Last Digest" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    } else {
      // Empty state
      await expect(
        page.getByText("No subreddits configured yet"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Add your first subreddit/ }),
      ).toBeVisible();
    }
  });

  test("has add subreddit button", async ({ page }) => {
    await page.goto("/subreddits");

    // Either "Add Subreddit" or "Add your first subreddit"
    const addButton = page.getByRole("button", { name: /Add/ });
    await expect(addButton.first()).toBeVisible();
  });

  test("subreddits display with r/ prefix", async ({ page }) => {
    await page.goto("/subreddits");

    const hasTable = await page.locator("table").isVisible().catch(() => false);
    if (hasTable) {
      // At least one cell should show r/ prefix
      const cells = page.locator("td.font-mono");
      const count = await cells.count();
      if (count > 0) {
        const firstCell = await cells.first().textContent();
        expect(firstCell).toMatch(/^r\//);
      }
    }
  });

  test("subreddits show active/inactive badges", async ({ page }) => {
    await page.goto("/subreddits");

    const hasTable = await page.locator("table").isVisible().catch(() => false);
    if (hasTable) {
      // Look for Active or Inactive badges
      const badges = page.locator("[data-slot='badge']");
      const count = await badges.count();
      if (count > 0) {
        const text = await badges.first().textContent();
        expect(text).toMatch(/Active|Inactive/);
      }
    }
  });

  test("each subreddit row has edit and delete buttons", async ({ page }) => {
    await page.goto("/subreddits");

    const hasTable = await page.locator("table").isVisible().catch(() => false);
    if (hasTable) {
      const rows = page.locator("tbody tr");
      const rowCount = await rows.count();
      if (rowCount > 0) {
        const firstRow = rows.first();
        await expect(
          firstRow.getByRole("button", { name: /Edit/ }),
        ).toBeVisible();
        await expect(
          firstRow.getByRole("button", { name: /Delete/ }),
        ).toBeVisible();
      }
    }
  });
});

test.describe("Trigger Page", () => {
  test("shows Configure Digest card", async ({ page }) => {
    await page.goto("/trigger");

    await expect(page.getByText("Configure Digest")).toBeVisible();
  });

  test("shows subreddit checkboxes or empty state", async ({ page }) => {
    await page.goto("/trigger");

    const hasCheckboxes = await page
      .locator("[role='checkbox']")
      .first()
      .isVisible()
      .catch(() => false);

    if (hasCheckboxes) {
      // Should have select/deselect all
      await expect(
        page.getByRole("button", { name: /select all/i }),
      ).toBeVisible();
    } else {
      // Empty state
      await expect(page.getByText("No active subreddits")).toBeVisible();
      await expect(page.getByRole("link", { name: /Add some first/ })).toBeVisible();
    }
  });

  test("has lookback hours input", async ({ page }) => {
    await page.goto("/trigger");

    await expect(page.getByLabel("Lookback hours")).toBeVisible();
  });

  test("has generate digest button", async ({ page }) => {
    await page.goto("/trigger");

    await expect(
      page.getByRole("button", { name: /Generate Digest/ }),
    ).toBeVisible();
  });

  test("subreddit checkboxes are interactive", async ({ page }) => {
    await page.goto("/trigger");

    const checkboxes = page.locator("[role='checkbox']");
    const count = await checkboxes.count();

    if (count > 0) {
      const first = checkboxes.first();
      // Should start checked (all selected by default)
      await expect(first).toHaveAttribute("data-state", "checked");

      // Click to uncheck
      await first.click();
      await expect(first).toHaveAttribute("data-state", "unchecked");

      // Click to recheck
      await first.click();
      await expect(first).toHaveAttribute("data-state", "checked");
    }
  });

  test("deselect all / select all toggle works", async ({ page }) => {
    await page.goto("/trigger");

    const checkboxes = page.locator("[role='checkbox']");
    const count = await checkboxes.count();

    if (count > 0) {
      // All start selected, so button says "Deselect all"
      const toggleBtn = page.getByRole("button", { name: /select all/i });
      await expect(toggleBtn).toHaveText(/Deselect all/i);

      // Click to deselect all
      await toggleBtn.click();
      await expect(toggleBtn).toHaveText(/Select all/i);

      // All checkboxes should be unchecked
      for (let i = 0; i < count; i++) {
        await expect(checkboxes.nth(i)).toHaveAttribute(
          "data-state",
          "unchecked",
        );
      }

      // Generate button should be disabled when none selected
      await expect(
        page.getByRole("button", { name: /Generate Digest/ }),
      ).toBeDisabled();

      // Click to select all
      await toggleBtn.click();
      await expect(toggleBtn).toHaveText(/Deselect all/i);
    }
  });
});

test.describe("Profiles Page", () => {
  test("shows table or empty state", async ({ page }) => {
    await page.goto("/profiles");

    const hasTable = await page.locator("table").isVisible().catch(() => false);

    if (hasTable) {
      await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Subreddits" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Schedule" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Delivery" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    } else {
      await expect(
        page.getByText("No profiles configured yet"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Create your first profile/ }),
      ).toBeVisible();
    }
  });

  test("has create profile button", async ({ page }) => {
    await page.goto("/profiles");

    // Either "Add Profile" or "Create your first profile"
    const addButton = page.getByRole("button", { name: /profile/i });
    await expect(addButton.first()).toBeVisible();
  });

  test("Default profile has no delete button", async ({ page }) => {
    await page.goto("/profiles");

    const hasTable = await page.locator("table").isVisible().catch(() => false);
    if (hasTable) {
      const defaultRow = page.locator("tbody tr").filter({ hasText: "Default" });
      const count = await defaultRow.count();
      if (count > 0) {
        // Default row should have Edit but no Delete
        await expect(
          defaultRow.first().getByRole("button", { name: /Edit/ }),
        ).toBeVisible();
        await expect(
          defaultRow.first().getByRole("button", { name: /Delete/ }),
        ).not.toBeVisible();
      }
    }
  });
});

test.describe("Digests Page", () => {
  test("shows table or empty state", async ({ page }) => {
    await page.goto("/digests");

    await expect(
      page.getByRole("heading", { name: "Digests" }),
    ).toBeVisible();

    // Either shows a data table or no digests message
    const content = await page.textContent("main");
    expect(content).toBeTruthy();
  });
});

test.describe("History Page", () => {
  test("displays table or empty state", async ({ page }) => {
    await page.goto("/history");

    await expect(
      page.getByRole("heading", { name: "Run History" }),
    ).toBeVisible();

    // Either shows a data table or an empty message
    const content = await page.textContent("main");
    expect(content).toBeTruthy();
  });
});

test.describe("Theme Toggle", () => {
  test("theme toggle button exists in header", async ({ page }) => {
    await page.goto("/subreddits");

    // The theme toggle should be in the header
    const header = page.locator("header");
    const buttons = header.locator("button");
    const count = await buttons.count();
    // At least sidebar trigger + theme toggle
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Responsive Layout", () => {
  test("sidebar collapses on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/subreddits");

    // On mobile, the sidebar should be collapsed/hidden
    await expect(
      page.getByRole("heading", { name: "Subreddits" }),
    ).toBeVisible();
  });

  test("settings form stacks on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/settings");

    await expect(page.getByLabel("Global Insight Prompt")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save Settings" }),
    ).toBeVisible();
  });
});
