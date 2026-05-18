import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feature, neighbors as topoNeighbors } from "topojson-client";
import { findShortestPathsWithRule } from "../src/lib/pathfinding.js";
import { normalizeName } from "../src/lib/names.js";
import { translate } from "../src/lib/locales.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const topoPath = path.resolve(__dirname, "..", "public", "catalunya-comarques.topojson");
const rulesPath = path.resolve(__dirname, "..", "src", "data", "rules.json");
const RULES = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
const SINGLE_REQUIRE_RULE = RULES.find(
  (rule) => rule.type === "REQUIRE" && (rule.comarques || []).length === 1
);
const MULTI_REQUIRE_RULE = RULES.find(
  (rule) => rule.type === "REQUIRE" && (rule.comarques || []).length > 1
);
if (!SINGLE_REQUIRE_RULE || !MULTI_REQUIRE_RULE) {
  throw new Error("No s'han trobat normes suficients per als tests E2E.");
}
const TUTORIAL_SEEN_KEY = "rumb-tutorial-seen-v1";
const STANDARD_DESCRIPTION =
  "uneix Inici i Destí triant comarques veïnes, completa una ruta vàlida i intenta millorar-la fins acostar-te al camí òptim.";
const topology = JSON.parse(fs.readFileSync(topoPath, "utf8"));
const objectKey = Object.keys(topology.objects)[0];
const topologyObject = topology.objects[objectKey];
const comarques = feature(topology, topologyObject).features;
const comarcaIds = comarques.map((item) => item.properties.id);
const comarcaNameById = new Map(
  comarques.map((item) => [item.properties.id, item.properties.name])
);
const comarcaIdByName = new Map(
  comarques.map((item) => [normalizeName(item.properties.name), item.properties.id])
);
const adjacency = new Map();
topoNeighbors(topologyObject.geometries || []).forEach((neighbors, index) => {
  adjacency.set(
    comarcaIds[index],
    new Set(neighbors.map((neighborIndex) => comarcaIds[neighborIndex]))
  );
});

const getRouteAndRule = async (page) =>
  page.evaluate(() => {
    const routeSpans = [...document.querySelectorAll(".map-brief .route span")].map(
      (span) => span.textContent || ""
    );
    const clean = (value) => value.replace(/^[^:]+:\s*/, "").trim();
    return {
      startName: clean(routeSpans[0] || ""),
      targetName: clean(routeSpans[1] || ""),
      ruleLabel:
        (document.querySelector(".map-brief .rule-line")?.textContent || "")
          .replace(/^[^:]+:\s*/, "")
          .trim()
    };
  });

const resolveOptimalGuessNames = ({ startName, targetName, ruleLabel }) => {
  const startId = comarcaIdByName.get(normalizeName(startName));
  const targetId = comarcaIdByName.get(normalizeName(targetName));
  const rawRule = RULES.find((rule) => rule.text === ruleLabel);
  const rule = rawRule
    ? {
        id: rawRule.id,
        kind: rawRule.type === "FORBID" ? "avoid" : "mustIncludeAny",
        label: rawRule.text,
        comarques: rawRule.comarques || []
      }
    : null;
  const preparedRule = rule
    ? {
        ...rule,
        comarcaIds: (rule.comarques || [])
          .map((name) => comarcaIdByName.get(normalizeName(name)))
          .filter(Boolean)
      }
    : null;
  const result = findShortestPathsWithRule(
    startId,
    targetId,
    adjacency,
    preparedRule,
    comarcaIds,
    { maxPaths: 64 }
  );
  return result.primaryPath
    .filter((id) => id !== startId && id !== targetId)
    .map((id) => comarcaNameById.get(id) || id);
};

const playGuesses = async (page, names) => {
  const input = page.locator("#guess-input");
  for (const name of names) {
    if (await input.isDisabled().catch(() => false)) break;
    await input.fill(name);
    await page.getByRole("button", { name: /Esbrina/i }).click();
    await expect(input).toHaveValue("", { timeout: 1000 }).catch(() => {});
    if (await page.locator(".modal").isVisible().catch(() => false)) break;
  }
};

const getTodayKey = () => {
  return getMadridDayKeyOffset(0);
};

const getMadridDayKey = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
};

const getMadridDayKeyOffset = (offsetDays) => {
  const [year, month, day] = getMadridDayKey().split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const supabaseJsonHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, x-client-info, content-type, prefer, range",
  "access-control-expose-headers": "content-range",
  "content-range": "0-0/1"
};

const rowFromDailyLevel = (date, level) => ({
  date,
  level_id: level.id,
  start_id: level.start_id,
  target_id: level.target_id,
  shortest_path: level.shortest_path,
  rule_id: level.rule_id ?? null,
  avoid_ids: level.avoid_ids ?? null,
  must_pass_ids: level.must_pass_ids ?? null,
  difficulty_id: level.difficulty_id
});

const mockDailyCalendarDetails = async (page, entries) => {
  const rowsByDate = new Map(
    entries.map(({ date, level }) => [date, rowFromDailyLevel(date, level)])
  );
  await page.route("**/*daily_calendar_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseJsonHeaders });
    }
    const url = new URL(route.request().url());
    const dateFilter = url.searchParams.get("date") || "";
    const requestedDate = dateFilter.startsWith("eq.") ? dateFilter.slice(3) : null;
    const rows = requestedDate
      ? rowsByDate.has(requestedDate)
        ? [rowsByDate.get(requestedDate)]
        : []
      : [...rowsByDate.values()];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        ...supabaseJsonHeaders,
        "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0"
      },
      body: JSON.stringify(rows)
    });
  });
};

const gotoHome = async (page) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "1");
  }, TUTORIAL_SEEN_KEY);
  return page.goto("/", { waitUntil: "domcontentloaded" });
};

test("carrega el mapa i la UI base", async ({ page }) => {
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  const count = await page.locator("path.comarca").count();
  expect(count).toBeGreaterThan(30);
  const theme = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: styles.getPropertyValue("--bg").trim().toLowerCase(),
      colorScheme: document.documentElement.style.colorScheme
    };
  });
  expect(theme.bg).toBe("#f7f2e8");
  expect(theme.colorScheme).toBe("light");
  const logoBox = await page.locator(".brand-logo").boundingBox();
  expect(logoBox?.width).toBeGreaterThanOrEqual(54);
  expect(logoBox?.height).toBeGreaterThanOrEqual(42);
  await expect(page.locator(".brand-date")).toBeVisible();
  await expect(page.locator(".brand-mode-description")).toHaveCount(0);
  await expect(page).toHaveTitle("Camicurt - Joc de rutes entre comarques");
  await expect(page.locator(".brand-summary")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /Mira l'objectiu/i })).toHaveCount(0);
  const metaDescription = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  expect(metaDescription).toBe(
    "Camicurt és un joc gratuït en català per trobar rutes entre comarques catalanes al navegador."
  );
  const canonicalHref = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonicalHref).toBe("https://www.camicurt.cat/");
  const structuredDataText = await page
    .locator('script[type="application/ld+json"]')
    .textContent();
  const structuredData = JSON.parse(structuredDataText || "{}");
  const graph = structuredData["@graph"] || [];
  expect(graph.map((item) => item["@type"])).toEqual(
    expect.arrayContaining(["WebSite", "SoftwareApplication", "Organization"])
  );
  expect(graph.find((item) => item["@id"] === "https://www.camicurt.cat/#website")).toEqual(
    expect.objectContaining({
      "@type": "WebSite",
      name: "Camicurt",
      url: "https://www.camicurt.cat/",
      inLanguage: "ca"
    })
  );
  const appSchema = graph.find(
    (item) => item["@id"] === "https://www.camicurt.cat/#app"
  );
  expect(appSchema).toEqual(
    expect.objectContaining({
      "@type": "SoftwareApplication",
      applicationCategory: "GameApplication",
      operatingSystem: "Web",
      isAccessibleForFree: true
    })
  );
  expect(appSchema.offers).toEqual(
    expect.objectContaining({
      "@type": "Offer",
      price: 0,
      priceCurrency: "EUR"
    })
  );
  expect(appSchema.aggregateRating).toBeUndefined();
  expect(appSchema.review).toBeUndefined();
  const headerAlignment = await page.evaluate(() => {
    const titleBox = document.querySelector(".brand h1")?.getBoundingClientRect();
    const dateBox = document.querySelector(".brand-date")?.getBoundingClientRect();
    const actionsBox = document.querySelector(".topbar-actions")?.getBoundingClientRect();
    return {
      dateTitleBottomDelta:
        titleBox && dateBox ? Math.abs(titleBox.bottom - dateBox.bottom) : Infinity,
      dateBeforeActions:
        dateBox && actionsBox ? dateBox.right <= actionsBox.left - 4 : false
    };
  });
  expect(headerAlignment.dateTitleBottomDelta).toBeLessThanOrEqual(4);
  expect(headerAlignment.dateBeforeActions).toBeTruthy();
  const faviconLinks = await page.$$eval('link[rel~="icon"]', (links) =>
    links.map((link) => ({
      rel: link.getAttribute("rel"),
      href: link.getAttribute("href"),
      sizes: link.getAttribute("sizes")
    }))
  );
  expect(faviconLinks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        href: "/logo/favicon.ico"
      })
    ])
  );
  const faviconResponse = await page.request.get("/logo/favicon.ico");
  await expect(faviconResponse.ok()).toBeTruthy();
  const faviconBytes = new Uint8Array(await faviconResponse.body());
  expect([...faviconBytes.slice(0, 4)]).toEqual([0, 0, 1, 0]);
  await expect((await page.request.get("/logo/logo.png")).ok()).toBeTruthy();
  await expect((await page.request.get("/rules.json")).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: /Nou mapa/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Diari$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Setmanal$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Calendari/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Esbrina/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Opcions/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Veïnes/i })).toHaveCount(0);
  await expect(page.locator(".bottom-nav")).toBeHidden();
  await expect(page.getByText(/Inici:/i)).toBeVisible();
  await expect(page.getByText(/Destí:/i)).toBeVisible();
  await expect(page.getByText(/Norma:/i)).toBeVisible();
  await expect(page.getByText(/Sense connexió/i)).toHaveCount(0);
  await expect(page.getByText(/^Jugada$/i)).toHaveCount(0);
  await expect(page.getByText(/Comarques:/i)).toHaveCount(0);
  await expect(page.getByText(/Òptim:/i)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Ã");
  await expect(page.locator("body")).not.toContainText("â€");
});

