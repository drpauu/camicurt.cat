import { test, expect } from "@playwright/test";

const TUTORIAL_SEEN_KEY = "rumb-tutorial-seen-v1";

test("la pàgina pública segueix carregant el joc", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), TUTORIAL_SEEN_KEY);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("svg.map");
  await expect(page.locator("path.comarca")).toHaveCount(41);
  await expect(page.getByRole("button", { name: /Nou mapa/i })).toBeVisible();
});

test("/aula mostra la landing de Camicurt Aula", async ({ page }) => {
  await page.goto("/aula", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Camicurt Aula" })).toBeVisible();
  await expect(page.getByText(/Recurs educatiu en català/i)).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: /Accés docent/i })).toBeVisible();
});

test("/aula/login mostra formulari de magic link", async ({ page }) => {
  await page.goto("/aula/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Entra a Camicurt Aula/i })).toBeVisible();
  await expect(page.getByLabel(/Correu docent/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Enviar enllaç d'accés/i })).toBeVisible();
});

test("/aula/join mostra formulari de codi i pseudònim", async ({ page }) => {
  await page.goto("/aula/join?code=ABC123", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Entra a la sessió/i })).toBeVisible();
  await expect(page.getByLabel(/Codi de sessió/i)).toHaveValue("ABC123");
  await expect(page.getByLabel(/Nom d'equip o pseudònim/i)).toBeVisible();
});

test("un codi invàlid a /aula/join mostra error controlat", async ({ page }) => {
  await page.route("**/functions/v1/aula-session/join", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Codi invàlid o sessió no trobada." })
    });
  });
  await page.goto("/aula/join", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/Codi de sessió/i).fill("INVAL1D");
  await page.getByLabel(/Nom d'equip o pseudònim/i).fill("Equip 1");
  await page.getByRole("button", { name: /Començar/i }).click();
  await expect(
    page.getByText(/Codi invàlid|Supabase no està configurat|No s'ha pogut/i)
  ).toBeVisible();
});

test("/aula/panel sense login no mostra panell privat", async ({ page }) => {
  await page.route("**/rest/v1/rpc/aula_get_access", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ allowed: false, reason: "unauthenticated" })
    });
  });
  await page.goto("/aula/panel", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Accés restringit/i)).toBeVisible();
  await expect(page.getByText(/Últimes sessions/i)).toHaveCount(0);
});

test("les rutes SPA d'Aula es poden refrescar", async ({ page }) => {
  await page.goto("/aula/materials", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText(/Camicurt Aula|Accés restringit/);
});
