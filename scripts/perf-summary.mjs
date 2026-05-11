import fs from "node:fs/promises";
import path from "node:path";

const files = process.argv.slice(2);
const defaultFiles = [
  ".perf/psi-mobile.json",
  ".perf/psi-desktop.json",
  ".perf/lighthouse-mobile.json"
];

function score(category) {
  return category?.score == null ? null : Math.round(category.score * 100);
}

function audit(result, id) {
  return result?.audits?.[id]?.displayValue || null;
}

function summarize(payload) {
  const result = payload.lighthouseResult || payload;
  const audits = result.audits || {};
  const opportunities = Object.entries(audits)
    .filter(([, value]) => value?.details?.overallSavingsMs != null)
    .sort((a, b) => b[1].details.overallSavingsMs - a[1].details.overallSavingsMs)
    .slice(0, 10)
    .map(([id, value]) => ({
      id,
      title: value.title,
      savingsMs: Math.round(value.details.overallSavingsMs),
      displayValue: value.displayValue || ""
    }));

  const diagnostics = Object.entries(audits)
    .filter(([, value]) => value?.score != null && value.score < 1)
    .slice(0, 20)
    .map(([id, value]) => ({
      id,
      title: value.title,
      score: value.score,
      displayValue: value.displayValue || ""
    }));

  return {
    scores: {
      performance: score(result.categories?.performance),
      accessibility: score(result.categories?.accessibility),
      bestPractices: score(result.categories?.["best-practices"]),
      seo: score(result.categories?.seo)
    },
    metrics: {
      fcp: audit(result, "first-contentful-paint"),
      lcp: audit(result, "largest-contentful-paint"),
      tbt: audit(result, "total-blocking-time"),
      cls: audit(result, "cumulative-layout-shift"),
      speedIndex: audit(result, "speed-index")
    },
    opportunities,
    diagnostics
  };
}

for (const file of files.length ? files : defaultFiles) {
  const filePath = path.resolve(file);
  try {
    const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
    console.log(`\n${file}`);
    console.log(JSON.stringify(summarize(payload), null, 2));
  } catch (error) {
    console.warn(`Skipping ${file}: ${error.message}`);
  }
}