test("el tutorial inicial apareix una vegada i es pot reobrir des d'Opcions", async ({
  page
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const dialog = page.locator(".tutorial-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Mira l'objectiu/i })).toBeVisible();
  await expect(dialog.locator(".tutorial-dot")).toHaveCount(4);
  await page.waitForSelector("svg.map");
  await expect(dialog.locator("svg.tutorial-goal-map")).toBeVisible();
  await expect(dialog.locator('[data-tutorial-label-name="Segarra"]')).toBeVisible();
  await expect(dialog.locator('[data-tutorial-label-name="Osona"]')).toBeVisible();
  await expect(dialog.locator('[data-tutorial-label-name="Terra Alta"]')).toBeVisible();
  await expect(page.locator(".map-brief .route")).toBeVisible();
  const routeBefore = await getRouteAndRule(page);

  await dialog.locator(".tutorial-goal-shot").click();
  await dialog.getByRole("button", { name: /Seg/i }).click();
  await expect(dialog.getByRole("heading", { name: /Tria comarques ve/i })).toBeVisible();
  await dialog.getByRole("button", { name: /Prova-ho/i }).click();
  await expect(dialog.locator(".tutorial-choose-shot")).toHaveClass(/is-played/);

  await dialog.getByRole("button", { name: /Seg/i }).click();
  await expect(dialog.getByRole("heading", { name: /Construeix/i })).toBeVisible();
  const activeBefore = await dialog.locator(".tutorial-route-node.is-active").count();
  await dialog.locator(".tutorial-route-shot").click();
  await expect
    .poll(async () => dialog.locator(".tutorial-route-node.is-active").count())
    .toBeGreaterThan(activeBefore);

  await dialog.getByRole("button", { name: /Seg/i }).click();
  await expect(dialog.getByRole("heading", { name: /Millora/i })).toBeVisible();
  await dialog.getByRole("tab", { name: /Un cam/i }).click();
  await expect(dialog.locator('.tutorial-result-card[data-route-view="optimal"]')).toBeVisible();
  await expect(dialog).toContainText("Un camí òptim");
  await expect(dialog.locator(".tutorial-improve-shot")).not.toContainText("passos");
  const tutorialRouteColors = await dialog
    .locator(".tutorial-improve-shot .tutorial-result-list li")
    .evaluateAll((items) =>
      items.map((item) => ({
        text: item.textContent.trim(),
        color: getComputedStyle(item).color
      }))
    );
  expect(tutorialRouteColors[0].text).toContain("Segarra");
  expect(tutorialRouteColors.at(-1).text).toContain("Terra Alta");
  expect(tutorialRouteColors[0].color).not.toBe(tutorialRouteColors[1].color);
  expect(tutorialRouteColors.at(-1).color).not.toBe(tutorialRouteColors[1].color);

  await dialog.getByRole("button", { name: /Comença/i }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), TUTORIAL_SEEN_KEY)).toBe(
    "1"
  );
  expect(await getRouteAndRule(page)).toEqual(routeBefore);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".tutorial-modal")).toHaveCount(0);

  await page.getByRole("button", { name: /Opcions/i }).click();
  await page.getByRole("dialog", { name: /Opcions/i }).getByRole("button", {
    name: /Tutorial/i
  }).click();
  await expect(page.locator(".tutorial-modal")).toBeVisible();
});

test("el tutorial inicial encaixa en mobil sense tallar accions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const dialog = page.locator(".tutorial-modal");
  await expect(dialog).toBeVisible();
  await page.waitForSelector("svg.map");
  await expect(dialog.locator("svg.tutorial-goal-map")).toBeVisible();
  const metrics = await page.evaluate(() => {
    const modal = document.querySelector(".tutorial-modal")?.getBoundingClientRect();
    const visual = document.querySelector(".tutorial-visual")?.getBoundingClientRect();
    const shot = document.querySelector(".tutorial-shot")?.getBoundingClientRect();
    const actions = document.querySelector(".tutorial-actions")?.getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".tutorial-actions button")].map(
      (button) => ({
        text: button.textContent.trim(),
        scrollWidth: button.scrollWidth,
        clientWidth: button.clientWidth,
        height: Math.round(button.getBoundingClientRect().height)
      })
    );
    return {
      modalWidth: Math.round(modal?.width || 0),
      modalHeight: Math.round(modal?.height || 0),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      shotTop: Math.round(shot?.top || 0),
      shotBottom: Math.round(shot?.bottom || 0),
      visualTop: Math.round(visual?.top || 0),
      visualBottom: Math.round(visual?.bottom || 0),
      actionsBottom: Math.round(actions?.bottom || 0),
      modalBottom: Math.round(modal?.bottom || 0),
      buttons
    };
  });
  expect(metrics.modalWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.modalHeight).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.shotTop).toBeGreaterThanOrEqual(metrics.visualTop - 1);
  expect(metrics.shotBottom).toBeLessThanOrEqual(metrics.visualBottom + 1);
  expect(metrics.visualBottom).toBeLessThanOrEqual(metrics.modalBottom);
  expect(metrics.actionsBottom).toBeLessThanOrEqual(metrics.modalBottom);
  expect(metrics.buttons).toHaveLength(3);
  expect(metrics.buttons.every((button) => button.scrollWidth <= button.clientWidth + 1)).toBe(
    true
  );
  expect(metrics.buttons.every((button) => button.height >= 44)).toBe(true);

  await dialog.getByRole("button", { name: /Seg/i }).click();
  await expect(dialog.getByRole("heading", { name: /Tria comarques ve/i })).toBeVisible();
  const chooseMetrics = await page.evaluate(() => {
    const visual = document.querySelector(".tutorial-visual")?.getBoundingClientRect();
    const shot = document.querySelector(".tutorial-choose-shot")?.getBoundingClientRect();
    const input = document.querySelector(".tutorial-input")?.getBoundingClientRect();
    const suggestions = document.querySelector(".tutorial-suggestions")?.getBoundingClientRect();
    const demoButton = document.querySelector(".tutorial-demo-button")?.getBoundingClientRect();
    return {
      shotTop: Math.round(shot?.top || 0),
      shotBottom: Math.round(shot?.bottom || 0),
      visualTop: Math.round(visual?.top || 0),
      visualBottom: Math.round(visual?.bottom || 0),
      inputLeft: Math.round(input?.left || 0),
      suggestionsLeft: Math.round(suggestions?.left || 0),
      buttonBottom: Math.round(demoButton?.bottom || 0),
      shotLeft: Math.round(shot?.left || 0),
      shotRight: Math.round(shot?.right || 0)
    };
  });
  expect(chooseMetrics.shotTop).toBeGreaterThanOrEqual(chooseMetrics.visualTop - 1);
  expect(chooseMetrics.shotBottom).toBeLessThanOrEqual(chooseMetrics.visualBottom + 1);
  expect(chooseMetrics.inputLeft).toBeGreaterThanOrEqual(chooseMetrics.shotLeft);
  expect(chooseMetrics.suggestionsLeft).toBeGreaterThanOrEqual(chooseMetrics.shotLeft);
  expect(chooseMetrics.buttonBottom).toBeLessThanOrEqual(chooseMetrics.shotBottom + 1);

  for (let index = 0; index < 2; index += 1) {
    await dialog.getByRole("button", { name: /Seg/i }).click();
  }
  await expect(dialog.getByRole("heading", { name: /Millora/i })).toBeVisible();
  const improveMetrics = await page.evaluate(() => {
    const visual = document.querySelector(".tutorial-visual")?.getBoundingClientRect();
    const shot = document.querySelector(".tutorial-improve-shot")?.getBoundingClientRect();
    const actions = document.querySelector(".tutorial-actions")?.getBoundingClientRect();
    const modal = document.querySelector(".tutorial-modal")?.getBoundingClientRect();
    return {
      shotTop: Math.round(shot?.top || 0),
      shotBottom: Math.round(shot?.bottom || 0),
      visualTop: Math.round(visual?.top || 0),
      visualBottom: Math.round(visual?.bottom || 0),
      actionsBottom: Math.round(actions?.bottom || 0),
      modalBottom: Math.round(modal?.bottom || 0)
    };
  });
  expect(improveMetrics.shotTop).toBeGreaterThanOrEqual(improveMetrics.visualTop - 1);
  expect(improveMetrics.shotBottom).toBeLessThanOrEqual(improveMetrics.visualBottom + 1);
  expect(improveMetrics.actionsBottom).toBeLessThanOrEqual(improveMetrics.modalBottom);
});

test("Nou mapa genera un repte nou mantenint mode i dificultat", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
    localStorage.setItem("rumb-difficulty", "pixapi");
  });
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  const route = page.locator(".map-brief .route");
  const before = (await route.textContent())?.trim();
  expect(before).toBeTruthy();

  await page.getByRole("button", { name: /Nou mapa/i }).click();
  await expect.poll(async () => (await route.textContent())?.trim()).not.toBe(before);
  expect(await page.evaluate(() => localStorage.getItem("rumb-mode"))).toBe("normal");
  expect(await page.evaluate(() => localStorage.getItem("rumb-difficulty"))).toBe("pixapi");
});

