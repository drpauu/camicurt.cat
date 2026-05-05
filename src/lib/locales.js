/**
 * @typedef {"ca-standard" | "ca-central" | "ca-barceloni" | "ca-gironi" | "ca-salat" | "ca-tarragoni" | "ca-lleidata" | "ca-pallares" | "ca-ribagorca" | "ca-tortosi" | "ca-xipella" | "ca-rossellones" | "ca-capcines" | "oc-aranes"} LocaleCode
 */

export const DEFAULT_LOCALE = "ca-standard";

export const LANGUAGES = [
  {
    "id": "ca-standard",
    "label": "Català"
  },
  {
    "id": "ca-central",
    "label": "Central"
  },
  {
    "id": "ca-barceloni",
    "label": "Barceloní"
  },
  {
    "id": "ca-gironi",
    "label": "Gironí"
  },
  {
    "id": "ca-salat",
    "label": "Salat"
  },
  {
    "id": "ca-tarragoni",
    "label": "Tarragoní"
  },
  {
    "id": "ca-lleidata",
    "label": "Lleidatà"
  },
  {
    "id": "ca-pallares",
    "label": "Pallarès"
  },
  {
    "id": "ca-ribagorca",
    "label": "Ribagorçà"
  },
  {
    "id": "ca-tortosi",
    "label": "Tortosí"
  },
  {
    "id": "ca-xipella",
    "label": "Xipella"
  },
  {
    "id": "ca-rossellones",
    "label": "Rossellonès"
  },
  {
    "id": "ca-capcines",
    "label": "Capcinès"
  },
  {
    "id": "oc-aranes",
    "label": "Aranès"
  }
];

export const LOCALE_CODES = LANGUAGES.map((language) => language.id);

