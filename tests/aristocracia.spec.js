import { test, expect } from "@playwright/test";

function buildMockDashboard() {
  const licenses = Array.from({ length: 18 }, (_, index) => {
    const status = index % 6 === 0 ? "trial" : index % 5 === 0 ? "pending_payment" : "active";
    return {
      license_id: `license-${index}`,
      organization_id: `org-${index}`,
      organization_name: `Institut Camicurt ${index + 1}`,
      organization_status: "active",
      city: index % 2 ? "Girona" : "Barcelona",
      contact_email: `direccio${index + 1}@centre.cat`,
      plan: index % 3 === 0 ? "centre" : "pilot",
      status,
      starts_at: "2026-05-01",
      ends_at: index % 5 === 0 ? "2026-05-30" : "2026-12-31",
      active_teachers: 1 + (index % 4),
      invited_teachers: index % 2,
      max_teachers: 8,
      max_participants_per_session: 32,
      billing_reference: `CM-${String(index + 1).padStart(3, "0")}`,
      price_cents: 9900,
      currency: "EUR"
    };
  });

  return {
    worker: {
      id: "worker-owner",
      email: "pau@camicurt.cat",
      full_name: "Pau",
      role: "owner",
      status: "active"
    },
    license_summary: {
      total: licenses.length,
      active: licenses.filter((license) => license.status === "active").length,
      trial: licenses.filter((license) => license.status === "trial").length,
      expired: 1,
      pending_payment: licenses.filter((license) => license.status === "pending_payment").length,
      suspended: 0
    },
    licenses,
    status_services: [
      {
        id: "status-web",
        service_key: "web_public",
        name: "Web pública",
        description: "Joc públic de camicurt.cat",
        automatic_status: "online",
        manual_status: null,
        effective_status: "online",
        last_checked_at: "2026-05-28T08:30:00Z",
        notes: "",
        sort_order: 10
      },
      {
        id: "status-aula",
        service_key: "aula_web",
        name: "Camicurt Aula",
        description: "Landing i panell docent",
        automatic_status: "degraded",
        manual_status: null,
        effective_status: "degraded",
        last_checked_at: "2026-05-28T08:28:00Z",
        notes: "Latència elevada",
        sort_order: 20
      },
      {
        id: "status-supabase",
        service_key: "supabase_api",
        name: "Supabase API",
        description: "Base de dades i Auth",
        automatic_status: "online",
        manual_status: null,
        effective_status: "online",
        last_checked_at: "2026-05-28T08:27:00Z",
        notes: "",
        sort_order: 30
      }
    ],
    social_links: [
      { id: "social-instagram", platform: "instagram", label: "Instagram", url: "", status: "draft", sort_order: 10, notes: "" },
      { id: "social-tiktok", platform: "tiktok", label: "TikTok", url: "", status: "draft", sort_order: 20, notes: "" },
      { id: "social-x", platform: "x", label: "X", url: "", status: "hidden", sort_order: 30, notes: "" },
      { id: "social-youtube", platform: "youtube", label: "YouTube", url: "", status: "draft", sort_order: 40, notes: "" },
      { id: "social-linkedin", platform: "linkedin", label: "LinkedIn", url: "", status: "draft", sort_order: 50, notes: "" },
      { id: "social-email", platform: "email", label: "Email", url: "mailto:pau@camicurt.cat", status: "active", sort_order: 60, notes: "" }
    ],
    workers: [
      {
        id: "worker-owner",
        email: "pau@camicurt.cat",
        full_name: "Pau",
        role: "owner",
        status: "active",
        invited_at: "2026-05-28T08:00:00Z",
        activated_at: "2026-05-28T08:01:00Z",
        last_seen_at: "2026-05-28T08:40:00Z"
      }
    ]
  };
}

async function installAristocraciaMock(page) {
  await page.addInitScript((dashboard) => {
    window.__CAMICURT_ARISTOCRACIA_MOCK__ = {
      access: {
        allowed: true,
        worker: {
          email: "pau@camicurt.cat",
          full_name: "Pau",
          role: "owner",
          status: "active"
        }
      },
      dashboard,
      calls: []
    };
  }, buildMockDashboard());
}

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
  await expect(page.getByText(/Supabase no està configurat|No s'ha pogut|Invalid|Failed to fetch/i)).toBeVisible();
});

test("la ruta publica segueix carregant fora del backoffice", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rumb-tutorial-seen-v1", "1"));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("svg.map");
  await expect(page.locator("path.comarca")).toHaveCount(41);
});

test("dashboard mockejat mostra totes les pestanyes administratives", async ({ page }) => {
  await installAristocraciaMock(page);
  await page.goto("/aristocracia", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Aristocracia" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Salut dels serveis" })).toBeVisible();

  await page.getByRole("button", { name: "Llicències" }).click();
  await expect(page.getByRole("heading", { name: "Crear centre" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Estat comercial" })).toBeVisible();

  await page.getByRole("button", { name: "Status" }).click();
  await expect(page.getByRole("heading", { name: "Serveis Camicurt" })).toBeVisible();

  await page.getByRole("button", { name: "Xarxes" }).click();
  await expect(page.getByRole("heading", { name: "Enllaços públics" })).toBeVisible();

  await page.getByRole("button", { name: "Treballadors" }).click();
  await expect(page.getByRole("heading", { name: "Crear credencial" })).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 }
]) {
  test(`aristocracia permet scroll vertical i evita overflow global ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installAristocraciaMock(page);
    await page.goto("/aristocracia", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Llicències" }).click();
    await expect(page.getByRole("heading", { name: "Estat comercial" })).toBeVisible();

    const canScroll = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    expect(canScroll).toBeTruthy();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const reachedBottom = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4
    );
    expect(reachedBottom).toBeTruthy();

    const hasBodyOverflowX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    );
    expect(hasBodyOverflowX).toBeFalsy();
  });
}

test("taules amples tenen scroll intern en mòbil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAristocraciaMock(page);
  await page.goto("/aristocracia", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Llicències" }).click();

  const tableWrapHasOverflow = await page
    .locator(".aristocracia-table-card .aula-table-wrap")
    .first()
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(tableWrapHasOverflow).toBeTruthy();

  const hasBodyOverflowX = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  expect(hasBodyOverflowX).toBeFalsy();
});

test("accions principals funcionen amb mock sense Supabase real", async ({ page }) => {
  await installAristocraciaMock(page);
  await page.goto("/aristocracia", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Status" }).click();
  await page.getByRole("button", { name: "Executar checks" }).click();
  await expect(page.getByText("Checks executats.")).toBeVisible();

  await page.getByRole("button", { name: "Xarxes" }).click();
  const instagram = page.locator(".aristocracia-social-card").filter({ hasText: "Instagram" });
  await instagram.getByLabel("URL o mailto").fill("https://instagram.com/camicurt");
  await instagram.getByRole("button", { name: "Desar" }).click();
  await expect(page.getByText("Xarxa desada.")).toBeVisible();

  await page.getByRole("button", { name: "Treballadors" }).click();
  await page.getByLabel("Contrasenya temporal").fill("Temporal11!");
  await page.getByRole("button", { name: "Crear o actualitzar" }).click();
  await expect(page.getByText(/Treballador creat o actualitzat/)).toBeVisible();

  const calls = await page.evaluate(() => window.__CAMICURT_ARISTOCRACIA_MOCK__.calls);
  expect(calls.map((call) => call.action)).toEqual(
    expect.arrayContaining(["health-check", "social-link-upsert", "worker-upsert"])
  );
  expect(calls.find((call) => call.action === "worker-upsert").password).toBeUndefined();
});
