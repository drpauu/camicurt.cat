import { isDisabledRule } from "./disabledRules.js";

export const GENERIC_RULE_TEXT_PATTERN = /algun lloc clau/i;

function getRuleText(rule) {
  if (!rule || typeof rule === "string") return "";
  return String(rule.text || rule.label || "");
}

export function hasGenericRuleText(rule) {
  return GENERIC_RULE_TEXT_PATTERN.test(getRuleText(rule));
}

export function hasRuleComarques(rule) {
  return Array.isArray(rule?.comarques) && rule.comarques.length > 0;
}

export function isActiveRuleSource(rule) {
  return Boolean(rule) && !isDisabledRule(rule) && hasRuleComarques(rule) && !hasGenericRuleText(rule);
}

export function getRulePayloadKind(ruleId, avoidIds = [], mustPassIds = [], ruleDefs = []) {
  const base = ruleDefs.find((def) => def?.id === ruleId) || null;
  if (base?.kind) return base.kind;
  return Array.isArray(avoidIds) && avoidIds.length ? "avoid" : "mustIncludeAny";
}

export function isLevelRulePayloadValid(levelData, ruleDefs = []) {
  if (!levelData?.rule_id) return true;
  if (isDisabledRule(levelData.rule_id)) return false;
  if (!ruleDefs.some((def) => def?.id === levelData.rule_id)) return false;
  const avoidIds = Array.isArray(levelData.avoid_ids) ? levelData.avoid_ids : [];
  const mustPassIds = Array.isArray(levelData.must_pass_ids) ? levelData.must_pass_ids : [];
  const kind = getRulePayloadKind(levelData.rule_id, avoidIds, mustPassIds, ruleDefs);
  if (kind === "avoid") return avoidIds.length > 0;
  if (kind === "mustIncludeAny") return mustPassIds.length > 0;
  return false;
}
