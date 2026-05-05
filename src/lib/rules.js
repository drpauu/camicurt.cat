import RAW_RULES from "../data/rules.json";
import { isDisabledGroupCulturalRule } from "./disabledRules.js";

export const RULES = Array.isArray(RAW_RULES)
  ? RAW_RULES.filter((rule) => !isDisabledGroupCulturalRule(rule))
  : [];

function hashString(value) {
  if (typeof value !== "string") return 0;
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function pickRuleForKey(rules, seedKey, history = [], rngFactory) {
  if (!rules.length) return null;
  const seed = seedKey || String(Date.now());
  const numericSeed = typeof seed === "number" ? seed : hashString(String(seed));
  const rng = rngFactory ? rngFactory(numericSeed) : Math.random;
  const historySet = new Set(history);
  const shuffled = [...rules].sort(() => rng() - 0.5);
  const picked =
    shuffled.find((rule) => !historySet.has(rule.id)) || shuffled[0];
  return picked || null;
}

export function normalizeRule(schema) {
  if (!schema) return null;
  if (isDisabledGroupCulturalRule(schema)) return null;
  const type = schema.type || "REQUIRE";
  const kind =
    type === "FORBID" ? "avoid" : type === "ONE_OF" ? "mustIncludeAny" : "mustIncludeAny";
  return {
    id: schema.id,
    kind,
    label: schema.text,
    comarques: schema.comarques || [],
    difficultyCultural: schema.difficultyCultural || 3,
    explanation: schema.explanation || "",
    tags: schema.tags || []
  };
}
