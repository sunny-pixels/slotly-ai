import { expect, test } from "@playwright/test";

test("customer books an open slot, sees it in My bookings, then cancels it", async ({ page }) => {
  // 1. Pick the demo customer from the sidebar switcher.
  await page.goto("/");
  await page.getByRole("button", { name: "Continue as…" }).click();
  await page.getByRole("button", { name: /Maya Chen/ }).click();
  // Wait for the server action to finish and the shell to show the signed-in user.
  await expect(page.getByText("maya@slotly.dev")).toBeVisible();

  // 2. Open a service and choose the first open time.
  await page.goto("/services/guided-meditation/book");
  await expect(page.getByRole("heading", { name: "Guided Meditation", level: 1 })).toBeVisible();
  const firstOpen = page.locator("fieldset button[aria-pressed]").first();
  await expect(firstOpen).toBeVisible();
  await firstOpen.click();
  await page.getByRole("button", { name: "Review and confirm" }).click();

  // 3. Confirm — success is shown only after the API commits.
  const dialog = page.getByRole("dialog", { name: "Confirm your booking" });
  await dialog.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: /You’re booked|You're booked/ })).toBeVisible();
  const reference = (await page.locator("aside p.font-display").first().textContent())?.trim() ?? "";
  expect(reference).toMatch(/^SLT-[A-Z0-9]{6}$/);

  // 4. It appears in My bookings.
  await page.goto(`/bookings?q=${reference}`);
  const row = page.getByRole("row", { name: new RegExp(reference) });
  await expect(row).toBeVisible();

  // 5. Cancel with explicit confirmation.
  await row.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByText("Booking cancelled")).toBeVisible({ timeout: 30_000 });
  await page.goto(`/bookings?view=cancelled&q=${reference}`);
  await expect(page.getByRole("row", { name: new RegExp(reference) })).toBeVisible();
});

test("customers cannot open the admin area", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue as…" }).click();
  await page.getByRole("button", { name: /Sam Okafor/ }).click();
  await expect(page.getByText("sam@slotly.dev")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByText("Administrator access required")).toBeVisible();
});