test("Nou mapa surt del repte diari cap a un nivell normal aleatori", async ({ page }) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-to-normal",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "pixapi"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
    localStorage.setItem("rumb-difficulty", "pixapi");
  });
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  const route = page.locator(".map-brief .route");

  await page.getByRole("button", { name: /^Diari$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  const dailyRoute = (await route.textContent())?.trim();
  expect(dailyRoute).toBeTruthy();
  await page.getByRole("button", { name: /Nou mapa/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "normal");
  await expect.poll(async () => (await route.textContent())?.trim()).not.toBe(dailyRoute);

  expect(await page.evaluate(() => localStorage.getItem("rumb-difficulty"))).toBe("pixapi");
});

test("el comodi d'inicials mostra lletres grans sense sortir del mapa de cada comarca", async ({ page }) => {
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  await page.getByRole("button", { name: /Inicials/i }).click();
  await page.waitForSelector("text.initial");

  const metrics = await page.evaluate(() => {
    return [...document.querySelectorAll("text.initial")].map((text) => {
      const id = text.getAttribute("data-comarca-id");
      const path = document.querySelector(`path.comarca[data-comarca-id="${id}"]`);
      const textBox = text.getBBox();
      const pathBox = path.getBBox();
      const fontSize = parseFloat(getComputedStyle(text).fontSize);
      return {
        id,
        fontSize,
        inside:
          textBox.x >= pathBox.x - 2 &&
          textBox.y >= pathBox.y - 2 &&
          textBox.x + textBox.width <= pathBox.x + pathBox.width + 2 &&
          textBox.y + textBox.height <= pathBox.y + pathBox.height + 2
      };
    });
  });

  expect(metrics.length).toBeGreaterThan(30);
  expect(Math.max(...metrics.map((entry) => entry.fontSize))).toBeGreaterThan(18);
  expect(metrics.filter((entry) => !entry.inside)).toEqual([]);
});

test("inicia el nivell diari", async ({ page }) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-start",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "pixapi"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.getByRole("button", { name: /^Diari$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(page.locator(".brand-mode-description")).toHaveCount(0);
});

test("Diari i logo carreguen avui sense obrir el calendari", async ({ page }) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-reset-actions",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "pixapi"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.waitForSelector("svg.map");

  await page.getByRole("button", { name: /^Diari$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(page.locator(".calendar-panel")).toHaveCount(0);
  await expect(page.locator(".map-brief .route")).toContainText("Urgell");
  await expect(page.locator(".map-brief .route")).toContainText("Terra Alta");

  await page.getByRole("button", { name: /Calendari/i }).click();
  await expect(page.locator(".calendar-panel")).toBeVisible();
  await page.locator(".calendar-header .icon-button").click();
  await page.locator(".topbar .brand-button").click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(page.locator(".calendar-panel")).toHaveCount(0);
  await expect(page.locator(".map-brief .route")).toContainText("Urgell");
});

test("obrir el calendari no canvia el nivell carregat", async ({ page }) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-calendar-open-no-change",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "pixapi"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.getByRole("button", { name: /^Diari$/i }).click();
  await expect(page.locator(".map-brief .route")).toContainText("Urgell");
  const routeBefore = (await page.locator(".map-brief .route").textContent())?.trim();
  await page.getByRole("button", { name: /Calendari/i }).click();
  await expect(page.locator(".calendar-panel")).toBeVisible();
  expect((await page.locator(".map-brief .route").textContent())?.trim()).toBe(routeBefore);
});

test("completar el nivell diari desbloqueja totes les dificultats", async ({ page }) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-unlocks",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "pixapi"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
    localStorage.setItem("rumb-difficulty", "pixapi");
    localStorage.setItem("rumb-difficulty-unlocks-v1", JSON.stringify(["pixapi"]));
  });
  await gotoHome(page);
  await page.waitForSelector(".map-brief .route");
  const normalRoute = (await page.locator(".map-brief .route").textContent())?.trim();
  await page.getByRole("button", { name: /^Diari$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect
    .poll(async () => (await page.locator(".map-brief .route").textContent())?.trim())
    .not.toBe(normalRoute);

  const route = await getRouteAndRule(page);
  const guesses = resolveOptimalGuessNames(route);
  expect(guesses.length).toBeGreaterThan(0);
  await playGuesses(page, guesses);

  await expect(page.locator(".modal")).toBeVisible();
  await expect
    .poll(async () =>
      JSON.parse(
        (await page.evaluate(() => localStorage.getItem("rumb-difficulty-unlocks-v1"))) ||
          "[]"
      ).sort()
    )
    .toEqual(["cap-colla-rutes", "dominguero", "pixapi", "rondinaire"]);
});

test("la capcalera no mostra descripcio en mode explora", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await optionsDialog.getByRole("button", { name: /^Explora$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "explore");
  await expect(page.locator(".brand-mode-description")).toHaveCount(0);
});

test("contrarellotge tanca opcions i mostra compte enrere des de 5", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  await page.evaluate(() => {
    window.__countdownValues = [];
    const recordCountdown = () => {
      const text = document.querySelector(".countdown-value")?.textContent?.trim();
      if (!text) return;
      const values = window.__countdownValues;
      if (values[values.length - 1] !== text) {
        values.push(text);
      }
    };
    const observer = new MutationObserver(recordCountdown);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true
    });
    window.__countdownObserver = observer;
  });
  await page.getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await expect(optionsDialog).toBeVisible();
  await optionsDialog.getByRole("button", { name: /Contrarellotge/i }).click();
  await expect(optionsDialog).toBeHidden();
  await expect(page.locator(".brand-mode-description")).toHaveCount(0);

  const countdown = page.locator(".countdown-value");
  await expect(countdown).toHaveText("5");
  await expect(countdown).toBeHidden({ timeout: 8000 });
  const values = await page.evaluate(() => window.__countdownValues);
  expect(values).toEqual(["5", "4", "3", "2", "1"]);
});

test("clicar un nivell completat al calendari el reinicia i conserva el dia verd", async ({ page }) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-completed",
    start_id: "baix-camp",
    target_id: "valles-occidental",
    shortest_path: [
      "baix-camp",
      "alt-camp",
      "alt-penedes",
      "baix-llobregat",
      "valles-occidental"
    ],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "cap-colla-rutes"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(({ key, level }) => {
    const record = {
      levelKey: `daily:${key}`,
      dayKey: key,
      mode: "daily",
      attemptsList: [
        {
          attempts: 3,
          timeMs: 12345,
          playerPath: [{ id: "alt-camp", name: "Alt Camp" }],
          shortestPath: ["Alt Camp", "Barcelonès"],
          shortestCount: 2
        }
      ],
      winningAttempt: {
        attempts: 3,
        timeMs: 12345,
        playerPath: [{ id: "alt-camp", name: "Alt Camp" }],
        shortestPath: ["Alt Camp", "Barcelonès"],
        shortestCount: 2,
        distance: 1,
        difficulty: "cap-colla-rutes",
        ruleComarques: ["Alt Camp"]
      },
      shortestPath: ["Alt Camp", "Barcelonès"],
      shortestCount: 2
    };
    localStorage.setItem(
      "rumb-calendar-cache-v1",
      JSON.stringify({
        updatedAt: Date.now(),
        daily: [{ date: key, levelId: level.id, level }]
      })
    );
    localStorage.setItem(
      "rumb-completion-records-v1",
      JSON.stringify({ [`daily:${key}`]: record })
    );
  }, { key: dayKey, level });
  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  const dayButton = page.locator(`[data-calendar-day="${dayKey}"]`);
  await expect(dayButton).toHaveAttribute("data-has-level", "true");
  await expect(dayButton.locator(".calendar-dot")).toHaveClass(/done/);
  await dayButton.click();
  await expect(page.locator(".result-modal")).toBeHidden();
  await expect(page.locator(".map-brief .route")).toContainText("Baix Camp");
  await expect(page.locator(".map-brief .route")).toContainText(/Vall.s Occidental/);
  await expect(page.locator(".guess-history-item")).toHaveCount(0);

  await page.getByRole("button", { name: /Calendari/i }).click();
  const completedDay = page.locator(`[data-calendar-day="${dayKey}"]`);
  await expect(completedDay).toHaveClass(/done/);
  await expect(completedDay.locator(".calendar-dot")).toHaveClass(/done/);
});

