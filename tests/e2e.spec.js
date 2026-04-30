import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feature, neighbors as topoNeighbors } from "topojson-client";
import { findShortestPathsWithRule } from "../src/lib/pathfinding.js";
import { normalizeName } from "../src/lib/names.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const topoPath = path.resolve(__dirname, "..", "public", "catalunya-comarques.topojson");
const rulesPath = path.resolve(__dirname, "..", "src", "data", "rules.json");
const RULES = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
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
    await input.fill(name);
    await page.getByRole("button", { name: /Esbrina/i }).click();
  }
};

const getTodayKey = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
};

const gotoHome = (page) => page.goto("/", { waitUntil: "domcontentloaded" });

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
  await expect(page.locator(".brand-mode-description")).toContainText("uneix Inici i Dest");
  await expect(page.locator(".brand-mode-description")).not.toContainText("Mode normal:");
  const headerAlignment = await page.evaluate(() => {
    const titleBox = document.querySelector(".brand h1")?.getBoundingClientRect();
    const dateBox = document.querySelector(".brand-date")?.getBoundingClientRect();
    const descriptionBox = document
      .querySelector(".brand-mode-description")
      ?.getBoundingClientRect();
    const actionsBox = document.querySelector(".topbar-actions")?.getBoundingClientRect();
    return {
      dateTitleBottomDelta:
        titleBox && dateBox ? Math.abs(titleBox.bottom - dateBox.bottom) : Infinity,
      descriptionTitleBottomDelta:
        titleBox && descriptionBox
          ? Math.abs(titleBox.bottom - descriptionBox.bottom)
          : Infinity,
      descriptionStartsAfterDate:
        dateBox && descriptionBox ? descriptionBox.left > dateBox.right : false,
      descriptionBeforeActions:
        descriptionBox && actionsBox ? descriptionBox.right <= actionsBox.left - 4 : false
    };
  });
  expect(headerAlignment.dateTitleBottomDelta).toBeLessThanOrEqual(4);
  expect(headerAlignment.descriptionTitleBottomDelta).toBeLessThanOrEqual(4);
  expect(headerAlignment.descriptionStartsAfterDate).toBeTruthy();
  expect(headerAlignment.descriptionBeforeActions).toBeTruthy();
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
        href: "/logo/favicon-simple-96.png",
        sizes: "96x96"
      }),
      expect.objectContaining({
        href: "/logo/favicon-simple-48.png",
        sizes: "48x48"
      })
    ])
  );
  await expect((await page.request.get("/logo/favicon-simple-96.png")).ok()).toBeTruthy();
  await expect((await page.request.get("/logo/favicon-simple.svg")).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: /Nova partida/i })).toBeVisible();
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

test("nova partida genera un repte nou mantenint mode i dificultat", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
    localStorage.setItem("rumb-difficulty", "pixapi");
  });
  await gotoHome(page);
  await page.waitForSelector("svg.map");
  const route = page.locator(".map-brief .route");
  const before = (await route.textContent())?.trim();
  expect(before).toBeTruthy();

  await page.getByRole("button", { name: /Nova partida/i }).click();
  await expect.poll(async () => (await route.textContent())?.trim()).not.toBe(before);
  expect(await page.evaluate(() => localStorage.getItem("rumb-mode"))).toBe("normal");
  expect(await page.evaluate(() => localStorage.getItem("rumb-difficulty"))).toBe("pixapi");
});

