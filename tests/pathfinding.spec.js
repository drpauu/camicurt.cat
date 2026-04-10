import { test, expect } from "@playwright/test";
import {
  aStarShortestPath,
  dijkstraAllShortestPaths,
  findShortestPathsWithRule
} from "../src/lib/pathfinding.js";
import { normalizeName } from "../src/lib/names.js";

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