test("Seguent mapa des d'un diari antic carrega el dia seguent del calendari", async ({
  page
}) => {
  const previousKey = getMadridDayKeyOffset(-1);
  const todayKey = getTodayKey();
  const previousLevel = {
    id: "daily-previous-next",
    start_id: "baix-camp",
    target_id: "valles-occidental",
    shortest_path: [
      "baix-camp",
      "alt-camp",
      "alt-penedes",
      "baix-llobregat",
      "valles-occidental"
    ],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "cap-colla-rutes"
  };
  const todayLevel = {
    id: "daily-current-next",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "cap-colla-rutes"
  };
  await mockDailyCalendarDetails(page, [
    { date: previousKey, level: previousLevel },
    { date: todayKey, level: todayLevel }
  ]);
  await page.addInitScript(
    ({ previousKey: prevKey, todayKey: currentKey, previousLevel, todayLevel }) => {
      const winningAttempt = {
        attempts: 2,
        timeMs: 9000,
        playerPath: [{ id: "alt-camp", name: "Alt Camp" }],
        shortestPath: ["Alt Camp", "Alt Penedes", "Baix Llobregat"],
        shortestCount: 3,
        distance: 1,
        mode: "daily",
        dayKey: prevKey,
        startName: "Baix Camp",
        targetName: "Valles Occidental"
      };
      localStorage.setItem(
        "rumb-calendar-cache-v1",
        JSON.stringify({
          updatedAt: Date.now(),
          daily: [
            { date: currentKey, levelId: todayLevel.id, level: todayLevel },
            { date: prevKey, levelId: previousLevel.id, level: previousLevel }
          ]
        })
      );
      localStorage.setItem(
        "rumb-completion-records-v1",
        JSON.stringify({
          [`daily:${prevKey}`]: {
            levelKey: `daily:${prevKey}`,
            dayKey: prevKey,
            mode: "daily",
            attemptsList: [winningAttempt],
            winningAttempt,
            shortestPath: winningAttempt.shortestPath,
            shortestCount: 3
          }
        })
      );
    },
    { previousKey, todayKey, previousLevel, todayLevel }
  );

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  const previousDayButton = page.locator(`[data-calendar-day="${previousKey}"]`);
  await expect(previousDayButton).toHaveAttribute("data-has-level", "true");
  await previousDayButton.click();
  await expect(page.locator(".map-brief .route")).toContainText("Baix Camp");
  await playGuesses(page, ["Alt Camp", "Alt Pened\u00e8s", "Baix Llobregat"]);
  const modal = page.locator(".result-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Seg.*nivell/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(modal).toBeHidden();
  await expect(page.locator(".map-brief .route")).toContainText("Urgell");
  await expect(page.locator(".map-brief .route")).toContainText("Terra Alta");
  await expect(page.locator(".guess-history-item")).toHaveCount(0);
});

test("Seguent mapa des del diari actual obre un mapa aleatori normal", async ({ page }) => {
  const todayKey = getTodayKey();
  const level = {
    id: "daily-current-random",
    start_id: "baix-camp",
    target_id: "valles-occidental",
    shortest_path: [
      "baix-camp",
      "alt-camp",
      "alt-penedes",
      "baix-llobregat",
      "valles-occidental"
    ],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "cap-colla-rutes"
  };
  await mockDailyCalendarDetails(page, [{ date: todayKey, level }]);
  await page.addInitScript(({ key, level }) => {
    const winningAttempt = {
      attempts: 2,
      timeMs: 9000,
      playerPath: [{ id: "alt-camp", name: "Alt Camp" }],
      shortestPath: ["Alt Camp", "Alt Penedes", "Baix Llobregat"],
      shortestCount: 3,
      distance: 1,
      mode: "daily",
      dayKey: key,
      startName: "Baix Camp",
      targetName: "Valles Occidental"
    };
    localStorage.setItem(
      "rumb-calendar-cache-v1",
      JSON.stringify({
        updatedAt: Date.now(),
        daily: [{ date: key, levelId: level.id, level }]
      })
    );
    localStorage.setItem(
      "rumb-completion-records-v1",
      JSON.stringify({
        [`daily:${key}`]: {
          levelKey: `daily:${key}`,
          dayKey: key,
          mode: "daily",
          attemptsList: [winningAttempt],
          winningAttempt,
          shortestPath: winningAttempt.shortestPath,
          shortestCount: 3
        }
      })
    );
  }, { key: todayKey, level });

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  const todayButton = page.locator(`[data-calendar-day="${todayKey}"]`);
  await expect(todayButton).toHaveAttribute("data-has-level", "true");
  await todayButton.click();
  await expect(page.locator(".map-brief .route")).toContainText("Baix Camp");
  await playGuesses(page, ["Alt Camp", "Alt Pened\u00e8s", "Baix Llobregat"]);
  const modal = page.locator(".result-modal");
  await expect(modal).toBeVisible();
  const routeBefore = (await page.locator(".map-brief .route").textContent())?.trim();
  await modal.getByRole("button", { name: /Seg.*nivell/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "normal");
  await expect(modal).toBeHidden();
  await expect
    .poll(async () => (await page.locator(".map-brief .route").textContent())?.trim())
    .not.toBe(routeBefore);
});

test("el modal mostra cami optim encara que la ruta ja sigui optima", async ({ page }) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-short",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "pixapi"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(({ key, level }) => {
    localStorage.setItem(
      "rumb-calendar-cache-v1",
      JSON.stringify({
        updatedAt: Date.now(),
        daily: [{ date: key, levelId: level.id, level }]
      })
    );
  }, { key: dayKey, level });
  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  await page.locator(`[data-calendar-day="${dayKey}"]`).click();
  await playGuesses(page, ["Garrigues", "Ribera d'Ebre"]);
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Repte diari completat");
  await expect(modal).toContainText("100% precisió");
  await expect(modal).not.toContainText("Has trobat");
  await expect(modal).toContainText("Un camí òptim");
  await expect(modal).not.toContainText("passos");
  const resultRouteColors = await modal.locator(".tutorial-result-list li").evaluateAll((items) =>
    items.map((item) => ({
      text: item.textContent.trim(),
      color: getComputedStyle(item).color
    }))
  );
  expect(resultRouteColors[0].text).toContain("Urgell");
  expect(resultRouteColors.at(-1).text).toContain("Terra Alta");
  expect(resultRouteColors[0].color).not.toBe(resultRouteColors[1].color);
  expect(resultRouteColors.at(-1).color).not.toBe(resultRouteColors[1].color);
  const primaryColor = await modal
    .getByRole("button", { name: /Seg.*nivell/i })
    .evaluate((button) => getComputedStyle(button).color);
  expect(primaryColor).toBe("rgb(255, 255, 255)");
  await modal.getByRole("tab", { name: /Un cam/i }).click();
  await expect(modal.locator('.tutorial-result-card[data-route-view="optimal"]')).toBeVisible();
  await expect(modal).not.toContainText("estrelles");
});

test("el boto diari reinicia un nivell completat i conserva el dia en verd", async ({
  page
}) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-reset",
    start_id: "baix-camp",
    target_id: "valles-occidental",
    shortest_path: [
      "baix-camp",
      "alt-camp",
      "alt-penedes",
      "baix-llobregat",
      "valles-occidental"
    ],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "cap-colla-rutes"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(({ key, level }) => {
    const winningAttempt = {
      attempts: 4,
      timeMs: 15000,
      playerPath: [{ id: "alt-camp", name: "Alt Camp" }],
      shortestPath: ["Alt Camp", "Alt Penedès", "Baix Llobregat"],
      shortestCount: 3,
      distance: 1,
      mode: "daily",
      difficulty: "cap-colla-rutes",
      dayKey: key,
      startName: "Baix Camp",
      targetName: "Vallès Occidental",
      ruleLabel: "Sense norma",
      ruleComarques: []
    };
    localStorage.setItem(
      "rumb-calendar-cache-v1",
      JSON.stringify({
        updatedAt: Date.now(),
        daily: [{ date: key, levelId: level.id, level }]
      })
    );
    localStorage.setItem(
      "rumb-completion-records-v1",
      JSON.stringify({
        [`daily:${key}`]: {
          levelKey: `daily:${key}`,
          dayKey: key,
          mode: "daily",
          attemptsList: [winningAttempt],
          winningAttempt,
          shortestPath: winningAttempt.shortestPath,
          shortestCount: 3
        }
      })
    );
  }, { key: dayKey, level });
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  await page.getByRole("button", { name: /^Diari$/i }).click();
  await expect(page.locator(".result-modal")).toBeHidden();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(page.locator(".map-brief .route")).toContainText("Baix Camp");
  await expect(page.locator(".map-brief .route")).toContainText("Vallès Occidental");
  await expect(page.locator(".map-brief .rule-line")).toContainText("Sense norma");
  await expect(page.locator(".guess-history-item")).toHaveCount(0);

  await page.getByRole("button", { name: /Calendari/i }).click();
  const dayButton = page.locator(`[data-calendar-day="${dayKey}"]`);
  await expect(dayButton).toHaveClass(/done/);
  await expect(dayButton.locator(".calendar-dot")).toHaveClass(/done/);
  await expect(dayButton.locator(".calendar-dot")).not.toHaveClass(/active/);
});

test("el modal de resultat no talla accions a amplades petites", async ({ page }) => {
  const dayKey = getTodayKey();
  const level = {
    id: "daily-result-actions",
    start_id: "baix-camp",
    target_id: "valles-occidental",
    shortest_path: [
      "baix-camp",
      "alt-camp",
      "alt-penedes",
      "baix-llobregat",
      "valles-occidental"
    ],
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    difficulty_id: "cap-colla-rutes"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);
  await page.addInitScript(({ key, level }) => {
    const winningAttempt = {
      attempts: 2,
      timeMs: 9000,
      playerPath: [{ id: "alt-camp", name: "Alt Camp" }],
      shortestPath: ["Alt Camp", "Alt Pened\u00e8s", "Baix Llobregat"],
      shortestCount: 3,
      distance: 0,
      mode: "daily",
      dayKey: key
    };
    const record = {
      levelKey: `daily:${key}`,
      dayKey: key,
      mode: "daily",
      attemptsList: [winningAttempt],
      winningAttempt,
      shortestPath: winningAttempt.shortestPath,
      shortestCount: 3
    };
    localStorage.setItem(
      "rumb-calendar-cache-v1",
      JSON.stringify({
        updatedAt: Date.now(),
        daily: [{ date: key, levelId: level.id, level }]
      })
    );
    localStorage.setItem(
      "rumb-completion-records-v1",
      JSON.stringify({ [`daily:${key}`]: record })
    );
  }, { key: dayKey, level });

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await gotoHome(page);
    await page.getByRole("button", { name: /Calendari/i }).click();
    await page.locator(`[data-calendar-day="${dayKey}"]`).click();
    await playGuesses(page, ["Alt Camp", "Alt Pened\u00e8s", "Baix Llobregat"]);
    const modal = page.locator(".result-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("button", { name: /Següent nivell/i })).toBeVisible();
    await expect(modal.getByRole("button", { name: /Repetir nivell/i })).toHaveCount(0);
    const metrics = await page.evaluate(() =>
      [...document.querySelectorAll(".tutorial-result-actions button")].map((button) => {
        const box = button.getBoundingClientRect();
        return {
          text: button.textContent.trim(),
          width: Math.round(box.width),
          height: Math.round(box.height),
          scrollWidth: button.scrollWidth,
          clientWidth: button.clientWidth
        };
      })
    );
    expect(metrics.map((entry) => entry.text)).toEqual([
      "Següent nivell",
      "Veure mapa"
    ]);
    expect(metrics.every((entry) => entry.height >= 44)).toBeTruthy();
    expect(metrics.every((entry) => entry.scrollWidth <= entry.clientWidth + 1)).toBeTruthy();
    await modal.getByRole("button", { name: /Veure mapa/i }).click();
  }
});

test("la llista de resultat alinea numeracio llarga dins del recuadre", async ({ page }) => {
  await gotoHome(page);
  const metrics = await page.evaluate(() => {
    const list = document.createElement("ol");
    list.className = "tutorial-result-list";
    list.style.width = "190px";
    list.style.boxSizing = "border-box";
    list.style.position = "fixed";
    list.style.left = "10px";
    list.style.top = "10px";
    const names = [
      "Baix Camp",
      "Pla de l'Estany",
      "Gironès",
      "Selva",
      "Vallès Oriental",
      "Baix Llobregat",
      "Alt Penedès",
      "Priorat",
      "Tarragonès",
      "Pla d'Urgell",
      "Alt Camp",
      "Vallès Occidental"
    ];
    names.forEach((name, index) => {
      const item = document.createElement("li");
      item.textContent = name;
      if (index === 0) item.className = "is-route-start";
      if (index === names.length - 1) item.className = "is-route-target";
      list.appendChild(item);
    });
    document.body.appendChild(list);
    const listBox = list.getBoundingClientRect();
    const itemBoxes = [...list.querySelectorAll("li")].map((item) =>
      item.getBoundingClientRect()
    );
    return {
      listLeft: Math.round(listBox.left),
      listRight: Math.round(listBox.right),
      minItemLeft: Math.round(Math.min(...itemBoxes.map((box) => box.left))),
      maxItemRight: Math.round(Math.max(...itemBoxes.map((box) => box.right))),
      tenthDisplay: getComputedStyle(list.querySelectorAll("li")[9]).display
    };
  });
  expect(metrics.minItemLeft).toBeGreaterThanOrEqual(metrics.listLeft);
  expect(metrics.maxItemRight).toBeLessThanOrEqual(metrics.listRight);
  expect(metrics.tenthDisplay).toBe("grid");
});

