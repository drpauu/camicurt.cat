import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const LOCAL_ENV = loadLocalEnvFiles([
  path.join(rootDir, ".env"),
  path.join(rootDir, ".env.local")
]);

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

function isPlaceholder(value) {
  const text = String(value || "").trim();
  return (
    !text ||
    text === "..." ||
    text.includes("YOUR_") ||
    /^<.+>$/.test(text) ||
    /^(undefined|null)$/i.test(text)
  );
}

function getValue(names) {
  for (const name of names) {
    if (!isPlaceholder(process.env[name])) return process.env[name].trim();
    if (!isPlaceholder(LOCAL_ENV[name])) return LOCAL_ENV[name].trim();
  }
  return null;
}

function getMadridDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(dayKey, offset) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const supabaseUrl = getValue(["VITE_SUPABASE_URL", "SUPABASE_URL"]);
const publicKey = getValue([
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY"
]);

if (!supabaseUrl || !publicKey) {
  console.error(
    "Falten VITE_SUPABASE_URL i una key publica (publishable o anon) per auditar el calendari public."
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, publicKey, {
  auth: { persistSession: false }
});

const today = getMadridDayKey();
const from = "2025-01-01";
const to = addDays(today, 30);

const bootstrap = await supabase.rpc("calendar_daily_bootstrap_public", {
  p_from: from,
  p_to: to
});

if (bootstrap.error) {
  console.error(`Error RPC calendar_daily_bootstrap_public: ${bootstrap.error.message}`);
  process.exit(1);
}

const payload = bootstrap.data || {};
const missingPastCount = Number(payload.missingPastCount ?? payload.missing_past_count ?? 0);
const expectedPastDays = Number(payload.expectedPastDays ?? payload.expected_past_days ?? 0);
const assignedPastDays = Number(payload.assignedPastDays ?? payload.assigned_past_days ?? 0);
const rows = Array.isArray(payload.rows) ? payload.rows : [];

if (!rows.length || missingPastCount > 0 || assignedPastDays < expectedPastDays) {
  console.error(
    `Bootstrap public incomplet: rows=${rows.length}, assigned=${assignedPastDays}, expected=${expectedPastDays}, missing=${missingPastCount}.`
  );
  process.exit(1);
}

const todayDetail = await supabase
  .from("daily_calendar_public")
  .select("date, level_id, start_id, target_id, shortest_path, difficulty_id")
  .eq("date", today)
  .maybeSingle();

if (todayDetail.error) {
  console.error(`Error llegint daily_calendar_public: ${todayDetail.error.message}`);
  process.exit(1);
}

if (
  !todayDetail.data?.level_id ||
  !todayDetail.data?.start_id ||
  !todayDetail.data?.target_id ||
  !Array.isArray(todayDetail.data?.shortest_path)
) {
  console.error(`El nivell public d'avui (${today}) no es jugable.`);
  process.exit(1);
}

console.log(
  `Calendari public correcte: ${rows.length} disponibilitats, ${assignedPastDays}/${expectedPastDays} dies passats assignats, avui ${today} jugable.`
);
