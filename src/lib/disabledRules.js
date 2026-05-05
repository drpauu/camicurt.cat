const GROUP_CULTURAL_RULE_ID_PATTERN = /^group-\d+-[01]$/;
const GROUP_CULTURAL_TEXT_PATTERN = /grup cultural/i;

export function isDisabledGroupCulturalRule(ruleOrId) {
  if (!ruleOrId) return false;
  const id =
    typeof ruleOrId === "string"
      ? ruleOrId
      : ruleOrId.id || ruleOrId.rule_id || "";
  const text =
    typeof ruleOrId === "string" ? "" : ruleOrId.text || ruleOrId.label || "";
  return GROUP_CULTURAL_RULE_ID_PATTERN.test(String(id)) ||
    GROUP_CULTURAL_TEXT_PATTERN.test(String(text));
}