test("el comodi revelar norma marca la comarca correcta en una norma simple", async ({
  page
}) => {
  const dayKey = getTodayKey();
  const comarcaName = SINGLE_REQUIRE_RULE.comarques[0];
  const comarcaId = comarcaIdByName.get(normalizeName(comarcaName));
  expect(comarcaId).toBeTruthy();
  const level = {
    id: "daily-rule-reveal-single",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: SINGLE_REQUIRE_RULE.id,
    avoid_ids: null,
    must_pass_ids: [comarcaId],
    difficulty_id: "pixapi"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level }]);

  await page.addInitScript(
    ({ key, level }) => {
      localStorage.setItem(
        "rumb-calendar-cache-v1",
        JSON.stringify({
          updatedAt: Date.now(),
          daily: [{ date: key, levelId: level.id, level }]
        })
      );
    },
    { key: dayKey, level }
  );

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  await page.locator(`[data-calendar-day="${dayKey}"]`).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(page.getByRole("button", { name: /Revelar norma/i })).toBeVisible();
  await page.getByRole("button", { name: /Revelar norma/i }).click();
  await page.waitForSelector("path.comarca.is-rule-reveal[data-comarca-name]");
  const revealNames = await page
    .locator("path.comarca.is-rule-reveal[data-comarca-name]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-comarca-name")).filter(Boolean));
  expect(revealNames).toEqual([comarcaName]);
});

test("el comodi revelar norma marca totes les comarques i no surt a cap de colla", async ({
  page
}) => {
  const dayKey = getTodayKey();
  const countyIds = MULTI_REQUIRE_RULE.comarques
    .map((name) => comarcaIdByName.get(normalizeName(name)))
    .filter(Boolean);
  expect(countyIds).toHaveLength(MULTI_REQUIRE_RULE.comarques.length);
  const softLevel = {
    id: "daily-rule-reveal-dominguero",
    start_id: "urgell",
    target_id: "terra-alta",
    shortest_path: ["urgell", "garrigues", "ribera-ebre", "terra-alta"],
    rule_id: MULTI_REQUIRE_RULE.id,
    avoid_ids: null,
    must_pass_ids: countyIds,
    difficulty_id: "dominguero"
  };
  const hardLevel = {
    ...softLevel,
    id: "daily-rule-reveal-cap-colla-rutes",
    difficulty_id: "cap-colla-rutes"
  };
  await mockDailyCalendarDetails(page, [{ date: dayKey, level: softLevel }]);

  await page.addInitScript(
    ({ key, level }) => {
      localStorage.setItem(
        "rumb-calendar-cache-v1",
        JSON.stringify({
          updatedAt: Date.now(),
          daily: [{ date: key, levelId: level.id, level }]
        })
      );
    },
    { key: dayKey, level: softLevel }
  );

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  await page.locator(`[data-calendar-day="${dayKey}"]`).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(page.getByRole("button", { name: /Revelar norma/i })).toBeVisible();
  await page.getByRole("button", { name: /Revelar norma/i }).click();
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll("path.comarca.is-rule-reveal[data-comarca-name]").length ===
      expected,
    MULTI_REQUIRE_RULE.comarques.length
  );
  const revealNames = await page
    .locator("path.comarca.is-rule-reveal[data-comarca-name]")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-comarca-name")).filter(Boolean).sort()
    );
  expect(revealNames).toEqual([...MULTI_REQUIRE_RULE.comarques].sort());

  const hardPage = await page.context().newPage();
  await mockDailyCalendarDetails(hardPage, [{ date: dayKey, level: hardLevel }]);
  await hardPage.addInitScript(
    ({ key, level, tutorialKey }) => {
      localStorage.setItem(tutorialKey, "1");
      localStorage.setItem(
        "rumb-calendar-cache-v1",
        JSON.stringify({
          updatedAt: Date.now(),
          daily: [{ date: key, levelId: level.id, level }]
        })
      );
    },
    {
      key: dayKey,
      level: hardLevel,
      tutorialKey: TUTORIAL_SEEN_KEY
    }
  );
  await gotoHome(hardPage);
  await hardPage.getByRole("button", { name: /Calendari/i }).click();
  await hardPage.locator(`[data-calendar-day="${dayKey}"]`).click();
  await hardPage.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(hardPage.getByRole("button", { name: /Revelar norma/i })).toHaveCount(0);
  await hardPage.close();
});

test("les opcions de so es persisteixen dins d'Opcions", async ({ page }) => {
  await gotoHome(page);
  await page.getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await expect(optionsDialog.getByRole("button", { name: /^Diari$/i })).toHaveCount(0);
  await expect(optionsDialog.getByRole("button", { name: /^Setmanal$/i })).toHaveCount(0);
  await expect(optionsDialog.getByRole("button", { name: /Calendari/i })).toHaveCount(0);
  await expect(optionsDialog.locator(".difficulty-grid .difficulty-button").first()).toContainText(
    "Pixapí"
  );
  await expect(optionsDialog.getByRole("button", { name: /Configuraci/i })).toHaveCount(0);
  await expect(page.locator(".config-modal")).toHaveCount(0);
  await expect(optionsDialog.locator(".options-body select")).toHaveCount(1);
  await expect(optionsDialog.locator(".options-body .toggle-button")).toHaveCount(2);
  await expect(optionsDialog).not.toContainText("Idioma");
  const routeBefore = await getRouteAndRule(page);
  await optionsDialog.locator(".options-body .toggle-button").nth(1).click();
  expect(await getRouteAndRule(page)).toEqual(routeBefore);
  await optionsDialog.getByRole("button", { name: /Tanca/i }).click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("rumb-settings-v1");
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return parsed.sfxEnabled === true && !Object.prototype.hasOwnProperty.call(parsed, "language");
    } catch {
      return false;
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const savedSettings = await page.evaluate(() => {
    const raw = localStorage.getItem("rumb-settings-v1");
    return raw ? JSON.parse(raw) : null;
  });
  expect(savedSettings?.language).toBeUndefined();
  expect(savedSettings?.sfxEnabled).toBe(true);
  await page.getByRole("button", { name: /Opcions/i }).click();
  const reopenedOptions = page.getByRole("dialog", { name: /Opcions/i });
  await expect(reopenedOptions.getByRole("button", { name: /Configuraci/i })).toHaveCount(0);
  await expect(reopenedOptions.locator(".options-body select")).toHaveCount(1);
  await expect(reopenedOptions).not.toContainText("Idioma");
});

test("els valors antics d'idioma s'ignoren i conserva la descripcio original", async ({ page }) => {
  expect(translate("ca-standard", "descriptionNormal")).toBe(STANDARD_DESCRIPTION);
  await page.addInitScript(() => {
    localStorage.setItem("rumb-language-v1", "aranes");
    localStorage.setItem(
      "rumb-settings-v1",
      JSON.stringify({
        theme: "default",
        language: "gironi"
      })
    );
  });
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  await page.getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await expect(optionsDialog.getByRole("button", { name: /Configuraci/i })).toHaveCount(0);
  await expect(optionsDialog.locator(".options-body select")).toHaveCount(1);
  await expect(optionsDialog).not.toContainText("Idioma");
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("rumb-settings-v1");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !Object.prototype.hasOwnProperty.call(parsed, "language");
  });
});

test("els simbols dels controls es renderitzen correctament", async ({ page }) => {
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  await expect(page.getByRole("button", { name: /Allunyar/i })).toHaveText("−");

  await page.getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await expect(optionsDialog.locator(".icon-button")).toHaveText("×");
  await optionsDialog.getByRole("button", { name: /Tanca/i }).click();

  await page.getByRole("button", { name: /Calendari/i }).click();
  const calendarPanel = page.locator(".calendar-panel");
  await expect(calendarPanel).toBeVisible();
  await expect(calendarPanel.locator(".calendar-header .icon-button")).toHaveText("×");
  await expect(calendarPanel.locator(".calendar-month .icon-button").first()).toHaveText("‹");
  await expect(calendarPanel.locator(".calendar-month .icon-button").last()).toHaveText("›");
});

test("el calendari habilita dies disponibles des de cache sense esperar xarxa", async ({
  page
}) => {
  const dayKey = getTodayKey();
  await page.route("**/*calendar_daily*", (route) => route.abort("failed"));
  await page.addInitScript((key) => {
    localStorage.setItem(
      "rumb-calendar-cache-v1",
      JSON.stringify({
        updatedAt: Date.now(),
        daily: [{ date: key, levelId: "cached-level", level: null }]
      })
    );
  }, dayKey);
  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  const dayButton = page.locator(`[data-calendar-day="${dayKey}"]`);
  await expect(dayButton).toHaveAttribute("data-has-level", "true");
  await expect(dayButton).toBeEnabled();
});

test("un jugador nou sense cache veu el calendari daily des de Supabase", async ({
  page
}) => {
  const todayKey = getTodayKey();
  const yesterdayKey = getMadridDayKeyOffset(-1);
  const supabaseHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, x-client-info, content-type, prefer, range",
    "access-control-expose-headers": "content-range",
    "content-range": "0-1/2"
  };

  await page.route("**/*calendar_daily_bootstrap_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify({
        serverDay: todayKey,
        from: "2025-01-01",
        to: getMadridDayKeyOffset(30),
        expectedPastDays: 2,
        assignedPastDays: 2,
        missingPastCount: 0,
        rows: [
          { date: todayKey, level_id: "level-today", server_day: todayKey, is_unlocked: true },
          { date: yesterdayKey, level_id: "level-yesterday", server_day: todayKey, is_unlocked: true }
        ]
      })
    });
  });
  await page.route("**/*daily_calendar_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ...supabaseHeaders, "content-range": "*/0" },
      body: JSON.stringify([])
    });
  });

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  await expect(page.locator(`[data-calendar-day="${todayKey}"]`)).toHaveAttribute(
    "data-has-level",
    "true"
  );
  await expect(page.locator(`[data-calendar-day="${yesterdayKey}"]`)).toHaveAttribute(
    "data-has-level",
    "true"
  );
});

