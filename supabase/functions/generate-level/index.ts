import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { feature, neighbors as topoNeighbors } from "https://esm.sh/topojson-client@3.1.0";
import { geoCentroid } from "https://esm.sh/d3-geo@3.1.1";
import topology from "./catalunya-comarques.topojson.json" assert { type: "json" };
import rules from "./rules.json" assert { type: "json" };

const RULE_HISTORY_LIMIT = 60;
const GROUP_CULTURAL_RULE_ID_PATTERN = /^group-\d+-[01]$/;
const GROUP_CULTURAL_TEXT_PATTERN = /grup cultural/i;
const DIRECT_COMARCA_RULE_ID_PATTERN = /-direct-[01]$/;
const DIRECT_COMARCA_TEXT_PATTERN = /^(Has de passar per|No pots passar per) (.+)\.$/i;
const DIRECT_COMARCA_NAMES = new Set(
  [
    "Alt Camp",
    "Alt Empordà",
    "Alt Penedès",
    "Alt Urgell",
    "Alta Ribagorça",
    "Anoia",
    "Bages",
    "Baix Camp",
    "Baix Ebre",
    "Baix Empordà",
    "Baix Llobregat",
    "Baix Penedès",
    "Barcelonès",
    "Berguedà",
    "Cerdanya",
    "Conca de Barberà",
    "Garraf",
    "Garrigues",
    "Garrotxa",
    "Gironès",
    "Lluçanès",
    "Maresme",
    "Moianès",
    "Montsià",
    "Noguera",
    "Osona",
    "Pallars Jussà",
    "Pallars Sobirà",
    "Pla de l'Estany",
    "Pla d'Urgell",
    "Priorat",
    "Ribera d'Ebre",
    "Ripollès",
    "Segarra",
    "Segrià",
    "Selva",
    "Solsonès",
    "Tarragonès",
    "Terra Alta",
    "Urgell",
    "Val d'Aran",
    "Vallès Occidental",
    "Vallès Oriental"
  ].map(normalizeDirectRuleName)
);
const DISTANCE_DIFFICULTY_RANGES = [
  { id: "pixapi", minInternal: 0, maxInternal: 3 },
  { id: "dominguero", minInternal: 4, maxInternal: 5 },
  { id: "rondinaire", minInternal: 6, maxInternal: 8 },
  { id: "cap-colla-rutes", minInternal: 9, maxInternal: Infinity }
];

function normalizeDirectRuleName(value: any) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ca");
}

function getRuleIdAndText(ruleOrId: any) {
  return {
    id:
      typeof ruleOrId === "string"
        ? ruleOrId
        : ruleOrId?.id || ruleOrId?.rule_id || "",
    text:
      typeof ruleOrId === "string"
        ? ""
        : ruleOrId?.text || ruleOrId?.label || ""
  };
}

function isDisabledGroupCulturalRule(ruleOrId: any) {
  if (!ruleOrId) return false;
  const { id, text } = getRuleIdAndText(ruleOrId);
  return (
    GROUP_CULTURAL_RULE_ID_PATTERN.test(String(id)) ||
    GROUP_CULTURAL_TEXT_PATTERN.test(String(text))
  );
}

function isDisabledDirectComarcaRule(ruleOrId: any) {
  if (!ruleOrId) return false;
  const { id, text } = getRuleIdAndText(ruleOrId);
  if (DIRECT_COMARCA_RULE_ID_PATTERN.test(String(id))) return true;
  const match = String(text).normalize("NFC").trim().match(DIRECT_COMARCA_TEXT_PATTERN);
  if (!match) return false;
  return DIRECT_COMARCA_NAMES.has(normalizeDirectRuleName(match[2]));
}

function isDisabledRule(ruleOrId: any) {
  return isDisabledGroupCulturalRule(ruleOrId) || isDisabledDirectComarcaRule(ruleOrId);
}

function getShortestInternalCount(pathOrCount: any) {
  if (Array.isArray(pathOrCount)) return Math.max(pathOrCount.length - 2, 0);
  const count = Number(pathOrCount);
  return Number.isFinite(count) ? Math.max(Math.trunc(count), 0) : 0;
}

