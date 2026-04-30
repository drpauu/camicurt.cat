import { createClient } from "@supabase/supabase-js";

const DEFAULT_DAYS = 21;

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

function parseDaysArg() {
  const raw = process.argv.find((arg) => arg.startsWith("--days="));
  if (!raw) return DEFAULT_DAYS;
  const value = Number(raw.slice("--days=".length));
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DAYS;
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Falten SUPABASE_URL i SUPABASE_ANON_KEY (o VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY)."
  );
  process.exit(1);
}

const days = parseDaysArg();
const today = getMadridDayKey();
const startKey = addDays(today, -(days - 1));
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

const { data, error } = await supabase
  .from("daily_calendar_public")
  .select("date, level_id, start_id, target_id, rule_id, difficulty_id, shortest_path")
  .gte("date", startKey)
  .lte("date", today)
  .order("date", { ascending: false });

if (error) {
  console.error(`Error llegint daily_calendar_public: ${error.message}`);
  process.exit(1);
}

const rows = Array.isArray(data) ? data : [];
const byDate = new Map(rows.map((row) => [row.date, row]));
const missingDates = [];
const invalidRows = [];

for (let offset = 0; offset < days; offset += 1) {
  const key = addDays(today, -offset);
  const row = byDate.get(key);
  if (!row) {
    missingDates.push(key);
    continue;
  }
  const hasPlayableLevel =
    row.level_id &&
    row.start_id &&
    row.target_id &&
    row.difficulty_id &&
    Array.isArray(row.shortest_path) &&
    row.shortest_path.length >= 2;
  if (!hasPlayableLevel) invalidRows.push(key);
}

if (missingDates.length || invalidRows.length) {
  if (missingDates.length) {
    console.error(`Falten dies al calendari: ${missingDates.join(", ")}`);
  }
  if (invalidRows.length) {
    console.error(`Dies amb nivell incomplet: ${invalidRows.join(", ")}`);
  }
  process.exit(1);
}

console.log(
  `Calendari diari correcte: ${rows.length}/${days} dies entre ${startKey} i ${today}.`
);
