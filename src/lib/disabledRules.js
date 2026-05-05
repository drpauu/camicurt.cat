const GROUP_CULTURAL_RULE_ID_PATTERN = /^group-\d+-[01]$/;
const GROUP_CULTURAL_TEXT_PATTERN = /grup cultural/i;
const DIRECT_COMARCA_RULE_ID_PATTERN = /-direct-[01]$/;
const DIRECT_COMARCA_TEXT_PATTERN = /^(Has de passar per|No pots passar per) (.+)\.$/i;
const DIRECT_COMARCA_NAMES = new Set(
  [
    "Alt Camp",
    "Alt Empordà",
    "Alt Penedès",
    "Alt Urgell",
    "Alta Ribagorça",
    "Anoia",
    "Bages",
    "Baix Camp",
    "Baix Ebre",
    "Baix Empordà",
    "Baix Llobregat",
    "Baix Penedès",
    "Barcelonès",
    "Berguedà",
    "Cerdanya",
    "Conca de Barberà",
    "Garraf",
    "Garrigues",
    "Garrotxa",
    "Gironès",
    "Lluçanès",
    "Maresme",
    "Moianès",
    "Montsià",
    "Noguera",
    "Osona",
    "Pallars Jussà",
    "Pallars Sobirà",
    "Pla de l'Estany",
    "Pla d'Urgell",
    "Priorat",
    "Ribera d'Ebre",
    "Ripollès",
    "Segarra",
    "Segrià",
    "Selva",
    "Solsonès",
    "Tarragonès",
    "Terra Alta",
    "Urgell",
    "Val d'Aran",
    "Vallès Occidental",
    "Vallès Oriental"
  ].map(normalizeDirectRuleName)
);

function normalizeDirectRuleName(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ca");
}

function getRuleIdAndText(ruleOrId) {
  return {
    id:
      typeof ruleOrId === "string"
        ? ruleOrId
        : ruleOrId?.id || ruleOrId?.rule_id || "",
    text:
      typeof ruleOrId === "string"
        ? ""
        : ruleOrId?.text || ruleOrId?.label || ""
  };
}

export function isDisabledGroupCulturalRule(ruleOrId) {
  if (!ruleOrId) return false;
  const { id, text } = getRuleIdAndText(ruleOrId);
  return GROUP_CULTURAL_RULE_ID_PATTERN.test(String(id)) ||
    GROUP_CULTURAL_TEXT_PATTERN.test(String(text));
}

export function isDisabledDirectComarcaRule(ruleOrId) {
  if (!ruleOrId) return false;
  const { id, text } = getRuleIdAndText(ruleOrId);
  if (DIRECT_COMARCA_RULE_ID_PATTERN.test(String(id))) return true;
  const match = String(text).normalize("NFC").trim().match(DIRECT_COMARCA_TEXT_PATTERN);
  if (!match) return false;
  return DIRECT_COMARCA_NAMES.has(normalizeDirectRuleName(match[2]));
}

export function isDisabledRule(ruleOrId) {
  return (
    isDisabledGroupCulturalRule(ruleOrId) ||
    isDisabledDirectComarcaRule(ruleOrId)
  );
}