test("el calendari completa una cache antiga amb la disponibilitat autoritativa", async ({
  page
}) => {
  const todayKey = getTodayKey();
  const yesterdayKey = getMadridDayKeyOffset(-1);
  const oldKey = getMadridDayKeyOffset(-3);
  const supabaseHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, x-client-info, content-type, prefer, range",
    "access-control-expose-headers": "content-range",
    "content-range": "0-2/3"
  };

  await page.route("**/*calendar_daily_bootstrap_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify({
        serverDay: todayKey,
        from: "2025-01-01",
        to: getMadridDayKeyOffset(30),
        expectedPastDays: 3,
        assignedPastDays: 3,
        missingPastCount: 0,
        rows: [
          { date: todayKey, level_id: "level-today-authoritative", server_day: todayKey, is_unlocked: true },
          { date: yesterdayKey, level_id: "level-yesterday-authoritative", server_day: todayKey, is_unlocked: true },
          { date: oldKey, level_id: "level-old-cache", server_day: todayKey, is_unlocked: true }
        ]
      })
    });
  });
  await page.route("**/*calendar_daily_availability_state_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify([
        {
          date: todayKey,
          level_id: "level-today-authoritative",
          server_day: todayKey,
          is_unlocked: true
        },
        {
          date: yesterdayKey,
          level_id: "level-yesterday-authoritative",
          server_day: todayKey,
          is_unlocked: true
        },
        {
          date: oldKey,
          level_id: "level-old-cache",
          server_day: todayKey,
          is_unlocked: true
        }
      ])
    });
  });
  await page.route("**/*daily_calendar_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ...supabaseHeaders, "content-range": "*/0" },
      body: JSON.stringify([])
    });
  });
  await page.addInitScript((key) => {
    localStorage.setItem(
      "rumb-calendar-cache-v1",
      JSON.stringify({
        updatedAt: Date.now() - 86400000,
        daily: [{ date: key, levelId: "level-old-cache", level: null }]
      })
    );
  }, oldKey);

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  await expect(page.locator(`[data-calendar-day="${todayKey}"]`)).toHaveAttribute(
    "data-has-level",
    "true"
  );
  await expect(page.locator(`[data-calendar-day="${yesterdayKey}"]`)).toHaveAttribute(
    "data-has-level",
    "true"
  );
  await page.waitForFunction(
    ([cacheKey, expectedToday]) => {
      const parsed = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      return (
        parsed.version &&
        parsed.serverDay === expectedToday &&
        Array.isArray(parsed.daily) &&
        parsed.daily.some((entry) => entry.date === expectedToday)
      );
    },
    ["rumb-calendar-cache-v1", todayKey]
  );
});

test("el calendari bloqueja un dia futur encara que tingui nivell assignat", async ({
  page
}) => {
  const todayKey = getTodayKey();
  const tomorrowKey = getMadridDayKeyOffset(1);
  const supabaseHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, x-client-info, content-type, prefer, range",
    "access-control-expose-headers": "content-range",
    "content-range": "0-1/2"
  };

  await page.route("**/*calendar_daily_bootstrap_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify({
        serverDay: todayKey,
        from: "2025-01-01",
        to: getMadridDayKeyOffset(30),
        expectedPastDays: 1,
        assignedPastDays: 1,
        missingPastCount: 0,
        rows: [
          { date: tomorrowKey, level_id: "level-future", server_day: todayKey, is_unlocked: false },
          { date: todayKey, level_id: "level-today", server_day: todayKey, is_unlocked: true }
        ]
      })
    });
  });
  await page.route("**/*calendar_daily_availability_state_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify([
        {
          date: tomorrowKey,
          level_id: "level-future",
          server_day: todayKey,
          is_unlocked: false
        },
        {
          date: todayKey,
          level_id: "level-today",
          server_day: todayKey,
          is_unlocked: true
        }
      ])
    });
  });
  await page.route("**/*daily_calendar_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ...supabaseHeaders, "content-range": "*/0" },
      body: JSON.stringify([])
    });
  });

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  if (tomorrowKey.slice(0, 7) !== todayKey.slice(0, 7)) {
    await page.locator(".calendar-month .icon-button").last().click();
  }
  const tomorrowButton = page.locator(`[data-calendar-day="${tomorrowKey}"]`);
  await expect(tomorrowButton).toHaveAttribute("data-has-level", "false");
  await expect(tomorrowButton).toHaveAttribute("data-locked", "true");
  await expect(tomorrowButton).toBeDisabled();
});

test("una resposta buida del backend no es guarda com calendari valid", async ({
  page
}) => {
  const todayKey = getTodayKey();
  const supabaseHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, x-client-info, content-type, prefer, range",
    "access-control-expose-headers": "content-range",
    "content-range": "*/0"
  };

  await page.route("**/*calendar_daily_bootstrap_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify({
        serverDay: todayKey,
        from: "2025-01-01",
        to: getMadridDayKeyOffset(30),
        expectedPastDays: 1,
        assignedPastDays: 0,
        missingPastCount: 1,
        rows: []
      })
    });
  });
  await page.route("**/*daily_calendar_public*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify([])
    });
  });

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  await expect(page.locator(".calendar-panel")).toContainText(
    /No s'han pogut carregar|Reintenta/
  );
  await page.waitForFunction(() => !localStorage.getItem("rumb-calendar-cache-v1"));
});

test("el calendari permet clicar disponibilitat abans del detall del nivell", async ({
  page
}) => {
  const dayKey = getTodayKey();
  let releaseDetail;
  const detailGate = new Promise((resolve) => {
    releaseDetail = resolve;
  });
  let availabilityRequests = 0;
  let detailRequests = 0;
  const supabaseHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, x-client-info, content-type, prefer, range",
    "access-control-expose-headers": "content-range",
    "content-range": "0-0/1"
  };

  await page.route("**/*calendar_daily*", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    availabilityRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify([{ date: dayKey, level_id: "level-slow-detail" }])
    });
  });
  await page.route("**/*daily_calendar_public*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: supabaseHeaders });
    }
    detailRequests += 1;
    await detailGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: supabaseHeaders,
      body: JSON.stringify([
        {
          date: dayKey,
          level_id: "level-slow-detail",
          start_id: "baix-camp",
          target_id: "valles-occidental",
          shortest_path: [
            "baix-camp",
            "alt-camp",
            "alt-penedes",
            "baix-llobregat",
            "valles-occidental"
          ],
          rule_id: null,
          avoid_ids: null,
          must_pass_ids: null,
          difficulty_id: "cap-colla-rutes"
        }
      ])
    });
  });
  await page.addInitScript((key) => {
    localStorage.setItem(
      "rumb-calendar-cache-v1",
      JSON.stringify({
        updatedAt: Date.now(),
        daily: [{ date: key, levelId: "level-slow-detail", level: null }]
      })
    );
  }, dayKey);

  await gotoHome(page);
  await page.getByRole("button", { name: /Calendari/i }).click();
  const dayButton = page.locator(`[data-calendar-day="${dayKey}"]`);
  await expect(dayButton).toHaveAttribute("data-has-level", "true");
  await expect(dayButton).toBeEnabled();
  await dayButton.click();
  await expect(page.locator(".calendar-panel")).toHaveCount(0);
  await expect.poll(() => detailRequests).toBeGreaterThan(0);
  releaseDetail();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(page.locator(".map-brief .route")).toContainText("Baix Camp");
  await expect(page.locator(".map-brief .route")).toContainText("Vallès Occidental");
});

test("arrenca amb l'audio silenciat i nomes mostra botons en mobil", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  await page.waitForFunction(() => {
    const appRaw = localStorage.getItem("rumb-settings-v1");
    const soundRaw = localStorage.getItem("rumb-sound-settings-v1");
    if (!appRaw || !soundRaw) return false;
    const app = JSON.parse(appRaw);
    const sound = JSON.parse(soundRaw);
    return (
      app.musicEnabled === false &&
      app.musicVolume === 0 &&
      app.musicTrack === "random" &&
      app.sfxEnabled === false &&
      app.sfxVolume === 0 &&
      sound.enabled === false &&
      sound.sfxVolume === 0 &&
      !Object.prototype.hasOwnProperty.call(sound, "masterVolume")
    );
  });

  await page.locator(".bottom-nav").getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await expect(optionsDialog.getByRole("button", { name: /Configuraci/i })).toHaveCount(0);
  const ranges = optionsDialog.locator('input[type="range"]');
  const toggles = optionsDialog.locator(".toggle-button");
  await expect(ranges).toHaveCount(0);
  await expect(toggles).toHaveCount(2);
  await expect(optionsDialog.locator("select")).toHaveValue("random");
  await expect(toggles.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(toggles.nth(1)).toHaveAttribute("aria-pressed", "false");

  await toggles.nth(0).click();
  await page.waitForFunction(() => {
    const settings = JSON.parse(localStorage.getItem("rumb-settings-v1") || "{}");
    return (
      settings.musicEnabled === true &&
      settings.musicVolume === 1 &&
      settings.musicTrack === "random"
    );
  });

  await toggles.nth(1).click();
  await page.waitForFunction(() => {
    const settings = JSON.parse(localStorage.getItem("rumb-settings-v1") || "{}");
    const sound = JSON.parse(localStorage.getItem("rumb-sound-settings-v1") || "{}");
    return (
      settings.sfxEnabled === true &&
      settings.sfxVolume === 1 &&
      sound.enabled === true &&
      sound.sfxVolume === 1
    );
  });
});

