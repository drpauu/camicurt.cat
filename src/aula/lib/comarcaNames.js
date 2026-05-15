const COMARCA_NAMES = {
  "alt-camp": "Alt Camp",
  "alt-emporda": "Alt Empordà",
  "alt-penedes": "Alt Penedès",
  "alt-urgell": "Alt Urgell",
  "alta-ribagorca": "Alta Ribagorça",
  anoia: "Anoia",
  bages: "Bages",
  "baix-camp": "Baix Camp",
  "baix-ebre": "Baix Ebre",
  "baix-emporda": "Baix Empordà",
  "baix-llobregat": "Baix Llobregat",
  "baix-penedes": "Baix Penedès",
  barcelones: "Barcelonès",
  bergueda: "Berguedà",
  cerdanya: "Cerdanya",
  "conca-de-barbera": "Conca de Barberà",
  garraf: "Garraf",
  garrigues: "Garrigues",
  garrotxa: "Garrotxa",
  girones: "Gironès",
  maresme: "Maresme",
  montsia: "Montsià",
  noguera: "Noguera",
  osona: "Osona",
  "pallars-jussa": "Pallars Jussà",
  "pallars-sobira": "Pallars Sobirà",
  "pla-d-urgell": "Pla d'Urgell",
  "pla-de-l-estany": "Pla de l'Estany",
  priorat: "Priorat",
  "ribera-d-ebre": "Ribera d'Ebre",
  ripolles: "Ripollès",
  segarra: "Segarra",
  segria: "Segrià",
  selva: "Selva",
  solsones: "Solsonès",
  tarragones: "Tarragonès",
  "terra-alta": "Terra Alta",
  urgell: "Urgell",
  "val-d-aran": "Val d'Aran",
  "valles-occidental": "Vallès Occidental",
  "valles-oriental": "Vallès Oriental"
};

export function formatComarcaName(id) {
  return COMARCA_NAMES[id] || id || "";
}

export function formatComarcaPath(ids, separator = " > ") {
  if (!Array.isArray(ids)) return "";
  return ids.map(formatComarcaName).filter(Boolean).join(separator);
}
