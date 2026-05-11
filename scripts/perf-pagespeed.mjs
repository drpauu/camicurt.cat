import fs from "node:fs/promises";
import path from "node:path";

const strategy = process.argv[2] === "desktop" ? "desktop" : "mobile";
const url = process.argv[3] || "https://www.camicurt.cat/";
const outDir = path.resolve(".perf");
const outPath = path.join(outDir, `psi-${strategy}.json`);
const params = new URLSearchParams({
  url,
  strategy,
  category: "performance",
  locale: "es"
});
if (process.env.PAGESPEED_API_KEY) {
  params.set("key", process.env.PAGESPEED_API_KEY);
}
["accessibility", "best-practices", "seo"].forEach((category) =>
  params.append("category", category)
);

const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`;
await fs.mkdir(outDir, { recursive: true });
let response = await fetch(endpoint);
if (response.status === 429) {
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  if (retryAfter > 0 && retryAfter <= 30) {
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    response = await fetch(endpoint);
  }
}
if (!response.ok) {
  const detail = await response.text().catch(() => "");
  throw new Error(
    `PageSpeed ${strategy} failed: ${response.status} ${response.statusText} ${detail}`.trim()
  );
}
const payload = await response.text();
await fs.writeFile(outPath, payload);
console.log(`PageSpeed ${strategy} written to ${outPath}`);