function classifyDifficultyByShortestCount(shortestCount: any) {
  const internalCount = getShortestInternalCount(shortestCount);
  return (
    DISTANCE_DIFFICULTY_RANGES.find(
      (range) =>
        internalCount >= range.minInternal && internalCount <= range.maxInternal
    )?.id || DISTANCE_DIFFICULTY_RANGES[DISTANCE_DIFFICULTY_RANGES.length - 1].id
  );
}

function normalizeRule(schema: any) {
  if (!schema) return null;
  if (isDisabledRule(schema)) return null;
  const type = schema.type || "REQUIRE";
  const kind = type === "FORBID" ? "avoid" : "mustIncludeAny";
  return {
    id: schema.id,
    kind,
    label: schema.text,
    comarques: schema.comarques || [],
    difficulty: "medium",
    tags: schema.tags || [],
    explanation: schema.explanation || ""
  };
}

const RULE_DEFS = Array.isArray(rules)
  ? rules.map((rule: any) => normalizeRule(rule)).filter(Boolean)
  : [];

const DAILY_MIN_INTERNAL = 4;

function normalizeName(value: string) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ca");
}

function slugifyName(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function mulberry32(seed: number) {
  let t = seed;
  return function () {
    t += 0x6d2b79f5;
    let result = Math.imul(t ^ (t >>> 15), t | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(list: T[], rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

function sortedNeighbors(adjacency: Map<string, Set<string>>, id: string, allowedSet?: Set<string>) {
  return [...(adjacency.get(id) || new Set<string>())]
    .filter((neighborId) => !allowedSet || allowedSet.has(neighborId))
    .sort((a, b) => a.localeCompare(b, "ca"));
}

function dijkstraAllShortestPaths(
  startId: string,
  targetId: string,
  adjacency: Map<string, Set<string>>,
  options: { allowedSet?: Set<string>; maxPaths?: number } = {}
) {
  const { allowedSet, maxPaths = 64 } = options;
  if (!startId || !targetId) {
    return { primaryPath: [], paths: [], distance: Infinity, truncated: false };
  }
  if (allowedSet && (!allowedSet.has(startId) || !allowedSet.has(targetId))) {
    return { primaryPath: [], paths: [], distance: Infinity, truncated: false };
  }
  if (startId === targetId) {
    return { primaryPath: [startId], paths: [[startId]], distance: 0, truncated: false };
  }

  const distances = new Map<string, number>([[startId, 0]]);
  const predecessors = new Map<string, string[]>();
  const queue = [{ id: startId, distance: 0 }];
  let targetDistance = Infinity;

  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id, "ca"));
    const { id: current, distance } = queue.shift()!;
    if (distance !== distances.get(current)) continue;
    if (distance > targetDistance) break;
    for (const next of sortedNeighbors(adjacency, current, allowedSet)) {
      const nextDistance = distance + 1;
      const knownDistance = distances.get(next);
      if (knownDistance === undefined || nextDistance < knownDistance) {
        distances.set(next, nextDistance);
        predecessors.set(next, [current]);
        queue.push({ id: next, distance: nextDistance });
        if (next === targetId) targetDistance = nextDistance;
      } else if (nextDistance === knownDistance) {
        const list = predecessors.get(next) || [];
        if (!list.includes(current)) {
          list.push(current);
          list.sort((a, b) => a.localeCompare(b, "ca"));
          predecessors.set(next, list);
        }
      }
    }
  }

  const distance = distances.get(targetId);
  if (distance === undefined) {
    return { primaryPath: [], paths: [], distance: Infinity, truncated: false };
  }

  const paths: string[][] = [];
  let truncated = false;
  function walk(nodeId: string, suffix: string[]) {
    if (paths.length >= maxPaths) {
      truncated = true;
      return;
    }
    if (nodeId === startId) {
      paths.push([startId, ...suffix]);
      return;
    }
    for (const previous of predecessors.get(nodeId) || []) {
      walk(previous, [nodeId, ...suffix]);
      if (truncated) return;
    }
  }
  walk(targetId, []);
  return { primaryPath: paths[0] || [], paths, distance, truncated };
}

function findShortestPath(startId: string, targetId: string, adjacency: Map<string, Set<string>>) {
  return dijkstraAllShortestPaths(startId, targetId, adjacency).primaryPath;
}

function findShortestPathInSet(
  startId: string,
  targetId: string,
  adjacency: Map<string, Set<string>>,
  allowedSet: Set<string>
) {
  return dijkstraAllShortestPaths(startId, targetId, adjacency, { allowedSet }).primaryPath;
}

function hasPathViaNode(
  startId: string,
  targetId: string,
  nodeId: string,
  adjacency: Map<string, Set<string>>,
  allowedSet: Set<string>
) {
  if (!allowedSet.has(nodeId)) return false;
  const toNode = findShortestPathInSet(startId, nodeId, adjacency, allowedSet);
  if (!toNode.length) return false;
  const toTarget = findShortestPathInSet(nodeId, targetId, adjacency, allowedSet);
  return toTarget.length > 0;
}

function pointDistance(a: any, b: any) {
  if (!a || !b) return 0;
  const ax = Number(a.lon);
  const ay = Number(a.lat);
  const bx = Number(b.lon);
  const by = Number(b.lat);
  if (![ax, ay, bx, by].every(Number.isFinite)) return 0;
  return Math.hypot(ax - bx, ay - by);
}

function maxNeighborDistance(adjacency: Map<string, Set<string>>, centroidMap: Map<string, any>) {
  let max = 0;
  adjacency.forEach((neighbors, id) => {
    const from = centroidMap.get(id);
    neighbors.forEach((neighborId) => {
      const distance = pointDistance(from, centroidMap.get(neighborId));
      if (distance > max) max = distance;
    });
  });
  return max || 1;
}

function aStarShortestPath(
  startId: string,
  targetId: string,
  adjacency: Map<string, Set<string>>,
  options: { allowedSet?: Set<string>; centroidMap?: Map<string, any> } = {}
) {
  const { allowedSet, centroidMap = new Map() } = options;
  if (!startId || !targetId) return [];
  if (allowedSet && (!allowedSet.has(startId) || !allowedSet.has(targetId))) return [];
  if (startId === targetId) return [startId];
  const edgeScale = maxNeighborDistance(adjacency, centroidMap);
  const heuristic = (id: string) => pointDistance(centroidMap.get(id), centroidMap.get(targetId)) / edgeScale;
  const open = [{ id: startId, fScore: heuristic(startId) }];
  const openIds = new Set([startId]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startId, 0]]);
  while (open.length) {
    open.sort((a, b) => a.fScore - b.fScore || a.id.localeCompare(b.id, "ca"));
    const current = open.shift()!.id;
    openIds.delete(current);
    if (current === targetId) {
      const path = [targetId];
      let step = targetId;
      while (cameFrom.has(step)) {
        step = cameFrom.get(step)!;
        path.push(step);
      }
      return path.reverse();
    }
    const currentScore = gScore.get(current) ?? Infinity;
    for (const next of sortedNeighbors(adjacency, current, allowedSet)) {
      const tentativeScore = currentScore + 1;
      if (tentativeScore >= (gScore.get(next) ?? Infinity)) continue;
      cameFrom.set(next, current);
      gScore.set(next, tentativeScore);
      const fScore = tentativeScore + heuristic(next);
      if (!openIds.has(next)) {
        open.push({ id: next, fScore });
        openIds.add(next);
      } else {
        const entry = open.find((item) => item.id === next);
        if (entry) entry.fScore = fScore;
      }
    }
  }
  return [];
}

