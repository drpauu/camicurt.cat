import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { geoCentroid } from "d3-geo";
import { feature, neighbors as topoNeighbors } from "topojson-client";
import { normalizeName, slugifyName } from "../src/lib/names.js";
import {
  findShortestPath,
  findShortestPathInSet,
  findShortestPathsWithRule
} from "../src/lib/pathfinding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RULES_PATH = path.resolve(__dirname, "..", "data", "rules.json");
const RAW_RULES = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const RULE_DEFS = Array.isArray(RAW_RULES)
  ? RAW_RULES.map((rule) => normalizeRule(rule)).filter(Boolean)
  : [];
const RULE_HISTORY_LIMIT = 60;

function normalizeRule(schema) {
  if (!schema) return null;
  const type = schema.type || "REQUIRE";
  const kind = type === "FORBID" ? "avoid" : "mustIncludeAny";
  return {
    id: schema.id,
    kind,
    label: schema.text,
    comarques: schema.comarques || [],
    difficultyCultural: schema.difficultyCultural || 3,
    tags: schema.tags || [],
    explanation: schema.explanation || ""
  };
}

function getRuleDifficulty(def) {
  if (!def) return "medium";
  const value = typeof def.difficultyCultural === "number" ? def.difficultyCultural : 3;
  if (value >= 5) return "expert";
  if (value >= 4) return "hard";
  if (value >= 3) return "medium";
  return "easy";
}