test("nova partida surt del repte diari cap a un nivell normal aleatori", async ({ page }) => {
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
  await page.getByRole("button", { name: /Nova partida/i }).click();
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
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.getByRole("button", { name: /^Diari$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await expect(page.locator(".brand-mode-description")).toContainText("uneix Inici i Dest");
  await expect(page.locator(".brand-mode-description")).not.toContainText("Mode diari:");
});

test("completar el nivell diari desbloqueja totes les dificultats", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
    localStorage.setItem("rumb-difficulty", "pixapi");
    localStorage.setItem("rumb-difficulty-unlocks-v1", JSON.stringify(["pixapi"]));
  });
  await gotoHome(page);
  await page.getByRole("button", { name: /^Diari$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
  await page.waitForSelector(".map-brief .route");

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

test("la descripcio de capcalera canvia en mode explora", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await optionsDialog.getByRole("button", { name: /^Explora$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "explore");
  await expect(page.locator(".brand-mode-description")).toContainText("juga sense pressa");
  await expect(page.locator(".brand-mode-description")).not.toContainText("Explora:");
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
  await expect(page.locator(".brand-mode-description")).toContainText(
    "completa el cam"
  );
  await expect(page.locator(".brand-mode-description")).not.toContainText("Contrarellotge:");

  const countdown = page.locator(".countdown-value");
  await expect(countdown).toHaveText("5");
  await expect(countdown).toBeHidden({ timeout: 8000 });
  const values = await page.evaluate(() => window.__countdownValues);
  expect(values).toEqual(["5", "4", "3", "2", "1"]);
});

test("obre el modal si el nivell ja està completat", async ({ page }) => {
  const dayKey = getTodayKey();
  await page.addInitScript((key) => {
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
        distance: 1
      },
      shortestPath: ["Alt Camp", "Barcelonès"],
      shortestCount: 2
    };
    localStorage.setItem(
      "rumb-completion-records-v1",
      JSON.stringify({ [`daily:${key}`]: record })
    );
  }, dayKey);
  await gotoHome(page);
  await page.getByRole("button", { name: /^Diari$/i }).click();
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Intents: 3");
  await expect(modal).toContainText("Temps: 0:12");
  await expect(modal).toContainText("Camí més curt: 2 comarques");
  await expect(modal).toContainText("Un camí òptim");
  await expect(modal).toContainText("Alt Camp");
  await expect(modal).not.toContainText("Top temps");
  await expect(modal).not.toContainText("Distribució");
  await expect(modal).not.toContainText("El teu recorregut");
  const resetStyles = await modal.locator(".reset").evaluate((button) => {
    const styles = getComputedStyle(button);
    return {
      backgroundColor: styles.backgroundColor,
      borderRadius: styles.borderRadius,
      fontWeight: styles.fontWeight
    };
  });
  expect(resetStyles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(resetStyles.borderRadius).toBe("8px");
  expect(Number(resetStyles.fontWeight)).toBeGreaterThanOrEqual(600);
});

test("el modal no mostra cami optim si la ruta ja es curta", async ({ page }) => {
  const dayKey = getTodayKey();
  await page.addInitScript((key) => {
    const winningAttempt = {
      attempts: 2,
      timeMs: 9000,
      playerPath: [{ id: "alt-camp", name: "Alt Camp" }],
      shortestPath: ["Alt Camp"],
      shortestCount: 1,
      distance: 0
    };
    const record = {
      levelKey: `daily:${key}`,
      dayKey: key,
      mode: "daily",
      attemptsList: [winningAttempt],
      winningAttempt,
      shortestPath: ["Alt Camp"],
      shortestCount: 1
    };
    localStorage.setItem(
      "rumb-completion-records-v1",
      JSON.stringify({ [`daily:${key}`]: record })
    );
  }, dayKey);
  await gotoHome(page);
  await page.getByRole("button", { name: /^Diari$/i }).click();
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Camí més curt: 1 comarques");
  await expect(modal).not.toContainText("Un camí òptim");
});

test("la configuració es persisteix", async ({ page }) => {
  await gotoHome(page);
  await page.getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await expect(optionsDialog.getByRole("button", { name: /^Diari$/i })).toHaveCount(0);
  await expect(optionsDialog.getByRole("button", { name: /^Setmanal$/i })).toHaveCount(0);
  await expect(optionsDialog.getByRole("button", { name: /Calendari/i })).toHaveCount(0);
  await expect(optionsDialog.locator(".difficulty-grid .difficulty-button").first()).toContainText(
    "Pixapí"
  );
  await optionsDialog.getByRole("button", { name: /^Configuració$/i }).click();
  const configModal = page.locator(".config-modal");
  await expect(configModal.getByRole("heading", { name: /^Configuració$/i })).toBeVisible();
  const languageSelect = page.locator(".config-content select").last();
  await expect(languageSelect).toContainText("Català");
  await expect(languageSelect).toContainText("Aranès");
  await expect(languageSelect).toContainText("Gironí");
  await expect(languageSelect).toContainText("Barceloní");
  await expect(languageSelect).toContainText("Tarragoní");
  await expect(languageSelect).toContainText("Lleidatà");
  await languageSelect.selectOption("aranes");
  await page.getByRole("button", { name: /Tanca/i }).click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("rumb-settings-v1");
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return parsed.language === "aranes";
    } catch {
      return false;
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const language = await page.evaluate(() => {
    const raw = localStorage.getItem("rumb-settings-v1");
    return raw ? JSON.parse(raw).language : null;
  });
  expect(language).toBe("aranes");
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

test("arrenca amb l'audio silenciat i el volum funciona en mobil", async ({ page }) => {
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
      app.sfxEnabled === false &&
      app.sfxVolume === 0 &&
      sound.enabled === false &&
      sound.masterVolume === 0 &&
      sound.sfxVolume === 0
    );
  });

  await page.locator(".bottom-nav").getByRole("button", { name: /Opcions/i }).click();
  await page.getByRole("button", { name: /Configuraci/i }).click();
  const ranges = page.locator('.config-content input[type="range"]');
  await expect(ranges).toHaveCount(3);
  await expect(ranges.nth(0)).toHaveValue("0");
  await expect(ranges.nth(1)).toHaveValue("0");
  await expect(ranges.nth(2)).toHaveValue("0");
  await expect(ranges.nth(1)).toBeEnabled();
  await expect(ranges.nth(2)).toBeEnabled();
  await expect(page.locator('.config-content input[type="checkbox"]').first()).not.toBeChecked();

  const setRangeValue = async (range, value) => {
    await range.evaluate((input, nextValue) => {
      input.value = nextValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  };

  await setRangeValue(ranges.nth(0), "0.42");
  await expect(ranges.nth(0)).toHaveValue("0.42");
  await page.waitForFunction(() => {
    const settings = JSON.parse(localStorage.getItem("rumb-settings-v1") || "{}");
    return settings.musicEnabled === true && settings.musicVolume === 0.42;
  });

  await setRangeValue(ranges.nth(1), "0.35");
  await expect(ranges.nth(1)).toHaveValue("0.35");
  await page.waitForFunction(() => {
    const sound = JSON.parse(localStorage.getItem("rumb-sound-settings-v1") || "{}");
    return sound.enabled === true && sound.masterVolume === 0.35 && sound.sfxVolume === 1;
  });
});

test("usa les families de sons del manifest en interaccions reals", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
    localStorage.setItem(
      "rumb-settings-v1",
      JSON.stringify({
        theme: "default",
        language: "ca",
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
      JSON.stringify({ enabled: true, masterVolume: 1, sfxVolume: 1 })
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
  await optionsDialog.getByRole("button", { name: /Configuraci/i }).click();
  await page.locator(".config-modal").getByRole("button", { name: /Tanca/i }).click();
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
    await page.getByRole("button", { name: /Revela un pas/i }).click();
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
  await expect(page.locator(".topbar").getByRole("button", { name: /^Diari$/i })).toBeVisible();
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
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "normal");

  const bottomLabels = await page
    .locator(".bottom-nav .bottom-nav-label")
    .evaluateAll((items) => items.map((item) => item.textContent.trim()));
  expect(bottomLabels).toEqual(["Calendari", "Nova partida", "Opcions"]);
  expect(bottomLabels).not.toContain("Joc");
  await expect(page.locator(".bottom-nav-icon:visible")).toHaveCount(0);
  await expect(page.locator(".options-launch-button")).toBeHidden();
  await expect(page.locator(".bottom-nav-new-game")).toBeVisible();
  const bottomNavMetrics = await page.evaluate(() => {
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
      calendarWidth: Math.round(calendar?.width || 0),
      newGameWidth: Math.round(newGame?.width || 0),
      optionsWidth: Math.round(options?.width || 0),
      newGameHeight: Math.round(newGame?.height || 0)
    };
  });
  expect(bottomNavMetrics.newGameWidth).toBeGreaterThan(bottomNavMetrics.calendarWidth);
  expect(bottomNavMetrics.newGameWidth).toBeGreaterThan(bottomNavMetrics.optionsWidth);
  expect(bottomNavMetrics.newGameHeight).toBeGreaterThanOrEqual(44);

  await page.locator(".bottom-nav").getByRole("button", { name: /Nova partida/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "normal");
  expect(await page.evaluate(() => localStorage.getItem("rumb-difficulty"))).toBe("pixapi");
});

test("la barra mobil no talla les accions a amplades petites", async ({ page }) => {
  for (const width of [320, 390]) {
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
          labelWidth: Math.round(labelBox.width),
          nowrap: getComputedStyle(label).whiteSpace
        };
      })
    );
    expect(metrics.map((entry) => entry.text)).toEqual([
      "Calendari",
      "Nova partida",
      "Opcions"
    ]);
    expect(metrics.every((entry) => entry.nowrap === "nowrap")).toBeTruthy();
    expect(
      metrics.every((entry) => entry.labelWidth <= entry.buttonWidth - 8)
    ).toBeTruthy();
  }
});

