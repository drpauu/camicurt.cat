import fs from "node:fs";
import path from "node:path";

const COMARQUES = [
  { name: "Alt Camp", clue: "els castells i els calçots", tags: ["festa", "gastronomia"] },
  { name: "Alt Empordà", clue: "la tramuntana", tags: ["paisatge", "vent"] },
  { name: "Alt Penedès", clue: "el cava i les vinyes", tags: ["gastronomia", "vinya"] },
  { name: "Alt Urgell", clue: "la porta d'Andorra", tags: ["paisatge", "pirineu"] },
  { name: "Alta Ribagorça", clue: "el romànic de muntanya", tags: ["patrimoni"] },
  { name: "Anoia", clue: "paper, fàbriques i rius", tags: ["industria"] },
  { name: "Bages", clue: "Montserrat i la sal", tags: ["patrimoni", "paisatge"] },
  { name: "Baix Camp", clue: "avellanes i costa", tags: ["gastronomia", "mar"] },
  { name: "Baix Ebre", clue: "el Delta de l'Ebre", tags: ["paisatge", "mar"] },
  { name: "Baix Empordà", clue: "gambes vermelles i cales", tags: ["gastronomia", "mar"] },
  { name: "Baix Llobregat", clue: "horta i aeroport", tags: ["paisatge", "industria"] },
  { name: "Baix Penedès", clue: "platges daurades i vinya", tags: ["mar", "vinya"] },
  { name: "Barcelonès", clue: "la gran capital", tags: ["urbana", "cultura"] },
  { name: "Berguedà", clue: "la Patum", tags: ["festa", "cultura"] },
  { name: "Cerdanya", clue: "la plana alta i la neu", tags: ["paisatge", "pirineu"] },
  { name: "Conca de Barberà", clue: "els monestirs del Cister", tags: ["patrimoni"] },
  { name: "Garraf", clue: "Sitges i penya-segats", tags: ["mar", "paisatge"] },
  { name: "Garrigues", clue: "oliveres i oli", tags: ["gastronomia"] },
  { name: "Garrotxa", clue: "volcans i fagedes", tags: ["paisatge", "natura"] },
  { name: "Gironès", clue: "muralles i ponts", tags: ["patrimoni", "cultura"] },
  { name: "Lluçanès", clue: "prats i ramats", tags: ["natura"] },
  { name: "Maresme", clue: "maduixes i costa", tags: ["gastronomia", "mar"] },
  { name: "Moianès", clue: "boscos i camins de pedra", tags: ["natura"] },
  { name: "Montsià", clue: "muscleres i badies", tags: ["mar", "gastronomia"] },
  { name: "Noguera", clue: "el Montsec i les estrelles", tags: ["paisatge", "astronomia"] },
  { name: "Osona", clue: "la Plana de Vic", tags: ["paisatge"] },
  { name: "Pallars Jussà", clue: "el congost de Mont-rebei", tags: ["paisatge", "pirineu"] },
  { name: "Pallars Sobirà", clue: "parcs d'alta muntanya", tags: ["pirineu", "natura"] },
  { name: "Pla de l'Estany", clue: "l'estany de Banyoles", tags: ["paisatge"] },
  { name: "Pla d'Urgell", clue: "canals i regadius", tags: ["agricultura"] },
  { name: "Priorat", clue: "vins de llicorella", tags: ["vinya", "gastronomia"] },
  { name: "Ribera d'Ebre", clue: "meandres del riu", tags: ["paisatge"] },
  { name: "Ripollès", clue: "romànic i pirineu", tags: ["patrimoni", "pirineu"] },
  { name: "Segarra", clue: "cereals i castells", tags: ["paisatge", "patrimoni"] },
  { name: "Segrià", clue: "la plana de Lleida", tags: ["agricultura"] },
  { name: "Selva", clue: "boscos i balnearis", tags: ["natura"] },
  { name: "Solsonès", clue: "santuaris i pinassa", tags: ["patrimoni", "natura"] },
  { name: "Tarragonès", clue: "la Tarraco romana", tags: ["patrimoni", "cultura"] },
  { name: "Terra Alta", clue: "memòria de l'Ebre", tags: ["historia"] },
  { name: "Urgell", clue: "mercats i fires de ponent", tags: ["cultura"] },
  { name: "Vallès Occidental", clue: "fàbriques i vapor", tags: ["industria"] },
  { name: "Vallès Oriental", clue: "valls i Montseny", tags: ["paisatge", "natura"] }
];

const DIRECT_TEMPLATES = [
  {
    type: "REQUIRE",
    text: (c) => `Has de passar per ${c.name}.`,
    explanation: (c) => `${c.name} és la comarca obligatòria d'aquesta norma.`,
    difficulty: 1,
    tags: ["directa"]
  },
  {
    type: "FORBID",
    text: (c) => `No pots passar per ${c.name}.`,
    explanation: (c) => `No es podia passar per ${c.name}.`,
    difficulty: 2,
    tags: ["directa"]
  }
];