test("usa les families de sons del manifest en interaccions reals", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
    localStorage.setItem(
      "rumb-settings-v1",
      JSON.stringify({
        theme: "default",
        musicEnabled: false,
        musicVolume: 0,
        musicTrack: "segadors",
        sfxEnabled: true,
        sfxVolume: 1
      })
    );
    localStorage.setItem(
      "rumb-sfx-settings-v1",
      JSON.stringify({ enabled: true, volume: 1 })
    );
    localStorage.setItem(
      "rumb-sound-settings-v1",
      JSON.stringify({ enabled: true, sfxVolume: 1 })
    );
    window.__playedAudio = [];
    HTMLMediaElement.prototype.play = function () {
      window.__playedAudio.push({
        kind: this.dataset?.sfxKind || "",
        file: this.dataset?.sfxFile || "",
        src: this.currentSrc || this.src || ""
      });
      setTimeout(() => this.dispatchEvent(new Event("ended")), 0);
      return Promise.resolve();
    };
  });

  const manifestResponse = page.waitForResponse((response) =>
    response.url().includes("/audio/audio-manifest.json")
  );
  await gotoHome(page);
  await manifestResponse;
  await page.waitForSelector("svg.map");

  const playedKinds = () =>
    page.evaluate(() => window.__playedAudio.map((entry) => entry.kind).filter(Boolean));
  const expectKind = async (kind) => {
    await expect.poll(async () => await playedKinds()).toContain(kind);
  };

  await page.getByRole("button", { name: /Apropar/i }).click();
  await expectKind("click");

  await page.getByRole("button", { name: /Opcions/i }).click();
  await expectKind("open");
  let optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await optionsDialog.getByRole("button", { name: /Contrarellotge/i }).click();
  await expectKind("toggle");
  await expectKind("countdown");
  await expect(page.locator(".countdown-value")).toBeHidden({ timeout: 8000 });

  await page.getByRole("button", { name: /Opcions/i }).click();
  optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await optionsDialog.getByRole("button", { name: /^Explora$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "explore");
  await expect(optionsDialog.getByRole("button", { name: /Configuraci/i })).toHaveCount(0);
  await optionsDialog.getByRole("button", { name: /Tanca/i }).click();
  await expectKind("close");

  const input = page.locator("#guess-input");
  await input.fill("Comarca inventada");
  await page.getByRole("button", { name: /Esbrina/i }).click();
  await expectKind("submit");
  await expectKind("error");

  const candidates = await page.evaluate(() => {
    const routeText = document.querySelector(".map-brief .route")?.textContent || "";
    return [
      ...new Set(
        [...document.querySelectorAll("path.comarca[data-comarca-name]")]
          .map((path) => path.getAttribute("data-comarca-name"))
          .filter((name) => name && !routeText.includes(name))
      )
    ].slice(0, 20);
  });
  expect(candidates.length).toBeGreaterThan(0);
  const repeatCandidate = candidates[0];
  for (const name of candidates) {
    await input.fill(name);
    await page.getByRole("button", { name: /Esbrina/i }).click();
    const kinds = await playedKinds();
    if (kinds.includes("neutral")) break;
  }
  await expectKind("neutral");
  await input.fill(repeatCandidate);
  await page.getByRole("button", { name: /Esbrina/i }).click();
  await expectKind("repeat");

  await expect(page.getByRole("button", { name: /Revela un pas/i })).toBeEnabled();
  for (let index = 0; index < 14; index += 1) {
    if (await page.locator(".modal").isVisible().catch(() => false)) break;
    const revealButton = page.getByRole("button", { name: /Revela un pas/i });
    if (!(await revealButton.isEnabled().catch(() => false))) break;
    const clicked = await revealButton.click({ timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) break;
    await expectKind("powerup");
    await page.waitForSelector("path.comarca.is-reveal[data-comarca-name]");
    const revealName = await page
      .locator("path.comarca.is-reveal[data-comarca-name]")
      .first()
      .getAttribute("data-comarca-name");
    expect(revealName).toBeTruthy();
    await input.fill(revealName);
    await page.getByRole("button", { name: /Esbrina/i }).click();
  }

  await expect(page.locator(".modal")).toBeVisible({ timeout: 3000 });
  await expectKind("correct");
  await expectKind("win");
  const uniqueKinds = [...new Set(await playedKinds())];
  expect(uniqueKinds).toEqual(
    expect.arrayContaining([
      "click",
      "open",
      "close",
      "toggle",
      "submit",
      "correct",
      "repeat",
      "neutral",
      "error",
      "countdown",
      "powerup",
      "win"
    ])
  );
});

test("els botons desktop encaixen amb el panel lateral", async ({ page }) => {
  await page.setViewportSize({ width: 945, height: 562 });
  await gotoHome(page);
  await page.waitForSelector("svg.map");

  const metrics = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect
        ? {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          }
        : null;
    };
    const buttonMetrics = (selector) =>
      [...document.querySelectorAll(selector)].map((button) => {
        const rect = button.getBoundingClientRect();
        const styles = getComputedStyle(button);
        return {
          text: button.textContent.trim(),
          width: rect.width,
          height: rect.height,
          scrollWidth: button.scrollWidth,
          clientWidth: button.clientWidth,
          whiteSpace: styles.whiteSpace
        };
      });
    const overlaps = (a, b) =>
      Boolean(
        a &&
          b &&
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top
      );
    const actions = box(".topbar-actions");
    const playCard = box(".play-card");
    const prompt = box(".map-brief");
    const controls = box(".map-controls");
    const mapStage = box(".map-stage");
    return {
      alignDelta: Math.abs((actions?.left || 0) - (playCard?.left || 0)),
      widthDelta: Math.abs((actions?.width || 0) - (playCard?.width || 0)),
      topbarButtons: buttonMetrics(".topbar-actions button"),
      mapControls: buttonMetrics(".map-controls button"),
      controlsInsideMap:
        Boolean(controls && mapStage) &&
        controls.left >= mapStage.left &&
        controls.right <= mapStage.right &&
        controls.top >= mapStage.top &&
        controls.bottom <= mapStage.bottom,
      controlsOverlapPrompt: overlaps(controls, prompt),
      submitHeight: box(".submit")?.height || 0,
      powerupHeights: buttonMetrics(".powerup-button").map((entry) => entry.height),
      optionsHeight: box(".options-launch-button")?.height || 0
    };
  });

  expect(metrics.alignDelta).toBeLessThanOrEqual(1);
  expect(metrics.widthDelta).toBeLessThanOrEqual(1);
  expect(metrics.topbarButtons).toHaveLength(3);
  expect(
    metrics.topbarButtons.every(
      (button) =>
        button.height >= 50 &&
        button.height <= 56 &&
        button.whiteSpace === "nowrap" &&
        button.scrollWidth <= button.clientWidth + 1
    )
  ).toBeTruthy();
  expect(metrics.mapControls[0].width).toBeGreaterThanOrEqual(42);
  expect(metrics.mapControls[0].width).toBeLessThanOrEqual(45);
  expect(metrics.mapControls[0].height).toBeGreaterThanOrEqual(42);
  expect(metrics.mapControls[0].height).toBeLessThanOrEqual(45);
  expect(metrics.mapControls[1].width).toBeGreaterThanOrEqual(42);
  expect(metrics.mapControls[1].width).toBeLessThanOrEqual(45);
  expect(metrics.mapControls[1].height).toBeGreaterThanOrEqual(42);
  expect(metrics.mapControls[1].height).toBeLessThanOrEqual(45);
  expect(metrics.mapControls[2].width).toBeGreaterThanOrEqual(84);
  expect(metrics.mapControls[2].width).toBeLessThanOrEqual(90);
  expect(metrics.mapControls[2].height).toBeGreaterThanOrEqual(42);
  expect(metrics.mapControls[2].height).toBeLessThanOrEqual(45);
  expect(metrics.controlsInsideMap).toBeTruthy();
  expect(metrics.controlsOverlapPrompt).toBeFalsy();
  expect(metrics.submitHeight).toBeGreaterThanOrEqual(48);
  expect(metrics.submitHeight).toBeLessThanOrEqual(52);
  expect(metrics.powerupHeights.every((height) => height >= 48 && height <= 52)).toBeTruthy();
  expect(metrics.optionsHeight).toBeGreaterThanOrEqual(46);
  expect(metrics.optionsHeight).toBeLessThanOrEqual(50);

  await page.setViewportSize({ width: 1440, height: 850 });
  await page.waitForTimeout(150);
  const largeMapControls = await page.evaluate(() =>
    [...document.querySelectorAll(".map-controls button")].map((button) => {
      const box = button.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    })
  );
  expect(largeMapControls[0].width).toBeGreaterThan(metrics.mapControls[0].width);
  expect(largeMapControls[0].width).toBeLessThanOrEqual(48);
  expect(largeMapControls[0].height).toBeGreaterThan(metrics.mapControls[0].height);
  expect(largeMapControls[0].height).toBeLessThanOrEqual(48);
  expect(largeMapControls[2].width).toBeGreaterThan(metrics.mapControls[2].width);
  expect(largeMapControls[2].width).toBeLessThanOrEqual(102);
});