export const caStandard = {
  "start": "Inici",
  "target": "Destí",
  "rule": "Norma",
  "difficulty": "Dificultat",
  "description": "Connecta Inici i Destí amb comarques veïnes, completa una ruta contínua i millora-la pas a pas fins apropar-te al camí òptim.",
  "descriptionNormal": "uneix Inici i Destí triant comarques veïnes, completa una ruta vàlida i intenta millorar-la fins acostar-te al camí òptim.",
  "descriptionDaily": "resol el repte fix d'avui amb la mateixa ruta per a tothom, compara intents, temps i apropa't a l'òptim.",
  "descriptionTimed": "completa el camí abans que acabi el compte enrere, evita errors innecessaris i prioritza decisions ràpides per arribar a temps.",
  "descriptionExplore": "juga sense pressa per practicar connexions entre comarques, provar rutes alternatives, entendre el mapa i preparar-te pels modes exigents.",
  "time": "Temps",
  "timeLeft": "Temps restant",
  "coins": "Rovellons",
  "daily": "Diari",
  "dailyLevel": "Nivell diari",
  "playToday": "Jugar al problema d'avui",
  "calendar": "Calendari",
  "calendarLoading": "Carregant calendari...",
  "calendarEmpty": "Sense nivells",
  "calendarPlayDaily": "Jugar diari",
  "calendarNoLevel": "Sense nivell",
  "previous": "Anterior",
  "next": "Següent",
  "close": "Tanca",
  "offline": "Sense connexió",
  "backendOffline": "Sense backend",
  "completed": "Completat",
  "mode": "Mode",
  "normal": "Normal",
  "timed": "Contrarellotge",
  "explore": "Explora",
  "buy": "Compra",
  "locked": "Bloquejat",
  "unlock": "Desbloqueja",
  "powerups": "Comodins",
  "stats": "Estadístiques",
  "attempts": "Intents",
  "bestTime": "Millor temps",
  "bestAttempts": "Record d'intents",
  "perfect": "Perfecte",
  "ranking": "Rànquing",
  "global": "Global",
  "province": "Província",
  "group": "Grup",
  "groupName": "Nom del grup",
  "groupCode": "Codi (5 xifres)",
  "createGroup": "Crea codi",
  "joinGroup": "Uneix-me",
  "achievements": "Assoliments",
  "collect": "Recollir",
  "config": "Configuració",
  "theme": "Tema",
  "music": "Música",
  "sounds": "Sons",
  "soundToggle": "Sons activats",
  "masterVolume": "Volum general",
  "sfxVolume": "Volum d'efectes",
  "language": "Idioma",
  "volume": "Volum",
  "newGame": "Nova partida",
  "challenge": "Repte",
  "action": "Jugada",
  "options": "Opcions",
  "guessLabel": "Escriu una comarca",
  "submit": "Esbrina",
  "usedCount": "Comarques: {value}",
  "optimalCount": "Òptim: {value}",
  "currentCount": "Ruta: {value}",
  "statusReady": "En progrés",
  "statusInProgress": "Ruta incompleta",
  "statusIncomplete": "Falta complir la norma",
  "statusSuboptimal": "Ruta vàlida però no òptima",
  "statusSolved": "Solució trobada",
  "statusFailed": "Temps esgotat",
  "feedbackNoMatch": "No existeix aquesta comarca.",
  "feedbackStartTarget": "No pots usar inici ni destí.",
  "feedbackRepeated": "Comarca repetida.",
  "feedbackOk": "Correcte.",
  "noMatch": "Cap coincidència",
  "levelLocked": "Nivell bloquejat",
  "buyFor": "Compra per {value}",
  "reward": "Premi",
  "dailyDone": "Diari completat",
  "noRule": "Sense norma",
  "path": "Camí escrit",
  "fixedDifficulty": "Dificultat fixa per aquest mode.",
  "yourPath": "El teu recorregut",
  "correctPath": "Resultat correcte",
  "shortestCount": "Camí més curt: {value} comarques",
  "optimalAlternatives": "{value} camins òptims trobats",
  "topTime": "Top temps",
  "topAttempts": "Top intents",
  "topRoute": "Top ruta",
  "distribution": "Distribució del temps",
  "bestTimes": "Millors temps",
  "shortestRoute": "Ruta més curta",
  "fewestAttempts": "Menys intents",
  "loadingRanking": "Carregant rànquing...",
  "noRewards": "Sense premis per recollir.",
  "copy": "Copia",
  "copied": "Copiat",
  "on": "On",
  "off": "Off",
  "congrats": "Felicitats per completar el nivell!",
  "timeOut": "Temps esgotat",
  "nextMap": "Següent mapa",
  "repeatLevel": "Repetir nivell",
  "viewMap": "Veure mapa",
  "resultLabel": "Resultat",
  "learningLabel": "Aprenentatge",
  "progressLabel": "Progrés",
  "rewardLabel": "Recompensa",
  "routeCompletedTitle": "Ruta completada",
  "dailyCompletedTitle": "Repte diari completat",
  "routeReviewed": "Ruta revisada",
  "routeFromTo": "De {start} a {target}",
  "accuracyText": "{value}% precisió",
  "foundOptimalText": "Has trobat el camí òptim amb {value} comarques.",
  "foundSuboptimalText": "Has trobat {found} comarques; l'òptim en tenia {optimal}.",
  "failedLearningText": "El temps s'ha acabat; fixa l'inici, el destí i torna a provar la connexió.",
  "attemptsOut": "Intents esgotats",
  "attemptLimitLearningText": "Has fet {attempts}/{max} intents; el camí curt en demanava menys.",
  "dailyProgressText": "{done}/{total} reptes diaris completats",
  "difficultyProgressText": "{done}/{total} dificultats desbloquejades",
  "allDifficultiesUnlocked": "Totes les dificultats desbloquejades",
  "newDifficultyUnlocked": "Nova dificultat: {value}",
  "achievementsAllTitle": "Felicitats!",
  "achievementsAllBody": "Has completat tots els assoliments. Ara et toca ser cap de colla de rutes.",
  "ok": "D'acord",
  "loadingData": "Carregant dades...",
  "loadingMap": "Carregant mapa...",
  "zoomIn": "Apropar",
  "zoomOut": "Allunyar",
  "recenter": "Recentrar",
  "mapAriaLabel": "Mapa de Catalunya",
  "calendarLockedSuffix": "bloquejat",
  "calendarLoadingSuffix": "carregant",
  "optimalPathLabel": "Un camí òptim",
  "mainNavigation": "Navegació principal",
  "referenceCounty": "Comarca de referència: {value}.",
  "difficultyPixapi": "Pixapí",
  "difficultyDominguero": "Dominguero",
  "difficultyRondinaire": "Rondinaire",
  "difficultyCapCollaRutes": "Cap de colla de rutes",
  "powerupRevealNext": "Revela un pas",
  "powerupTempInitials": "Inicials (5s)"
};

