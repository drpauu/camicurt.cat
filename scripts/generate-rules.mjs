import fs from "node:fs";
import path from "node:path";

const INPUT_FILES = [
  { path: path.resolve("normes", "normes.json"), prefix: "normes-base" },
  { path: path.resolve("normes", "rumb_rules_extra_500.json"), prefix: "normes-extra-1" },
  { path: path.resolve("normes", "rumb_rules_extra_500_v2.json"), prefix: "normes-extra-2" },
  { path: path.resolve("normes", "rumb_rules_extra_500_hard_v3.json"), prefix: "normes-hard-3" }
];

const TYPE_MAP = {
  INCLUDE: "REQUIRE",
  REQUIRE: "REQUIRE",
  ONE_OF: "ONE_OF",
  EXCLUDE: "FORBID",
  FORBID: "FORBID"
};

const OUT_PATHS = [
  path.resolve("src", "data", "rules.json"),
  path.resolve("data", "rules.json"),
  path.resolve("supabase", "functions", "generate-level", "rules.json")
];

const BAD_COPY_PATTERNS = [
  /\bon també\b/i,
  /\bmentre amb\b/i,
  /\bamb el detall que\b/i,
  /\bsense oblidar(?: que)?\b/i,
  /\bi sobretot\b/i,
  /;\s*amb\b/i,
  /\balhora\s+(?:amb|en|entre|quan|per|a )/i,
  /\bon\s+(?:amb|en|per|entre)\b/i
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComarcaName(value) {
  return normalizeText(value);
}

function buildExplanation(type, comarques) {
  const names = comarques.join(", ");
  if (type === "FORBID") return `La comarca a evitar era ${names}.`;
  if (type === "ONE_OF") return `Una comarca valida era ${names}.`;
  return `La norma feia referencia a ${names}.`;
}

function assertReadableRuleText(text, inputPath, index) {
  for (const pattern of BAD_COPY_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(
        `Norma amb redaccio sospitosa a ${inputPath}#${index + 1}: ${text}`
      );
    }
  }
}

function readRules(input) {
  const raw = JSON.parse(fs.readFileSync(input.path, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`El fitxer ${input.path} no conte una llista de normes.`);
  }

  return raw.map((rule, index) => {
    const type = TYPE_MAP[String(rule.type || "INCLUDE").toUpperCase()];
    if (!type) {
      throw new Error(
        `Tipus de norma desconegut a ${input.path}#${index + 1}: ${rule.type}`
      );
    }

    const comarques = Array.isArray(rule.comarques)
      ? rule.comarques.map(normalizeComarcaName).filter(Boolean)
      : [];
    if (!comarques.length) {
      throw new Error(`Norma sense comarques a ${input.path}#${index + 1}.`);
    }

    const text = normalizeText(rule.text);
    assertReadableRuleText(text, input.path, index);

    return {
      id: `${input.prefix}-${String(index + 1).padStart(4, "0")}`,
      text,
      type,
      comarques,
      explanation: buildExplanation(type, comarques),
      tags: ["normes", input.prefix]
    };
  });
}

const rules = INPUT_FILES.flatMap(readRules);
const seenIds = new Set();
const seenContent = new Set();

for (const rule of rules) {
  if (seenIds.has(rule.id)) {
    throw new Error(`ID de norma duplicat: ${rule.id}`);
  }
  seenIds.add(rule.id);

  const contentKey = JSON.stringify([
    rule.text,
    rule.type,
    [...rule.comarques].sort((a, b) => a.localeCompare(b, "ca"))
  ]);
  if (seenContent.has(contentKey)) {
    throw new Error(`Norma duplicada detectada: ${rule.id}`);
  }
  seenContent.add(contentKey);
}

OUT_PATHS.forEach((filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(rules, null, 2)}\n`);
});

console.log(`Regles generades des de normes: ${rules.length}`);
