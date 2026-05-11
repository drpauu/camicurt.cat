import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const url = process.argv[2] || "https://www.camicurt.cat/";
const outDir = path.resolve(".perf");
const outPath = path.join(outDir, "lighthouse-mobile.json");
const chromePath = process.env.CHROME_PATH || chromium.executablePath();
const chromePort = Number(process.env.LIGHTHOUSE_PORT || 9222);
const profileDir = path.join(outDir, ".chrome-profile");
await fs.mkdir(outDir, { recursive: true });
await fs.rm(profileDir, { recursive: true, force: true });

async function waitForChrome(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chromium did not open a remote debugging port in time.");
}

const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${chromePort}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    "about:blank"
  ],
  { stdio: "ignore" }
);

try {
  await waitForChrome(chromePort);
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "lighthouse",
      url,
      `--port=${chromePort}`,
      "--output=json",
      `--output-path=${outPath}`,
      "--quiet"
    ],
    { stdio: "inherit", shell: process.platform === "win32" }
  );

  if (result.status !== 0) {
    throw new Error(`Lighthouse failed with exit code ${result.status}`);
  }
} finally {
  chrome.kill();
}

console.log(`Lighthouse written to ${outPath}`);