const DIALECT_PARTICLES = {
  "ca-central": "va",
  "ca-barceloni": "bro",
  "ca-gironi": "noi",
  "ca-salat": "idò",
  "ca-tarragoni": "xe",
  "ca-lleidata": "lo",
  "ca-pallares": "rai",
  "ca-ribagorca": "au",
  "ca-tortosi": "xiquet",
  "ca-xipella": "i au",
  "ca-rossellones": "pas nyap",
  "ca-capcines": "pas cabrada",
  "oc-aranes": "òc"
};

const REPLACEMENT_SPECS = {
  "ca-central": [
    [
      "\\bD'acord\\b",
      "g",
      "Va bé"
    ],
    [
      "\\bCorrecte\\b",
      "g",
      "Clavat"
    ],
    [
      "\\bConfiguració\\b",
      "g",
      "Config"
    ]
  ],
  "ca-barceloni": [
    [
      "\\bConfiguració\\b",
      "g",
      "Config"
    ],
    [
      "\\bCompra\\b",
      "g",
      "Pilla"
    ],
    [
      "\\bCorrecte\\b",
      "g",
      "Correcte, crack"
    ],
    [
      "\\bSense connexió\\b",
      "g",
      "Sense wifi"
    ]
  ],
  "ca-gironi": [
    [
      "\\bCorrecte\\b",
      "g",
      "Ben parit"
    ],
    [
      "\\bCompra\\b",
      "g",
      "Pilla"
    ],
    [
      "\\bConfiguració\\b",
      "g",
      "Ajustos"
    ]
  ],
  "ca-salat": [
    [
      "\\bInici\\b",
      "g",
      "s'Inici"
    ],
    [
      "\\bDestí\\b",
      "g",
      "es Destí"
    ],
    [
      "\\bla ruta\\b",
      "g",
      "sa ruta"
    ],
    [
      "\\bel camí\\b",
      "g",
      "es camí"
    ],
    [
      "\\bEl camí\\b",
      "g",
      "Es camí"
    ]
  ],
  "ca-tarragoni": [
    [
      "\\bCorrecte\\b",
      "g",
      "Correcte, xe"
    ],
    [
      "\\bConfiguració\\b",
      "g",
      "Configuració, xe"
    ],
    [
      "\\bSense connexió\\b",
      "g",
      "Sense xarxa"
    ]
  ],
  "ca-lleidata": [
    [
      "\\bel camí\\b",
      "g",
      "lo camí"
    ],
    [
      "\\bEl camí\\b",
      "g",
      "Lo camí"
    ],
    [
      "\\bDestí\\b",
      "g",
      "destí"
    ],
    [
      "\\bCorrecte\\b",
      "g",
      "Correcte, lo"
    ]
  ],
  "ca-pallares": [
    [
      "\\bel camí\\b",
      "g",
      "lo camí"
    ],
    [
      "\\bEl camí\\b",
      "g",
      "Lo camí"
    ],
    [
      "\\bpots\\b",
      "g",
      "podes"
    ],
    [
      "\\bCorrecte\\b",
      "g",
      "Dret i fet"
    ]
  ],
  "ca-ribagorca": [
    [
      "\\bel camí\\b",
      "g",
      "lo camí"
    ],
    [
      "\\bEl camí\\b",
      "g",
      "Lo camí"
    ],
    [
      "\\bCorrecte\\b",
      "g",
      "Ben fet"
    ],
    [
      "\\bDestí\\b",
      "g",
      "destí"
    ]
  ],
  "ca-tortosi": [
    [
      "\\bDestí\\b",
      "g",
      "destí"
    ],
    [
      "\\bCorrecte\\b",
      "g",
      "Correcte, xiquet"
    ]
  ],
  "ca-xipella": [
    [
      "\\bcomarca\\b",
      "g",
      "comarquí"
    ],
    [
      "\\bcomarques\\b",
      "g",
      "comarquís"
    ],
    [
      "\\bruta\\b",
      "g",
      "ruti"
    ],
    [
      "\\bvàlida\\b",
      "g",
      "vàlidi"
    ],
    [
      "\\bveïnes\\b",
      "g",
      "veïní"
    ]
  ],
  "ca-rossellones": [
    [
      "\\bno\\b",
      "g",
      "pas"
    ],
    [
      "\\bNo\\b",
      "g",
      "Pas"
    ],
    [
      "\\bCorrecte\\b",
      "g",
      "Ben fet"
    ],
    [
      "\\bEnrere\\b",
      "g",
      "Endarrere"
    ]
  ],
  "ca-capcines": [
    [
      "\\bno\\b",
      "g",
      "pas"
    ],
    [
      "\\bNo\\b",
      "g",
      "Pas"
    ],
    [
      "\\bel camí\\b",
      "g",
      "lo camí"
    ],
    [
      "\\bEl camí\\b",
      "g",
      "Lo camí"
    ],
    [
      "\\bCorrecte\\b",
      "g",
      "Ben fet"
    ]
  ],
  "oc-aranes": [
    [
      "\\bInici\\b",
      "g",
      "inici"
    ],
    [
      "\\bDestí\\b",
      "g",
      "destin"
    ],
    [
      "\\bNorma\\b",
      "g",
      "Nòrma"
    ],
    [
      "\\bRuta\\b",
      "g",
      "Rota"
    ],
    [
      "\\bruta\\b",
      "g",
      "rota"
    ],
    [
      "\\bCamí\\b",
      "g",
      "Camin"
    ],
    [
      "\\bcamí\\b",
      "g",
      "camin"
    ],
    [
      "\\bcurt\\b",
      "g",
      "cuert"
    ],
    [
      "\\bòptim\\b",
      "g",
      "optim"
    ],
    [
      "\\bÒptim\\b",
      "g",
      "Optim"
    ],
    [
      "\\bcomarca\\b",
      "g",
      "comarca"
    ],
    [
      "\\bcomarques\\b",
      "g",
      "comarques"
    ],
    [
      "\\bvàlida\\b",
      "g",
      "valida"
    ],
    [
      "\\bmillorar\\b",
      "g",
      "milhorar"
    ],
    [
      "\\bacostar-te\\b",
      "g",
      "apropar-te"
    ]
  ]
};

