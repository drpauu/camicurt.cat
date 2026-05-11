import { isActiveRuleSource } from "./ruleValidation.js";
export {
  GENERIC_RULE_TEXT_PATTERN,
  getRulePayloadKind,
  hasGenericRuleText,
  hasRuleComarques,
  isActiveRuleSource,
  isLevelRulePayloadValid
} from "./ruleValidation.js";

const RULES_VERSION = "2026-05-11";
const RULES_URL = `/rules.json?v=${RULES_VERSION}`;
const RULES_CACHE_KEY = `rumb-rules-catalog-${RULES_VERSION}`;

let rulesPromise = null;

export const RULES = [];

function readCachedRules() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(RULES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedRules(rules) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RULES_CACHE_KEY, JSON.stringify(rules));
  } catch {
    // Cache best-effort: storage may be full or disabled.
  }
}

export async function loadRulesCatalog() {
  const cached = readCachedRules();
  if (cached?.length) return cached.filter((rule) => isActiveRuleSource(rule));
  if (!rulesPromise) {
    rulesPromise = fetch(RULES_URL, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("No s'ha pogut carregar el cataleg de normes.");
        return response.json();
      })
      .then((rules) => {
        const list = Array.isArray(rules) ? rules : [];
        writeCachedRules(list);
        return list.filter((rule) => isActiveRuleSource(rule));
      });
  }
  return rulesPromise;
}

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
  if (!isActiveRuleSource(schema)) return null;
  const type = String(schema.type || "REQUIRE").toUpperCase();
  const kind =
    type === "FORBID" || type === "EXCLUDE"
      ? "avoid"
      : type === "ONE_OF" || type === "INCLUDE" || type === "REQUIRE"
        ? "mustIncludeAny"
        : "mustIncludeAny";
  return {
    id: schema.id,
    kind,
    label: schema.text,
    comarques: schema.comarques || [],
    difficulty: "medium",
    explanation: schema.explanation || "",
    tags: schema.tags || []
  };
}
