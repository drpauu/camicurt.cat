import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { geoCentroid } from "d3-geo";
import { feature, neighbors as topoNeighbors } from "topojson-client";
import { normalizeName, slugifyName } from "../src/lib/names.js";
import { isDisabledRule } from "../src/lib/disabledRules.js";
import {
  classifyDifficultyByShortestCount,
  getDifficultyDistanceRange,
  getShortestInternalCount
} from "../src/lib/difficulty.js";
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
const DEFAULT_BANK_COUNT = 20000;
const DEFAULT_BANK_ADD_COUNT = 10000;
const LOCAL_ENV = loadLocalEnvFiles([
  path.resolve(__dirname, "..", ".env"),
  path.resolve(__dirname, "..", ".env.local")
]);
const RULE_HISTORY_LIMIT = 60;
const DIFFICULTY_CONFIGS = [
  {
    id: "pixapi",
    minInternal: 0,
    maxInternal: 3
  },
  {
    id: "dominguero",
    minInternal: 4,
    maxInternal: 5
  },
  {
    id: "rondinaire",
    minInternal: 6,
    maxInternal: 8
  },
  {
    id: "cap-colla-rutes",
    minInternal: 9,
    maxInternal: Infinity
  }
];

function normalizeRule(schema) {
  if (!schema) return null;
  if (isDisabledRule(schema)) return null;
  const type = String(schema.type || "REQUIRE").toUpperCase();
  const kind =
    type === "FORBID" || type === "EXCLUDE" ? "avoid" : "mustIncludeAny";
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

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
}

function loadLocalEnvFiles(files) {
  const values = {};
  files.forEach((filePath) => {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const entry = parseEnvLine(line);
      if (!entry) return;
      const [key, value] = entry;
      values[key] = value;
    });
  });
  return values;
}

function isPlaceholderEnvValue(value) {
  const text = String(value || "").trim();
  return (
    !text ||
    text === "..." ||
    text.includes("YOUR_") ||
    /^<.+>$/.test(text) ||
    /^(undefined|null)$/i.test(text)
  );
}

function getCandidateEnvValue(name) {
  const fromProcess = process.env[name];
  if (!isPlaceholderEnvValue(fromProcess)) return fromProcess.trim();
  const fromFile = LOCAL_ENV[name];
  if (!isPlaceholderEnvValue(fromFile)) return fromFile.trim();
  return null;
}