function hasDuplicateIds(path: string[]) {
  return new Set(path).size !== path.length;
}

function findShortestPathsWithRule(
  startId: string,
  targetId: string,
  adjacency: Map<string, Set<string>>,
  rule: any,
  allIds: string[],
  options: { centroidMap?: Map<string, any>; maxPaths?: number } = {}
) {
  const { centroidMap = new Map(), maxPaths = 64 } = options;
  if (!rule) {
    const result = dijkstraAllShortestPaths(startId, targetId, adjacency, { maxPaths });
    const astarPath = aStarShortestPath(startId, targetId, adjacency, { centroidMap });
    return { ...result, astarPath };
  }
  if (rule.kind === "avoid") {
    const blocked = new Set(rule.comarcaIds || []);
    const allowed = new Set(allIds.filter((id) => !blocked.has(id)));
    const result = dijkstraAllShortestPaths(startId, targetId, adjacency, {
      allowedSet: allowed,
      maxPaths
    });
    const astarPath = aStarShortestPath(startId, targetId, adjacency, {
      allowedSet: allowed,
      centroidMap
    });
    return { ...result, astarPath };
  }
  if (rule.kind === "mustIncludeAny") {
    let bestDistance = Infinity;
    let truncated = false;
    const paths: string[][] = [];
    const seen = new Set<string>();
    (rule.comarcaIds || []).forEach((nodeId: string) => {
      const first = dijkstraAllShortestPaths(startId, nodeId, adjacency, { maxPaths });
      const second = dijkstraAllShortestPaths(nodeId, targetId, adjacency, { maxPaths });
      if (!first.primaryPath.length || !second.primaryPath.length) return;
      first.paths.forEach((firstPath) => {
        second.paths.forEach((secondPath) => {
          const combined = firstPath.concat(secondPath.slice(1));
          if (hasDuplicateIds(combined)) return;
          const distance = combined.length - 1;
          if (distance < bestDistance) {
            bestDistance = distance;
            paths.length = 0;
            seen.clear();
          }
          if (distance !== bestDistance || paths.length >= maxPaths) {
            if (paths.length >= maxPaths) truncated = true;
            return;
          }
          const key = combined.join("|");
          if (seen.has(key)) return;
          seen.add(key);
          paths.push(combined);
        });
      });
    });
    const astarCandidates = (rule.comarcaIds || [])
      .map((nodeId: string) => {
        const first = aStarShortestPath(startId, nodeId, adjacency, { centroidMap });
        const second = aStarShortestPath(nodeId, targetId, adjacency, { centroidMap });
        if (!first.length || !second.length) return [];
        const combined = first.concat(second.slice(1));
        return hasDuplicateIds(combined) ? [] : combined;
      })
      .filter((path: string[]) => path.length);
    const astarPath = astarCandidates.sort((a: string[], b: string[]) => a.length - b.length)[0] || [];
    return {
      primaryPath: paths[0] || [],
      paths,
      distance: paths[0]?.length ? paths[0].length - 1 : Infinity,
      truncated,
      astarPath
    };
  }
  return findShortestPathsWithRule(startId, targetId, adjacency, null, allIds, options);
}

