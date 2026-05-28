import { test, expect } from "@playwright/test";

test("/aristocracia sense sessió mostra login intern", async ({ page }) => {
  await page.goto("/aristocracia", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Aristocracia" })).toBeVisible();
  await expect(page.getByLabel(/Correu/i)).toHaveValue("pau@camicurt.cat");
  await expect(page.getByLabel(/Contrasenya/i)).toBeVisible();
});

test("/aristocracia/login mostra error controlat amb credencials invalides", async ({ page }) => {
  await page.goto("/aristocracia/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/Contrasenya/i).fill("incorrecta");
  await page.getByRole("button", { name: /Entrar/i }).click();
  await expect(page.getByText(/Supabase no està configurat|No s'ha pogut|Invalid/i)).toBeVisible();
});

test("la ruta publica segueix carregant fora del backoffice", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rumb-tutorial-seen-v1", "1"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("svg.map");
  await expect(page.locator("path.comarca")).toHaveCount(41);
});