const REPLACEMENTS = Object.fromEntries(
  Object.entries(REPLACEMENT_SPECS).map(([code, specs]) => [
    code,
    specs.map(([pattern, flags, replacement]) => [new RegExp(pattern, flags), replacement])
  ])
);

const EXACT_OVERRIDES = {
  "ca-central": {
    "descriptionNormal": "uneix Inici i Destí triant comarques veïnes, fes una ruta decenteta i acosta’t al camí òptim, va.",
    "description": "Connecta Inici i Destí amb comarques veïnes, fes una ruta fina i acosta-la al camí òptim, va.",
    "descriptionDaily": "resol el repte d'avui amb la mateixa ruta per tothom, compara intents i acosta't a l'òptim, va.",
    "descriptionTimed": "completa el camí abans del compte enrere, evita pífies i decideix ràpid per arribar-hi, va.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes exigents, va."
  },
  "ca-barceloni": {
    "descriptionNormal": "connecta Inici i Destí per comarques veïnes; si no toquen, no colen. Acosta’t bé al camí òptim.",
    "description": "Connecta Inici i Destí amb comarques veïnes, munta una ruta neta i acosta't al camí òptim, bro.",
    "descriptionDaily": "resol el repte d'avui amb la mateixa ruta per tothom, compara intents i acosta't a l'òptim, bro.",
    "descriptionTimed": "completa el camí abans del compte enrere, evita fails i decideix ràpid per arribar-hi, bro.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i entrena't pels modes intensos, bro."
  },
  "ca-gironi": {
    "descriptionNormal": "ajunta Inici i Destí triant comarques veïnes, fes una ruta ben parida i acosta-la al camí òptim.",
    "description": "Ajunta Inici i Destí amb comarques veïnes, fes ruta ben parida i acosta-la al camí òptim.",
    "descriptionDaily": "resol el repte d'avui amb la mateixa ruta per tothom, compara intents i acosta't a l'òptim, noi.",
    "descriptionTimed": "completa el camí abans del compte enrere, evita patacades i decideix ràpid, noi.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes de tralla, noi."
  },
  "ca-salat": {
    "descriptionNormal": "uneix s’Inici i es Destí triant ses comarques veïnes, completa sa ruta i acosta’t a es camí òptim.",
    "description": "Connecta s'Inici i es Destí amb ses comarques veïnes, completa sa ruta i acosta't a es camí òptim.",
    "descriptionDaily": "resol es repte d'avui amb sa mateixa ruta per tothom, compara intents i acosta't a s'òptim.",
    "descriptionTimed": "completa es camí abans des compte enrere, evita badades i decideix aviat, idò.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pes modes exigents, idò."
  },
  "ca-tarragoni": {
    "descriptionNormal": "uneix Inici i Destí triant comarques veïnes, fes una ruta com cal i acosta’t al camí òptim, au.",
    "description": "Uneix Inici i Destí amb comarques veïnes, fes ruta com cal i acosta-la al camí òptim, xe.",
    "descriptionDaily": "resol el repte d'avui amb la mateixa ruta per tothom, compara intents i acosta't a l'òptim, xe.",
    "descriptionTimed": "completa el camí abans del compte enrere, evita nyaps i decideix ràpid, xe.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes forts, xe."
  },
  "ca-lleidata": {
    "descriptionNormal": "uneix lo començament i lo destí triant comarques veïnes, fes ruta bona i acosta’t a lo camí òptim.",
    "description": "Connecta lo començament i lo destí amb comarques veïnes, fes ruta bona i acosta't a lo camí òptim.",
    "descriptionDaily": "resol lo repte d'avui amb la mateixa ruta per tothom, compara intents i acosta't a lo camí bo.",
    "descriptionTimed": "completa lo camí abans del compte enrere, evita nyaps i ves per feina, lo.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes forts, lo."
  },
  "ca-pallares": {
    "descriptionNormal": "ajunta lo punt d’inici i lo destí per comarques veïnes, fes ruta dreta i acosta’t a lo camí òptim.",
    "description": "Ajunta lo punt d'inici i lo destí amb comarques veïnes, fes ruta dreta i acosta't a lo camí òptim.",
    "descriptionDaily": "resol lo repte d'avui amb la mateixa ruta per tothom, compara intents i acosta't a lo camí bo.",
    "descriptionTimed": "completa lo camí abans del compte enrere, evita marrades i tira dret, rai.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes drets, rai."
  },
  "ca-ribagorca": {
    "descriptionNormal": "ajunta lo començament i lo destí per comarques veïnes, fes ruta bona i acosta’t a lo camí òptim.",
    "description": "Ajunta lo començament i lo destí amb comarques veïnes, fes ruta bona i acosta't a lo camí òptim.",
    "descriptionDaily": "resol lo repte d'avui amb la mateixa ruta per tothom, compara intents i acosta't a lo camí bo.",
    "descriptionTimed": "completa lo camí abans del compte enrere, evita marrades i ves-hi fort, au.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes forts, au."
  },
  "ca-tortosi": {
    "descriptionNormal": "uneix lo punt d’inici i lo destí triant comarques veïnes, fes ruta que face goig i acosta’t al camí òptim.",
    "description": "Uneix lo punt d'inici i lo destí amb comarques veïnes, fes ruta que face goig i acosta't al camí òptim.",
    "descriptionDaily": "resol lo repte d'avui amb la mateixa ruta per tothom, compara intents i acosta't a l'òptim, xiquet.",
    "descriptionTimed": "completa lo camí abans del compte enrere, evita nyaps i espavila, xiquet.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes forts, xiquet."
  },
  "ca-xipella": {
    "descriptionNormal": "uneix l’Inici i el Destí triant comarquís veïní, fes ruti vàlidi i acosta’t al camí òptim, i au.",
    "description": "Connecta l'Inici i el Destí amb comarquís veïní, fes ruti finí i acosta-la al camí òptim.",
    "descriptionDaily": "resol el repti d'avui amb la mateixi ruti per tothom, compara intents i acosta't a l'òptim.",
    "descriptionTimed": "completa el camí abans del compti enrere, evita nyapis i decideix ràpid, i au.",
    "descriptionExplore": "juga sense pressi, prova connexions entre comarquís i prepara't pels modis exigents, i au."
  },
  "ca-rossellones": {
    "descriptionNormal": "ajunta l’Inici i el Destí triant comarques veïnes, fes una ruta bona, pas nyap, cap al camí òptim.",
    "description": "Ajunta l'Inici i el Destí amb comarques veïnes, fes ruta bona, pas nyap, cap al camí òptim.",
    "descriptionDaily": "resol el repte d'avui amb la mateixa ruta per tothom, compara intents i ves cap a l'òptim.",
    "descriptionTimed": "completa el camí abans del compte enrere, pas badis, i decideix ràpid.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes forts, pas nyap."
  },
  "ca-capcines": {
    "descriptionNormal": "ajunta l’Inici i el Destí per comarques veïnes, fes ruta bona, pas cabrada, cap a lo camí òptim.",
    "description": "Ajunta l'Inici i el Destí amb comarques veïnes, fes ruta bona, pas cabrada, cap a lo camí òptim.",
    "descriptionDaily": "resol lo repte d'avui amb la mateixa ruta per tothom, compara intents i ves cap a l'òptim.",
    "descriptionTimed": "completa lo camí abans del compte enrere, pas badis, i decideix ràpid.",
    "descriptionExplore": "juga sense pressa, prova connexions entre comarques i prepara't pels modes forts, pas cabrada."
  },
  "oc-aranes": {
    "descriptionNormal": "junh er inici e eth destin per comarques vesies, hè ua rota valida e apròpa-la ath camin optim.",
    "description": "Junh er inici e eth destin damb comarques vesies, completa ua rota e apròpa-la ath camin optim.",
    "descriptionDaily": "resòlv eth rèpte d'aué damb era madeisha rota entà toti, compara assagi e apròpa-te ar optim.",
    "descriptionTimed": "completa eth camin abans deth compde enrere, evita errors e decidís rapid entà arribar.",
    "descriptionExplore": "jòga sense prèssa, pròva connexions entre comarques e prepara-te entàs mòdes exigents."
  }
};

