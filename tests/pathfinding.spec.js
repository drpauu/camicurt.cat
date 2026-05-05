import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aStarShortestPath,
  dijkstraAllShortestPaths,
  findShortestPathsWithRule
} from "../src/lib/pathfinding.js";
import { normalizeName } from "../src/lib/names.js";
import {
  isDisabledDirectComarcaRule,
  isDisabledGroupCulturalRule,
  isDisabledRule
} from "../src/lib/disabledRules.js";
import { classifyDifficultyByShortestCount } from "../src/lib/difficulty.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const graph = new Map([
  ["a", new Set(["b", "c"])],
  ["b", new Set(["a", "d"])],
  ["c", new Set(["a", "d"])],
  ["d", new Set(["b", "c", "e"])],
  ["e", new Set(["d"])]
]);

const centroids = new Map([
  ["a", { lat: 0, lon: 0 }],
  ["b", { lat: 1, lon: 0 }],
  ["c", { lat: 0, lon: 1 }],
  ["d", { lat: 1, lon: 1 }],
  ["e", { lat: 2, lon: 1 }]
]);

test("Dijkstra retorna tots els camins minims", () => {
  const result = dijkstraAllShortestPaths("a", "d", graph);
  expect(result.distance).toBe(2);
  expect(result.paths.map((path) => path.join(">")).sort()).toEqual([
    "a>b>d",
    "a>c>d"
  ]);
});

test("A* retorna una ruta amb la mateixa distancia minima", () => {
  const dijkstra = dijkstraAllShortestPaths("a", "e", graph);
  const astar = aStarShortestPath("a", "e", graph, { centroidMap: centroids });
  expect(astar.length - 1).toBe(dijkstra.distance);
});

test("les regles avoid i mustIncludeAny canvien les rutes optimes", () => {
  const avoid = findShortestPathsWithRule(
    "a",
    "d",
    graph,
    { kind: "avoid", comarcaIds: ["b"] },
    [...graph.keys()],
    { centroidMap: centroids }
  );
  expect(avoid.primaryPath).toEqual(["a", "c", "d"]);

  const must = findShortestPathsWithRule(
    "a",
    "e",
    graph,
    { kind: "mustIncludeAny", comarcaIds: ["c"] },
    [...graph.keys()],
    { centroidMap: centroids }
  );
  expect(must.primaryPath).toEqual(["a", "c", "d", "e"]);
});

test("la normalitzacio de comarca exigeix accents i apostrofs", () => {
  expect(normalizeName("VALLÈS OCCIDENTAL")).toBe(normalizeName("Vallès Occidental"));
  expect(normalizeName("valles occidental")).not.toBe(normalizeName("Vallès Occidental"));
  expect(normalizeName("Val d'Aran")).toBe(normalizeName("val d'aran"));
  expect(normalizeName("Val d Aran")).not.toBe(normalizeName("Val d'Aran"));
});

test("les regles de grup cultural queden deshabilitades", () => {
  expect(isDisabledGroupCulturalRule("group-10-0")).toBeTruthy();
  expect(
    isDisabledGroupCulturalRule({
      text: "Has de passar per una comarca de grup cultural 11."
    })
  ).toBeTruthy();
  expect(
    isDisabledGroupCulturalRule({ id: "coast-avoid", text: "No pots passar pel litoral." })
  ).toBeFalsy();
  const appRules = JSON.parse(
    fs.readFileSync(path.join(rootDir, "src", "data", "rules.json"), "utf8")
  );
  expect(appRules.some((rule) => isDisabledGroupCulturalRule(rule))).toBeFalsy();
});

test("les regles directes que revelen comarca queden deshabilitades", () => {
  expect(isDisabledDirectComarcaRule("alt-camp-direct-0")).toBeTruthy();
  expect(isDisabledDirectComarcaRule("girones-direct-1")).toBeTruthy();
  expect(isDisabledDirectComarcaRule({ text: "Has de passar per Gironès." })).toBeTruthy();
  expect(isDisabledDirectComarcaRule({ text: "No pots passar per Gironès." })).toBeTruthy();
  expect(
    isDisabledDirectComarcaRule({
      text: "Has de passar per la comarca de muralles i ponts."
    })
  ).toBeFalsy();
  expect(isDisabledRule({ text: "Has de passar per Gironès." })).toBeTruthy();
});

test("la dificultat es classifica nomes per distancia del cami curt", () => {
  expect(classifyDifficultyByShortestCount(3)).toBe("pixapi");
  expect(classifyDifficultyByShortestCount(4)).toBe("dominguero");
  expect(classifyDifficultyByShortestCount(5)).toBe("dominguero");
  expect(classifyDifficultyByShortestCount(6)).toBe("rondinaire");
  expect(classifyDifficultyByShortestCount(8)).toBe("rondinaire");
  expect(classifyDifficultyByShortestCount(9)).toBe("cap-colla-rutes");
});

test("els seeds del banc guarden difficulty_id segons el shortest_path", () => {
  const sql = fs.readFileSync(
    path.join(rootDir, "supabase", "seed_level_bank_10000.sql"),
    "utf8"
  );
  const rows = sql
    .split(/\r?\n/)
    .filter((line) => /^\s*\('bank:/.test(line));
  expect(rows.length).toBeGreaterThan(0);
  const mismatches = rows.filter((line) => {
    const match = line.match(
      /^\s*\('[^']+', '([^']+)', (?:'[^']+'|null), '[^']+', '[^']+', (array\[[^\]]+\]::text\[])/
    );
    if (!match) return true;
    const difficultyId = match[1];
    const pathIds = [...match[2].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
    return difficultyId !== classifyDifficultyByShortestCount(pathIds);
  });
  expect(mismatches.slice(0, 5)).toEqual([]);
});

test("les dades i seeds no tornen a introduir regles deshabilitades", () => {
  const jsonPaths = [
    "src/data/rules.json",
    "data/rules.json",
    "supabase/functions/generate-level/rules.json",
    ...fs
      .readdirSync(path.join(rootDir, "normes"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join("normes", name))
  ];
  const jsonOffenders = jsonPaths.filter((relativePath) => {
    const rules = JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
    return Array.isArray(rules) && rules.some((rule) => isDisabledRule(rule));
  });
  expect(jsonOffenders).toEqual([]);

  const checkedPaths = [
    "scripts/generate-rules.mjs",
    "supabase/seed_level_bank_10000.sql",
    ...fs
      .readdirSync(path.join(rootDir, "supabase", "seed_level_bank_10000_chunks"))
      .filter((name) => name.endsWith(".sql"))
      .map((name) => path.join("supabase", "seed_level_bank_10000_chunks", name))
  ];
  const disabledPattern = /grup cultural|group-\d+-[01]|-direct-[01]/i;
  const offenders = checkedPaths.filter((relativePath) =>
    disabledPattern.test(fs.readFileSync(path.join(rootDir, relativePath), "utf8"))
  );
  expect(offenders).toEqual([]);
});