function getFirstEnvValue(names) {
  for (const name of names) {
    const value = getCandidateEnvValue(name);
    if (value) return value;
  }
  return null;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getSupabaseCredentials() {
  const supabaseUrl = getFirstEnvValue([
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL"
  ]);
  const serviceKey = getFirstEnvValue([
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY"
  ]);

  if (!supabaseUrl || !isValidHttpUrl(supabaseUrl)) {
    console.error(
      "Falta una URL valida de Supabase. Defineix SUPABASE_URL=https://<project-ref>.supabase.co o VITE_SUPABASE_URL a .env.local."
    );
    process.exit(1);
  }
  if (!serviceKey) {
    console.error(
      "Falta una key elevada. Defineix SUPABASE_SERVICE_ROLE_KEY o SERVICE_ROLE_KEY abans d'executar aquest script."
    );
    process.exit(1);
  }
  if (serviceKey.startsWith("sb_publishable_")) {
    console.error(
      "La key rebuda es publishable. Per inserir nivells cal una key elevada: sb_secret_... o la legacy service_role."
    );
    process.exit(1);
  }

  return { supabaseUrl, serviceKey };
}

function getLevelFingerprint(levelData) {
  return [
    levelData.difficulty_id || "",
    levelData.rule_id || "",
    levelData.start_id,
    levelData.target_id,
    (levelData.shortest_path || []).join(">"),
    (levelData.avoid_ids || []).join(","),
    (levelData.must_pass_ids || []).join(",")
  ].join("|");
}

function sanitizeDisabledRuleLevelData(levelData, adjacency) {
  if (!isDisabledRule(levelData?.rule_id)) return levelData;
  const shortestPath = findShortestPath(levelData.start_id, levelData.target_id, adjacency);
  return {
    ...levelData,
    difficulty_id: classifyDifficultyByShortestCount(
      shortestPath.length ? shortestPath : levelData.shortest_path
    ),
    rule_id: null,
    avoid_ids: null,
    must_pass_ids: null,
    shortest_path: shortestPath.length ? shortestPath : levelData.shortest_path
  };
}

function formatSqlString(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function formatSqlArray(values) {
  if (!values?.length) return "null";
  return `array[${values.map(formatSqlString).join(", ")}]::text[]`;
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
  const difficulty = resolved.difficulty || "medium";
  const names = resolved.comarques || [];
  const comarcaIds = names
    .map((name) => ctx.normalizedToId.get(normalizeName(name)))
    .filter(Boolean);
  return { ...resolved, comarcaIds, difficulty };
}

function isRuleFeasible(rule, ctx) {
  if (!rule) return false;
  if (rule.kind === "avoid") {
    const blocked = rule.comarcaIds || [];
    if (!blocked.length) return false;
    const blockedSet = new Set(blocked);
    const allowed = new Set(ctx.allIds.filter((id) => !blockedSet.has(id)));
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

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function shuffleInPlace(list, rng = Math.random) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
  return list;
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
  maxInternal = Infinity,
  targetDifficultyId = null,
  rulePool
}) {
  const targetRange = targetDifficultyId
    ? getDifficultyDistanceRange(targetDifficultyId)
    : {
        minInternal: Math.max(Number(minInternal) || 0, 0),
        maxInternal: Number.isFinite(maxInternal) ? maxInternal : Infinity
      };
  const isPathInTargetRange = (path) => {
    const internalCount = getShortestInternalCount(path);
    return (
      internalCount >= targetRange.minInternal &&
      internalCount <= targetRange.maxInternal
    );
  };
  const pool = rulePool?.length ? rulePool : RULE_DEFS;
  let start = null;
  let target = null;
  let shortest = [];
  let selectedRule = null;
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

async function run() {
  const mode = process.argv[2];
  if (
    !mode ||
    ![
      "daily",
      "backfill-2025",
      "backfill-year",
      "backfill-dates",
      "bank",
      "bank-add",
      "bank-sql",
      "bank-sql-chunks",
      "assign-year",
      "reassign-year",
      "reassign-years"
    ].includes(mode)
  ) {
    console.error(
      "Usa: node scripts/generate-level.mjs daily|backfill-2025|backfill-year YYYY|backfill-dates|bank [count] [offset]|bank-add [count]|bank-sql [count] [output.sql]|bank-sql-chunks [count] [output-dir]|assign-year [YYYY]|reassign-year YYYY|reassign-years YYYY [...]"
    );
    process.exit(1);
  }

  const needsSupabase = !["bank-sql", "bank-sql-chunks"].includes(mode);
  let supabase = null;
  if (needsSupabase) {
    const { supabaseUrl, serviceKey } = getSupabaseCredentials();
    supabase = createClient(supabaseUrl, serviceKey);
  }

  const { ids, names, normalizedToId, centroidMap, adjacencyMap } = loadTopology();

  const today = new Date();
  const dayKey = getDayKey(today);
  const rulePool = RULE_DEFS;

  async function fetchRecentRuleIds(mode, limit) {
    const query = supabase
      .from("levels")
      .select("rule_id")
      .eq("level_type", mode)
      .order("date", { ascending: false })
      .limit(limit);
    const { data, error } = await query;
    if (error) return [];
    return (data || []).map((row) => row.rule_id).filter(Boolean);
  }

  const dailyHistory = needsSupabase
    ? await fetchRecentRuleIds("daily", RULE_HISTORY_LIMIT)
    : [];

  async function createDailyLevel(forDayKey) {
    const existing = await supabase
      .from("calendar_daily")
      .select("date")
      .eq("date", forDayKey)
      .maybeSingle();
    if (existing.data) return { created: false, reason: "ja_existeix" };
    if (existing.error) return { created: false, reason: existing.error.message };

    const seed = forDayKey;
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

    return {
      created: Boolean(insertLevel.data?.created),
      levelId: insertLevel.data?.level_id || undefined,
      reason: insertLevel.data?.reason || undefined
    };
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

  function buildBankRows(requestedCount, offset = 0) {
    const rows = [];
    const fingerprints = new Set();
    let duplicateRetries = 0;
    const maxDuplicateRetries = requestedCount * 100;

    while (rows.length < requestedCount) {
      const globalIndex = offset + rows.length;
      const config = DIFFICULTY_CONFIGS[rows.length % DIFFICULTY_CONFIGS.length];
      const seedKey = `bank:${config.id}:${globalIndex}`;
      const seedInput =
        duplicateRetries > 0 ? `${seedKey}:retry:${duplicateRetries}` : seedKey;
      const rng = mulberry32(hashString(seedInput));
      const levelData = buildLevel({
        rng,
        ids,
        names,
        normalizedToId,
        centroidMap,
        adjacency: adjacencyMap,
        targetDifficultyId: config.id,
        rulePool: RULE_DEFS
      });
      const row = {
        seed_key: seedKey,
        difficulty_id: levelData.difficulty_id,
        rule_id: levelData.rule_id,
        start_id: levelData.start_id,
        target_id: levelData.target_id,
        shortest_path: levelData.shortest_path,
        avoid_ids: levelData.avoid_ids,
        must_pass_ids: levelData.must_pass_ids
      };
      row.fingerprint = getLevelFingerprint(row);
      if (fingerprints.has(row.fingerprint)) {
        duplicateRetries += 1;
        if (duplicateRetries > maxDuplicateRetries) {
          throw new Error(
            `No s'han pogut generar ${requestedCount} fingerprints unics per al banc.`
          );
        }
        continue;
      }
      fingerprints.add(row.fingerprint);
      rows.push(row);
    }
    return rows;
  }

  function writeBankSql(rows, outputPath) {
    const migrationPath = path.resolve(
      __dirname,
      "..",
      "supabase",
      "migrations",
      "202604300002_level_bank.sql"
    );
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    const lines = [
      `-- Seed ${rows.length} pregenerated levels for public.level_bank.`,
      "-- Generated with scripts/generate-level.mjs using the active app rules and topology.",
      "",
      migrationSql.trim(),
      "",
      "begin;"
    ];
    const batchSize = 250;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      lines.push(
        "",
        "insert into public.level_bank (",
        "  seed_key,",
        "  difficulty_id,",
        "  rule_id,",
        "  start_id,",
        "  target_id,",
        "  shortest_path,",
        "  avoid_ids,",
        "  must_pass_ids,",
        "  fingerprint",
        ") values"
      );
      batch.forEach((row, index) => {
        const suffix = index === batch.length - 1 ? "" : ",";
        lines.push(
          `  (${formatSqlString(row.seed_key)}, ${formatSqlString(row.difficulty_id)}, ${formatSqlString(row.rule_id)}, ${formatSqlString(row.start_id)}, ${formatSqlString(row.target_id)}, ${formatSqlArray(row.shortest_path)}, ${formatSqlArray(row.avoid_ids)}, ${formatSqlArray(row.must_pass_ids)}, ${formatSqlString(row.fingerprint)})${suffix}`
        );
      });
      lines.push(
        "on conflict (seed_key) do update set",
        "  difficulty_id = excluded.difficulty_id,",
        "  rule_id = excluded.rule_id,",
        "  start_id = excluded.start_id,",
        "  target_id = excluded.target_id,",
        "  shortest_path = excluded.shortest_path,",
        "  avoid_ids = excluded.avoid_ids,",
        "  must_pass_ids = excluded.must_pass_ids,",
        "  fingerprint = excluded.fingerprint;"
      );
    }
    lines.push(
      "",
      "commit;",
      "",
      "select difficulty_id, count(*)",
      "from public.level_bank",
      "group by difficulty_id",
      "order by difficulty_id;"
    );
    fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
  }

  function formatBankInsertSql(rows) {
    const lines = [
      "insert into public.level_bank (",
      "  seed_key,",
      "  difficulty_id,",
      "  rule_id,",
      "  start_id,",
      "  target_id,",
      "  shortest_path,",
      "  avoid_ids,",
      "  must_pass_ids,",
      "  fingerprint",
      ") values"
    ];
    rows.forEach((row, index) => {
      const suffix = index === rows.length - 1 ? "" : ",";
      lines.push(
        `  (${formatSqlString(row.seed_key)}, ${formatSqlString(row.difficulty_id)}, ${formatSqlString(row.rule_id)}, ${formatSqlString(row.start_id)}, ${formatSqlString(row.target_id)}, ${formatSqlArray(row.shortest_path)}, ${formatSqlArray(row.avoid_ids)}, ${formatSqlArray(row.must_pass_ids)}, ${formatSqlString(row.fingerprint)})${suffix}`
      );
    });
    lines.push(
      "on conflict (seed_key) do update set",
      "  difficulty_id = excluded.difficulty_id,",
      "  rule_id = excluded.rule_id,",
      "  start_id = excluded.start_id,",
      "  target_id = excluded.target_id,",
      "  shortest_path = excluded.shortest_path,",
      "  avoid_ids = excluded.avoid_ids,",
      "  must_pass_ids = excluded.must_pass_ids,",
      "  fingerprint = excluded.fingerprint;"
    );
    return lines.join("\n");
  }

  function writeBankSqlChunks(rows, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    const migrationPath = path.resolve(
      __dirname,
      "..",
      "supabase",
      "migrations",
      "202604300002_level_bank.sql"
    );
    fs.copyFileSync(migrationPath, path.join(outputDir, "000_create_level_bank.sql"));

    const batchSize = 250;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const number = String(start / batchSize + 1).padStart(3, "0");
      const filePath = path.join(outputDir, `${number}_seed_level_bank.sql`);
      fs.writeFileSync(
        filePath,
        [
          `-- Seed level_bank rows ${start + 1}-${start + batch.length}.`,
          "begin;",
          formatBankInsertSql(batch),
          "commit;"
        ].join("\n") + "\n"
      );
    }

    fs.writeFileSync(
      path.join(outputDir, "999_verify_level_bank.sql"),
      [
        "select count(*) from public.level_bank;",
        "",
        "select difficulty_id, count(*)",
        "from public.level_bank",
        "group by difficulty_id",
        "order by difficulty_id;"
      ].join("\n") + "\n"
    );
  }

  async function insertBankRows(rows) {
    let inserted = 0;
    const batchSize = 250;
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      const result = await supabase
        .from("level_bank")
        .upsert(batch, { onConflict: "seed_key" })
        .select("id");
      if (result.error) {
        console.error(`Error inserint banc ${start}-${start + batch.length}:`, result.error.message);
        process.exit(1);
      }
      inserted += result.data?.length || 0;
      console.log(`Banc de nivells: ${Math.min(start + batch.length, rows.length)}/${rows.length}`);
    }
    return inserted;
  }

  async function getLevelBankCount() {
    const result = await supabase
      .from("level_bank")
      .select("id", { count: "exact", head: true });
    if (result.error) {
      console.error("Error llegint el banc de nivells:", result.error.message);
      process.exit(1);
    }
    return result.count || 0;
  }

  async function fetchUnusedBankRows() {
    const rows = [];
    const pageSize = 1000;
    for (let start = 0; ; start += pageSize) {
      const result = await supabase
        .from("level_bank")
        .select(
          "id, difficulty_id, rule_id, start_id, target_id, shortest_path, avoid_ids, must_pass_ids"
        )
        .is("used_on", null)
        .order("created_at", { ascending: true })
        .range(start, start + pageSize - 1);
      if (result.error) {
        console.error("Error llegint nivells lliures del banc:", result.error.message);
        process.exit(1);
      }
      rows.push(...(result.data || []));
      if (!result.data || result.data.length < pageSize) break;
    }
    return rows;
  }

  async function assignDailyFromBank(forDayKey, bankRow) {
    const levelData = sanitizeDisabledRuleLevelData(bankRow, adjacencyMap);
    const result = await supabase
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
    if (result.error) {
      return { created: false, reason: result.error.message };
    }
    if (!result.data?.created) {
      return {
        created: false,
        levelId: result.data?.level_id || undefined,
        reason: result.data?.reason || "ja_existeix"
      };
    }

    const update = await supabase
      .from("level_bank")
      .update({ used_on: forDayKey })
      .eq("id", bankRow.id)
      .is("used_on", null)
      .select("id")
      .maybeSingle();
    if (update.error) {
      return { created: false, reason: update.error.message };
    }
    if (!update.data) {
      return { created: true, levelId: result.data.level_id, reason: "nivell_creat_banc_no_marcat" };
    }
    return { created: true, levelId: result.data.level_id };
  }

  async function assignDailyRangeFromBank(startDate, days) {
    const keys = Array.from({ length: days }, (_, index) =>
      getDayKey(addDays(startDate, index))
    );
    const existing = await supabase
      .from("calendar_daily")
      .select("date")
      .in("date", keys);
    if (existing.error) {
      console.error("Error llegint el calendari:", existing.error.message);
      process.exit(1);
    }
    const existingSet = new Set((existing.data || []).map((row) => row.date));
    const missingKeys = keys.filter((key) => !existingSet.has(key));
    if (!missingKeys.length) {
      return { createdKeys: [], skipped: keys.length, total: keys.length };
    }

    const bankRows = await fetchUnusedBankRows();
    if (bankRows.length < missingKeys.length) {
      console.error(
        `Falten nivells lliures al banc: calen ${missingKeys.length}, disponibles ${bankRows.length}.`
      );
      process.exit(1);
    }
    shuffleInPlace(bankRows);

    const createdKeys = [];
    for (const key of missingKeys) {
      const bankRow = bankRows.pop();
      const result = await assignDailyFromBank(key, bankRow);
      if (result.created) {
        createdKeys.push(key);
      }
      console.log(
        `Calendari daily ${key}: ${result.created ? "assignat" : result.reason}`
      );
    }

    return {
      createdKeys,
      skipped: keys.length - missingKeys.length,
      total: keys.length
    };
  }

  function getYearRange(year) {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    const totalDays =
      Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    return { startDate, totalDays };
  }

  function parseYear(value, example = "2026") {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      console.error(`Afegeix un any valid, per exemple: ${example}`);
      process.exit(1);
    }
    return year;
  }

  async function clearBankUsageForKeys(keys) {
    if (!keys.length) return 0;
    const update = await supabase
      .from("level_bank")
      .update({ used_on: null })
      .in("used_on", keys)
      .select("id");
    if (update.error) {
      console.error("Error alliberant nivells del banc:", update.error.message);
      process.exit(1);
    }
    return update.data?.length || 0;
  }

  async function deleteDailyLevelsForKeys(keys) {
    if (!keys.length) return { calendarRows: 0, levelRows: 0 };
    const existing = await supabase
      .from("calendar_daily")
      .select("date, level_id")
      .in("date", keys);
    if (existing.error) {
      console.error("Error llegint el calendari existent:", existing.error.message);
      process.exit(1);
    }
    const levelIds = [...new Set((existing.data || []).map((row) => row.level_id).filter(Boolean))];

    const calendarDelete = await supabase
      .from("calendar_daily")
      .delete()
      .in("date", keys)
      .select("date");
    if (calendarDelete.error) {
      console.error("Error esborrant calendar_daily:", calendarDelete.error.message);
      process.exit(1);
    }

    let deletedLevels = 0;
    if (levelIds.length) {
      const levelDelete = await supabase
        .from("levels")
        .delete()
        .in("id", levelIds)
        .select("id");
      if (levelDelete.error) {
        console.error("Error esborrant levels antics:", levelDelete.error.message);
        process.exit(1);
      }
      deletedLevels += levelDelete.data?.length || 0;
    }

    const staleLevelDelete = await supabase
      .from("levels")
      .delete()
      .eq("level_type", "daily")
      .in("date", keys)
      .select("id");
    if (staleLevelDelete.error) {
      console.error("Error esborrant levels daily per data:", staleLevelDelete.error.message);
      process.exit(1);
    }
    deletedLevels += staleLevelDelete.data?.length || 0;

    return {
      calendarRows: calendarDelete.data?.length || 0,
      levelRows: deletedLevels
    };
  }

  async function reassignDailyRangeFromBank(startDate, days) {
    const keys = Array.from({ length: days }, (_, index) =>
      getDayKey(addDays(startDate, index))
    );
    const freedBankRows = await clearBankUsageForKeys(keys);
    const availableRows = await fetchUnusedBankRows();
    if (availableRows.length < keys.length) {
      console.error(
        `Falten nivells lliures al banc: calen ${keys.length}, disponibles ${availableRows.length}.`
      );
      process.exit(1);
    }

    const deleted = await deleteDailyLevelsForKeys(keys);
    const assigned = await assignDailyRangeFromBank(startDate, days);
    return {
      ...assigned,
      freedBankRows,
      deleted
    };
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

  if (mode === "backfill-2025") {
    const startDate = new Date(2025, 0, 1);
    const endDate = new Date(2025, 11, 31);
    const totalDays =
      Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    const dailyBatch = await ensureDailyRange(startDate, totalDays);
    console.log(
      `Backfill 2025 diari: ${dailyBatch.createdKeys.length}/${dailyBatch.total}`
    );

    return;
  }

  if (mode === "backfill-year") {
    const year = parseYear(process.argv[3], "backfill-year 2026");
    const { startDate, totalDays } = getYearRange(year);
    const dailyBatch = await ensureDailyRange(startDate, totalDays);
    console.log(
      `Backfill ${year} diari: ${dailyBatch.createdKeys.length}/${dailyBatch.total}`
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

  if (mode === "bank") {
    const requestedCount = parsePositiveInteger(process.argv[3], DEFAULT_BANK_COUNT);
    const offset = parseNonNegativeInteger(process.argv[4], 0);
    if (!requestedCount || offset === null) {
      console.error("Afegeix valors valids, per exemple: bank 20000 0");
      process.exit(1);
    }

    const rows = buildBankRows(requestedCount, offset);
    const inserted = await insertBankRows(rows);

    console.log(`Banc de nivells creat: ${inserted}/${rows.length} (offset ${offset})`);
    return;
  }

  if (mode === "bank-add") {
    const requestedCount = parsePositiveInteger(process.argv[3], DEFAULT_BANK_ADD_COUNT);
    if (!requestedCount) {
      console.error("Afegeix un nombre valid de nivells, per exemple: bank-add 10000");
      process.exit(1);
    }
    const offset = await getLevelBankCount();
    const rows = buildBankRows(requestedCount, offset);
    const inserted = await insertBankRows(rows);
    console.log(`Banc de nivells afegit: ${inserted}/${rows.length} (offset ${offset})`);
    return;
  }

  if (mode === "bank-sql") {
    const requestedCount = Number(process.argv[3] || DEFAULT_BANK_COUNT);
    if (!Number.isInteger(requestedCount) || requestedCount <= 0) {
      console.error("Afegeix un nombre valid de nivells, per exemple: bank-sql 20000");
      process.exit(1);
    }
    const outputPath = path.resolve(
      process.argv[4] || path.resolve(__dirname, "..", "supabase", `seed_level_bank_${requestedCount}.sql`)
    );
    const rows = buildBankRows(requestedCount);
    writeBankSql(rows, outputPath);
    console.log(`Query SQL del banc creada: ${outputPath}`);
    console.log(`Files generades: ${rows.length}`);
    return;
  }

  if (mode === "bank-sql-chunks") {
    const requestedCount = Number(process.argv[3] || DEFAULT_BANK_COUNT);
    if (!Number.isInteger(requestedCount) || requestedCount <= 0) {
      console.error("Afegeix un nombre valid de nivells, per exemple: bank-sql-chunks 20000");
      process.exit(1);
    }
    const outputDir = path.resolve(
      process.argv[4] ||
        path.resolve(__dirname, "..", "supabase", `seed_level_bank_${requestedCount}_chunks`)
    );
    const rows = buildBankRows(requestedCount);
    writeBankSqlChunks(rows, outputDir);
    console.log(`Queries SQL per lots creades: ${outputDir}`);
    console.log(`Files generades: ${rows.length}`);
    return;
  }

  if (mode === "assign-year") {
    const year = parseYear(process.argv[3] || new Date().getFullYear(), "assign-year 2026");
    const { startDate, totalDays } = getYearRange(year);
    const result = await assignDailyRangeFromBank(startDate, totalDays);
    console.log(
      `Calendari ${year} assignat: ${result.createdKeys.length}/${result.total} nous, ${result.skipped} ja existien`
    );
    return;
  }

  if (mode === "reassign-year") {
    const year = parseYear(process.argv[3], "reassign-year 2026");
    const { startDate, totalDays } = getYearRange(year);
    const result = await reassignDailyRangeFromBank(startDate, totalDays);
    console.log(
      `Calendari ${year} reassignat: ${result.createdKeys.length}/${result.total} nous, ${result.deleted.calendarRows} calendaris antics, ${result.deleted.levelRows} nivells antics, ${result.freedBankRows} banc alliberats`
    );
    return;
  }

  if (mode === "reassign-years") {
    const years = [
      ...new Set(process.argv.slice(3).map((value) => parseYear(value, "reassign-years 2026 2027 2028")))
    ];
    if (!years.length) {
      console.error("Afegeix anys, per exemple: reassign-years 2026 2027 2028");
      process.exit(1);
    }
    for (const year of years) {
      const { startDate, totalDays } = getYearRange(year);
      const result = await reassignDailyRangeFromBank(startDate, totalDays);
      console.log(
        `Calendari ${year} reassignat: ${result.createdKeys.length}/${result.total} nous, ${result.deleted.calendarRows} calendaris antics, ${result.deleted.levelRows} nivells antics, ${result.freedBankRows} banc alliberats`
      );
    }
    return;
  }
}

run().catch((err) => {
  console.error("Error generant nivell:", err.message || err);
  process.exit(1);
});