test("la navegacio mobil te nomes reptes a capcalera i accions a baix", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "explore");
    localStorage.setItem("rumb-difficulty", "pixapi");
  });
  await gotoHome(page);
  await page.waitForSelector("svg.map");

  await expect(page.locator(".topbar .brand")).toBeVisible();
  await expect(page.locator(".topbar .brand h1")).toHaveText("camicurt.cat");
  await expect(page.locator(".topbar .brand-logo")).toBeVisible();
  await expect(page.locator(".brand-date")).toBeHidden();
  await expect(page.locator(".brand-mode-description")).toBeHidden();
  await expect(page.locator(".topbar-new-game")).toBeHidden();
  await expect(page.locator(".topbar-calendar")).toBeHidden();
  await expect(page.locator(".topbar").getByRole("button", { name: /^Diari$/i })).toHaveCount(0);
  await expect(page.locator(".topbar").getByRole("button", { name: /^Setmanal$/i })).toHaveCount(0);
  const mobileBrandMetrics = await page.evaluate(() => {
    const brand = document.querySelector(".topbar .brand");
    const button = document.querySelector(".topbar .brand-button");
    const brandBox = brand?.getBoundingClientRect();
    const buttonBox = button?.getBoundingClientRect();
    const brandStyle = brand ? getComputedStyle(brand) : null;
    return {
      centerDelta:
        brandBox && buttonBox
          ? Math.round(
              Math.abs(
                brandBox.left + brandBox.width / 2 - (buttonBox.left + buttonBox.width / 2)
              )
            )
          : Infinity,
      buttonWidth: Math.round(buttonBox?.width || 0),
      brandWidth: Math.round(brandBox?.width || 0),
      background: brandStyle?.backgroundColor || "",
      borderTopWidth: brandStyle?.borderTopWidth || "",
      boxShadow: brandStyle?.boxShadow || ""
    };
  });
  expect(mobileBrandMetrics.centerDelta).toBeLessThanOrEqual(3);
  expect(mobileBrandMetrics.buttonWidth).toBeLessThan(mobileBrandMetrics.brandWidth);
  expect(mobileBrandMetrics.background).toBe("rgba(0, 0, 0, 0)");
  expect(mobileBrandMetrics.borderTopWidth).toBe("0px");
  expect(mobileBrandMetrics.boxShadow).toBe("none");

  await page.locator(".topbar .brand-button").click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");

  const bottomLabels = await page
    .locator(".bottom-nav .bottom-nav-label")
    .evaluateAll((items) => items.map((item) => item.textContent.trim()));
  expect(bottomLabels).toEqual(["Calendari", "Nou mapa", "Opcions"]);
  expect(bottomLabels).not.toContain("Joc");
  await expect(page.locator(".bottom-nav-icon:visible")).toHaveCount(0);
  await expect(page.locator(".options-launch-button")).toBeHidden();
  await expect(page.locator(".bottom-nav-new-game")).toBeVisible();
  const bottomNavMetrics = await page.evaluate(() => {
    const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect();
    const calendar = document
      .querySelector(".bottom-nav")
      ?.querySelector("button:nth-of-type(1)")
      ?.getBoundingClientRect();
    const newGame = document.querySelector(".bottom-nav-new-game")?.getBoundingClientRect();
    const options = document
      .querySelector(".bottom-nav")
      ?.querySelector("button:nth-of-type(3)")
      ?.getBoundingClientRect();
    return {
      navHeight: Math.round(nav?.height || 0),
      calendarWidth: Math.round(calendar?.width || 0),
      calendarHeight: Math.round(calendar?.height || 0),
      newGameWidth: Math.round(newGame?.width || 0),
      newGameHeight: Math.round(newGame?.height || 0),
      optionsWidth: Math.round(options?.width || 0),
      optionsHeight: Math.round(options?.height || 0)
    };
  });
  expect(bottomNavMetrics.newGameWidth).toBeGreaterThanOrEqual(98);
  expect(bottomNavMetrics.newGameWidth).toBeLessThanOrEqual(118);
  expect(bottomNavMetrics.navHeight).toBeGreaterThanOrEqual(60);
  expect(bottomNavMetrics.navHeight).toBeLessThanOrEqual(64);
  expect(bottomNavMetrics.calendarHeight).toBeGreaterThanOrEqual(38);
  expect(bottomNavMetrics.calendarHeight).toBeLessThanOrEqual(42);
  expect(bottomNavMetrics.newGameHeight).toBeGreaterThanOrEqual(42);
  expect(bottomNavMetrics.newGameHeight).toBeLessThanOrEqual(46);
  expect(bottomNavMetrics.optionsHeight).toBeGreaterThanOrEqual(38);
  expect(bottomNavMetrics.optionsHeight).toBeLessThanOrEqual(42);

  await page.locator(".bottom-nav").getByRole("button", { name: /Nou mapa/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "normal");
  expect(await page.evaluate(() => localStorage.getItem("rumb-difficulty"))).toBe("pixapi");
});

test("la barra mobil no talla accions ni solapa el mapa", async ({ page }) => {
  const expectedBottomLabels = ["calendar", "newGame", "options"].map((key) =>
    translate("ca-standard", key)
  );
  await page.addInitScript(() => {
    localStorage.setItem("rumb-settings-v1", JSON.stringify({ theme: "default" }));
  });
  const observedZoomWidths = [];
  const observedRecenterWidths = [];
  for (const width of [320, 390, 459]) {
    await page.setViewportSize({ width, height: 844 });
    await gotoHome(page);
    await page.waitForSelector("svg.map");
    const metrics = await page.evaluate(() =>
      [...document.querySelectorAll(".bottom-nav button")].map((button) => {
        const label = button.querySelector(".bottom-nav-label");
        const buttonBox = button.getBoundingClientRect();
        const labelBox = label.getBoundingClientRect();
        return {
          text: label.textContent.trim(),
          buttonWidth: Math.round(buttonBox.width),
          buttonHeight: Math.round(buttonBox.height),
          labelWidth: Math.round(labelBox.width),
          labelHeight: Math.round(labelBox.height)
        };
      })
    );
    expect(metrics.map((entry) => entry.text)).toEqual(expectedBottomLabels);
    expect(
      metrics.every((entry) => entry.labelWidth <= entry.buttonWidth - 8)
    ).toBeTruthy();
    expect(
      metrics.every((entry) => entry.labelHeight <= entry.buttonHeight - 8)
    ).toBeTruthy();
    const mapBriefMetrics = await page.evaluate(() => {
      const map = document.querySelector(".map-wrap")?.getBoundingClientRect();
      const prompt = document.querySelector(".map-brief")?.getBoundingClientRect();
      const svg = document.querySelector("svg.map")?.getBoundingClientRect();
      const controls = document.querySelector(".map-controls")?.getBoundingClientRect();
      const controlButtons = [...document.querySelectorAll(".map-controls button")].map(
        (button) => {
          const box = button.getBoundingClientRect();
          return {
            width: Math.round(box.width),
            height: Math.round(box.height),
            scrollWidth: Math.round(button.scrollWidth),
            clientWidth: Math.round(button.clientWidth)
          };
        }
      );
      const markedComarques = [
        ...document.querySelectorAll(".comarca.is-start, .comarca.is-target")
      ].map((path) => path.getBoundingClientRect());
      const overlaps = (a, b) =>
        Boolean(
          a &&
            b &&
            a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top
        );
      return {
        promptLeft: Math.round(prompt?.left || 0),
        promptRight: Math.round(prompt?.right || 0),
        promptBottom: Math.round(prompt?.bottom || 0),
        svgTop: Math.round(svg?.top || 0),
        mapLeft: Math.round(map?.left || 0),
        mapRight: Math.round(map?.right || 0),
        overlapsControls: overlaps(prompt, controls),
        overlapsSvg: overlaps(prompt, svg),
        overlapsMarkedComarques: markedComarques.some((box) => overlaps(prompt, box)),
        controlButtons
      };
    });
    expect(mapBriefMetrics.promptLeft).toBeGreaterThanOrEqual(mapBriefMetrics.mapLeft);
    expect(mapBriefMetrics.promptRight).toBeLessThanOrEqual(mapBriefMetrics.mapRight);
    expect(mapBriefMetrics.promptBottom).toBeLessThanOrEqual(mapBriefMetrics.svgTop);
    expect(mapBriefMetrics.overlapsControls).toBeFalsy();
    expect(mapBriefMetrics.overlapsSvg).toBeFalsy();
    expect(mapBriefMetrics.overlapsMarkedComarques).toBeFalsy();
    expect(mapBriefMetrics.controlButtons[0].width).toBeGreaterThanOrEqual(38);
    expect(mapBriefMetrics.controlButtons[0].width).toBeLessThanOrEqual(42);
    expect(mapBriefMetrics.controlButtons[0].height).toBeGreaterThanOrEqual(38);
    expect(mapBriefMetrics.controlButtons[0].height).toBeLessThanOrEqual(42);
    expect(mapBriefMetrics.controlButtons[1].width).toBeGreaterThanOrEqual(38);
    expect(mapBriefMetrics.controlButtons[1].width).toBeLessThanOrEqual(42);
    expect(mapBriefMetrics.controlButtons[1].height).toBeGreaterThanOrEqual(38);
    expect(mapBriefMetrics.controlButtons[1].height).toBeLessThanOrEqual(42);
    expect(mapBriefMetrics.controlButtons[2].width).toBeGreaterThanOrEqual(76);
    expect(mapBriefMetrics.controlButtons[2].width).toBeLessThanOrEqual(84);
    expect(mapBriefMetrics.controlButtons[2].height).toBeGreaterThanOrEqual(38);
    expect(mapBriefMetrics.controlButtons[2].height).toBeLessThanOrEqual(42);
    expect(
      mapBriefMetrics.controlButtons.every(
        (button) => button.scrollWidth <= button.clientWidth + 1
      )
    ).toBeTruthy();
    observedZoomWidths.push(mapBriefMetrics.controlButtons[0].width);
    observedRecenterWidths.push(mapBriefMetrics.controlButtons[2].width);
  }
  expect(observedZoomWidths[0]).toBeLessThan(observedZoomWidths[2]);
  expect(observedRecenterWidths[0]).toBeLessThan(observedRecenterWidths[2]);

  await page.setViewportSize({ width: 390, height: 844 });
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  let guesses = [];
  for (let index = 0; index < 6; index += 1) {
    guesses = resolveOptimalGuessNames(await getRouteAndRule(page));
    if (guesses.length) break;
    await page.locator(".bottom-nav").getByRole("button", { name: /Nou mapa/i }).click();
  }
  expect(guesses.length).toBeGreaterThan(0);
  await playGuesses(page, guesses);
  await expect(page.locator(".modal")).toBeVisible();
  const completedMetrics = await page.evaluate(() => {
    const prompt = document.querySelector(".map-brief")?.getBoundingClientRect();
    const svg = document.querySelector("svg.map")?.getBoundingClientRect();
    const clipToSvg = (box) => {
      if (!box || !svg) return null;
      const left = Math.max(box.left, svg.left);
      const right = Math.min(box.right, svg.right);
      const top = Math.max(box.top, svg.top);
      const bottom = Math.min(box.bottom, svg.bottom);
      if (left >= right || top >= bottom) return null;
      return { left, right, top, bottom };
    };
    const completed = [
      ...document.querySelectorAll(
        ".comarca.is-start, .comarca.is-target, .comarca.is-complete-route"
      )
    ]
      .map((path) => clipToSvg(path.getBoundingClientRect()))
      .filter(Boolean);
    const overlaps = (a, b) =>
      Boolean(
        a &&
          b &&
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top
      );
    return {
      completedCount: completed.length,
      overlapsCompletedRoute: completed.some((box) => overlaps(prompt, box))
    };
  });
  expect(completedMetrics.completedCount).toBeGreaterThan(0);
  expect(completedMetrics.overlapsCompletedRoute).toBeFalsy();
});

