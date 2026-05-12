import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { isDisabledRule } from "../src/lib/disabledRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const DEFAULT_DAYS = 21;
const GENERIC_RULE_TEXT_PATTERN = /algun lloc clau/i;
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

function getMadridDayKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function addDays(dayKey, offset) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function parseArgValue(name) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : null;
}

function parseDaysArg() {
  const value = Number(parseArgValue("days") || DEFAULT_DAYS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DAYS;
}

function normalizeDayKeyInput(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
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

function getRulePayloadKind(ruleId, avoidIds = [], mustPassIds = []) {
  const base = RULE_DEFS.find((rule) => rule.id === ruleId) || null;
  if (base?.kind) return base.kind;
  return Array.isArray(avoidIds) && avoidIds.length ? "avoid" : "mustIncludeAny";
}

function getLevelRulePayloadIssue(levelData) {
  if (!levelData?.rule_id) return null;
  if (isDisabledRule(levelData.rule_id)) return "regla deshabilitada";
  if (!RULE_DEFS.some((rule) => rule.id === levelData.rule_id)) {
    return "rule_id desconegut";
  }
  const avoidIds = Array.isArray(levelData.avoid_ids) ? levelData.avoid_ids : [];
  const mustPassIds = Array.isArray(levelData.must_pass_ids) ? levelData.must_pass_ids : [];
  const kind = getRulePayloadKind(levelData.rule_id, avoidIds, mustPassIds);
  if (kind === "avoid" && !avoidIds.length) return "avoid sense avoid_ids";
  if (kind === "mustIncludeAny" && !mustPassIds.length) {
    return "mustIncludeAny sense must_pass_ids";
  }
  if (kind !== "avoid" && kind !== "mustIncludeAny") return `tipus desconegut: ${kind}`;
  return null;
}

function getPlayableLevelIssue(row) {
  const hasPlayableLevel =
    row.level_id &&
    row.start_id &&
    row.target_id &&
    row.difficulty_id &&
    Array.isArray(row.shortest_path) &&
    row.shortest_path.length >= 2;
  return hasPlayableLevel ? null : "nivell incomplet";
}

const startArg = normalizeDayKeyInput(parseArgValue("start"));
const endArg = normalizeDayKeyInput(parseArgValue("end"));
const days = parseDaysArg();
const today = getMadridDayKey();
const startKey = startArg || addDays(today, -(days - 1));
const endKey = endArg || today;
const publicEndKey = endKey < today ? endKey : today;

if (startKey > endKey) {
  console.error("El rang de dates no es valid: la data inicial supera la final.");
  process.exit(1);
}

const supabaseUrl = getCandidateEnvValue(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
const supabaseKey = getCandidateEnvValue([
  "SUPABASE_SERVICE_ROLE_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY"
]);

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Falten SUPABASE_URL i una key de lectura (service role, anon o publishable)."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

const availabilityRows = [];
const detailRows = [];
const pageSize = 1000;

for (let start = 0; ; start += pageSize) {
  const { data, error } = await supabase
    .from("calendar_daily")
    .select("date, level_id")
    .gte("date", startKey)
    .lte("date", endKey)
    .order("date", { ascending: false })
    .range(start, start + pageSize - 1);

  if (error) {
    console.error(`Error llegint calendar_daily: ${error.message}`);
    process.exit(1);
  }

  availabilityRows.push(...(data || []));
  if (!data || data.length < pageSize) break;
}

if (publicEndKey >= startKey) {
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("daily_calendar_public")
      .select(
        "date, level_id, start_id, target_id, rule_id, difficulty_id, shortest_path, avoid_ids, must_pass_ids"
      )
      .gte("date", startKey)
      .lte("date", publicEndKey)
      .order("date", { ascending: false })
      .range(start, start + pageSize - 1);

    if (error) {
      console.error(`Error llegint daily_calendar_public: ${error.message}`);
      process.exit(1);
    }

    detailRows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
}

const availabilityByDate = new Map(availabilityRows.map((row) => [row.date, row]));
const detailByDate = new Map(detailRows.map((row) => [row.date, row]));
const missingDates = [];
const invalidRows = [];

let cursor = endKey;
while (cursor >= startKey) {
  const row = availabilityByDate.get(cursor);
  if (!row) {
    missingDates.push(cursor);
  } else if (cursor <= publicEndKey) {
    const detailRow = detailByDate.get(cursor);
    const issues = detailRow
      ? [getPlayableLevelIssue(detailRow), getLevelRulePayloadIssue(detailRow)].filter(Boolean)
      : ["nivell públic no visible"];
    if (issues.length) invalidRows.push({ date: cursor, issues });
  }
  cursor = addDays(cursor, -1);
}

if (missingDates.length || invalidRows.length) {
  if (missingDates.length) {
    console.error(`Falten dies al calendari: ${missingDates.join(", ")}`);
  }
  if (invalidRows.length) {
    console.error(
      `Dies amb nivell o norma incoherent: ${invalidRows
        .map((row) => `${row.date} (${row.issues.join("; ")})`)
        .join(", ")}`
    );
  }
  process.exit(1);
}

console.log(
  `Calendari diari correcte: ${availabilityRows.length} disponibilitats i ${detailRows.length} nivells públics entre ${startKey} i ${endKey}.`
);
