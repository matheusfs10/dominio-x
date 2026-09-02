import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "admin@dominio-x.local";
const password = process.env.E2E_PASSWORD ?? "admin-password-123";
const domain = process.env.E2E_DOMAIN ?? `e2e-${Date.now().toString(36)}.com.br`;

test("login → submit domain → analysis completes → detail → shortlist → batch page", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.goto("/domains");
  await page.locator('input[name="domain"]').fill(domain);
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page).toHaveURL(/\/domains\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: domain })).toBeVisible();

  await expect(
    page
      .locator("span")
      .filter({ hasText: /^(completed|partial)$/ })
      .first(),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Why this score?")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Score cards/ })).toBeVisible();

  await page.goto("/shortlists");
  const listName = `E2E ${Date.now()}`;
  await page.locator('input[name="shortlist-name"]').fill(listName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("link", { name: listName })).toBeVisible();

  await page.goto("/domains");
  await page.locator('input[name="q"]').fill(domain);
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("link", { name: domain, exact: true }).first().click();
  await page
    .locator("select")
    .filter({ hasText: "add to shortlist" })
    .selectOption({ label: listName });
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("link", { name: listName, exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await page.goto("/batches");
  await expect(page.getByRole("heading", { name: "Release Batches" })).toBeVisible();
});