function findShortestPathWithRule(
  startId: string,
  targetId: string,
  adjacency: Map<string, Set<string>>,
  rule: any,
  allIds: string[],
  options: { centroidMap?: Map<string, any>; maxPaths?: number } = {}
) {
  return findShortestPathsWithRule(startId, targetId, adjacency, rule, allIds, options)
    .primaryPath;
}

function resolveRule(def: any, ctx: any) {
  if (def.kind !== "avoid-random") return def;
  const pool = ctx.comarcaNames.filter(
    (name: string) => name !== ctx.startName && name !== ctx.targetName
  );
  const pick = pool.length ? pickRandom(pool, ctx.rng) : ctx.comarcaNames[0];
  return {
    id: `${def.id}-${slugifyName(pick)}`,
    kind: "avoid",
    label: `No pots passar per ${pick}.`,
    comarques: [pick],
    difficulty: "medium"
  };
}

function prepareRule(def: any, ctx: any) {
  const resolved = resolveRule(def, ctx);
  const difficulty = resolved.difficulty || "medium";
  const tags = resolved.tags || def.tags || ["cultural"];
  const names = resolved.comarques || [];
  const comarcaIds = names
    .map((name: string) => ctx.normalizedToId.get(normalizeName(name)))
    .filter(Boolean);
  return { ...resolved, comarcaIds, difficulty, tags };
}