function getRuleTags(def) {
  if (def?.tags?.length) return def.tags;
  return ["cultural"];
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function mulberry32(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let result = Math.imul(t ^ (t >>> 15), t | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

function hasPathViaNode(startId, targetId, nodeId, adjacency, allowedSet) {
  if (!allowedSet.has(nodeId)) return false;
  const toNode = findShortestPathInSet(startId, nodeId, adjacency, allowedSet);
  if (!toNode.length) return false;
  const toTarget = findShortestPathInSet(nodeId, targetId, adjacency, allowedSet);
  return toTarget.length > 0;
}

function resolveRule(def, ctx) {
  if (def.kind !== "avoid-random") return def;
  const pool = ctx.comarcaNames.filter(
    (name) => name !== ctx.startName && name !== ctx.targetName
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

function prepareRule(def, ctx) {
  const resolved = resolveRule(def, ctx);
  const difficulty = resolved.difficulty || getRuleDifficulty(def);
  const names = resolved.comarques || [];
  const comarcaIds = names
    .map((name) => ctx.normalizedToId.get(normalizeName(name)))
    .filter(Boolean);
  return { ...resolved, comarcaIds, difficulty };
}

function isRuleFeasible(rule, ctx) {
  if (!rule) return false;
  if (rule.kind === "avoid") {
    const blocked = rule.comarcaIds?.[0];
    if (!blocked) return false;
    const allowed = new Set(ctx.allIds.filter((id) => id !== blocked));
    return (
      findShortestPathInSet(ctx.startId, ctx.targetId, ctx.adjacency, allowed).length > 0
    );
  }
  if (rule.kind === "mustIncludeAny") {
    const allowed = new Set(ctx.allIds);
    return rule.comarcaIds.some((id) =>
      hasPathViaNode(ctx.startId, ctx.targetId, id, ctx.adjacency, allowed)
    );
  }
  return true;
}

function pickRule(defs, ctx) {
  const attempts = Math.max(defs.length * 3, 60);
  for (let i = 0; i < attempts; i += 1) {
    const def = pickRandom(defs, ctx.rng);
    const rule = prepareRule(def, ctx);
    if (rule.kind !== "avoid" && !rule.comarcaIds.length) continue;
    if (isRuleFeasible(rule, ctx)) return rule;
  }
  return null;
}

function pickRuleForKey(rules, seedKey, history = [], rngFactory) {
  if (!rules.length) return null;
  const seed = seedKey || String(Date.now());
  const rng = rngFactory ? rngFactory(hashString(seed)) : Math.random;
  const historySet = new Set(history);
  const shuffled = [...rules].sort(() => rng() - 0.5);
  return shuffled.find((rule) => !historySet.has(rule.id)) || shuffled[0] || null;
}

function getDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDayKeyInput(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.valueOf())) return getDayKey(parsed);
  return null;
}

function addDays(date, offset) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + offset);
  return next;
}

function getWeekKey(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target - firstThursday;
  const week = 1 + Math.round(diff / 604800000);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function loadTopology() {
  const topoPath = path.resolve(__dirname, "..", "public", "catalunya-comarques.topojson");
  const raw = fs.readFileSync(topoPath, "utf8");
  const topology = JSON.parse(raw);
  const objectKey = Object.keys(topology.objects)[0];
  const object = topology.objects[objectKey];
  const collection = feature(topology, object);
  const ids = collection.features.map((featureItem) => featureItem.properties.id);
  const names = collection.features.map((featureItem) => featureItem.properties.name);
  const normalizedToId = new Map();
  collection.features.forEach((featureItem) => {
    normalizedToId.set(normalizeName(featureItem.properties.name), featureItem.properties.id);
  });
  const centroidMap = new Map();
  collection.features.forEach((featureItem) => {
    const [lon, lat] = geoCentroid(featureItem);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      centroidMap.set(featureItem.properties.id, { lat, lon });
    }
  });
  const neighborIndex = topoNeighbors(object.geometries || []);
  const adjacencyMap = new Map();
  neighborIndex.forEach((neighbors, index) => {
    adjacencyMap.set(
      ids[index],
      new Set(neighbors.map((neighborIndexItem) => ids[neighborIndexItem]))
    );
  });
  return { ids, names, normalizedToId, centroidMap, adjacencyMap, collection };
}

function buildLevel({
  rng,
  ids,
  names,
  normalizedToId,
  centroidMap,
  adjacency,
  minInternal,
  rulePool
}) {
  const minLength = Math.max(minInternal + 2, 3);
  const pool = rulePool.length ? rulePool : RULE_DEFS;
  let start = null;
  let target = null;
  let shortest = [];
  let selectedRule = null;
  let attemptsLeft = 500;

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
    const candidateRule = pickRule(pool, ctx);
    if (!candidateRule) continue;
    const pathResult = findShortestPathsWithRule(
      candidateStart,
      candidateTarget,
      adjacency,
      candidateRule,
      ids,
      { centroidMap, maxPaths: 64 }
    );
    const path = pathResult.primaryPath;
    const basePath = findShortestPath(candidateStart, candidateTarget, adjacency);
    if (!path.length) continue;
    if (basePath.length && path.length <= basePath.length) continue;
    if (path.length < minLength) continue;
    start = candidateStart;
    target = candidateTarget;
    shortest = path;
    selectedRule = candidateRule;
    break;
  }

  if (!start || !target) {
    start = ids[0];
    target = ids[1] || ids[0];
    shortest = findShortestPath(start, target, adjacency);
  }

  const avoidIds =
    selectedRule?.kind === "avoid" ? selectedRule.comarcaIds || [] : [];
  const mustPassIds =
    selectedRule?.kind === "mustIncludeAny" ? selectedRule.comarcaIds || [] : [];

  return {
    start_id: start,
    target_id: target,
    shortest_path: shortest,
    rule_id: selectedRule?.id || null,
    avoid_ids: avoidIds.length ? avoidIds : null,
    must_pass_ids: mustPassIds.length ? mustPassIds : null
  };
}