function wordCount(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function applyReplacements(value, code) {
  return (REPLACEMENTS[code] || []).reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value
  );
}

function shouldAddParticle(key, value) {
  if (!value || /[{%]/.test(value)) return false;
  if (/^(on|off|ok|copy|copied)$/.test(key)) return false;
  const count = wordCount(value);
  return count > 0 && count <= 6;
}

function dialectizeLocale(code, overrides = {}) {
  const particle = DIALECT_PARTICLES[code];
  return Object.fromEntries(
    Object.entries(caStandard).map(([key, value]) => {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) return [key, overrides[key]];
      let next = applyReplacements(value, code);
      if (particle && shouldAddParticle(key, next)) {
        next = `${next}, ${particle}`;
      }
      return [key, next];
    })
  );
}

export const translations = Object.freeze(
  Object.fromEntries(
    LOCALE_CODES.map((code) => [
      code,
      code === DEFAULT_LOCALE
        ? caStandard
        : dialectizeLocale(code, EXACT_OVERRIDES[code] || {})
    ])
  )
);

export function resolveLocale(value) {
  return LOCALE_CODES.includes(value) ? value : DEFAULT_LOCALE;
}

export function translate(locale, key, vars = {}) {
  const resolvedLocale = resolveLocale(locale);
  const table = translations[resolvedLocale] || translations[DEFAULT_LOCALE];
  let text = table[key] || translations[DEFAULT_LOCALE][key] || key;
  Object.entries(vars).forEach(([token, value]) => {
    text = text.replace(new RegExp(`\\{${token}\\}`, "g"), String(value));
  });
  return text;
}