const INDIRECT_TEMPLATES = [
  {
    type: "REQUIRE",
    text: (c) => `Has de passar per la comarca de ${c.clue}.`,
    explanation: (c) => `La pista feia referència a ${c.name}.`,
    difficulty: 4
  },
  {
    type: "FORBID",
    text: (c) => `Evita la comarca on destaquen ${c.clue}.`,
    explanation: (c) => `La comarca a evitar era ${c.name}.`,
    difficulty: 4
  },
  {
    type: "REQUIRE",
    text: (c) => `Has d'anar on es viu ${c.clue}.`,
    explanation: (c) => `La pista apuntava a ${c.name}.`,
    difficulty: 5
  },
  {
    type: "ONE_OF",
    text: (c) => `Has de passar per una comarca on es parla de ${c.clue}.`,
    explanation: (c) => `La comarca correcta era ${c.name}.`,
    difficulty: 5
  },
  {
    type: "REQUIRE",
    text: (c) => `Busques la comarca que s'associa a ${c.clue}.`,
    explanation: (c) => `La referència corresponia a ${c.name}.`,
    difficulty: 5
  }
];

const GROUP_TEMPLATES = [
  {
    type: "ONE_OF",
    text: (group, clue) => `Has de passar per una comarca de ${clue}.`,
    explanation: (group) => `Qualsevol d'aquestes comarques complia la norma: ${group.join(
      ", "
    )}.`,
    difficulty: 3,
    tags: ["zona"]
  },
  {
    type: "FORBID",
    text: (group, clue) => `No pots passar per cap comarca de ${clue}.`,
    explanation: (group) =>
      `S'havien d'evitar aquestes comarques: ${group.join(", ")}.`,
    difficulty: 4,
    tags: ["zona"]
  }
];

const ZONE_GROUPS = [
  {
    clue: "costa",
    comarques: [
      "Alt Empordà",
      "Baix Empordà",
      "Selva",
      "Maresme",
      "Barcelonès",
      "Baix Llobregat",
      "Garraf",
      "Baix Penedès",
      "Tarragonès",
      "Baix Camp",
      "Baix Ebre",
      "Montsià"
    ]
  },
  {
    clue: "pirineu",
    comarques: [
      "Val d'Aran",
      "Alta Ribagorça",
      "Pallars Sobirà",
      "Pallars Jussà",
      "Alt Urgell",
      "Cerdanya",
      "Ripollès"
    ]
  },
  {
    clue: "vinya i cava",
    comarques: ["Alt Penedès", "Baix Penedès", "Priorat", "Tarragonès"]
  },
  {
    clue: "interior agrícola",
    comarques: ["Segarra", "Urgell", "Segrià", "Pla d'Urgell", "Garrigues"]
  },
  {
    clue: "romànic i monestirs",
    comarques: ["Conca de Barberà", "Ripollès", "Bages", "Alt Urgell"]
  }
];

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

const rules = [];

COMARQUES.forEach((comarca) => {
  INDIRECT_TEMPLATES.forEach((tpl, index) => {
    rules.push({
      id: `${slugify(comarca.name)}-indirect-${index}`,
      text: tpl.text(comarca),
      type: tpl.type,
      comarques: [comarca.name],
      difficultyCultural: tpl.difficulty,
      explanation: tpl.explanation(comarca),
      tags: comarca.tags || []
    });
  });
  DIRECT_TEMPLATES.forEach((tpl, index) => {
    rules.push({
      id: `${slugify(comarca.name)}-direct-${index}`,
      text: tpl.text(comarca),
      type: tpl.type,
      comarques: [comarca.name],
      difficultyCultural: tpl.difficulty,
      explanation: tpl.explanation(comarca),
      tags: comarca.tags || []
    });
  });
});

ZONE_GROUPS.forEach((zone, index) => {
  GROUP_TEMPLATES.forEach((tpl, idx) => {
    rules.push({
      id: `zone-${slugify(zone.clue)}-${index}-${idx}`,
      text: tpl.text(zone.comarques, zone.clue),
      type: tpl.type,
      comarques: zone.comarques,
      difficultyCultural: tpl.difficulty,
      explanation: tpl.explanation(zone.comarques),
      tags: tpl.tags
    });
  });
});

const unique = new Map();
rules.forEach((rule) => {
  if (!unique.has(rule.id)) unique.set(rule.id, rule);
});

const finalRules = [...unique.values()];

const outPaths = [
  path.resolve("src", "data", "rules.json"),
  path.resolve("data", "rules.json"),
  path.resolve("supabase", "functions", "generate-level", "rules.json")
];

outPaths.forEach((filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(finalRules, null, 2));
});

console.log(`Regles generades: ${finalRules.length}`);