async function run() {
  const mode = process.argv[2];
  if (!mode || !["daily", "weekly", "backfill-2025", "backfill-dates"].includes(mode)) {
    console.error(
      "Usa: node scripts/generate-level.mjs daily|weekly|backfill-2025|backfill-dates"
    );
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Falten SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (o SERVICE_ROLE_KEY)."
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { ids, names, normalizedToId, centroidMap, adjacencyMap } = loadTopology();

  const today = new Date();
  const dayKey = getDayKey(today);
  const weekKey = getWeekKey(today);
  const difficultyId = "cap-colla-rutes";
  const highPool = RULE_DEFS.filter((def) => {
    const difficultyLevel = getRuleDifficulty(def);
    const tags = getRuleTags(def);
    const hasCultural = tags.includes("cultural");
    const hasGeo = tags.includes("geo");
    return difficultyLevel === "expert" && (hasCultural || hasGeo);
  });
  const rulePool = highPool.length ? highPool : RULE_DEFS;

  async function fetchRecentRuleIds(mode, limit) {
    const column = mode === "weekly" ? "week_key" : "date";
    const query = supabase
      .from("levels")
      .select("rule_id")
      .eq("level_type", mode)
      .order(column, { ascending: false })
      .limit(limit);
    const { data, error } = await query;
    if (error) return [];
    return (data || []).map((row) => row.rule_id).filter(Boolean);
  }

  const dailyHistory = await fetchRecentRuleIds("daily", RULE_HISTORY_LIMIT);
  const weeklyHistory = await fetchRecentRuleIds("weekly", RULE_HISTORY_LIMIT);

  async function createDailyLevel(forDayKey) {
    const existing = await supabase
      .from("calendar_daily")
      .select("date")
      .eq("date", forDayKey)
      .maybeSingle();
    if (existing.data) return { created: false, reason: "ja_existeix" };
    if (existing.error) return { created: false, reason: existing.error.message };

    const seed = `${forDayKey}-${difficultyId}`;
    const rng = mulberry32(hashString(seed));
    const ruleDef = pickRuleForKey(rulePool, forDayKey, dailyHistory, mulberry32) || rulePool[0];
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
      minInternal: 4,
      rulePool: ruleDef ? [ruleDef] : rulePool
    });

    const insertLevel = await supabase
      .from("levels")
      .insert({
        level_type: "daily",
        date: forDayKey,
        week_key: null,
        difficulty_id: difficultyId,
        rule_id: levelData.rule_id,
        start_id: levelData.start_id,
        target_id: levelData.target_id,
        shortest_path: levelData.shortest_path,
        avoid_ids: levelData.avoid_ids,
        must_pass_ids: levelData.must_pass_ids
      })
      .select("id")
      .single();
    if (insertLevel.error) {
      return { created: false, reason: insertLevel.error.message };
    }

    const levelId = insertLevel.data.id;
    const insertCalendar = await supabase
      .from("calendar_daily")
      .insert({ date: forDayKey, level_id: levelId });
    if (insertCalendar.error) {
      return { created: false, reason: insertCalendar.error.message };
    }
    return { created: true, levelId };
  }

  async function createWeeklyLevel(forWeekKey) {
    const existing = await supabase
      .from("calendar_weekly")
      .select("week_key")
      .eq("week_key", forWeekKey)
      .maybeSingle();
    if (existing.data) return { created: false, reason: "ja_existeix" };
    if (existing.error) return { created: false, reason: existing.error.message };

    const seed = `${forWeekKey}-${difficultyId}`;
    const rng = mulberry32(hashString(seed));
    const ruleDef =
      pickRuleForKey(rulePool, forWeekKey, weeklyHistory, mulberry32) || rulePool[0];
    if (ruleDef && !weeklyHistory.includes(ruleDef.id)) {
      weeklyHistory.push(ruleDef.id);
      if (weeklyHistory.length > RULE_HISTORY_LIMIT) {
        weeklyHistory.splice(0, weeklyHistory.length - RULE_HISTORY_LIMIT);
      }
    }
    const levelData = buildLevel({
      rng,
      ids,
      names,
      normalizedToId,
      centroidMap,
      adjacency: adjacencyMap,
      minInternal: 8,
      rulePool: ruleDef ? [ruleDef] : rulePool
    });

    const insertLevel = await supabase
      .from("levels")
      .insert({
        level_type: "weekly",
        date: null,
        week_key: forWeekKey,
        difficulty_id: difficultyId,
        rule_id: levelData.rule_id,
        start_id: levelData.start_id,
        target_id: levelData.target_id,
        shortest_path: levelData.shortest_path,
        avoid_ids: levelData.avoid_ids,
        must_pass_ids: levelData.must_pass_ids
      })
      .select("id")
      .single();
    if (insertLevel.error) {
      return { created: false, reason: insertLevel.error.message };
    }

    const levelId = insertLevel.data.id;
    const insertCalendar = await supabase
      .from("calendar_weekly")
      .insert({ week_key: forWeekKey, level_id: levelId });
    if (insertCalendar.error) {
      return { created: false, reason: insertCalendar.error.message };
    }
    return { created: true, levelId };
  }

  async function ensureDailyRange(startDate, days) {
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
    const createdKeys = [];
    let todayResult = null;

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

  async function ensureWeeklyRange(startDate, weeks) {
    const keys = Array.from({ length: weeks }, (_, index) =>
      getWeekKey(addDays(startDate, index * 7))
    );
    const uniqueKeys = [...new Set(keys)];
    const existing = await supabase
      .from("calendar_weekly")
      .select("week_key")
      .in("week_key", uniqueKeys);
    if (existing.error) {
      return {
        currentResult: { created: false, reason: existing.error.message },
        createdKeys: [],
        total: uniqueKeys.length
      };
    }
    const existingSet = new Set((existing.data || []).map((row) => row.week_key));
    const createdKeys = [];
    let currentResult = null;

    for (const key of uniqueKeys) {
      if (existingSet.has(key)) {
        if (key === weekKey) {
          currentResult = { created: false, reason: "ja_existeix" };
        }
        continue;
      }
      const result = await createWeeklyLevel(key);
      if (key === weekKey) {
        currentResult = result;
      }
      if (result.created) {
        createdKeys.push(key);
      }
    }

    if (!currentResult) {
      currentResult = { created: false, reason: "ja_existeix" };
    }

    return { currentResult, createdKeys, total: uniqueKeys.length };
  }

  if (mode === "daily") {
    const startDate = addDays(today, -20);
    const dailyBatch = await ensureDailyRange(startDate, 21);
    if (dailyBatch.todayResult.created) {
      console.log(`Nivell daily creat: ${dailyBatch.todayResult.levelId}`);
    } else {
      console.log(`Nivell daily: ${dailyBatch.todayResult.reason}`);
    }
    if (dailyBatch.createdKeys.length) {
      console.log(
        `Backfill diari: ${dailyBatch.createdKeys.length}/${dailyBatch.total}`
      );
    }
    return;
  }

  if (mode === "weekly") {
    const startDate = addDays(today, -21);
    const weeklyBatch = await ensureWeeklyRange(startDate, 4);
    if (weeklyBatch.currentResult.created) {
      console.log(`Nivell weekly creat: ${weeklyBatch.currentResult.levelId}`);
    } else {
      console.log(`Nivell weekly: ${weeklyBatch.currentResult.reason}`);
    }
    if (weeklyBatch.createdKeys.length) {
      console.log(
        `Backfill setmanal: ${weeklyBatch.createdKeys.length}/${weeklyBatch.total}`
      );
    }
    return;
  }

  if (mode === "backfill-2025") {
    const startDate = new Date(2025, 0, 1);
    const endDate = new Date(2025, 11, 31);
    const totalDays =
      Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    const dailyBatch = await ensureDailyRange(startDate, totalDays);
    console.log(
      `Backfill 2025 diari: ${dailyBatch.createdKeys.length}/${dailyBatch.total}`
    );

    const weeklyBatch = await ensureWeeklyRange(startDate, 53);
    console.log(
      `Backfill 2025 setmanal: ${weeklyBatch.createdKeys.length}/${weeklyBatch.total}`
    );
    return;
  }

  if (mode === "backfill-dates") {
    const inputs = process.argv.slice(3);
    const keys = [
      ...new Set(inputs.map((value) => normalizeDayKeyInput(value)).filter(Boolean))
    ];
    if (!keys.length) {
      console.error("Afegeix dates (YYYY-MM-DD) com a paràmetres.");
      process.exit(1);
    }
    const createdKeys = [];
    for (const key of keys) {
      const result = await createDailyLevel(key);
      if (result.created) {
        createdKeys.push(key);
      }
      console.log(
        `Nivell daily ${key}: ${result.created ? "creat" : result.reason}`
      );
    }
    console.log(`Backfill manual diari: ${createdKeys.length}/${keys.length}`);
    return;
  }
}

run().catch((err) => {
  console.error("Error generant nivell:", err.message || err);
  process.exit(1);
});
