import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { isDisabledRule } from "../src/lib/disabledRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const GENERIC_RULE_TEXT_PATTERN = /algun lloc clau/i;
const PAGE_SIZE = 1000;
const LOCAL_ENV = loadLocalEnvFiles([
  path.join(rootDir, ".env"),
  path.join(rootDir, ".env.local")
]);
const RAW_RULES = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "rules.json"), "utf8"));
const RULE_DEFS = Array.isArray(RAW_RULES)
  ? RAW_RULES.map((rule) => normalizeRule(rule)).filter(Boolean)
  : [];

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
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .forEach((line) => {
        const entry = parseEnvLine(line);
        if (!entry) return;
        values[entry[0]] = entry[1];
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

function getCandidateEnvValue(names) {
  for (const name of names) {
    const fromProcess = process.env[name];
    if (!isPlaceholderEnvValue(fromProcess)) return fromProcess.trim();
    const fromFile = LOCAL_ENV[name];
    if (!isPlaceholderEnvValue(fromFile)) return fromFile.trim();
  }
  return null;
}

function hasGenericRuleText(rule) {
  const text =
    !rule || typeof rule === "string"
      ? ""
      : String(rule.text || rule.label || "");
  return GENERIC_RULE_TEXT_PATTERN.test(text);
}

function isActiveRuleSource(rule) {
  return (
    Boolean(rule) &&
    !isDisabledRule(rule) &&
    Array.isArray(rule.comarques) &&
    rule.comarques.length > 0 &&
    !hasGenericRuleText(rule)
  );
}

function normalizeRule(rule) {
  if (!isActiveRuleSource(rule)) return null;
  const type = String(rule.type || "REQUIRE").toUpperCase();
  return {
    id: rule.id,
    kind: type === "FORBID" || type === "EXCLUDE" ? "avoid" : "mustIncludeAny"
  };
}

function getRulePayloadKind(ruleId) {
  const base = RULE_DEFS.find((rule) => rule.id === ruleId) || null;
  return base?.kind || null;
}

function getPlayableLevelIssue(row) {
  const hasPlayableLevel =
    row.start_id &&
    row.target_id &&
    row.difficulty_id &&
    Array.isArray(row.shortest_path) &&
    row.shortest_path.length >= 2;
  return hasPlayableLevel ? null : "nivell incomplet";
}

function getRulePayloadIssue(row) {
  if (!row?.rule_id) return null;
  if (isDisabledRule(row.rule_id)) return "regla deshabilitada";
  const kind = getRulePayloadKind(row.rule_id);
  if (!kind) return "rule_id desconegut";
  const avoidIds = Array.isArray(row.avoid_ids) ? row.avoid_ids : [];
  const mustPassIds = Array.isArray(row.must_pass_ids) ? row.must_pass_ids : [];
  if (kind === "avoid" && !avoidIds.length) return "avoid sense avoid_ids";
  if (kind === "mustIncludeAny" && !mustPassIds.length) {
    return "mustIncludeAny sense must_pass_ids";
  }
  return null;
}

function summarizeInvalidRows(label, rows) {
  const invalid = rows
    .map((row) => ({
      row,
      issues: [getPlayableLevelIssue(row), getRulePayloadIssue(row)].filter(Boolean)
    }))
    .filter((entry) => entry.issues.length);
  if (!invalid.length) return [];
  console.error(
    `${label} amb problemes: ${invalid
      .slice(0, 50)
      .map(({ row, issues }) => `${row.date || row.seed_key || row.id} (${issues.join("; ")})`)
      .join(", ")}`
  );
  if (invalid.length > 50) {
    console.error(`${label}: ${invalid.length - 50} problemes mes no mostrats.`);
  }
  return invalid;
}

async function fetchAllRows(supabase, table, columns) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("created_at", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) {
      console.error(`Error llegint ${table}: ${error.message}`);
      process.exit(1);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

const supabaseUrl = getCandidateEnvValue(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
const serviceKey = getCandidateEnvValue(["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"]);

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Falta SUPABASE_URL i una key elevada (SUPABASE_SERVICE_ROLE_KEY o SERVICE_ROLE_KEY) per auditar tots els nivells."
  );
  process.exit(1);
}

if (serviceKey.startsWith("sb_publishable_")) {
  console.error("La key rebuda es publishable. Per auditar tots els nivells cal una key elevada.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false }
});

const [levels, bankRows] = await Promise.all([
  fetchAllRows(
    supabase,
    "levels",
    "id, level_type, date, difficulty_id, rule_id, start_id, target_id, shortest_path, avoid_ids, must_pass_ids, created_at"
  ),
  fetchAllRows(
    supabase,
    "level_bank",
    "id, seed_key, difficulty_id, rule_id, start_id, target_id, shortest_path, avoid_ids, must_pass_ids, fingerprint, used_on, created_at"
  )
]);

const invalidLevels = summarizeInvalidRows("levels", levels);
const invalidBankRows = summarizeInvalidRows("level_bank", bankRows);

if (invalidLevels.length || invalidBankRows.length) {
  process.exit(1);
}

console.log(
  `Tots els nivells estan correctes: ${levels.length} rows a levels i ${bankRows.length} rows a level_bank.`
);
