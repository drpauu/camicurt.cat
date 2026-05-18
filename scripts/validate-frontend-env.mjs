import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const envFiles = [path.join(rootDir, ".env"), path.join(rootDir, ".env.local")];

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

function readLocalEnv() {
  const values = {};
  envFiles.forEach((filePath) => {
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

function getValue(names, localEnv) {
  for (const name of names) {
    if (!isPlaceholder(process.env[name])) return process.env[name].trim();
    if (!isPlaceholder(localEnv[name])) return localEnv[name].trim();
  }
  return null;
}

const localEnv = readLocalEnv();
const supabaseUrl = getValue(["VITE_SUPABASE_URL"], localEnv);
const supabasePublicKey = getValue(
  ["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"],
  localEnv
);

if (!supabaseUrl || !supabasePublicKey) {
  console.error(
    "Falten variables publiques de Supabase per construir el frontend: VITE_SUPABASE_URL i VITE_SUPABASE_PUBLISHABLE_KEY o VITE_SUPABASE_ANON_KEY."
  );
  process.exit(1);
}
