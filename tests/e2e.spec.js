import { test, expect } from "@playwright/test";

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
  await expect(page.getByRole("button", { name: /^Setmanal$/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Calendari/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Esbrina/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Opcions/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Veïnes|VeÃ¯nes/i })).toHaveCount(0);
  await expect(page.locator(".bottom-nav").getByText(/Calendari/i)).toHaveCount(0);
  await expect(page.getByText(/Inici:/i)).toBeVisible();
  await expect(page.getByText(/Destí:/i)).toBeVisible();
  await expect(page.getByText(/Norma:/i)).toBeVisible();
  await expect(page.getByText(/Sense connexió/i)).toHaveCount(0);
  await expect(page.getByText(/^Jugada$/i)).toHaveCount(0);
  await expect(page.getByText(/Comarques:/i)).toHaveCount(0);
  await expect(page.getByText(/Òptim:/i)).toHaveCount(0);
});

test("inicia el nivell diari", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.getByRole("button", { name: /^Diari$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "daily");
});

test("inicia el nivell setmanal", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("rumb-mode", "normal");
  });
  await gotoHome(page);
  await page.getByRole("button", { name: /^Setmanal$/i }).click();
  await page.waitForFunction(() => localStorage.getItem("rumb-mode") === "weekly");
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
        shortestCount: 2
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
  await expect(page.locator(".modal")).toBeVisible();
});

test("la configuració es persisteix", async ({ page }) => {
  await gotoHome(page);
  await page.getByRole("button", { name: /Opcions/i }).click();
  const optionsDialog = page.getByRole("dialog", { name: /Opcions/i });
  await expect(optionsDialog.getByRole("button", { name: /^Diari$/i })).toHaveCount(0);
  await expect(optionsDialog.getByRole("button", { name: /^Setmanal$/i })).toHaveCount(0);
  await expect(optionsDialog.getByRole("button", { name: /Calendari/i })).toHaveCount(0);
  await page.getByRole("button", { name: /Configuració/i }).click();
  await page.locator(".config-content select").last().selectOption("aranes");
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