function isRuleFeasible(rule: any, ctx: any) {
  if (!rule) return false;
  if (rule.kind === "avoid") {
    const blocked = rule.comarcaIds || [];
    if (!blocked.length) return false;
    const blockedSet = new Set(blocked);
    const allowed = new Set(ctx.allIds.filter((id: string) => !blockedSet.has(id)));
    return findShortestPathInSet(ctx.startId, ctx.targetId, ctx.adjacency, allowed).length > 0;
  }
  if (rule.kind === "mustIncludeAny") {
    const allowed = new Set(ctx.allIds);
    return rule.comarcaIds.some((id: string) =>
      hasPathViaNode(ctx.startId, ctx.targetId, id, ctx.adjacency, allowed)
    );
  }
  return true;
}

function pickRule(defs: any[], ctx: any) {
  const attempts = Math.max(defs.length * 3, 60);
  for (let i = 0; i < attempts; i += 1) {
    const def = pickRandom(defs, ctx.rng);
    const rule = prepareRule(def, ctx);
    if (rule.kind !== "avoid" && !rule.comarcaIds.length) continue;
    if (isRuleFeasible(rule, ctx)) return rule;
  }
  return null;
}

function pickRuleForKey(rules: any[], seedKey: string, history: string[], rngFactory: any) {
  if (!rules.length) return null;
  const seed = seedKey || String(Date.now());
  const rng = rngFactory ? rngFactory(hashString(seed)) : Math.random;
  const historySet = new Set(history || []);
  const shuffled = [...rules].sort(() => rng() - 0.5);
  return shuffled.find((rule) => !historySet.has(rule.id)) || shuffled[0] || null;
}

function buildLevel({
  rng,
  ids,
  names,
  normalizedToId,
  centroidMap,
  adjacency,
  minInternal,
  maxInternal = Infinity,
  rulePool
}: {
  rng: () => number;
  ids: string[];
  names: string[];
  normalizedToId: Map<string, string>;
  centroidMap: Map<string, any>;
  adjacency: Map<string, Set<string>>;
  minInternal: number;
  maxInternal?: number;
  rulePool: any[];
}) {
  const targetRange = {
    minInternal: Math.max(Number(minInternal) || 0, 0),
    maxInternal: Number.isFinite(maxInternal) ? maxInternal : Infinity
  };
  const isPathInTargetRange = (path: string[]) => {
    const internalCount = getShortestInternalCount(path);
    return (
      internalCount >= targetRange.minInternal &&
      internalCount <= targetRange.maxInternal
    );
  };
  let start: string | null = null;
  let target: string | null = null;
  let shortest: string[] = [];
  let selectedRule: any = null;
  let attemptsLeft = 3000;

  while (attemptsLeft > 0) {
    attemptsLeft -= 1;
    const candidateStart = pickRandom(ids, rng);
    const candidateTarget = pickRandom(ids, rng);
    if (candidateTarget === candidateStart) continue;
    const neighbors = adjacency.get(candidateStart);
    if (neighbors && neighbors.has(candidateTarget)) continue;
    const startName = names[ids.indexOf(candidateStart)];
    const targetName = names[ids.indexOf(candidateTarget)];
    const ctx = {
      rng,
      startId: candidateStart,
      targetId: candidateTarget,
      startName,
      targetName,
      comarcaNames: names,
      normalizedToId,
      adjacency,
      allIds: ids
    };
    const candidateRule = pickRule(rulePool, ctx);
    if (!candidateRule) continue;
    const path = findShortestPathWithRule(
      candidateStart,
      candidateTarget,
      adjacency,
      candidateRule,
      ids,
      { centroidMap, maxPaths: 64 }
    );
    const basePath = findShortestPath(candidateStart, candidateTarget, adjacency);
    if (!path.length) continue;
    if (basePath.length && path.length <= basePath.length) continue;
    if (!isPathInTargetRange(path)) continue;
    start = candidateStart;
    target = candidateTarget;
    shortest = path;
    selectedRule = candidateRule;
    break;
  }

  if (!start || !target) {
    for (const candidateStart of ids) {
      for (const candidateTarget of ids) {
        if (candidateTarget === candidateStart) continue;
        const neighbors = adjacency.get(candidateStart);
        if (neighbors && neighbors.has(candidateTarget)) continue;
        const path = findShortestPath(candidateStart, candidateTarget, adjacency);
        if (!path.length || !isPathInTargetRange(path)) continue;
        start = candidateStart;
        target = candidateTarget;
        shortest = path;
        break;
      }
      if (start && target) break;
    }
    if (!start || !target) {
      start = ids[0];
      target = ids[1] || ids[0];
      shortest = findShortestPath(start, target, adjacency);
    }
  }

  const avoidIds =
    selectedRule?.kind === "avoid" ? selectedRule.comarcaIds || [] : [];
  const mustPassIds =
    selectedRule?.kind === "mustIncludeAny" ? selectedRule.comarcaIds || [] : [];

  return {
    difficulty_id: classifyDifficultyByShortestCount(shortest),
    start_id: start,
    target_id: target,
    shortest_path: shortest,
    rule_id: selectedRule?.id || null,
    avoid_ids: avoidIds.length ? avoidIds : null,
    must_pass_ids: mustPassIds.length ? mustPassIds : null
  };
}

function getMadridParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const lookup: Record<string, string> = {};
  parts.forEach((part) => {
    lookup[part.type] = part.value;
  });
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    weekday: lookup.weekday
  };
}

function getDayKeyFromParts(parts: { year: number; month: number; day: number }) {
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

function getDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, offset: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
}

const objectKey = Object.keys(topology.objects)[0];
const collection = feature(topology, topology.objects[objectKey]);
const ids = collection.features.map((featureItem: any) => featureItem.properties.id);
const names = collection.features.map((featureItem: any) => featureItem.properties.name);
const normalizedToId = new Map<string, string>();
collection.features.forEach((featureItem: any) => {
  normalizedToId.set(normalizeName(featureItem.properties.name), featureItem.properties.id);
});
const centroidMap = new Map<string, { lat: number; lon: number }>();
collection.features.forEach((featureItem: any) => {
  const [lon, lat] = geoCentroid(featureItem);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    centroidMap.set(featureItem.properties.id, { lat, lon });
  }
});
const neighborIndex = topoNeighbors(topology.objects[objectKey].geometries || []);
const adjacencyMap = new Map<string, Set<string>>();
neighborIndex.forEach((neighbors: number[], index: number) => {
  adjacencyMap.set(
    ids[index],
    new Set(neighbors.map((neighborIndexItem) => ids[neighborIndexItem]))
  );
});

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const force = url.searchParams.get("force") === "1";
  const madrid = getMadridParts();
  const dayKey = getDayKeyFromParts(madrid);
  const localDate = new Date(Date.UTC(madrid.year, madrid.month - 1, madrid.day));
  const shouldRunNow = madrid.hour === 0 && madrid.minute >= 0 && madrid.minute <= 4;

  if (!force && !shouldRunNow && !mode) {
    return new Response(
      JSON.stringify({ ok: true, ran: false, reason: "fora_de_franges" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  const cronKey = Deno.env.get("CRON_KEY");
  const requestKey = req.headers.get("x-cron-key");
  if (!cronKey || requestKey !== cronKey) {
    return new Response(JSON.stringify({ ok: false, error: "No autoritzat." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Falten credencials de Supabase." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const rulePool = RULE_DEFS;

  async function fetchRecentRuleIds(mode: "daily", limit: number) {
    const { data, error } = await supabase
      .from("levels")
      .select("rule_id")
      .eq("level_type", mode)
      .order("date", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []).map((row: { rule_id: string | null }) => row.rule_id).filter(Boolean);
  }

  const dailyHistory = await fetchRecentRuleIds("daily", RULE_HISTORY_LIMIT);

  const shouldRunDaily = force || mode === "daily" || (!mode && shouldRunNow);
  let runDaily = shouldRunDaily;
  let dailyGate: string | null = null;

  async function checkAndMarkRun(runKey: string) {
    const existing = await supabase
      .from("cron_runs")
      .select("run_key")
      .eq("run_key", runKey)
      .maybeSingle();
    if (existing.error) {
      return { allowed: true, warning: existing.error.message };
    }
    if (existing.data) {
      return { allowed: false, reason: "ja_executat" };
    }
    const inserted = await supabase.from("cron_runs").insert({ run_key: runKey });
    if (inserted.error) {
      return { allowed: false, reason: inserted.error.message };
    }
    return { allowed: true };
  }

  if (!force) {
    if (runDaily) {
      const gate = await checkAndMarkRun(`daily:${dayKey}`);
      if (!gate.allowed) {
        runDaily = false;
        dailyGate = gate.reason || "ja_executat";
      } else if (gate.warning) {
        dailyGate = gate.warning;
      }
    }
  }

  async function createDailyLevel(forDayKey: string) {
    const existing = await supabase
      .from("calendar_daily")
      .select("date")
      .eq("date", forDayKey)
      .maybeSingle();
    if (existing.data) return { created: false, reason: "ja_existeix" };
    if (existing.error) return { created: false, reason: existing.error.message };

    const seed = forDayKey;
    const rng = mulberry32(hashString(seed));
    const ruleDef =
      pickRuleForKey(rulePool, forDayKey, dailyHistory, mulberry32) || rulePool[0];
    if (ruleDef && !dailyHistory.includes(ruleDef.id)) {
      dailyHistory.push(ruleDef.id);
      if (dailyHistory.length > RULE_HISTORY_LIMIT) {
        dailyHistory.splice(0, dailyHistory.length - RULE_HISTORY_LIMIT);
      }
    }
    const levelData = buildLevel({
      rng,
      ids,
      names,
      normalizedToId,
      centroidMap,
      adjacency: adjacencyMap,
      minInternal: DAILY_MIN_INTERNAL,
      rulePool: ruleDef ? [ruleDef] : rulePool
    });

    const insertLevel = await supabase
      .rpc("create_daily_level", {
        p_date: forDayKey,
        p_difficulty_id: levelData.difficulty_id,
        p_rule_id: levelData.rule_id,
        p_start_id: levelData.start_id,
        p_target_id: levelData.target_id,
        p_shortest_path: levelData.shortest_path,
        p_avoid_ids: levelData.avoid_ids,
        p_must_pass_ids: levelData.must_pass_ids
      })
      .single();

    if (insertLevel.error) {
      return { created: false, reason: insertLevel.error.message };
    }

    const result = insertLevel.data as {
      created: boolean;
      level_id: string | null;
      reason: string | null;
    };
    return {
      created: Boolean(result.created),
      reason: result.reason || undefined,
      levelId: result.level_id || undefined
    };
  }

  async function ensureDailyRange(startDate: Date, days: number) {
    const keys = Array.from({ length: days }, (_, index) =>
      getDayKey(addDays(startDate, index))
    );
    const existing = await supabase
      .from("calendar_daily")
      .select("date")
      .in("date", keys);
    if (existing.error) {
      return {
        todayResult: { created: false, reason: existing.error.message },
        createdKeys: [],
        total: keys.length
      };
    }
    const existingSet = new Set((existing.data || []).map((row) => row.date));
    const createdKeys: string[] = [];
    let todayResult: { created: boolean; reason?: string; levelId?: string } | null = null;

    for (const key of keys) {
      if (existingSet.has(key)) {
        if (key === dayKey) {
          todayResult = { created: false, reason: "ja_existeix" };
        }
        continue;
      }
      const result = await createDailyLevel(key);
      if (key === dayKey) {
        todayResult = result;
      }
      if (result.created) {
        createdKeys.push(key);
      }
    }

    if (!todayResult) {
      todayResult = { created: false, reason: "ja_existeix" };
    }

    return { todayResult, createdKeys, total: keys.length };
  }

  const dailyBatch = runDaily
    ? await ensureDailyRange(addDays(localDate, -20), 21)
    : null;

  const dailyResult = dailyBatch?.todayResult ?? null;

  console.log("cron-result", {
    dayKey,
    ranDaily: Boolean(runDaily),
    dailyGate,
    dailyResult,
    dailyBatch: dailyBatch
      ? { created: dailyBatch.createdKeys.length, total: dailyBatch.total }
      : null
  });

  return new Response(
    JSON.stringify({
      ok: true,
      ranDaily: Boolean(runDaily),
      dailyGate,
      dailyResult,
      dailyBatch
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});
