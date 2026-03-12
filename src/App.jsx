import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { feature, mesh, neighbors as topoNeighbors } from "topojson-client";
import { supabase, supabaseEnabled } from "./lib/supabase.js";
import { buildCentroidMap, buildNeighborSet } from "./lib/geography.js";
import { loadSettings, saveSettings } from "./lib/settings.js";
import { TOMAS_THEME_ID } from "./lib/themes.js";
import { RULES, pickRuleForKey, normalizeRule } from "./lib/rules.js";
import { createAudioManager, loadAudioManifest } from "./lib/audio.js";
import { useSound } from "./audio/SoundProvider.tsx";
import {
  loadCompletionRecords,
  saveCompletionRecords,
  upsertCompletionRecord,
  selectWinningAttempt
} from "./lib/completion.js";
import { ThemeProvider } from "./ThemeProvider.jsx";

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 700;
const MAP_ID = "catalunya";
const DEFAULT_TIME_LIMIT_MS = 180000;
const LEADERBOARD_KEY = "rumb-leaderboard-v2";
const HISTORY_KEY = "rumb-history-v1";
const PLAYER_KEY = "rumb-player-id";
const STREAK_KEY = "rumb-daily-streak-v1";
const ACTIVE_THEME_KEY = "rumb-theme-active-v1";
const DIFFICULTY_UNLOCKS_KEY = "rumb-difficulty-unlocks-v1";
const LEVEL_STATS_KEY = "rumb-level-stats-v1";
const DAILY_RESULTS_KEY = "rumb-daily-results-v1";
const WEEKLY_RESULTS_KEY = "rumb-weekly-results-v1";
const CALENDAR_WEEKDAYS = ["dl", "dt", "dc", "dj", "dv", "ds", "dg"];
const CALENDAR_CACHE_KEY = "rumb-calendar-cache-v1";
const CALENDAR_CACHE_TTL_MS = 1000 * 60 * 15;
const RULE_HISTORY_KEY = "rumb-rule-history-v1";
const RULE_ASSIGNMENTS_KEY = "rumb-rule-assignments-v1";
const RULE_HISTORY_LIMIT = 60;
const LANGUAGE_KEY = "rumb-language-v1";
const MUSIC_SETTINGS_KEY = "rumb-music-settings-v1";
const SFX_SETTINGS_KEY = "rumb-sfx-settings-v1";
const SETTINGS_KEY = "rumb-settings-v1";
const COMPLETION_KEY = "rumb-completion-records-v1";
const WEATHER_CACHE_KEY = "rumb-weather-cache-v1";
const WEATHER_TTL_MS = 1000 * 60 * 10;
const MAP_CACHE_KEY = "rumb-map-cache-v1";
const MAP_CACHE_VERSION = "2026-01-05";
const MAP_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MAP_TOPO_URL = `/catalunya-comarques.topojson?v=${MAP_CACHE_VERSION}`;
const PING_URL = import.meta.env.VITE_PING_URL || "https://example.com/";
const TELEMETRY_QUEUE_KEY = "rumb-telemetry-queue-v1";
const ATTEMPTS_QUEUE_KEY = "rumb-attempts-queue-v1";
const MAX_TELEMETRY_QUEUE = 200;
const MAX_ATTEMPTS_QUEUE = 50;
const LEVEL_STATS_MAX = 200;

const DIFFICULTIES = [
  {
    id: "pixapi",
    label: "Pixapí",
    shortLabel: "pixapi",
    ruleLevels: ["easy"],
    minInternal: 3,
    hintsDisabled: false,
    fog: false
  },
  {
    id: "dominguero",
    label: "Dominguero",
    shortLabel: "dominguero",
    ruleLevels: ["easy", "medium"],
    minInternal: 4,
    hintsDisabled: false,
    fog: false
  },
  {
    id: "rondinaire",
    label: "Rondinaire",
    shortLabel: "rondinaire",
    ruleLevels: ["medium", "hard"],
    minInternal: 6,
    hintsDisabled: true,
    fog: true
  },
  {
    id: "cap-colla-rutes",
    label: "Cap de colla de rutes",
    shortLabel: "cap de colla",
    ruleLevels: ["expert"],
    minInternal: 9,
    hintsDisabled: true,
    fog: true
  }
];

const PRIMARY_MODES = [
  { id: "normal", label: "Normal" },
  { id: "timed", label: "Contrarellotge" },
  { id: "explore", label: "Explora" }
];

const DAILY_MIN_INTERNAL = 4;
const WEEKLY_MIN_INTERNAL = 8;
const EXPLORE_MIN_INTERNAL = 8;

const POWERUPS = [
  {
    id: "reveal-next",
    label: "Revela un pas",
    durationMs: 5000,
    penaltyMs: 4000,
    uses: {
      pixapi: 2,
      dominguero: 2,
      rondinaire: 1,
      "cap-colla-rutes": 0
    }
  },
  {
    id: "temp-neighbors",
    label: "Veïnes (5s)",
    durationMs: 5000,
    penaltyMs: 3000,
    uses: {
      pixapi: 2,
      dominguero: 2,
      rondinaire: 1,
      "cap-colla-rutes": 0
    }
  },
  {
    id: "temp-initials",
    label: "Inicials (5s)",
    durationMs: 5000,
    penaltyMs: 2000,
    uses: {
      pixapi: 2,
      dominguero: 1,
      rondinaire: 0,
      "cap-colla-rutes": 0
    }
  }
];

const MUSIC_TRACKS = [
  {
    id: "segadors",
    label: "els Segadors"
  },
  {
    id: "himne-del-barca",
    label: "Himne del barça"
  },
  {
    id: "toc-de-castells",
    label: "Toc de Castells"
  }
];

const AUDIO_PRELOAD_SFX = [
  "click",
  "open",
  "close",
  "toggle",
  "submit",
  "correct",
  "repeat",
  "neutral",
  "error",
  "win",
  "countdown",
  "powerup"
];

const LANGUAGES = [
  { id: "ca", label: "Català" },
  { id: "aranes", label: "Aranés" },
  { id: "gironi", label: "Gironí" },
  { id: "barceloni", label: "Barceloní" },
  { id: "tarragoni", label: "Tarragoní" },
  { id: "lleidata", label: "Lleidatà" }
];

const BASE_DESCRIPTION =
  "Connecta Inici i Destí amb comarques veïnes, completa una ruta contínua i millora-la pas a pas fins apropar-te al camí òptim.";

const STRINGS = {
  ca: {
    start: "Inici",
    target: "Destí",
    rule: "Norma",
    difficulty: "Dificultat",
    description: BASE_DESCRIPTION,
    descriptionNormal:
      "Mode normal: uneix Inici i Destí triant comarques veïnes, completa una ruta vàlida i intenta millorar-la fins acostar-te al camí òptim.",
    descriptionDaily:
      "Mode diari: resol el repte fix d'avui amb la mateixa ruta per a tothom, compara intents, temps i apropa't a l'òptim.",
    descriptionTimed:
      "Contrarellotge: completa el camí abans que acabi el compte enrere, evita errors innecessaris i prioritza decisions ràpides per arribar a temps.",
    descriptionExplore:
      "Explora: juga sense pressa per practicar connexions entre comarques, provar rutes alternatives, entendre el mapa i preparar-te pels modes exigents.",
    time: "Temps",
    timeLeft: "Temps restant",
    coins: "Rovellons",
    daily: "Diari",
    weekly: "Setmanal",
    dailyLevel: "Nivell diari",
    weeklyLevel: "Nivell setmanal",
    playToday: "Jugar al problema d'avui",
    playWeekly: "Jugar al problema d'aquesta setmana",
    calendar: "Calendari",
    calendarLoading: "Carregant calendari...",
    calendarEmpty: "Sense nivells",
    calendarPlayDaily: "Jugar diari",
    calendarPlayWeekly: "Jugar setmanal",
    calendarNoLevel: "Sense nivell",
    previous: "Anterior",
    next: "Següent",
    close: "Tanca",
    offline: "Sense connexió",
    backendOffline: "Sense backend",
    completed: "Completat",
    mode: "Mode",
    normal: "Normal",
    timed: "Contrarellotge",
    explore: "Explora",
    buy: "Compra",
    locked: "Bloquejat",
    unlock: "Desbloqueja",
    powerups: "Comodins",
    stats: "Estadístiques",
    attempts: "Intents",
    bestTime: "Millor temps",
    bestAttempts: "Record d'intents",
    perfect: "Perfecte",
    ranking: "Rànquing",
    global: "Global",
    province: "Província",
    group: "Grup",
    groupName: "Nom del grup",
    groupCode: "Codi (5 xifres)",
    createGroup: "Crea codi",
    joinGroup: "Uneix-me",
    achievements: "Assoliments",
    collect: "Recollir",
    config: "Configuració",
    theme: "Tema",
    music: "Música",
    sounds: "Sons",
    soundToggle: "Sons activats",
    masterVolume: "Volum general",
    sfxVolume: "Volum d'efectes",
    language: "Idioma",
    volume: "Volum",
    newGame: "Nova partida",
    challenge: "Repte",
    action: "Jugada",
    options: "Opcions",
    guessLabel: "Escriu una comarca",
    submit: "Esbrina",
    usedCount: "Comarques: {value}",
    optimalCount: "Òptim: {value}",
    currentCount: "Ruta: {value}",
    statusReady: "En progrés",
    statusInProgress: "Ruta incompleta",
    statusIncomplete: "Falta complir la norma",
    statusSuboptimal: "Ruta vàlida però no òptima",
    statusSolved: "Solució trobada",
    statusFailed: "Temps esgotat",
    feedbackNoMatch: "No existeix aquesta comarca.",
    feedbackStartTarget: "No pots usar inici ni destí.",
    feedbackRepeated: "Comarca repetida.",
    feedbackOk: "Correcte.",
    noMatch: "Cap coincidència",
    levelLocked: "Nivell bloquejat",
    buyFor: "Compra per {value}",
    reward: "Premi",
    dailyDone: "Diari completat",
    weeklyDone: "Setmanal completat",
    noRule: "Sense norma",
    path: "Camí escrit",
    fixedDifficulty: "Dificultat fixa per aquest mode.",
    yourPath: "El teu recorregut",
    correctPath: "Resultat correcte",
    shortestCount: "Camí més curt: {value} comarques",
    topTime: "Top temps",
    topAttempts: "Top intents",
    topRoute: "Top ruta",
    distribution: "Distribució del temps",
    bestTimes: "Millors temps",
    shortestRoute: "Ruta més curta",
    fewestAttempts: "Menys intents",
    loadingRanking: "Carregant rànquing...",
    noRewards: "Sense premis per recollir.",
    copy: "Copia",
    copied: "Copiat",
    on: "On",
    off: "Off",
    congrats: "Felicitats per completar el nivell!",
    timeOut: "Temps esgotat",
    achievementsAllTitle: "Felicitats!",
    achievementsAllBody:
      "Has completat tots els assoliments. Ara et toca ser cap de colla de rutes.",
    ok: "D'acord"
  },
  aranes: {
    start: "Inici",
    target: "Destin",
    rule: "Nòrma",
    difficulty: "Dificultat",
    description: BASE_DESCRIPTION,
    time: "Temps",
    timeLeft: "Temps restant",
    coins: "Rovellons",
    daily: "Diari",
    weekly: "Setmanau",
    dailyLevel: "Nivell diari",
    weeklyLevel: "Nivell setmanau",
    playToday: "Jugar al problema d'avui",
    playWeekly: "Jugar al problema d'aquesta setmana",
    calendar: "Calendari",
    completed: "Completat",
    mode: "Mòde",
    normal: "Normau",
    timed: "Contrarrelòtge",
    explore: "Explòra",
    buy: "Crompa",
    locked: "Bloquejat",
    unlock: "Desblòqueja",
    powerups: "Comodins",
    stats: "Estadistiques",
    attempts: "Intents",
    bestTime: "Melhor temps",
    bestAttempts: "Record d'intents",
    perfect: "Perfècte",
    ranking: "Rank",
    global: "Globau",
    province: "Província",
    group: "Grop",
    groupName: "Nòm deth grop",
    groupCode: "Còde (5 chifres)",
    createGroup: "Crea còde",
    joinGroup: "Jòin-me",
    achievements: "Assoliments",
    collect: "Recuelh",
    config: "Configuracion",
    calendarPlayDaily: "Jugar diari",
    calendarPlayWeekly: "Jugar setmanau",
    calendarNoLevel: "Sense nivèl",
    previous: "Anterior",
    next: "Seguent",
    close: "Tanca",
    offline: "Sense connexion",
    backendOffline: "Sense servidor",
    theme: "Tèma",
    music: "Musica",
    sounds: "Sons",
    soundToggle: "Sons activats",
    masterVolume: "Volum generau",
    sfxVolume: "Volum d'efèctes",
    language: "Lengua",
    volume: "Vòlum",
    newGame: "Nau partida",
    guessLabel: "Escriu ua comarca",
    submit: "Esbrina",
    noMatch: "Cap coincidéncia",
    levelLocked: "Nivell bloquejat",
    buyFor: "Crompa per {value}",
    reward: "Prèmi",
    dailyDone: "Diari completat",
    weeklyDone: "Setmanau completat",
    noRule: "Sense nòrma",
    path: "Camín escrit",
    fixedDifficulty: "Dificultat fixa entà aguest mòde.",
    yourPath: "Eth tòn recorregut",
    correctPath: "Resultat corrècte",
    shortestCount: "Camín mès curt: {value} comarques",
    topTime: "Top temps",
    topAttempts: "Top intents",
    topRoute: "Top ròta",
    distribution: "Distribucion deth temps",
    bestTimes: "Melhors temps",
    shortestRoute: "Ròta mès curta",
    fewestAttempts: "Menys intents",
    loadingRanking: "Carregant rank...",
    noRewards: "Sense prèmis entà recuelh.",
    copy: "Còpia",
    copied: "Copiat",
    on: "On",
    off: "Off",
    congrats: "Felicitats per completar eth nivèu!",
    timeOut: "Temps esgotat",
    achievementsAllTitle: "Felicitats!",
    achievementsAllBody:
      "As completat tots es assoliments. Ara te tòca èster cap de colla de rutes.",
    ok: "D'acord"
  },
  gironi: {
    start: "Inici, noi de Girona",
    target: "Destí, nano",
    rule: "Norma, tu",
    difficulty: "Dificultat, eh",
    description: BASE_DESCRIPTION,
    time: "Temps, nano",
    timeLeft: "Temps que queda, eh",
    coins: "Rovellons",
    daily: "Diari, noi",
    weekly: "Setmanal, nano",
    dailyLevel: "Nivell diari",
    weeklyLevel: "Nivell setmanal",
    playToday: "Jugar al problema d'avui",
    playWeekly: "Jugar al problema d'aquesta setmana",
    calendar: "Calendari, noi",
    completed: "Fet i ben fet",
    mode: "Mode, noi",
    normal: "Normalet de barri",
    timed: "Contrarellotge a sac",
    explore: "Explora-ho tot, va",
    buy: "Pilla-ho",
    locked: "Tancat amb pany",
    unlock: "Desbloqueja-ho",
    powerups: "Comodins de tralla",
    stats: "Números i xarrup",
    attempts: "Intents",
    bestTime: "Millor temps",
    bestAttempts: "Record d'intents",
    perfect: "Perfecte, nano!",
    ranking: "Rànquing",
    global: "Global",
    province: "Província",
    group: "Colla",
    groupName: "Nom de la colla",
    groupCode: "Codi (5 xifres)",
    createGroup: "Crea codi",
    joinGroup: "Entra-hi",
    achievements: "Assoliments",
    collect: "Recull",
    config: "Ajustos de la vida",
    calendarPlayDaily: "Juga diari, noi",
    calendarPlayWeekly: "Juga setmanal, nano",
    calendarNoLevel: "Sense nivell, apa",
    previous: "Enrere",
    next: "Següent",
    close: "Tanca",
    offline: "Sense xarxa, noi",
    backendOffline: "Backend caigut, nano",
    theme: "Tema, noi",
    music: "Música, eh",
    sounds: "Sorollets, nano",
    soundToggle: "Sons activats",
    masterVolume: "Volum general",
    sfxVolume: "Volum d'efectes",
    language: "Parla, noi",
    volume: "Volum, eh",
    newGame: "Nova partida, som-hi",
    guessLabel: "Escriu una comarca, nano",
    submit: "Esbrina",
    noMatch: "No hi ha res, nano",
    levelLocked: "Nivell bloquejat",
    buyFor: "Pilla per {value}",
    reward: "Premi",
    dailyDone: "Diari fet",
    weeklyDone: "Setmanal fet",
    noRule: "Sense norma, eh",
    path: "Camí escrit",
    fixedDifficulty: "Dificultat fixa, no toquis res.",
    yourPath: "El teu recorregut",
    correctPath: "Resultat bo de debò",
    shortestCount: "Camí més curt: {value} comarques",
    topTime: "Top temps, noi",
    topAttempts: "Top intents, nano",
    topRoute: "Top ruta",
    distribution: "Distribució del temps, noi",
    bestTimes: "Millors temps",
    shortestRoute: "Ruta més curta",
    fewestAttempts: "Menys intents",
    loadingRanking: "Carregant rànquing, espera...",
    noRewards: "No hi ha premis per recollir, noi.",
    copy: "Copia",
    copied: "Copiat",
    on: "On",
    off: "Off",
    congrats: "Felicitats, ho has petat!",
    timeOut: "Temps esgotat, nano",
    achievementsAllTitle: "Felicitats!",
    achievementsAllBody:
      "Has completat tots els assoliments. Ara ets cap de colla de rutes, nano.",
    ok: "D'acord"
  },
  barceloni: {
    start: "Inici, tio",
    target: "Destí, tronco",
    rule: "Norma, bro",
    difficulty: "Dificultat, tio",
    description: BASE_DESCRIPTION,
    time: "Temps, bro",
    timeLeft: "Temps que queda, bro",
    coins: "Rovellons",
    daily: "Diari, bro",
    weekly: "Setmanal, bro",
    dailyLevel: "Nivell diari",
    weeklyLevel: "Nivell setmanal",
    playToday: "Jugar al problema d'avui",
    playWeekly: "Jugar al problema d'aquesta setmana",
    calendar: "Calendari, bro",
    completed: "Fet, bro",
    mode: "Mode, bro",
    normal: "Normalillo",
    timed: "Contrarellotge a saco",
    explore: "Explora-ho, killa",
    buy: "Compra-ho",
    locked: "Bloquejat, nano",
    unlock: "Desbloqueja-ho",
    powerups: "Comodins, bro",
    stats: "Stats, tio",
    attempts: "Intents",
    bestTime: "Millor temps",
    bestAttempts: "Record d'intents",
    perfect: "Perfecte, crack",
    ranking: "Rànquing",
    global: "Global",
    province: "Província",
    group: "Grupet",
    groupName: "Nom del grup",
    groupCode: "Codi (5 xifres)",
    createGroup: "Crea codi",
    joinGroup: "M'hi apunto",
    achievements: "Assoliments",
    collect: "Pilla",
    config: "Config, bro",
    calendarPlayDaily: "Juga diari, bro",
    calendarPlayWeekly: "Juga setmanal, bro",
    calendarNoLevel: "Res avui, bro",
    previous: "Enrere",
    next: "Següent",
    close: "Tanca",
    offline: "Sense wifi, bro",
    backendOffline: "Backend KO, bro",
    theme: "Tema, bro",
    music: "Música, bro",
    sounds: "Sons, tio",
    soundToggle: "Sons activats",
    masterVolume: "Volum general",
    sfxVolume: "Volum d'efectes",
    language: "Idioma, bro",
    volume: "Volum, tio",
    newGame: "Nova partida, bro",
    guessLabel: "Escriu una comarca, crack",
    submit: "Esbrina",
    noMatch: "No hi ha res, bro",
    levelLocked: "Nivell bloquejat",
    buyFor: "Compra per {value}",
    reward: "Premi",
    dailyDone: "Diari fet",
    weeklyDone: "Setmanal fet",
    noRule: "Sense norma, tio",
    path: "Camí escrit",
    fixedDifficulty: "Dificultat fixa, no maregis",
    yourPath: "El teu recorregut",
    correctPath: "Resultat correcte, bro",
    shortestCount: "Camí més curt: {value} comarques",
    topTime: "Top temps, bro",
    topAttempts: "Top intents, bro",
    topRoute: "Top ruta",
    distribution: "Distribució del temps, bro",
    bestTimes: "Millors temps",
    shortestRoute: "Ruta més curta",
    fewestAttempts: "Menys intents",
    loadingRanking: "Carregant rànquing, tio...",
    noRewards: "Ara mateix no hi ha premis, bro.",
    copy: "Copia",
    copied: "Copiat",
    on: "On",
    off: "Off",
    congrats: "Felicitats, crack!",
    timeOut: "Temps esgotat, tio",
    achievementsAllTitle: "Felicitats!",
    achievementsAllBody:
      "Has completat tots els assoliments. Ara ets cap de colla de rutes, bro.",
    ok: "Ok"
  },
  tarragoni: {
    start: "Inici, xiquet",
    target: "Destí, xiqueta",
    rule: "Norma, xe",
    difficulty: "Dificultat, xe",
    description: BASE_DESCRIPTION,
    time: "Temps, xe",
    timeLeft: "Temps que queda, xe",
    coins: "Rovellons",
    daily: "Diari, xe",
    weekly: "Setmanal, xe",
    dailyLevel: "Nivell diari",
    weeklyLevel: "Nivell setmanal",
    playToday: "Jugar al problema d'avui",
    playWeekly: "Jugar al problema d'aquesta setmana",
    calendar: "Calendari, xe",
    completed: "Fet i llest",
    mode: "Mode, xe",
    normal: "Normalet",
    timed: "Contrarellotge a tota castanya",
    explore: "Explora-ho, xe",
    buy: "Compra-ho",
    locked: "Tancat",
    unlock: "Desbloqueja-ho",
    powerups: "Comodins, xe",
    stats: "Números, xe",
    attempts: "Intents",
    bestTime: "Millor temps",
    bestAttempts: "Record d'intents",
    perfect: "Perfecte, xiquet",
    ranking: "Rànquing",
    global: "Global",
    province: "Província",
    group: "Penya",
    groupName: "Nom de la penya",
    groupCode: "Codi (5 xifres)",
    createGroup: "Crea codi",
    joinGroup: "M'hi fiqui",
    achievements: "Assoliments",
    collect: "Recull",
    config: "Configuració, xe",
    calendarPlayDaily: "Juga diari, xe",
    calendarPlayWeekly: "Juga setmanal, xe",
    calendarNoLevel: "No n'hi ha, xe",
    previous: "Enrere",
    next: "Següent",
    close: "Tanca",
    offline: "Sense xarxa, xe",
    backendOffline: "Backend caigut, xe",
    theme: "Tema, xe",
    music: "Música, xe",
    sounds: "Sons, xe",
    soundToggle: "Sons activats",
    masterVolume: "Volum general",
    sfxVolume: "Volum d'efectes",
    language: "Idioma, xe",
    volume: "Volum, xe",
    newGame: "Nova partida, xe",
    guessLabel: "Escriu una comarca, xe",
    submit: "Esbrina",
    noMatch: "No hi ha res, xiquet",
    levelLocked: "Nivell bloquejat",
    buyFor: "Compra per {value}",
    reward: "Premi",
    dailyDone: "Diari fet",
    weeklyDone: "Setmanal fet",
    noRule: "Sense norma, xe",
    path: "Camí escrit",
    fixedDifficulty: "Dificultat fixa, no toquis",
    yourPath: "El teu recorregut",
    correctPath: "Resultat bo, xe",
    shortestCount: "Camí més curt: {value} comarques",
    topTime: "Top temps",
    topAttempts: "Top intents",
    topRoute: "Top ruta",
    bestTimes: "Millors temps",
    shortestRoute: "Ruta més curta",
    fewestAttempts: "Menys intents",
    loadingRanking: "Carregant rànquing, xe...",
    noRewards: "Ara no hi ha premis, xiquet.",
    copy: "Copia",
    copied: "Copiat",
    on: "On",
    off: "Off",
    congrats: "Felicitats, xiquet!",
    timeOut: "Temps esgotat, xe",
    achievementsAllTitle: "Felicitats!",
    achievementsAllBody:
      "Has completat tots els assoliments. Ara ets cap de colla de rutes, xe.",
    ok: "D'acord"
  },
  lleidata: {
    start: "Inici, lo",
    target: "Destí, lo",
    rule: "Norma, lo",
    difficulty: "Dificultat, lo",
    description: BASE_DESCRIPTION,
    time: "Temps, lo",
    timeLeft: "Temps que queda, lo",
    coins: "Rovellons",
    daily: "Diari, lo",
    weekly: "Setmanal, lo",
    dailyLevel: "Nivell diari",
    weeklyLevel: "Nivell setmanal",
    playToday: "Jugar al problema d'avui",
    playWeekly: "Jugar al problema d'aquesta setmana",
    calendar: "Calendari, lo",
    completed: "Fet i dat",
    mode: "Mode, lo",
    normal: "Normalet",
    timed: "Contrarellotge a saco",
    explore: "Explora-ho, lo",
    buy: "Compra-ho",
    locked: "Tancat",
    unlock: "Desbloqueja-ho",
    powerups: "Comodins, lo",
    stats: "Números, lo",
    attempts: "Intents",
    bestTime: "Millor temps",
    bestAttempts: "Record d'intents",
    perfect: "Perfecte, lo",
    ranking: "Rànquing",
    global: "Global",
    province: "Província",
    group: "Colla",
    groupName: "Nom de la colla",
    groupCode: "Codi (5 xifres)",
    createGroup: "Crea codi",
    joinGroup: "M'hi poso",
    achievements: "Assoliments",
    collect: "Recull",
    config: "Configuració, lo",
    calendarPlayDaily: "Juga diari, lo",
    calendarPlayWeekly: "Juga setmanal, lo",
    calendarNoLevel: "No n'hi ha, lo",
    previous: "Enrere",
    next: "Següent",
    close: "Tanca",
    offline: "Sense xarxa, lo",
    backendOffline: "Backend KO, lo",
    theme: "Tema, lo",
    music: "Música, lo",
    sounds: "Sons, lo",
    soundToggle: "Sons activats",
    masterVolume: "Volum general",
    sfxVolume: "Volum d'efectes",
    language: "Idioma, lo",
    volume: "Volum, lo",
    newGame: "Nova partida, lo",
    guessLabel: "Escriu una comarca, lo",
    submit: "Esbrina",
    noMatch: "No n'hi ha cap, lo",
    levelLocked: "Nivell bloquejat",
    buyFor: "Compra per {value}",
    reward: "Premi",
    dailyDone: "Diari fet",
    weeklyDone: "Setmanal fet",
    noRule: "Sense norma, lo",
    path: "Camí escrit",
    fixedDifficulty: "Dificultat fixa, no maregis",
    yourPath: "El teu recorregut",
    correctPath: "Resultat bo, lo",
    shortestCount: "Camí més curt: {value} comarques",
    topTime: "Top temps",
    topAttempts: "Top intents",
    topRoute: "Top ruta",
    bestTimes: "Millors temps",
    shortestRoute: "Ruta més curta",
    fewestAttempts: "Menys intents",
    loadingRanking: "Carregant rànquing, lo...",
    noRewards: "Ara no hi ha premis, lo.",
    copy: "Copia",
    copied: "Copiat",
    on: "On",
    off: "Off",
    congrats: "Felicitats, lo!",
    timeOut: "Temps esgotat, lo",
    achievementsAllTitle: "Felicitats!",
    achievementsAllBody:
      "Has completat tots els assoliments. Ara ets cap de colla de rutes, lo.",
    ok: "D'acord"
  }
};

const REGIONS = [
  {
    id: "barcelona",
    label: "Barcelona",
    comarques: [
      "Alt Penedès",
      "Anoia",
      "Bages",
      "Baix Llobregat",
      "Barcelonès",
      "Berguedà",
      "Garraf",
      "Maresme",
      "Osona",
      "Vallès Occidental",
      "Vallès Oriental"
    ]
  },
  {
    id: "girona",
    label: "Girona",
    comarques: [
      "Alt Empordà",
      "Baix Empordà",
      "Garrotxa",
      "Gironès",
      "Pla de l'Estany",
      "Ripollès",
      "Selva",
      "Cerdanya"
    ]
  },
  {
    id: "lleida",
    label: "Lleida",
    comarques: [
      "Alt Urgell",
      "Alta Ribagorça",
      "Garrigues",
      "Noguera",
      "Pallars Jussà",
      "Pallars Sobirà",
      "Pla d'Urgell",
      "Segarra",
      "Segrià",
      "Solsonès",
      "Urgell",
      "Val d'Aran"
    ]
  },
  {
    id: "tarragona",
    label: "Tarragona",
    comarques: [
      "Alt Camp",
      "Baix Camp",
      "Baix Ebre",
      "Baix Penedès",
      "Conca de Barberà",
      "Montsià",
      "Priorat",
      "Ribera d'Ebre",
      "Tarragonès",
      "Terra Alta"
    ]
  }
];

const RULE_DEFS = RULES.map((rule) => normalizeRule(rule)).filter(Boolean);

function pickRandom(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getInitials(value) {
  const skip = new Set(["el", "la", "les", "l", "de", "del", "d", "dels"]);
  return value
    .replace(/'/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !skip.has(token.toLowerCase()))
    .map((token) => token[0].toUpperCase())
    .join("");
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return "—";
  const total = Math.max(ms, 0);
  const seconds = Math.floor(total / 1000);
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

function formatTopPercent(value) {
  if (!Number.isFinite(value)) return "—";
  const clamped = Math.min(100, Math.max(1, Math.round(value)));
  return `Top ${clamped}%`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(resource, options = {}, config = {}) {
  const { retries = 2, backoffMs = 400 } = config;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(resource, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await wait(backoffMs * 2 ** attempt);
    }
  }
  throw lastError;
}

async function withRetry(action, config = {}) {
  const { retries = 2, backoffMs = 400 } = config;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await wait(backoffMs * 2 ** attempt);
    }
  }
  throw lastError;
}

function getRuleDifficulty(def) {
  if (!def) return "medium";
  if (typeof def.difficulty === "string") return def.difficulty;
  const value = typeof def.difficultyCultural === "number" ? def.difficultyCultural : 3;
  if (value >= 5) return "expert";
  if (value >= 4) return "hard";
  if (value >= 3) return "medium";
  return "easy";
}

function getRuleTags(def) {
  if (def?.tags && def.tags.length) return def.tags;
  return ["cultural"];
}

function getDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayKeyOffset(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return getDayKey(date);
}

function getLocalDayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalDayKeyOffset(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return getLocalDayKey(date);
}

function normalizeDayKey(value) {
  if (!value) return null;
  if (value instanceof Date) return getLocalDayKey(value);
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return getLocalDayKey(parsed);
  }
  return null;
}

function normalizeWeekKey(value) {
  if (!value) return null;
  if (value instanceof Date) return getWeekKey(value);
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-W(\d{1,2})$/);
    if (match) return `${match[1]}-W${match[2].padStart(2, "0")}`;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return getWeekKey(parsed);
    return value;
  }
  return null;
}

function getWeekKey(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target - firstThursday;
  const week = 1 + Math.round(diff / 604800000);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function buildMonthGrid(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    return {
      date: current,
      key: getLocalDayKey(current),
      inMonth: current.getMonth() === date.getMonth(),
      label: current.getDate()
    };
  });
}

function buildWeeksForYear(year) {
  const base = new Date(Date.UTC(year, 0, 4));
  const day = (base.getUTCDay() + 6) % 7;
  base.setUTCDate(base.getUTCDate() - day);
  const weeks = [];
  for (let i = 0; i < 53; i += 1) {
    const current = new Date(base);
    current.setUTCDate(base.getUTCDate() + i * 7);
    const key = getWeekKey(current);
    if (!weeks.find((entry) => entry.key === key)) {
      weeks.push({ key, date: current });
    }
  }
  return weeks;
}

function formatDayLabel(dayKey) {
  if (!dayKey) return "";
  const date = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return date.toLocaleDateString("ca-ES", {
    day: "2-digit",
    month: "short",
    timeZone: "Europe/Madrid"
  });
}

function formatFullDayLabel(dayKey) {
  if (!dayKey) return "";
  const date = new Date(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dayKey;
  const weekday = date.toLocaleDateString("ca-ES", {
    weekday: "long",
    timeZone: "Europe/Madrid"
  });
  const day = date.toLocaleDateString("ca-ES", {
    day: "numeric",
    timeZone: "Europe/Madrid"
  });
  const month = date.toLocaleDateString("ca-ES", {
    month: "long",
    timeZone: "Europe/Madrid"
  });
  const year = date.toLocaleDateString("ca-ES", {
    year: "numeric",
    timeZone: "Europe/Madrid"
  });
  return `${weekday} ${day} de ${month} del ${year}`;
}

function getWeekRange(weekKey) {
  if (!weekKey) return null;
  const [yearPart, weekPart] = weekKey.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);
  if (!year || !week) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(year, 0, 4 - dayOfWeek + (week - 1) * 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday, end: sunday };
}

function formatWeekLabel(weekKey) {
  const range = getWeekRange(weekKey);
  if (!range) return weekKey || "";
  const startDay = range.start.toLocaleDateString("ca-ES", {
    day: "numeric",
    timeZone: "Europe/Madrid"
  });
  const endDay = range.end.toLocaleDateString("ca-ES", {
    day: "numeric",
    timeZone: "Europe/Madrid"
  });
  const startMonth = range.start.toLocaleDateString("ca-ES", {
    month: "long",
    timeZone: "Europe/Madrid"
  });
  const endMonth = range.end.toLocaleDateString("ca-ES", {
    month: "long",
    timeZone: "Europe/Madrid"
  });
  const endYear = range.end.toLocaleDateString("ca-ES", {
    year: "numeric",
    timeZone: "Europe/Madrid"
  });
  if (startMonth === endMonth) {
    return `del ${startDay} al ${endDay} de ${endMonth} ${endYear}`;
  }
  return `del ${startDay} de ${startMonth} al ${endDay} de ${endMonth} ${endYear}`;
}

function serializeAdjacency(adjacencyMap) {
  return [...adjacencyMap.entries()].map(([id, neighbors]) => [id, [...neighbors]]);
}

function deserializeAdjacency(list) {
  if (!Array.isArray(list)) return new Map();
  return new Map(list.map(([id, neighbors]) => [id, new Set(neighbors || [])]));
}

function deserializeShortestPathCache(list) {
  if (!Array.isArray(list)) return new Map();
  return new Map(
    list.map(([startId, targets]) => [startId, new Map(targets || [])])
  );
}

function readMapCache() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(MAP_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== MAP_CACHE_VERSION) return null;
    if (parsed.updatedAt && Date.now() - parsed.updatedAt > MAP_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeMapCache(payload) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      MAP_CACHE_KEY,
      JSON.stringify({ ...payload, version: MAP_CACHE_VERSION, updatedAt: Date.now() })
    );
  } catch {
    // Sense espai a localStorage o privacitat estricta.
  }
}

function readCalendarCache() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CALENDAR_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.updatedAt) return null;
    if (Date.now() - parsed.updatedAt > CALENDAR_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCalendarCache(payload) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      CALENDAR_CACHE_KEY,
      JSON.stringify({ ...payload, updatedAt: Date.now() })
    );
  } catch {
    // Sense espai a localStorage o privacitat estricta.
  }
}

function readRuleHistory() {
  if (typeof window === "undefined") return { daily: [], weekly: [] };
  const raw = localStorage.getItem(RULE_HISTORY_KEY);
  if (!raw) return { daily: [], weekly: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      daily: Array.isArray(parsed?.daily) ? parsed.daily : [],
      weekly: Array.isArray(parsed?.weekly) ? parsed.weekly : []
    };
  } catch {
    return { daily: [], weekly: [] };
  }
}

function writeRuleHistory(history) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RULE_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // ignorem
  }
}

function readRuleAssignments() {
  if (typeof window === "undefined") return { daily: {}, weekly: {} };
  const raw = localStorage.getItem(RULE_ASSIGNMENTS_KEY);
  if (!raw) return { daily: {}, weekly: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      daily: parsed?.daily && typeof parsed.daily === "object" ? parsed.daily : {},
      weekly: parsed?.weekly && typeof parsed.weekly === "object" ? parsed.weekly : {}
    };
  } catch {
    return { daily: {}, weekly: {} };
  }
}

function writeRuleAssignments(assignments) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RULE_ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch {
    // ignorem
  }
}

function readWeatherCache() {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(WEATHER_CACHE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeWeatherCache(payload) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignorem
  }
}

function resolveWeatherState(weatherCode, windSpeed) {
  const wind = Number(windSpeed) || 0;
  if (wind >= 12) return "wind";
  if ([95, 96, 99].includes(weatherCode)) return "storm";
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "snow";
  if ([45, 48].includes(weatherCode)) return "fog";
  if (
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)
  ) {
    return "rain";
  }
  if ([1, 2, 3].includes(weatherCode)) return "clouds";
  return "clear";
}

function buildShortestPathCache(adjacency) {
  if (!adjacency || !adjacency.size) return new Map();
  const ids = [...adjacency.keys()];
  const cache = new Map();

  ids.forEach((startId) => {
    const queue = [startId];
    const visited = new Set([startId]);
    const prev = new Map();

    while (queue.length) {
      const current = queue.shift();
      const neighbors = adjacency.get(current) || new Set();
      for (const next of neighbors) {
        if (visited.has(next)) continue;
        visited.add(next);
        prev.set(next, current);
        queue.push(next);
      }
    }

    const targetMap = new Map();
    ids.forEach((targetId) => {
      if (targetId === startId) {
        targetMap.set(targetId, [startId]);
        return;
      }
      if (!visited.has(targetId)) return;
      const path = [targetId];
      let step = targetId;
      while (prev.has(step)) {
        step = prev.get(step);
        path.push(step);
        if (step === startId) break;
      }
      targetMap.set(targetId, path.reverse());
    });
    cache.set(startId, targetMap);
  });

  return cache;
}

function readQueue(key) {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(key, items, max) {
  if (typeof window === "undefined") return [];
  const trimmed = items.slice(-max);
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Sense espai al localStorage o privacitat estricta.
  }
  return trimmed;
}

function enqueueQueue(key, item, max) {
  const list = readQueue(key);
  list.push(item);
  return writeQueue(key, list, max);
}

function getStreakTitle(streak) {
  if (streak >= 30) return "Mestre dels Camins";
  if (streak >= 14) return "Cartògraf del Dia";
  if (streak >= 7) return "Ruter Constant";
  if (streak >= 3) return "Caminant";
  return "Explorador";
}

function getStreakTier(streak) {
  if (streak >= 60) return "cap de colla";
  if (streak >= 45) return "ninja del pirineu";
  if (streak >= 30) return "ciclista de cuneta";
  if (streak >= 21) return "rondinaire";
  if (streak >= 14) return "tastaolletes";
  if (streak >= 7) return "dominguero";
  return "pixapi";
}

function getPowerupUses(difficultyId) {
  const uses = {};
  POWERUPS.forEach((powerup) => {
    uses[powerup.id] = powerup.uses[difficultyId] ?? 0;
  });
  return uses;
}

function getNextDifficultyId(currentId) {
  const index = DIFFICULTIES.findIndex((entry) => entry.id === currentId);
  if (index < 0 || index >= DIFFICULTIES.length - 1) return null;
  return DIFFICULTIES[index + 1].id;
}

function formatRuleDifficulty(value) {
  if (value === "easy") return "Fàcil";
  if (value === "medium") return "Mitjà";
  if (value === "hard") return "Difícil";
  if (value === "expert") return "Expert";
  return "—";
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function mulberry32(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let result = Math.imul(t ^ (t >>> 15), t | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function findShortestPath(startId, targetId, adjacency, cache) {
  if (!startId || !targetId) return [];
  if (startId === targetId) return [startId];
  const cached = cache?.get(startId)?.get(targetId);
  if (cached) return cached;
  const queue = [startId];
  const visited = new Set([startId]);
  const prev = new Map();

  while (queue.length) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || new Set();
    for (const next of neighbors) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, current);
      if (next === targetId) {
        const path = [targetId];
        let step = targetId;
        while (prev.has(step)) {
          step = prev.get(step);
          path.push(step);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

function findShortestPathInSet(startId, targetId, adjacency, allowedSet) {
  if (!startId || !targetId) return [];
  if (!allowedSet.has(startId) || !allowedSet.has(targetId)) return [];
  if (startId === targetId) return [startId];
  const queue = [startId];
  const visited = new Set([startId]);
  const prev = new Map();

  while (queue.length) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || new Set();
    for (const next of neighbors) {
      if (visited.has(next) || !allowedSet.has(next)) continue;
      visited.add(next);
      prev.set(next, current);
      if (next === targetId) {
        const path = [targetId];
        let step = targetId;
        while (prev.has(step)) {
          step = prev.get(step);
          path.push(step);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

function hasPathViaNode(startId, targetId, nodeId, adjacency, allowedSet) {
  if (!allowedSet.has(nodeId)) return false;
  const toNode = findShortestPathInSet(startId, nodeId, adjacency, allowedSet);
  if (!toNode.length) return false;
  const toTarget = findShortestPathInSet(nodeId, targetId, adjacency, allowedSet);
  return toTarget.length > 0;
}

function findShortestPathWithRule(startId, targetId, adjacency, rule, allIds, cache) {
  if (!rule) return findShortestPath(startId, targetId, adjacency, cache);
  if (rule.kind === "avoid") {
    const blocked = new Set(rule.comarcaIds || []);
    const allowed = new Set(allIds.filter((id) => !blocked.has(id)));
    return findShortestPathInSet(startId, targetId, adjacency, allowed);
  }
  if (rule.kind === "mustIncludeAny") {
    const candidates = rule.comarcaIds || [];
    let best = [];
    candidates.forEach((nodeId) => {
      const first = findShortestPath(startId, nodeId, adjacency, cache);
      const second = findShortestPath(nodeId, targetId, adjacency, cache);
      if (!first.length || !second.length) return;
      const combined = first.concat(second.slice(1));
      if (!best.length || combined.length < best.length) {
        best = combined;
      }
    });
    return best.length ? best : findShortestPath(startId, targetId, adjacency, cache);
  }
  return findShortestPath(startId, targetId, adjacency, cache);
}

function resolveRule(def, ctx) {
  if (def.kind !== "avoid-random") return def;
  const pool = ctx.comarcaNames.filter(
    (name) => name !== ctx.startName && name !== ctx.targetName
  );
  const pick = pool.length ? pickRandom(pool, ctx.rng) : ctx.comarcaNames[0];
  return {
    id: `${def.id}-${normalizeName(pick).replace(/\s+/g, "-")}`,
    kind: "avoid",
    label: `No pots passar per ${pick}.`,
    comarques: [pick],
    difficulty: "medium"
  };
}

function prepareRule(def, ctx) {
  const resolved = resolveRule(def, ctx);
  const difficulty = resolved.difficulty || getRuleDifficulty(def);
  const tags = resolved.tags || getRuleTags(def);
  const names = resolved.comarques || [];
  const comarcaIds = names
    .map((name) => ctx.normalizedToId.get(normalizeName(name)))
    .filter(Boolean);
  return { ...resolved, comarcaIds, difficulty, tags };
}

function buildRuleFromLevel(level, comarcaById, normalizedToId) {
  if (!level?.rule_id) return null;
  const base = RULE_DEFS.find((def) => def.id === level.rule_id) || null;
  const avoidIds = Array.isArray(level.avoid_ids) ? level.avoid_ids : [];
  const mustPassIds = Array.isArray(level.must_pass_ids) ? level.must_pass_ids : [];
  const kind = base?.kind || (avoidIds.length ? "avoid" : "mustIncludeAny");
  let comarcaIds = kind === "avoid" ? avoidIds : mustPassIds;
  if (!comarcaIds.length && base?.comarques?.length && normalizedToId) {
    comarcaIds = base.comarques
      .map((name) => normalizedToId.get(normalizeName(name)))
      .filter(Boolean);
  }
  const comarques = comarcaIds
    .map((id) => comarcaById.get(id)?.properties.name)
    .filter(Boolean);
  let label = base?.label;
  if (!label) {
    if (kind === "avoid") {
      const name = comarques[0] || "aquesta comarca";
      label = `No pots passar per ${name}.`;
    } else {
      label = "Has de passar per algun lloc clau.";
    }
  }
  const difficulty = base ? getRuleDifficulty(base) : "medium";
  const tags = base ? getRuleTags(base) : ["geo"];
  const explanation = base?.explanation || "";
  return {
    id: level.rule_id,
    kind,
    label,
    comarques,
    comarcaIds,
    difficulty,
    tags,
    explanation
  };
}

function isRuleFeasible(rule, ctx) {
  if (!rule) return false;
  if (rule.kind === "avoid") {
    const blocked = rule.comarcaIds || [];
    if (!blocked.length) return false;
    const blockedSet = new Set(blocked);
    const allowed = new Set(ctx.allIds.filter((id) => !blockedSet.has(id)));
    return findShortestPathInSet(ctx.startId, ctx.targetId, ctx.adjacency, allowed).length > 0;
  }
  if (rule.kind === "mustIncludeAny") {
    const allowed = new Set(ctx.allIds);
    return rule.comarcaIds.some((id) =>
      hasPathViaNode(ctx.startId, ctx.targetId, id, ctx.adjacency, allowed)
    );
  }
  return true;
}

function pickRule(defs, ctx) {
  const attempts = Math.max(defs.length * 3, 60);
  for (let i = 0; i < attempts; i += 1) {
    const def = pickRandom(defs, ctx.rng);
    const rule = prepareRule(def, ctx);
    if (rule.kind !== "avoid" && !rule.comarcaIds.length) continue;
    if (isRuleFeasible(rule, ctx)) return rule;
  }
  return null;
}

function evaluateRule(rule, ctx) {
  if (!rule) return { satisfied: true, failed: false };
  if (rule.kind === "avoid") {
    const forbidden = rule.comarcaIds || [];
    if (!forbidden.length) return { satisfied: true, failed: false };
    const isForbidden = forbidden.some((id) => ctx.guessedSet.has(id));
    return { satisfied: !isForbidden, failed: isForbidden };
  }
  if (rule.kind === "mustIncludeAny") {
    const has = rule.comarcaIds.some(
      (id) => ctx.allowedSet.has(id) && hasPathViaNode(ctx.startId, ctx.targetId, id, ctx.adjacency, ctx.allowedSet)
    );
    return { satisfied: has, failed: false };
  }
  return { satisfied: true, failed: false };
}

function computeGaussianStats(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return null;
  const mean = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
  const variance =
    filtered.reduce((sum, value) => sum + (value - mean) ** 2, 0) / filtered.length;
  const std = Math.sqrt(variance) || 1;
  return {
    mean,
    std,
    min: Math.min(...filtered),
    max: Math.max(...filtered),
    count: filtered.length
  };
}

function buildGaussianViz(stats, value, width = 260, height = 80) {
  if (!stats || !Number.isFinite(stats.mean)) return null;
  const sigma = Math.max(stats.std, stats.mean * 0.08, 1);
  const rawMin = Math.min(
    stats.mean - 3 * sigma,
    stats.min ?? stats.mean - 3 * sigma
  );
  const rawMax = Math.max(
    stats.mean + 3 * sigma,
    stats.max ?? stats.mean + 3 * sigma
  );
  const min = Math.max(0, rawMin);
  const max = Math.max(min + 1, rawMax);
  const points = [];
  const steps = 60;
  for (let i = 0; i <= steps; i += 1) {
    const x = min + ((max - min) * i) / steps;
    const z = (x - stats.mean) / sigma;
    const y = Math.exp(-0.5 * z * z);
    points.push({ x, y });
  }
  const maxY = Math.max(...points.map((point) => point.y)) || 1;
  const path = points
    .map((point, index) => {
      const x = ((point.x - min) / (max - min)) * width;
      const y = height - (point.y / maxY) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const clamped = Math.min(Math.max(value, min), max);
  const markerX = ((clamped - min) / (max - min)) * width;
  return { path, markerX, min, max, width, height };
}

function trimResults(results, limit) {
  const entries = Object.entries(results || {});
  if (entries.length <= limit) return results;
  const sorted = entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(sorted.slice(-limit));
}

function trimLevelStats(stats, limit = LEVEL_STATS_MAX) {
  const entries = Object.entries(stats || {});
  if (entries.length <= limit) return stats;
  const sorted = entries.sort(([, a], [, b]) => {
    const timeA = a?.lastPlayed || 0;
    const timeB = b?.lastPlayed || 0;
    return timeA - timeB;
  });
  return Object.fromEntries(sorted.slice(-limit));
}

let confettiInstance = null;
async function fireConfetti(options) {
  if (!confettiInstance) {
    const module = await import("canvas-confetti");
    confettiInstance = module.default || module;
  }
  confettiInstance(options);
}

function getPlayerId() {
  if (typeof window === "undefined") return "anon";
  const stored = localStorage.getItem(PLAYER_KEY);
  if (stored) return stored;
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(PLAYER_KEY, id);
  return id;
}

function createEventId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const initialSettings = useMemo(() => loadSettings(), []);
  const [comarques, setComarques] = useState([]);
  const [adjacency, setAdjacency] = useState(new Map());
  const [shortestPathCache, setShortestPathCache] = useState(new Map());
  const [startId, setStartId] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [targetId, setTargetId] = useState(null);
  const [outline, setOutline] = useState(null);
  const [guessHistory, setGuessHistory] = useState([]);
  const [isComplete, setIsComplete] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [guessValue, setGuessValue] = useState("");
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [guessError, setGuessError] = useState(false);
  const [guessFeedback, setGuessFeedback] = useState(null);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [shortestPath, setShortestPath] = useState([]);
  const [activeRule, setActiveRule] = useState(null);
  const [resultData, setResultData] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const [gameMode, setGameMode] = useState(() => {
    if (typeof window === "undefined") return "normal";
    const storedMode = localStorage.getItem("rumb-mode") || "normal";
    return storedMode === "weekly" ? "normal" : storedMode;
  });
  const [difficulty, setDifficulty] = useState(() => {
    if (typeof window === "undefined") return "pixapi";
    const stored = localStorage.getItem("rumb-difficulty") || "";
    if (DIFFICULTIES.some((entry) => entry.id === stored)) return stored;
    return "pixapi";
  });
  const [unlockedDifficulties, setUnlockedDifficulties] = useState(() => {
    if (typeof window === "undefined") return new Set(["pixapi"]);
    const raw = localStorage.getItem(DIFFICULTY_UNLOCKS_KEY);
    if (!raw) return new Set(["pixapi"]);
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : ["pixapi"];
      return new Set(list.length ? list : ["pixapi"]);
    } catch {
      return new Set(["pixapi"]);
    }
  });
  const {
    play,
    enabled: sfxEnabled,
    setEnabled: setSfxEnabled,
    masterVolume,
    setMasterVolume,
    sfxVolume,
    setSfxVolume
  } = useSound();
  const [musicEnabled] = useState(initialSettings.musicEnabled);
  const [musicVolume, setMusicVolume] = useState(initialSettings.musicVolume);
  const [musicTrack, setMusicTrack] = useState(initialSettings.musicTrack);
  const [language, setLanguage] = useState(initialSettings.language);
  const [activeTheme, setActiveTheme] = useState(initialSettings.theme);
  const [configOpen, setConfigOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [audioManifest, setAudioManifest] = useState(null);
  const audioManagerRef = useRef(null);
  const [weatherState, setWeatherState] = useState("clear");
  const [weatherStatus, setWeatherStatus] = useState("idle");
  const [completionRecords, setCompletionRecords] = useState(() => loadCompletionRecords());
  const [countdownValue, setCountdownValue] = useState(null);
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const [history, setHistory] = useState(() => {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [dailyStreak, setDailyStreak] = useState(() => {
    if (typeof window === "undefined") return { count: 0, lastDate: null };
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return { count: 0, lastDate: null };
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? parsed
        : { count: 0, lastDate: null };
    } catch {
      return { count: 0, lastDate: null };
    }
  });
  const [dailyResults, setDailyResults] = useState(() => {
    if (typeof window === "undefined") return {};
    const raw = localStorage.getItem(DAILY_RESULTS_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [weeklyResults, setWeeklyResults] = useState(() => {
    if (typeof window === "undefined") return {};
    const raw = localStorage.getItem(WEEKLY_RESULTS_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [calendarMode, setCalendarMode] = useState("daily");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [calendarDaily, setCalendarDaily] = useState([]);
  const [calendarWeekly, setCalendarWeekly] = useState([]);
  const [calendarStatus, setCalendarStatus] = useState("idle");
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [calendarSelection, setCalendarSelection] = useState(null);
  const [levelStats, setLevelStats] = useState(() => {
    if (typeof window === "undefined") return {};
    const raw = localStorage.getItem(LEVEL_STATS_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? trimLevelStats(parsed) : {};
    } catch {
      return {};
    }
  });
  const [powerups, setPowerups] = useState({});
  const [tempRevealId, setTempRevealId] = useState(null);
  const [tempNeighborHint, setTempNeighborHint] = useState(false);
  const [tempInitialsHint, setTempInitialsHint] = useState(false);
  const [replayMode, setReplayMode] = useState(null);
  const [replayOrder, setReplayOrder] = useState([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [leaderboardEntries, setLeaderboardEntries] = useState([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState("idle");
  const [lastEntryId, setLastEntryId] = useState(null);
  const [copyStatus, setCopyStatus] = useState("idle");
  const [supabaseUserId, setSupabaseUserId] = useState(null);
  const [supabaseBlocked, setSupabaseBlocked] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [timeLimitMs, setTimeLimitMs] = useState(DEFAULT_TIME_LIMIT_MS);
  const [timePenaltyMs, setTimePenaltyMs] = useState(0);

  const svgRef = useRef(null);
  const gRef = useRef(null);
  const zoomRef = useRef(null);
  const copyTimerRef = useRef(null);
  const hintTimersRef = useRef({});
  const replayTimerRef = useRef(null);
  const musicTimerRef = useRef(null);
  const musicBlockedRef = useRef(false);
  const musicStartedRef = useRef(false);
  const guessErrorTimerRef = useRef(null);
  const guessFeedbackTimerRef = useRef(null);
  const guessInputRef = useRef(null);
  const lastGuessRef = useRef(null);
  const userZoomedRef = useRef(false);
  const weatherFetchRef = useRef(null);
  const playerIdRef = useRef(getPlayerId());
  const supabaseUserIdRef = useRef(null);
  const calendarApplyRef = useRef(null);
  const calendarAutoSetRef = useRef({ daily: false, weekly: false });
  const calendarLoadingRef = useRef(false);
  const calendarCountsRef = useRef({ daily: 0, weekly: 0 });
  const calendarMonthRef = useRef(calendarMonth);
  const telemetryFlushRef = useRef(false);
  const attemptsFlushRef = useRef(false);
  const completionMigrationRef = useRef(false);

  const leaderboardEndpoint = import.meta.env.VITE_LEADERBOARD_URL || "";
  const isSupabaseReady = useMemo(
    () => Boolean(supabaseEnabled && supabase && !supabaseBlocked),
    [supabaseBlocked]
  );
  const isExploreMode = gameMode === "explore";
  const isTimedMode = gameMode === "timed";
  const isWeeklyMode = gameMode === "weekly";
  const isDailyMode = gameMode === "daily";
  const isFixedMode = isDailyMode || isWeeklyMode;
  const shouldLoadCalendar = calendarOpen || isDailyMode || isWeeklyMode;
  const activeDifficulty = isFixedMode ? "cap-colla-rutes" : difficulty;
  const difficultyConfig = useMemo(() => {
    return DIFFICULTIES.find((entry) => entry.id === activeDifficulty) || DIFFICULTIES[0];
  }, [activeDifficulty]);
  const timeLeftMs = Math.max(timeLimitMs - elapsedMs - timePenaltyMs, 0);
  const weekKey = useMemo(() => getWeekKey(), []);
  const dayKey = useMemo(() => getDayKey(), []);
  const centroidMap = useMemo(() => buildCentroidMap(comarques), [comarques]);
  const isMapReady = comarques.length > 0;
  const triggerWeatherForComarca = useCallback(
    (id, force = false) => {
      if (!id) return;
      if (!force && activeTheme !== TOMAS_THEME_ID) return;
      const coords = centroidMap.get(id);
      if (!coords) return;
      const cache = readWeatherCache();
      const cached = cache[id];
      if (cached && Date.now() - cached.updatedAt < WEATHER_TTL_MS) {
        setWeatherState(cached.state || "clear");
        setWeatherStatus("cached");
        return;
      }
      if (weatherFetchRef.current === id) return;
      weatherFetchRef.current = id;
      setWeatherStatus("loading");
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=weather_code,wind_speed_10m`
      )
        .then((res) => res.json())
        .then((data) => {
          const code = data?.current?.weather_code;
          const wind = data?.current?.wind_speed_10m;
          const state = resolveWeatherState(code, wind);
          const nextCache = { ...cache, [id]: { state, updatedAt: Date.now() } };
          writeWeatherCache(nextCache);
          setWeatherState(state);
          setWeatherStatus("ready");
        })
        .catch(() => {
          setWeatherState("clear");
          setWeatherStatus("error");
        });
    },
    [activeTheme, centroidMap]
  );
  const calendarDailyMap = useMemo(() => {
    return new Map(calendarDaily.map((entry) => [entry.date, entry]));
  }, [calendarDaily]);
  const calendarWeeklyMap = useMemo(() => {
    return new Map(calendarWeekly.map((entry) => [entry.weekKey, entry]));
  }, [calendarWeekly]);
  const activeDayKey =
    gameMode === "daily" && calendarSelection?.mode === "daily"
      ? calendarSelection.key
      : dayKey;
  const activeWeekKey =
    gameMode === "weekly" && calendarSelection?.mode === "weekly"
      ? calendarSelection.key
      : weekKey;
  const activeCalendarEntry = useMemo(() => {
    if (!calendarSelection) return null;
    if (calendarSelection.mode === "daily") {
      return calendarDailyMap.get(calendarSelection.key) || null;
    }
    if (calendarSelection.mode === "weekly") {
      return calendarWeeklyMap.get(calendarSelection.key) || null;
    }
    return null;
  }, [calendarSelection, calendarDailyMap, calendarWeeklyMap]);
  const isCalendarModeActive = Boolean(
    calendarSelection &&
      calendarSelection.mode === gameMode &&
      activeCalendarEntry?.level
  );
  const displayStreak = useMemo(() => {
    if (!dailyStreak.lastDate) return 0;
    const today = getLocalDayKey(new Date());
    const yesterday = getLocalDayKeyOffset(-1);
    if (dailyStreak.lastDate === today || dailyStreak.lastDate === yesterday) {
      return dailyStreak.count || 0;
    }
    return 0;
  }, [dailyStreak]);
  const streakTitle = getStreakTitle(displayStreak);
  const t = useMemo(() => {
    const table = STRINGS[language] || STRINGS.ca;
    return (key, vars = {}) => {
      let text = table[key] || STRINGS.ca[key] || key;
      Object.entries(vars).forEach(([token, value]) => {
        text = text.replace(new RegExp(`\\{${token}\\}`, "g"), String(value));
      });
      return text;
    };
  }, [language]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("rumb-mode", gameMode);
    localStorage.setItem("rumb-difficulty", difficulty);
    localStorage.setItem(ACTIVE_THEME_KEY, activeTheme);
    localStorage.setItem(LANGUAGE_KEY, language);
  }, [gameMode, difficulty, activeTheme, language]);

  useEffect(() => {
    supabaseUserIdRef.current = supabaseUserId;
  }, [supabaseUserId]);

  useEffect(() => {
    saveSettings({
      theme: activeTheme,
      language,
      musicEnabled,
      musicVolume,
      musicTrack,
      sfxEnabled,
      sfxVolume
    });
  }, [activeTheme, language, musicEnabled, musicVolume, musicTrack, sfxEnabled, sfxVolume]);

  useEffect(() => {
    let active = true;
    loadAudioManifest()
      .then((manifest) => {
        if (!active) return;
        setAudioManifest(manifest);
        audioManagerRef.current = createAudioManager(manifest);
        audioManagerRef.current.preload(activeTheme, AUDIO_PRELOAD_SFX);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!audioManifest?.music) return;
    const ids = Object.keys(audioManifest.music);
    if (!ids.length) return;
    if (!ids.includes(musicTrack)) {
      setMusicTrack(ids[0]);
    }
  }, [audioManifest, musicTrack]);

  useEffect(() => {
    if (!audioManifest || !audioManagerRef.current) return;
    audioManagerRef.current.preload(activeTheme, AUDIO_PRELOAD_SFX);
  }, [audioManifest, activeTheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDailyStreak((prev) => {
      const today = getLocalDayKey(new Date());
      const yesterday = getLocalDayKeyOffset(-1);
      if (!prev?.lastDate) {
        const next = { count: 1, lastDate: today };
        localStorage.setItem(STREAK_KEY, JSON.stringify(next));
        return next;
      }
      if (prev.lastDate === today) return prev;
      if (prev.lastDate === yesterday) {
        const next = { count: (prev.count || 0) + 1, lastDate: today };
        localStorage.setItem(STREAK_KEY, JSON.stringify(next));
        return next;
      }
      const next = { count: 1, lastDate: today };
      localStorage.setItem(STREAK_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      DIFFICULTY_UNLOCKS_KEY,
      JSON.stringify([...unlockedDifficulties])
    );
  }, [unlockedDifficulties]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      MUSIC_SETTINGS_KEY,
      JSON.stringify({ enabled: musicEnabled, volume: musicVolume, track: musicTrack })
    );
  }, [musicEnabled, musicVolume, musicTrack]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      SFX_SETTINGS_KEY,
      JSON.stringify({ enabled: sfxEnabled, volume: sfxVolume })
    );
  }, [sfxEnabled, sfxVolume]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (Object.keys(dailyResults).length > 60) {
      setDailyResults((prev) => trimResults(prev, 60));
      return;
    }
    localStorage.setItem(DAILY_RESULTS_KEY, JSON.stringify(dailyResults));
  }, [dailyResults]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (Object.keys(weeklyResults).length > 30) {
      setWeeklyResults((prev) => trimResults(prev, 30));
      return;
    }
    localStorage.setItem(WEEKLY_RESULTS_KEY, JSON.stringify(weeklyResults));
  }, [weeklyResults]);

  useEffect(() => {
    if (completionMigrationRef.current) return;
    const hasRecords = completionRecords && Object.keys(completionRecords).length > 0;
    const hasLegacy =
      Object.keys(dailyResults).length > 0 || Object.keys(weeklyResults).length > 0;
    if (hasRecords || !hasLegacy) {
      completionMigrationRef.current = true;
      return;
    }
    let next = { ...completionRecords };
    Object.entries(dailyResults).forEach(([key, result]) => {
      next = upsertCompletionRecord(next, `daily:${key}`, {
        mode: "daily",
        dayKey: key,
        shortestPath: result.shortestPath || [],
        shortestCount: result.shortestCount || 0,
        attempt: result
      });
    });
    Object.entries(weeklyResults).forEach(([key, result]) => {
      next = upsertCompletionRecord(next, `weekly:${key}`, {
        mode: "weekly",
        weekKey: key,
        shortestPath: result.shortestPath || [],
        shortestCount: result.shortestCount || 0,
        attempt: result
      });
    });
    completionMigrationRef.current = true;
    setCompletionRecords(next);
  }, [completionRecords, dailyResults, weeklyResults]);

  useEffect(() => {
    saveCompletionRecords(completionRecords);
  }, [completionRecords]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(LEVEL_STATS_KEY, JSON.stringify(levelStats));
  }, [levelStats]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-20)));
  }, [history]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let timer;

    const checkConnectivity = async () => {
      try {
        await fetch(PING_URL, { mode: "no-cors", cache: "no-store" });
        if (!cancelled) setIsOnline(true);
      } catch {
        if (!cancelled) setIsOnline(false);
      }
    };

    const schedule = () => {
      checkConnectivity();
      timer = setInterval(checkConnectivity, 20000);
    };

    const handleOnline = () => {
      checkConnectivity();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);
    schedule();

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOnline);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !import.meta.env.DEV) return;
    let frame = 0;
    let last = performance.now();
    let rafId;
    const tick = (now) => {
      frame += 1;
      if (now - last >= 1000) {
        window.__rumbFps = Math.round((frame * 1000) / (now - last));
        frame = 0;
        last = now;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (!isSupabaseReady || !supabaseUserId || !isOnline) return;
    flushTelemetryQueue();
    flushAttemptsQueue();
  }, [isSupabaseReady, supabaseUserId, isOnline]);

  useEffect(() => {
    if (!isSupabaseReady || !supabaseUserId || !isOnline) return;
    const interval = setInterval(() => {
      flushTelemetryQueue();
      flushAttemptsQueue();
    }, 15000);
    return () => clearInterval(interval);
  }, [isSupabaseReady, supabaseUserId, isOnline]);

  useEffect(() => {
    if (!isSupabaseReady) return;
    const userId = supabaseUserIdRef.current;
    if (!userId) return;
    supabase
      .from("players")
      .update({
        unlocked_difficulties: [...unlockedDifficulties],
        language,
        music_track: musicTrack,
        music_enabled: musicEnabled,
        music_volume: musicVolume,
        sfx_enabled: sfxEnabled,
        sfx_volume: sfxVolume,
        last_seen: new Date().toISOString()
      })
      .eq("id", userId)
      .then(() => {})
      .catch(() => {});
  }, [
    isSupabaseReady,
    unlockedDifficulties,
    language,
    musicTrack,
    musicEnabled,
    musicVolume,
    sfxEnabled,
    sfxVolume
  ]);

  useEffect(() => {
    if (activeTheme !== TOMAS_THEME_ID) {
      setWeatherStatus("idle");
      return;
    }
    const lastGuessId = lastGuessRef.current;
    if (!lastGuessId) return;
    triggerWeatherForComarca(lastGuessId, true);
  }, [activeTheme, triggerWeatherForComarca]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      const cached = readMapCache();
      if (cached && !cancelled) {
        setComarques(cached.features || []);
        setAdjacency(deserializeAdjacency(cached.adjacency));
        setOutline(cached.outline || null);
      }

      try {
        const response = await fetchWithRetry(
          MAP_TOPO_URL,
          { cache: "no-store" },
          { retries: 2, backoffMs: 500 }
        );
        const topology = await response.json();
        const objectKey = Object.keys(topology.objects)[0];
        const object = topology.objects[objectKey];
        const collection = feature(topology, object);
        const outlineMesh = mesh(topology, object, (a, b) => a === b);
        const ids = collection.features.map((featureItem) => featureItem.properties.id);
        const neighborIndex = topoNeighbors(object.geometries || []);
        const adjacencyMap = new Map();
        neighborIndex.forEach((neighbors, index) => {
          adjacencyMap.set(
            ids[index],
            new Set(neighbors.map((neighborIndexItem) => ids[neighborIndexItem]))
          );
        });

        writeMapCache({
          features: collection.features || [],
          adjacency: serializeAdjacency(adjacencyMap),
          outline: outlineMesh
        });

        if (!cancelled) {
          setComarques(collection.features || []);
          setAdjacency(adjacencyMap);
          setOutline(outlineMesh);
        }
      } catch {
        if (!cached && !cancelled) {
          setComarques([]);
        }
      }
    }

    loadData().catch(() => {
      if (!cancelled) {
        setComarques([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!adjacency.size) {
      setShortestPathCache(new Map());
      return;
    }
    let cancelled = false;
    if (typeof Worker === "undefined") {
      setShortestPathCache(buildShortestPathCache(adjacency));
      return;
    }
    const worker = new Worker(new URL("./workers/path-cache.worker.js", import.meta.url), {
      type: "module"
    });
    worker.postMessage({ adjacency: serializeAdjacency(adjacency) });
    worker.onmessage = (event) => {
      if (cancelled) return;
      setShortestPathCache(deserializeShortestPathCache(event.data.cache));
    };
    worker.onerror = () => {
      if (cancelled) return;
      setShortestPathCache(buildShortestPathCache(adjacency));
    };
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [adjacency]);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    const svg = select(svgRef.current);
    const zoomBehavior = zoom()
      .scaleExtent([0.8, 6])
      .on("zoom", (event) => {
        select(gRef.current).attr("transform", event.transform);
        if (event.sourceEvent) {
          userZoomedRef.current = true;
        }
      });

    zoomRef.current = zoomBehavior;
    svg.call(zoomBehavior);
    svg.call(zoomBehavior.transform, zoomIdentity);

    return () => {
      svg.on(".zoom", null);
    };
  }, [comarques.length]);

  useEffect(() => {
    if (!startedAt || isComplete || isFailed || isExploreMode) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 500);
    return () => clearInterval(interval);
  }, [startedAt, isComplete, isFailed, isExploreMode]);

  useEffect(() => {
    if (!isMapReady || isComplete || isFailed || isCountdownActive) return;
    focusGuessInput();
  }, [isMapReady, isComplete, isFailed, isCountdownActive, startId, targetId]);

  useEffect(() => {
    if (!isTimedMode || !isCountdownActive) return;
    if (countdownValue === null) return;
    if (countdownValue <= 0) {
      setIsCountdownActive(false);
      setCountdownValue(null);
      setStartedAt(Date.now());
      return;
    }
    const timer = setTimeout(() => {
      setCountdownValue((prev) => (prev !== null ? prev - 1 : prev));
    }, 1000);
    return () => clearTimeout(timer);
  }, [isTimedMode, isCountdownActive, countdownValue]);

  useEffect(() => {
    if (!isTimedMode || !startedAt || isComplete || isFailed) return;
    if (timeLeftMs <= 0) {
      play("level_lose", { bypassCooldown: true });
      setIsFailed(true);
      setShowModal(true);
      setResultData((prev) =>
        prev || {
          failed: true,
          attempts,
          timeMs: elapsedMs,
          playerPath: guessHistory,
          ruleLabel: activeRule?.label || "Sense norma",
          ruleDifficulty: activeRule?.difficulty || null,
          ruleExplanation: activeRule?.explanation || "",
          ruleComarques: activeRule?.comarques || [],
          shortestPath: [],
          shortestCount: 0,
          distance: 0,
          mode: gameMode,
          difficulty: activeDifficulty,
          streak: displayStreak
        }
      );
      enqueueTelemetry("level_fail", {
        reason: "timeout",
        attempts,
        timeMs: elapsedMs
      });
    }
  }, [
    gameMode,
    startedAt,
    timeLeftMs,
    isComplete,
    isFailed,
    attempts,
    elapsedMs,
    guessHistory,
    activeRule,
    activeDifficulty,
    dailyStreak,
    play
  ]);

  useEffect(() => {
    if (!comarques.length || !adjacency.size) return;
    if (isCalendarModeActive) return;
    resetGame();
  }, [comarques, adjacency, gameMode, activeDifficulty, isCalendarModeActive]);

  useEffect(() => {
    if (!calendarSelection || !activeCalendarEntry?.level) return;
    if (calendarSelection.mode !== gameMode) return;
    const key = `${calendarSelection.mode}:${calendarSelection.key}`;
    if (calendarApplyRef.current === key) return;
    const record = getCompletionRecord(calendarSelection.mode, calendarSelection.key);
    const result = record?.winningAttempt || null;
    applyCalendarLevel(activeCalendarEntry.level, {
      result,
      showResult: Boolean(result)
    });
    calendarApplyRef.current = key;
  }, [
    calendarSelection,
    activeCalendarEntry,
    gameMode,
    completionRecords
  ]);

  useEffect(() => {
    if (!leaderboardEndpoint && typeof window === "undefined") return;
    let idleId;
    const schedule = () => loadLeaderboard();
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(schedule, { timeout: 2000 });
    } else {
      idleId = setTimeout(schedule, 1200);
    }
    return () => {
      if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId);
      }
    };
  }, [leaderboardEndpoint]);

  useEffect(() => {
    if (!shouldLoadCalendar || calendarLoaded || calendarLoadingRef.current) return;
    let isMounted = true;
    async function loadCalendar() {
      const canReadCalendar = Boolean(supabaseEnabled && supabase);
      if (!canReadCalendar) {
        if (isMounted) setCalendarStatus("error");
        return;
      }
      calendarLoadingRef.current = true;
      const cached = readCalendarCache();
      const hasCache = Boolean(cached?.daily?.length || cached?.weekly?.length);
      if (hasCache && isMounted) {
        setCalendarDaily(cached.daily || []);
        setCalendarWeekly(cached.weekly || []);
      }
      setCalendarStatus(hasCache ? "refreshing" : "loading");
      try {
        const now = new Date();
        const start = new Date(now);
        start.setFullYear(now.getFullYear() - 2);
        const end = new Date(now);
        end.setFullYear(now.getFullYear() + 2);
        const startKey = getLocalDayKey(start);
        const endKey = getLocalDayKey(end);
        const startWeekKey = getWeekKey(start);
        const endWeekKey = getWeekKey(end);

        const dailyRes = await withRetry(
          () =>
            supabase
              .from("calendar_daily")
              .select("date, level_id")
              .gte("date", startKey)
              .lte("date", endKey)
              .order("date", { ascending: false }),
          { retries: 2, backoffMs: 500 }
        );
        if (dailyRes.error) throw dailyRes.error;
        const weeklyRes = await withRetry(
          () =>
            supabase
              .from("calendar_weekly")
              .select("week_key, level_id")
              .gte("week_key", startWeekKey)
              .lte("week_key", endWeekKey)
              .order("week_key", { ascending: false }),
          { retries: 2, backoffMs: 500 }
        );
        if (weeklyRes.error) throw weeklyRes.error;

        const dailyRows = Array.isArray(dailyRes.data) ? dailyRes.data : [];
        const weeklyRows = Array.isArray(weeklyRes.data) ? weeklyRes.data : [];
        const levelIds = [
          ...new Set(
            [...dailyRows, ...weeklyRows]
              .map((row) => row.level_id)
              .filter(Boolean)
          )
        ];

        const levelsById = new Map();
        if (levelIds.length) {
          const levelsRes = await withRetry(
            () =>
              supabase
                .from("levels")
                .select(
                  "id, start_id, target_id, shortest_path, rule_id, avoid_ids, must_pass_ids, difficulty_id"
                )
                .in("id", levelIds),
            { retries: 2, backoffMs: 500 }
          );
          if (!levelsRes.error) {
            (levelsRes.data || []).forEach((level) => {
              levelsById.set(level.id, level);
            });
          }
        }

        const dailyEntries = dailyRows
          .map((row) => {
            const dateKey = normalizeDayKey(row.date);
            if (!dateKey) return null;
            return {
              date: dateKey,
              levelId: row.level_id,
              level: levelsById.get(row.level_id) || null
            };
          })
          .filter(Boolean);
        const weeklyEntries = weeklyRows
          .map((row) => {
            const weekKeyValue = normalizeWeekKey(row.week_key);
            if (!weekKeyValue) return null;
            return {
              weekKey: weekKeyValue,
              levelId: row.level_id,
              level: levelsById.get(row.level_id) || null
            };
          })
          .filter(Boolean);
        if (isMounted) {
          setCalendarDaily(dailyEntries);
          setCalendarWeekly(weeklyEntries);
          setCalendarStatus("ready");
          setCalendarLoaded(true);
          writeCalendarCache({ daily: dailyEntries, weekly: weeklyEntries });
        }
      } catch {
        if (isMounted) {
          setCalendarStatus(hasCache ? "ready" : "error");
          if (hasCache) setCalendarLoaded(true);
        }
      } finally {
        calendarLoadingRef.current = false;
      }
    }

    loadCalendar();

    return () => {
      isMounted = false;
    };
  }, [isSupabaseReady, shouldLoadCalendar, calendarLoaded]);

  useEffect(() => {
    if (gameMode === "daily" || gameMode === "weekly") return;
    if (calendarSelection) {
      setCalendarSelection(null);
      calendarApplyRef.current = null;
    }
  }, [gameMode, calendarSelection]);

  useEffect(() => {
    calendarMonthRef.current = calendarMonth;
  }, [calendarMonth]);

  useEffect(() => {
    if (!calendarLoaded) return;
    const prevDailyCount = calendarCountsRef.current.daily;
    const prevWeeklyCount = calendarCountsRef.current.weekly;
    calendarCountsRef.current = {
      daily: calendarDaily.length,
      weekly: calendarWeekly.length
    };
    const monthRef = calendarMonthRef.current;
    if (calendarMode === "daily" && !calendarAutoSetRef.current.daily) {
      const latestDay = calendarDaily[0]?.date;
      if (latestDay) {
        const parsed = new Date(`${latestDay}T00:00:00`);
        if (!Number.isNaN(parsed.valueOf())) {
          setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
        }
      }
      calendarAutoSetRef.current.daily = true;
    }
    if (
      calendarMode === "daily" &&
      prevDailyCount === 0 &&
      calendarDaily.length > 0 &&
      monthRef
    ) {
      const latestDay = calendarDaily[0]?.date;
      if (latestDay) {
        const parsed = new Date(`${latestDay}T00:00:00`);
        if (!Number.isNaN(parsed.valueOf())) {
          setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
        }
      }
    }
    if (calendarMode === "weekly" && !calendarAutoSetRef.current.weekly) {
      const latestWeek = calendarWeekly[0]?.weekKey;
      if (latestWeek) {
        const year = Number(latestWeek.slice(0, 4));
        if (!Number.isNaN(year)) {
          setCalendarMonth(new Date(year, 0, 1));
        }
      }
      calendarAutoSetRef.current.weekly = true;
    }
    if (
      calendarMode === "weekly" &&
      prevWeeklyCount === 0 &&
      calendarWeekly.length > 0 &&
      monthRef
    ) {
      const latestWeek = calendarWeekly[0]?.weekKey;
      if (latestWeek) {
        const year = Number(latestWeek.slice(0, 4));
        if (!Number.isNaN(year)) {
          setCalendarMonth(new Date(year, 0, 1));
        }
      }
    }
  }, [calendarLoaded, calendarMode, calendarDaily, calendarWeekly]);

  useEffect(() => {
    if (unlockedDifficulties.has(difficulty)) return;
    const fallback =
      DIFFICULTIES.find((entry) => unlockedDifficulties.has(entry.id)) ||
      DIFFICULTIES[0];
    if (fallback && fallback.id !== difficulty) {
      setDifficulty(fallback.id);
    }
  }, [unlockedDifficulties, difficulty]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!audioManifest) return;
    if (!musicEnabled) {
      stopMusic();
      return;
    }
    startMusic();
  }, [musicEnabled, musicTrack, audioManifest, activeTheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!audioManagerRef.current) return;
    audioManagerRef.current.setMusicVolume?.(musicVolume);
    if (!musicEnabled || !audioManifest?.music) return;
    if (musicVolume <= 0) return;
    if (musicBlockedRef.current || !musicStartedRef.current) {
      startMusic();
    }
  }, [musicVolume, musicEnabled, audioManifest, activeTheme, musicTrack]);

  useEffect(() => {
    musicStartedRef.current = false;
  }, [musicTrack]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      if (!musicEnabled) return;
      if (!audioManifest?.music) return;
      if (!audioManagerRef.current) return;
      if (musicVolume <= 0) return;
      if (musicBlockedRef.current || !musicStartedRef.current) {
        startMusic();
      }
    };
    window.addEventListener("pointerdown", handler, { passive: true });
    window.addEventListener("keydown", handler);
    window.addEventListener("touchstart", handler, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
      window.removeEventListener("touchstart", handler);
    };
  }, [musicEnabled, audioManifest, musicTrack, musicVolume, activeTheme]);

  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      if (!isSupabaseReady) return;
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        if (isMounted) setSupabaseBlocked(true);
        return;
      }
      if (!userData?.user) {
        const { error: signError } = await supabase.auth.signInAnonymously();
        if (signError) {
          if (isMounted) setSupabaseBlocked(true);
          return;
        }
      }
      const { data: fresh, error: freshError } = await supabase.auth.getUser();
      if (freshError || !fresh?.user) {
        if (isMounted) setSupabaseBlocked(true);
        return;
      }
      const user = fresh?.user;
      if (user && isMounted) {
        setSupabaseUserId(user.id);
        await supabase
          .from("players")
          .upsert(
            {
              id: user.id,
              name: user.user_metadata?.name || user.id,
              last_seen: new Date().toISOString()
            },
            { onConflict: "id" }
          );
        const { data: playerData } = await supabase
          .from("players")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        if (playerData && isMounted) {
          if (Array.isArray(playerData.unlocked_difficulties)) {
            setUnlockedDifficulties(new Set(playerData.unlocked_difficulties));
          }
          if (typeof playerData.language === "string") {
            setLanguage(playerData.language);
          }
          if (typeof playerData.music_volume === "number") {
            setMusicVolume(playerData.music_volume);
          }
          if (typeof playerData.music_track === "string") {
            setMusicTrack(playerData.music_track);
          }
          if (typeof playerData.sfx_enabled === "boolean") {
            setSfxEnabled(playerData.sfx_enabled);
          }
          if (typeof playerData.sfx_volume === "number") {
            setSfxVolume(playerData.sfx_volume);
          }
        }
      }
    }

    initAuth().catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [isSupabaseReady]);

  const comarcaById = useMemo(() => {
    return new Map(comarques.map((featureItem) => [featureItem.properties.id, featureItem]));
  }, [comarques]);

  const regionByName = useMemo(() => {
    const map = new Map();
    REGIONS.forEach((region) => {
      region.comarques.forEach((name) => {
        map.set(name, region);
      });
    });
    return map;
  }, []);

  const sortedNames = useMemo(() => {
    return comarques
      .map((featureItem) => featureItem.properties.name)
      .sort((a, b) => a.localeCompare(b, "ca"));
  }, [comarques]);

  const normalizedToId = useMemo(() => {
    const map = new Map();
    comarques.forEach((featureItem) => {
      const name = featureItem.properties.name;
      map.set(normalizeName(name), featureItem.properties.id);
    });
    return map;
  }, [comarques]);

  const initialsById = useMemo(() => {
    const map = new Map();
    comarques.forEach((featureItem) => {
      map.set(featureItem.properties.id, getInitials(featureItem.properties.name));
    });
    return map;
  }, [comarques]);

  const suggestions = useMemo(() => {
    const query = normalizeName(guessValue);
    if (!query) return [];
    return sortedNames
      .filter((name) => normalizeName(name).includes(query))
      .slice(0, 8);
  }, [guessValue, sortedNames]);

  const guessedIds = useMemo(() => {
    return [...new Set(guessHistory.map((entry) => entry.id))];
  }, [guessHistory]);

  const guessedSet = useMemo(() => new Set(guessedIds), [guessedIds]);

  const allowedSet = useMemo(() => {
    const ids = [...guessedIds];
    if (startId) ids.push(startId);
    if (targetId) ids.push(targetId);
    return new Set(ids);
  }, [guessedIds, startId, targetId]);

  const pathInGuesses = useMemo(() => {
    if (!startId || !targetId || !adjacency.size) return [];
    return findShortestPathInSet(startId, targetId, adjacency, allowedSet);
  }, [startId, targetId, adjacency, allowedSet]);

  const ruleStatus = useMemo(() => {
    return evaluateRule(activeRule, {
      startId,
      targetId,
      adjacency,
      allowedSet,
      guessedSet
    });
  }, [activeRule, startId, targetId, adjacency, allowedSet, guessedSet]);

  const showNeighborHintActive = tempNeighborHint;
  const showInitialsActive = tempInitialsHint;

  const replaySet = useMemo(() => {
    if (!replayOrder.length || replayIndex <= 0) return new Set();
    return new Set(replayOrder.slice(0, replayIndex));
  }, [replayOrder, replayIndex]);

  const neighborSet = useMemo(() => {
    if (!showNeighborHintActive || !currentId) return new Set();
    return adjacency.get(currentId) || new Set();
  }, [showNeighborHintActive, currentId, adjacency]);

  const { paths, viewBox, outlinePath } = useMemo(() => {
    if (!comarques.length) {
      return {
        paths: [],
        viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
        outlinePath: null
      };
    }

    const collection = {
      type: "FeatureCollection",
      features: comarques
    };

    const projection = geoMercator().fitSize([VIEW_WIDTH, VIEW_HEIGHT], collection);
    const generator = geoPath(projection);

    const mapped = comarques.map((featureItem) => ({
      id: featureItem.properties.id,
      name: featureItem.properties.name,
      path: generator(featureItem),
      centroid: generator.centroid(featureItem)
    }));

    return {
      paths: mapped,
      viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
      outlinePath: outline ? generator(outline) : null
    };
  }, [comarques, outline]);

  const centroidById = useMemo(() => {
    const map = new Map();
    paths.forEach((featureItem) => {
      if (featureItem.centroid) {
        map.set(featureItem.id, featureItem.centroid);
      }
    });
    return map;
  }, [paths]);

  const renderPaths = useMemo(() => {
    return paths.map((featureItem) => {
      const isStart = featureItem.id === startId;
      const isTarget = featureItem.id === targetId;
      const isCurrent = featureItem.id === currentId && !isExploreMode;
      const isGuessed = guessedSet.has(featureItem.id);
      const isReplay = replaySet.has(featureItem.id);
      const isPowerReveal = tempRevealId === featureItem.id;
      const isRevealed = isStart || isTarget || isGuessed || isReplay || isPowerReveal;
      const isNeighbor =
        showNeighborHintActive &&
        !isRevealed &&
        neighborSet.has(featureItem.id) &&
        !isStart &&
        !isTarget;
      const isHidden = !isRevealed && !isNeighbor;
      const isOutline = showInitialsActive && isHidden;

      const classes = [
        "comarca",
        isHidden && "is-hidden",
        isOutline && "is-outline",
        isGuessed && "is-guessed",
        isStart && "is-start",
        isTarget && "is-target",
        isCurrent && "is-current",
        isNeighbor && "is-neighbor",
        isReplay && "is-replay",
        isPowerReveal && "is-reveal"
      ]
        .filter(Boolean)
        .join(" ");

      return {
        ...featureItem,
        classes
      };
    });
  }, [
    paths,
    startId,
    targetId,
    currentId,
    guessedSet,
    replaySet,
    tempRevealId,
    showNeighborHintActive,
    neighborSet,
    isExploreMode,
    showInitialsActive
  ]);

  useEffect(() => {
    if (isComplete || isFailed) return;
    if (!pathInGuesses.length || !ruleStatus.satisfied) return;
    finishGame(pathInGuesses);
  }, [isComplete, isFailed, pathInGuesses, ruleStatus]);

  useEffect(() => {
    if (!replayMode || !replayOrder.length) return;
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    replayTimerRef.current = setInterval(() => {
      setReplayIndex((prev) => {
        if (prev >= replayOrder.length) {
          if (replayTimerRef.current) clearInterval(replayTimerRef.current);
          return prev;
        }
        return prev + 1;
      });
    }, 450);
    return () => {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    };
  }, [replayMode, replayOrder]);

  useEffect(() => {
    if (!replayMode || !replayOrder.length) return;
    if (replayIndex >= replayOrder.length) {
      const timeout = setTimeout(() => {
        setReplayMode(null);
        setReplayOrder([]);
        setReplayIndex(0);
      }, 600);
      return () => clearTimeout(timeout);
    }
  }, [replayIndex, replayMode, replayOrder.length]);

  async function persistLevel(payload) {
    if (!payload) return;
    if (!isSupabaseReady) return;
    if (!supabaseUserId) return;
    try {
      await supabase.from("levels").insert(payload);
    } catch {
      // Silencia errors de connexió o permisos.
    }
  }

  async function flushTelemetryQueue() {
    if (!isSupabaseReady || !supabaseUserId || !isOnline) return;
    if (telemetryFlushRef.current) return;
    const queued = readQueue(TELEMETRY_QUEUE_KEY);
    if (!queued.length) return;
    telemetryFlushRef.current = true;
    try {
      const batch = queued.slice(0, 50).map((entry) => ({
        ...entry,
        player_id: entry.player_id || supabaseUserId
      }));
      const { error } = await supabase
        .from("telemetry_events")
        .upsert(batch, { onConflict: "id" });
      if (!error) {
        writeQueue(TELEMETRY_QUEUE_KEY, queued.slice(batch.length), MAX_TELEMETRY_QUEUE);
      }
    } catch {
      // Manté la cua per a la següent connexió.
    } finally {
      telemetryFlushRef.current = false;
    }
  }

  function enqueueTelemetry(eventType, payload = {}, meta = {}) {
    const entry = {
      id: createEventId(),
      player_id: supabaseUserId || null,
      event_type: eventType,
      mode: gameMode,
      difficulty_id: activeDifficulty,
      map_id: MAP_ID,
      start_id: startId,
      target_id: targetId,
      rule_id: activeRule?.id || null,
      day_key: isDailyMode ? activeDayKey : null,
      week_key: isWeeklyMode ? activeWeekKey : null,
      created_at: new Date().toISOString(),
      payload,
      ...meta
    };
    enqueueQueue(TELEMETRY_QUEUE_KEY, entry, MAX_TELEMETRY_QUEUE);
    flushTelemetryQueue();
  }

  async function flushAttemptsQueue() {
    if (!isSupabaseReady || !supabaseUserId || !isOnline) return;
    if (attemptsFlushRef.current) return;
    const queued = readQueue(ATTEMPTS_QUEUE_KEY);
    if (!queued.length) return;
    attemptsFlushRef.current = true;
    try {
      const batch = queued.slice(0, 25).map((entry) => ({
        ...entry,
        player_id: entry.player_id || supabaseUserId
      }));
      const { error } = await supabase
        .from("attempts")
        .upsert(batch, { onConflict: "id" });
      if (!error) {
        writeQueue(ATTEMPTS_QUEUE_KEY, queued.slice(batch.length), MAX_ATTEMPTS_QUEUE);
      }
    } catch {
      // Manté la cua per a la següent connexió.
    } finally {
      attemptsFlushRef.current = false;
    }
  }

  function enqueueAttempt(payload) {
    if (!payload || !supabaseUserId) return;
    const entry = {
      ...payload,
      player_id: supabaseUserId,
      created_at: payload.created_at || new Date().toISOString()
    };
    enqueueQueue(ATTEMPTS_QUEUE_KEY, entry, MAX_ATTEMPTS_QUEUE);
    flushAttemptsQueue();
  }

  function stopMusic() {
    if (audioManagerRef.current) {
      audioManagerRef.current.stopMusic();
    }
    if (musicTimerRef.current) {
      clearInterval(musicTimerRef.current);
      musicTimerRef.current = null;
    }
    musicStartedRef.current = false;
  }

  function startMusic(trackId = musicTrack, volumeOverride) {
    if (!musicEnabled) return;
    if (audioManagerRef.current) {
      const nextVolume =
        typeof volumeOverride === "number" && Number.isFinite(volumeOverride)
          ? volumeOverride
          : musicVolume;
      const playPromise = audioManagerRef.current.playMusic(
        trackId,
        nextVolume,
        activeTheme
      );
      if (playPromise && typeof playPromise.then === "function") {
        playPromise
          .then(() => {
            musicBlockedRef.current = false;
            musicStartedRef.current = true;
          })
          .catch(() => {
            musicBlockedRef.current = true;
            musicStartedRef.current = false;
          });
      } else {
        musicBlockedRef.current = false;
        musicStartedRef.current = true;
      }
    }
  }

  function applyCalendarLevel(level, options = {}) {
    if (!level) return;
    const { result, showResult } = options;
    const start = level.start_id;
    const target = level.target_id;
    const nextShortest = Array.isArray(level.shortest_path) ? level.shortest_path : [];
    const rule = buildRuleFromLevel(level, comarcaById, normalizedToId);
    const playerPath = Array.isArray(result?.playerPath) ? result.playerPath : [];
    const basePowerups = getPowerupUses(activeDifficulty);

    setStartId(start);
    setTargetId(target);
    setCurrentId(start);
    setGuessHistory(playerPath);
    setAttempts(result?.attempts || 0);
    setHintsUsed(result?.hintsUsed || 0);
    setGuessError(false);
    setTempRevealId(null);
    setTempNeighborHint(false);
    setTempInitialsHint(false);
    setPowerups(basePowerups);
    setReplayMode(null);
    setReplayOrder([]);
    setReplayIndex(0);
    setGuessValue("");
    setIsSuggestionsOpen(false);
    setIsComplete(Boolean(result));
    setIsFailed(Boolean(result?.failed));
    setShowModal(Boolean(result && showResult));
    setResultData(result || null);
    setShortestPath(nextShortest);
    setActiveRule(rule);
    setElapsedMs(result?.timeMs || 0);
    setStartedAt(null);
    setTimePenaltyMs(0);
    if (isTimedMode) {
      const internalCount = Math.max(nextShortest.length - 2, 0);
      setTimeLimitMs(Math.max(15000, internalCount * 5000));
      if (!result) {
        beginTimedCountdown();
      } else {
        setIsCountdownActive(false);
        setCountdownValue(null);
      }
    } else {
      setTimeLimitMs(DEFAULT_TIME_LIMIT_MS);
      setIsCountdownActive(false);
      setCountdownValue(null);
    }
    setLastEntryId(null);
    setCopyStatus("idle");

    if (!result) {
      enqueueTelemetry(
        "calendar_start",
        {
          shortestCount: Math.max(nextShortest.length - 2, 0),
          ruleDifficulty: rule?.difficulty || null
        },
        {
          start_id: start,
          target_id: target,
          rule_id: rule?.id || null,
          day_key: isDailyMode ? activeDayKey : null,
          week_key: isWeeklyMode ? activeWeekKey : null
        }
      );
    }
  }

  function getCompletionRecord(mode, key) {
    if (!mode || !key) return null;
    return completionRecords[`${mode}:${key}`] || null;
  }

  function openCompletionModal(record) {
    if (!record?.winningAttempt) return;
    const payload = {
      ...record.winningAttempt,
      shortestPath: record.shortestPath || record.winningAttempt.shortestPath || [],
      shortestCount:
        typeof record.shortestCount === "number"
          ? record.shortestCount
          : record.winningAttempt.shortestCount || 0
    };
    setResultData(payload);
    setIsFailed(Boolean(payload.failed));
    setShowModal(true);
  }

  function beginTimedCountdown() {
    setCountdownValue(3);
    setIsCountdownActive(true);
    setStartedAt(null);
  }

  function resetGame(forceNew = false) {
    if (!comarques.length) return;
    if (guessFeedbackTimerRef.current) clearTimeout(guessFeedbackTimerRef.current);
    setGuessFeedback(null);
    lastGuessRef.current = null;
    const ids = comarques.map((featureItem) => featureItem.properties.id);
    const todayKey = getDayKey();
    const baseSeed =
      gameMode === "daily"
        ? `${todayKey}-${activeDifficulty}`
        : gameMode === "weekly"
          ? `${weekKey}-${activeDifficulty}`
          : null;
    const seed = baseSeed && !forceNew ? baseSeed : null;
    const rng = seed ? mulberry32(hashString(seed)) : Math.random;
    const minInternal = isDailyMode
      ? DAILY_MIN_INTERNAL
      : isWeeklyMode
        ? WEEKLY_MIN_INTERNAL
        : isExploreMode
          ? EXPLORE_MIN_INTERNAL
          : difficultyConfig.minInternal || 4;
    const minLength = minInternal + 2;
    const comarcaNames = comarques.map((featureItem) => featureItem.properties.name);
    const allowedLevels = difficultyConfig.ruleLevels || ["medium"];
    const rulePool = RULE_DEFS.filter((def) =>
      allowedLevels.includes(getRuleDifficulty(def))
    );
    const highPool = RULE_DEFS.filter((def) => {
      const difficultyLevel = getRuleDifficulty(def);
      const tags = getRuleTags(def);
      const hasCultural = tags.includes("cultural");
      const hasGeo = tags.includes("geo");
      return difficultyLevel === "expert" && (hasCultural || hasGeo);
    });
    const pool = isDailyMode || isWeeklyMode
      ? highPool.length
        ? highPool
        : rulePool.length
          ? rulePool
          : RULE_DEFS
      : rulePool.length
        ? rulePool
        : RULE_DEFS;
    const fixedMode = isDailyMode || isWeeklyMode;
    const fixedKey = isDailyMode ? activeDayKey : isWeeklyMode ? activeWeekKey : null;
    let fixedRuleDef = null;
    if (!isExploreMode && fixedMode && fixedKey) {
      const assignments = readRuleAssignments();
      const history = readRuleHistory();
      const modeKey = isDailyMode ? "daily" : "weekly";
      const assignedId = assignments[modeKey]?.[fixedKey];
      fixedRuleDef =
        pool.find((def) => def.id === assignedId) ||
        RULE_DEFS.find((def) => def.id === assignedId) ||
        null;
      if (!fixedRuleDef) {
        const picked = pickRuleForKey(pool, fixedKey, history[modeKey], mulberry32);
        if (picked) {
          fixedRuleDef = picked;
          const nextAssignments = {
            ...assignments,
            [modeKey]: { ...(assignments[modeKey] || {}), [fixedKey]: picked.id }
          };
          const nextHistory = {
            ...history,
            [modeKey]: [...(history[modeKey] || []), picked.id].slice(-RULE_HISTORY_LIMIT)
          };
          writeRuleAssignments(nextAssignments);
          writeRuleHistory(nextHistory);
        }
      }
    }
    let start = null;
    let target = null;
    let nextShortest = [];
    let selectedRule = null;
    let attemptsLeft = 500;

    while (attemptsLeft > 0) {
      attemptsLeft -= 1;
      const candidateStart = pickRandom(ids, rng);
      const candidateTarget = pickRandom(ids, rng);
      if (candidateTarget === candidateStart) continue;
      const neighbors = adjacency.get(candidateStart);
      if (neighbors && neighbors.has(candidateTarget)) continue;
      const startName = comarcaById.get(candidateStart)?.properties.name;
      const targetName = comarcaById.get(candidateTarget)?.properties.name;
      const ctx = {
        rng,
        startId: candidateStart,
        targetId: candidateTarget,
        startName,
        targetName,
        comarcaNames,
        normalizedToId,
        adjacency,
        allIds: ids
      };
      const candidateRule = isExploreMode
        ? null
        : fixedRuleDef
          ? prepareRule(fixedRuleDef, ctx)
          : pickRule(pool, ctx);
      if (!isExploreMode && !candidateRule) continue;
      const path = findShortestPathWithRule(
        candidateStart,
        candidateTarget,
        adjacency,
        candidateRule,
        ids,
        shortestPathCache
      );
      const basePath =
        !isExploreMode && candidateRule
          ? findShortestPath(candidateStart, candidateTarget, adjacency, shortestPathCache)
          : [];
      if (!path.length) continue;
      if (!isExploreMode && candidateRule && basePath.length && path.length <= basePath.length) {
        continue;
      }
      if (path.length < minLength) continue;
      start = candidateStart;
      target = candidateTarget;
      nextShortest = path;
      selectedRule = candidateRule;
      break;
    }

    if (!start || !target || (!isExploreMode && !selectedRule)) {
      let fallbackAttempts = 500;
      while (fallbackAttempts > 0) {
        fallbackAttempts -= 1;
        const candidateStart = pickRandom(ids, rng);
        const candidateTarget = pickRandom(ids, rng);
        if (candidateTarget === candidateStart) continue;
        const neighbors = adjacency.get(candidateStart);
        if (neighbors && neighbors.has(candidateTarget)) continue;
        const startName = comarcaById.get(candidateStart)?.properties.name;
        const targetName = comarcaById.get(candidateTarget)?.properties.name;
        const ctx = {
          rng,
          startId: candidateStart,
          targetId: candidateTarget,
          startName,
          targetName,
          comarcaNames,
          normalizedToId,
          adjacency,
          allIds: ids
        };
        const candidateRule = isExploreMode
          ? null
          : fixedRuleDef
            ? prepareRule(fixedRuleDef, ctx)
            : pickRule(pool, ctx);
        if (!isExploreMode && !candidateRule) continue;
        const path = findShortestPathWithRule(
          candidateStart,
          candidateTarget,
          adjacency,
          candidateRule,
          ids,
          shortestPathCache
        );
        const basePath =
          !isExploreMode && candidateRule
            ? findShortestPath(candidateStart, candidateTarget, adjacency, shortestPathCache)
            : [];
        if (!path.length) continue;
        if (
          !isExploreMode &&
          candidateRule &&
          basePath.length &&
          path.length <= basePath.length
        ) {
          continue;
        }
        if (path.length < minLength) continue;
        start = candidateStart;
        target = candidateTarget;
        nextShortest = path;
        selectedRule = candidateRule;
        break;
      }
    }
    if (!start || !target) {
      start = ids[0];
      target = ids[1] || ids[0];
      nextShortest = findShortestPath(start, target, adjacency, shortestPathCache);
    }
    if (!selectedRule) {
      const startName = comarcaById.get(start)?.properties.name;
      const targetName = comarcaById.get(target)?.properties.name;
      const candidateRule = isExploreMode
        ? null
        : fixedRuleDef
          ? prepareRule(fixedRuleDef, {
              rng,
              startId: start,
              targetId: target,
              startName,
              targetName,
              comarcaNames,
              normalizedToId,
              adjacency,
              allIds: ids
            })
          : pickRule(pool, {
              rng,
              startId: start,
              targetId: target,
              startName,
              targetName,
              comarcaNames,
              normalizedToId,
              adjacency,
              allIds: ids
            });
      if (candidateRule) {
        const candidatePath = findShortestPathWithRule(
          start,
          target,
          adjacency,
          candidateRule,
          ids,
          shortestPathCache
        );
        const basePath = findShortestPath(start, target, adjacency, shortestPathCache);
        if (candidatePath.length && basePath.length && candidatePath.length > basePath.length) {
          selectedRule = candidateRule;
          nextShortest = candidatePath;
        }
      }
    }

    setStartId(start);
    setTargetId(target);
    setCurrentId(start);
    setGuessHistory([]);
    setAttempts(0);
    setHintsUsed(0);
    setGuessError(false);
    setTempRevealId(null);
    setTempNeighborHint(false);
    setTempInitialsHint(false);
    const basePowerups = getPowerupUses(activeDifficulty);
    const explorePowerups = Object.fromEntries(
      POWERUPS.map((powerup) => [powerup.id, 99])
    );
    setPowerups(isExploreMode ? explorePowerups : basePowerups);
    setReplayMode(null);
    setReplayOrder([]);
    setReplayIndex(0);
    setGuessValue("");
    setIsSuggestionsOpen(false);
    setIsComplete(false);
    setIsFailed(false);
    setShowModal(false);
    setResultData(null);
    setShortestPath(nextShortest);
    setActiveRule(isExploreMode ? null : selectedRule);
    setElapsedMs(0);
    setStartedAt(null);
    setTimePenaltyMs(0);
    if (isTimedMode) {
      const internalCount = Math.max(nextShortest.length - 2, 0);
      setTimeLimitMs(Math.max(15000, internalCount * 5000));
      beginTimedCountdown();
    } else {
      setTimeLimitMs(DEFAULT_TIME_LIMIT_MS);
      setIsCountdownActive(false);
      setCountdownValue(null);
    }
    setLastEntryId(null);
    setCopyStatus("idle");

    const avoidIds =
      selectedRule?.kind === "avoid" ? selectedRule.comarcaIds || [] : [];
    const mustPassIds =
      selectedRule?.kind === "mustIncludeAny" ? selectedRule.comarcaIds || [] : [];
    const shouldPersist = !isFixedMode && (forceNew || !baseSeed);
    if (shouldPersist) {
      const payload = {
        level_type: gameMode,
        date: gameMode === "daily" ? todayKey : null,
        week_key: gameMode === "weekly" ? weekKey : null,
        difficulty_id: activeDifficulty,
        rule_id: selectedRule?.id || null,
        start_id: start,
        target_id: target,
        shortest_path: nextShortest,
        avoid_ids: avoidIds.length ? avoidIds : null,
        must_pass_ids: mustPassIds.length ? mustPassIds : null
      };
      persistLevel(payload);
    }

    enqueueTelemetry(
      "level_start",
      {
        shortestCount: Math.max(nextShortest.length - 2, 0),
        ruleDifficulty: selectedRule?.difficulty || null
      },
      {
        start_id: start,
        target_id: target,
        rule_id: selectedRule?.id || null,
        day_key: gameMode === "daily" ? todayKey : null,
        week_key: gameMode === "weekly" ? weekKey : null
      }
    );
  }

  function activateTempHint(key, durationMs, setter, resetValue) {
    if (hintTimersRef.current[key]) {
      clearTimeout(hintTimersRef.current[key]);
    }
    setter(resetValue === undefined ? true : resetValue);
    hintTimersRef.current[key] = setTimeout(() => {
      setter(resetValue === undefined ? false : null);
    }, durationMs);
  }

  function handlePowerupUse(powerupId) {
    if (isComplete || isFailed) return;
    const powerup = POWERUPS.find((item) => item.id === powerupId);
    if (!powerup) return;
    const usesLeft = powerups[powerupId] ?? 0;
    if (!isExploreMode && usesLeft <= 0) {
      play("wrong_comarca");
      if (isTimedMode) {
        play("level_lose", { bypassCooldown: true });
        setIsFailed(true);
        setShowModal(true);
        setResultData((prev) =>
          prev || {
            failed: true,
            attempts,
            timeMs: elapsedMs,
            playerPath: guessHistory,
            ruleLabel: activeRule?.label || "Sense norma",
            ruleDifficulty: activeRule?.difficulty || null,
            shortestPath: [],
            shortestCount: 0,
            distance: 0,
            mode: gameMode,
            difficulty: activeDifficulty,
            streak: displayStreak
          }
        );
      }
      return;
    }
    play("recharge");
    if (powerupId === "reveal-next") {
      const revealId =
        shortestPath.find(
          (id) => id !== startId && id !== targetId && !guessedSet.has(id)
        ) || null;
      if (!revealId) return;
      if (!isExploreMode) {
        setPowerups((prev) => ({
          ...prev,
          [powerupId]: Math.max((prev[powerupId] || 0) - 1, 0)
        }));
      }
      setHintsUsed((prev) => prev + 1);
      if (isTimedMode) {
        setTimePenaltyMs((prev) => prev + (powerup.penaltyMs || 0));
      }
      if (hintTimersRef.current.reveal) clearTimeout(hintTimersRef.current.reveal);
      setTempRevealId(revealId);
      hintTimersRef.current.reveal = setTimeout(() => {
        setTempRevealId(null);
      }, powerup.durationMs || 5000);
      return;
    }
    if (!isExploreMode) {
      setPowerups((prev) => ({
        ...prev,
        [powerupId]: Math.max((prev[powerupId] || 0) - 1, 0)
      }));
    }
    setHintsUsed((prev) => prev + 1);
    if (isTimedMode) {
      setTimePenaltyMs((prev) => prev + (powerup.penaltyMs || 0));
    }
    if (powerupId === "temp-neighbors") {
      activateTempHint("neighbors", powerup.durationMs || 5000, setTempNeighborHint);
      return;
    }
    if (powerupId === "temp-initials") {
      activateTempHint("initials", powerup.durationMs || 5000, setTempInitialsHint);
    }
  }

  function triggerGuessError() {
    setGuessError(true);
    if (guessErrorTimerRef.current) clearTimeout(guessErrorTimerRef.current);
    guessErrorTimerRef.current = setTimeout(() => {
      setGuessError(false);
    }, 700);
  }

  function focusGuessInput() {
    if (!guessInputRef.current) return;
    requestAnimationFrame(() => {
      guessInputRef.current?.focus();
    });
  }

  function pushGuessFeedback(text, tone = "neutral") {
    if (!text) return;
    setGuessFeedback({ text, tone });
    if (guessFeedbackTimerRef.current) clearTimeout(guessFeedbackTimerRef.current);
    guessFeedbackTimerRef.current = setTimeout(() => {
      setGuessFeedback(null);
    }, 1600);
  }

  function handleGuessSubmit(event) {
    event.preventDefault();
    if (!startId || !targetId || isComplete || isFailed) return;

    const trimmed = guessValue.trim();
    if (!trimmed) {
      focusGuessInput();
      return;
    }

    const normalized = normalizeName(trimmed);
    const id = normalizedToId.get(normalized);
    if (!id) {
      triggerGuessError();
      play("wrong_comarca");
      pushGuessFeedback(t("feedbackNoMatch"), "bad");
      focusGuessInput();
      return;
    }

    if (id === startId || id === targetId) {
      triggerGuessError();
      play("wrong_comarca");
      pushGuessFeedback(t("feedbackStartTarget"), "warn");
      focusGuessInput();
      return;
    }

    if (guessedSet.has(id)) {
      triggerGuessError();
      play("wrong_comarca");
      pushGuessFeedback(t("feedbackRepeated"), "warn");
      focusGuessInput();
      return;
    }

    if (!startedAt && !isTimedMode) {
      setStartedAt(Date.now());
    }

    setAttempts((prev) => prev + 1);
    setCurrentId(id);
    setGuessValue("");
    setIsSuggestionsOpen(false);
    lastGuessRef.current = id;

    const name = comarcaById.get(id)?.properties.name || trimmed;
    setGuessHistory((prev) => [...prev, { id, name }]);
    if (shortestPathSet.has(id)) {
      play("correct_comarca");
    } else if (shortestNeighborSet.has(id)) {
      play("almost_comarca");
    } else {
      play("wrong_comarca");
    }
    pushGuessFeedback(t("feedbackOk"), "good");
    focusGuessInput();
    if (!userZoomedRef.current) {
      smartRecenter(id);
    }
    triggerWeatherForComarca(id);
  }

  function handleGuessChange(event) {
    const value = event.target.value;
    setGuessValue(value);
    setIsSuggestionsOpen(Boolean(value.trim()));
    if (guessError) setGuessError(false);
    if (guessFeedback) setGuessFeedback(null);
  }

  function handleGuessFocus() {
    setIsSuggestionsOpen(true);
  }

  function handleGuessBlur() {
    setTimeout(() => setIsSuggestionsOpen(false), 150);
  }

  function handleSuggestionPick(name) {
    play("ui_select");
    setGuessValue(name);
    setIsSuggestionsOpen(false);
    focusGuessInput();
  }

  function handleCalendarPick(mode, key) {
    const record = getCompletionRecord(mode, key);
    if (record?.winningAttempt) {
      openCompletionModal(record);
      return;
    }
    const entry =
      mode === "daily" ? calendarDailyMap.get(key) : calendarWeeklyMap.get(key);
    calendarApplyRef.current = null;
    setCalendarMode(mode);
    if (!entry?.level) {
      setCalendarSelection(null);
      if (gameMode !== mode) {
        setGameMode(mode);
      } else {
        resetGame();
      }
      return;
    }
    setCalendarSelection({ mode, key });
    if (gameMode !== mode) {
      setGameMode(mode);
      return;
    }
    const result = record?.winningAttempt || null;
    applyCalendarLevel(entry.level, { result, showResult: Boolean(result) });
    calendarApplyRef.current = `${mode}:${key}`;
  }

  function handlePlayToday() {
    play("ui_select");
    const key = dayKey;
    const record = getCompletionRecord("daily", key);
    if (record?.winningAttempt) {
      openCompletionModal(record);
      return;
    }
    setCalendarSelection({ mode: "daily", key });
    if (gameMode !== "daily") {
      setGameMode("daily");
      return;
    }
    const entry = calendarDailyMap.get(key);
    if (entry?.level) {
      applyCalendarLevel(entry.level);
      calendarApplyRef.current = `daily:${key}`;
    } else if (entry?.levelId) {
      handleCalendarAction("daily", key);
    }
  }

  function handleStartNext() {
    play("ui_select");
    if (isDailyMode) {
      const record = getCompletionRecord("daily", activeDayKey);
      if (record?.winningAttempt) {
        openCompletionModal(record);
        return;
      }
    }
    if (isWeeklyMode) {
      const record = getCompletionRecord("weekly", activeWeekKey);
      if (record?.winningAttempt) {
        openCompletionModal(record);
        return;
      }
    }
    if (isDailyMode && calendarSelection?.mode === "daily") {
      const entry = calendarDailyMap.get(activeDayKey);
      if (entry?.level) {
        applyCalendarLevel(entry.level);
        calendarApplyRef.current = `daily:${activeDayKey}`;
        return;
      }
    }
    if (isWeeklyMode && calendarSelection?.mode === "weekly") {
      const entry = calendarWeeklyMap.get(activeWeekKey);
      if (entry?.level) {
        applyCalendarLevel(entry.level);
        calendarApplyRef.current = `weekly:${activeWeekKey}`;
        return;
      }
    }
    resetGame(!isFixedMode);
  }

  const handleZoomIn = useCallback(() => {
    if (!zoomRef.current || !svgRef.current) return;
    userZoomedRef.current = true;
    select(svgRef.current).call(zoomRef.current.scaleBy, 1.2);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!zoomRef.current || !svgRef.current) return;
    userZoomedRef.current = true;
    select(svgRef.current).call(zoomRef.current.scaleBy, 0.85);
  }, []);

  const handleRecenter = useCallback(() => {
    if (!zoomRef.current || !svgRef.current) return;
    userZoomedRef.current = false;
    select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
  }, []);

  function smartRecenter(id) {
    if (!zoomRef.current || !svgRef.current) return;
    const centroid = centroidById.get(id);
    if (!centroid) return;
    const [x, y] = centroid;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    select(svgRef.current).call(zoomRef.current.translateTo, x, y);
  }

  function handleConfigOpen() {
    play("ui_select");
    setConfigOpen(true);
  }

  function handleConfigClose() {
    play("ui_select");
    setConfigOpen(false);
  }

  function handleDifficultyPick(difficultyId) {
    if (!unlockedDifficulties.has(difficultyId)) return;
    play("ui_select");
    setDifficulty(difficultyId);
  }

  function handleCalendarOpen(mode) {
    play("ui_select");
    const now = new Date();
    let targetMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (mode === "daily") {
      if (!calendarDailyMap.has(dayKey)) {
        const latestDay = calendarDaily[0]?.date;
        if (latestDay) {
          const parsed = new Date(`${latestDay}T00:00:00`);
          if (!Number.isNaN(parsed.valueOf())) {
            targetMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
          }
        }
      }
      setCalendarMonth(targetMonth);
      setCalendarMode("daily");
    } else {
      if (!calendarWeeklyMap.has(weekKey)) {
        const latestWeek = calendarWeekly[0]?.weekKey;
        if (latestWeek) {
          const year = Number(latestWeek.slice(0, 4));
          if (!Number.isNaN(year)) {
            targetMonth = new Date(year, 0, 1);
          }
        }
      }
      setCalendarMonth(targetMonth);
      setCalendarMode("weekly");
    }
    setCalendarOpen(true);
  }

  function handleCalendarPrevMonth() {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function handleCalendarNextMonth() {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  async function handleCalendarAction(mode, key) {
    const hasCalendarData = calendarDaily.length > 0 || calendarWeekly.length > 0;
    if (!hasCalendarData && calendarStatus !== "ready") return;
    play("ui_select");
    const record = getCompletionRecord(mode, key);
    if (record?.winningAttempt) {
      openCompletionModal(record);
      setCalendarOpen(false);
      return;
    }
    const entry =
      mode === "daily" ? calendarDailyMap.get(key) : calendarWeeklyMap.get(key);
    if (!entry?.level && !entry?.levelId) return;
    let level = entry.level;
    if (!level && entry.levelId) {
      try {
        const { data, error } = await withRetry(
          () =>
            supabase
              .from("levels")
              .select(
                "id, start_id, target_id, shortest_path, rule_id, avoid_ids, must_pass_ids, difficulty_id"
              )
              .eq("id", entry.levelId)
              .maybeSingle(),
          { retries: 2, backoffMs: 500 }
        );
        if (error) return;
        level = data || null;
      } catch {
        return;
      }
    }
    if (!level) return;
    if (!entry.level && level) {
      if (mode === "daily") {
        setCalendarDaily((prev) =>
          prev.map((item) => (item.date === key ? { ...item, level } : item))
        );
      } else {
        setCalendarWeekly((prev) =>
          prev.map((item) => (item.weekKey === key ? { ...item, level } : item))
        );
      }
    }
    handleCalendarPick(mode, key);
    setCalendarOpen(false);
  }

  function handleCalendarClose() {
    play("ui_select");
    setCalendarOpen(false);
  }

  function handleTitleReset() {
    play("ui_select");
    const todayKey = dayKey;
    const todayDone = Boolean(getCompletionRecord("daily", todayKey)?.winningAttempt);
    setShowModal(false);
    setResultData(null);
    setIsFailed(false);
    setIsComplete(false);
    setReplayMode(null);
    setReplayOrder([]);
    setReplayIndex(0);
    setCalendarOpen(false);
    calendarApplyRef.current = null;

    if (!isSupabaseReady) {
      if (gameMode !== "normal") {
        setGameMode("normal");
        setCalendarSelection(null);
      } else {
        resetGame(true);
      }
      return;
    }

    if (!todayDone) {
      handleCalendarPick("daily", todayKey);
      return;
    }
    const unlocked = [...unlockedDifficulties];
    const next =
      unlocked[Math.floor(Math.random() * unlocked.length)] || "pixapi";
    const willChangeDifficulty = next !== difficulty;
    if (willChangeDifficulty) {
      setDifficulty(next);
    }
    if (gameMode !== "normal") {
      setGameMode("normal");
    } else if (!willChangeDifficulty) {
      resetGame(true);
    }
  }

  function handleReplayStart(mode) {
    if (!isComplete || !startId || !targetId) return;
    const order =
      mode === "shortest"
        ? shortestPath.filter((id) => id !== startId && id !== targetId)
        : guessHistory.map((entry) => entry.id);
    if (!order.length) return;
    setReplayMode(mode);
    setReplayOrder(order);
    setReplayIndex(0);
  }

  const getLeaderboardKey = (item) => {
    if (!item) return "";
    if (item.mode === "daily") return item.dayKey ? `daily:${item.dayKey}` : "";
    if (item.mode === "weekly") return item.weekKey ? `weekly:${item.weekKey}` : "";
    const ruleId = item.ruleId || "none";
    return `${item.mode}:${item.difficulty}:${item.startId}:${item.targetId}:${ruleId}`;
  };

  function computeRank(entries, entry, key) {
    if (!entries.length) return null;
    const list = entries.some((item) => item.id === entry.id)
      ? entries
      : [...entries, entry];
    const normalize = (value) =>
      Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    const sorted = [...list].sort((a, b) => {
      const aValue = normalize(a[key]);
      const bValue = normalize(b[key]);
      if (aValue === bValue) return (a.timeMs || 0) - (b.timeMs || 0);
      return aValue - bValue;
    });
    const index = sorted.findIndex((item) => item.id === entry.id);
    if (index === -1) return null;
    return {
      rank: index + 1,
      total: sorted.length,
      topPercent: Math.ceil(((index + 1) / sorted.length) * 100)
    };
  }

  function buildLeaderboardStats(entries, entry) {
    const key = getLeaderboardKey(entry);
    if (!key) return null;
    const same = entries.filter((item) => getLeaderboardKey(item) === key);
    const list = same.some((item) => item.id === entry.id) ? same : [...same, entry];
    const timeRank = computeRank(list, entry, "timeMs");
    const attemptsRank = computeRank(list, entry, "attempts");
    const timeStats = computeGaussianStats(list.map((item) => item.timeMs));
    return {
      topTimePercent: timeRank?.topPercent ?? null,
      topAttemptsPercent: attemptsRank?.topPercent ?? null,
      totalPlayers: Math.max(list.length, 1),
      timeStats
    };
  }

  async function loadLeaderboard() {
    setLeaderboardStatus("loading");
    try {
      if (leaderboardEndpoint) {
        const response = await fetchWithRetry(
          leaderboardEndpoint,
          {},
          { retries: 2, backoffMs: 500 }
        );
        const data = await response.json();
        setLeaderboardEntries(Array.isArray(data) ? data : []);
      } else if (typeof window !== "undefined") {
        const raw = localStorage.getItem(LEADERBOARD_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        setLeaderboardEntries(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      setLeaderboardEntries([]);
    } finally {
      setLeaderboardStatus("idle");
    }
  }

  async function submitLeaderboard(entry) {
    if (!entry) return [];
    try {
      if (leaderboardEndpoint) {
        await fetch(leaderboardEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry)
        });
        const response = await fetchWithRetry(
          leaderboardEndpoint,
          {},
          { retries: 2, backoffMs: 500 }
        );
        const data = await response.json();
        const list = Array.isArray(data) ? data : [];
        setLeaderboardEntries(list);
        return list;
      }
      const raw = localStorage.getItem(LEADERBOARD_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const updated = Array.isArray(parsed) ? [...parsed, entry] : [entry];
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(updated.slice(-500)));
      setLeaderboardEntries(updated.slice(-500));
      return updated.slice(-500);
    } catch {
      return leaderboardEntries;
    }
  }

  function finishGame(path) {
    const totalTime = startedAt ? Date.now() - startedAt : elapsedMs;
    const bonusMs = isTimedMode ? Math.max(timeLimitMs - totalTime, 0) : 0;
    const shortestCount = shortestPath.length ? shortestPath.length - 2 : 0;
    const foundCount = path.length ? Math.max(path.length - 2, 0) : 0;
    const distance = Math.max(foundCount - shortestCount, 0);
    const startName = startId ? comarcaById.get(startId)?.properties.name : "";
    const regionId = startName ? regionByName.get(startName)?.id || null : null;
    const ruleId = activeRule?.id || null;
    const ruleDifficulty = activeRule?.difficulty || null;
    const ruleTags = activeRule ? getRuleTags(activeRule) : [];

    let nextStreak = dailyStreak;
    const isCurrentDaily = gameMode === "daily" && activeDayKey === dayKey;
    if (isCurrentDaily) {
      const today = getLocalDayKey(new Date());
      const yesterday = getLocalDayKeyOffset(-1);
      if (dailyStreak.lastDate === today) {
        nextStreak = dailyStreak;
      } else if (dailyStreak.lastDate === yesterday) {
        nextStreak = {
          count: (dailyStreak.count || 0) + 1,
          lastDate: today
        };
      } else {
        nextStreak = { count: 1, lastDate: today };
      }
      setDailyStreak(nextStreak);
      if (typeof window !== "undefined") {
        localStorage.setItem(STREAK_KEY, JSON.stringify(nextStreak));
      }
    }

    const levelKey = isDailyMode
      ? `daily:${activeDayKey}`
      : isWeeklyMode
        ? `weekly:${activeWeekKey}`
        : `${gameMode}:${activeDifficulty}:${startId || "?"}:${targetId || "?"}:${ruleId || "none"}`;

    const nextDifficulty =
      distance === 0 && gameMode === "normal"
        ? getNextDifficultyId(activeDifficulty)
        : null;
    const shouldUnlock =
      Boolean(nextDifficulty) && !unlockedDifficulties.has(nextDifficulty);
    if (shouldUnlock && nextDifficulty) {
      setUnlockedDifficulties((prev) => new Set([...prev, nextDifficulty]));
    }

    const currentStats = levelStats[levelKey] || {};
    const isNewBestTime =
      !currentStats.bestTime || totalTime < currentStats.bestTime;
    const isNewBestAttempts =
      !currentStats.bestAttempts || attempts < currentStats.bestAttempts;
    const shouldReward = isNewBestTime || isNewBestAttempts;

    setLevelStats((prev) => {
      const current = prev[levelKey] || {};
      const bestTime = current.bestTime ? Math.min(current.bestTime, totalTime) : totalTime;
      const bestAttempts = current.bestAttempts
        ? Math.min(current.bestAttempts, attempts)
        : attempts;
      const perfect = current.perfect || distance === 0;
      const next = {
        ...prev,
        [levelKey]: {
          bestTime,
          bestAttempts,
          perfect,
          lastPlayed: Date.now()
        }
      };
      return trimLevelStats(next);
    });

    const entry = {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      playerId: playerIdRef.current,
      mode: gameMode,
      mapId: MAP_ID,
      difficulty: activeDifficulty,
      timeMs: totalTime,
      attempts,
      guesses: guessedIds.length,
      distance,
      shortest: shortestCount,
      found: foundCount,
      ruleId,
      ruleDifficulty,
      ruleTags,
      startId,
      targetId,
      region: regionId,
      weekKey: isWeeklyMode ? activeWeekKey : null,
      dayKey: isDailyMode ? activeDayKey : null,
      createdAt: new Date().toISOString()
    };

    const shortestNames = shortestPath
      .filter((id) => id !== startId && id !== targetId)
      .map((pathId) => comarcaById.get(pathId)?.properties.name || pathId);

    setIsComplete(true);
    play("objective_met");
    if (distance === 0) {
      play("level_perfect", { bypassCooldown: true });
    } else {
      play("level_win", { bypassCooldown: true });
    }
    const rewardKeys = [];
    if (bonusMs > 0) rewardKeys.push("treasure_bonus");
    if (shouldUnlock) rewardKeys.push("unlock");
    if (shouldReward) rewardKeys.push("coin_reward");
    rewardKeys.forEach((key, index) => {
      setTimeout(() => play(key), 1300 + index * 350);
    });
    void fireConfetti({ particleCount: 180, spread: 70, origin: { y: 0.7 } });
    setLastEntryId(entry.id);

    setHistory((prev) => {
      const historyEntry = {
        id: entry.id,
        date: entry.createdAt,
        mode: gameMode,
        difficulty: activeDifficulty,
        timeMs: totalTime,
        attempts,
        distance,
        shortest: shortestCount,
        found: foundCount,
        rule: activeRule?.label || "Sense norma"
      };
      return [...prev, historyEntry].slice(-20);
    });

    const baseResultPayload = {
      attempts,
      timeMs: totalTime,
      playerPath: guessHistory,
      shortestPath: shortestNames,
      shortestCount,
      foundCount,
      distance,
      ruleLabel: activeRule?.label || "Sense norma",
      ruleDifficulty,
      hintsUsed,
      bonusMs,
      entryId: entry.id,
      mode: gameMode,
      difficulty: activeDifficulty,
      streak: nextStreak.count || 0
    };

    enqueueTelemetry("level_complete", {
      attempts,
      timeMs: totalTime,
      distance,
      shortestCount,
      foundCount,
      hintsUsed,
      ruleDifficulty
    });

    submitLeaderboard(entry).then((entries) => {
      const stats = buildLeaderboardStats(entries, entry);
      const resultPayload = stats
        ? { ...baseResultPayload, ...stats }
        : baseResultPayload;
      const levelId = isDailyMode
        ? calendarDailyMap.get(activeDayKey)?.level?.id ||
          calendarDailyMap.get(activeDayKey)?.levelId ||
          null
        : isWeeklyMode
          ? calendarWeeklyMap.get(activeWeekKey)?.level?.id ||
            calendarWeeklyMap.get(activeWeekKey)?.levelId ||
            null
          : null;
      setCompletionRecords((prev) =>
        upsertCompletionRecord(prev, levelKey, {
          levelId,
          mode: gameMode,
          dayKey: isDailyMode ? activeDayKey : null,
          weekKey: isWeeklyMode ? activeWeekKey : null,
          shortestPath: shortestNames,
          shortestCount,
          attempt: resultPayload
        })
      );
      if (isDailyMode) {
        setDailyResults((prev) => ({ ...prev, [activeDayKey]: resultPayload }));
      }
      if (isWeeklyMode) {
        setWeeklyResults((prev) => ({ ...prev, [activeWeekKey]: resultPayload }));
      }
      setResultData(resultPayload);
      setShowModal(true);
    });

    if (supabaseUserId) {
      enqueueAttempt({
        id: entry.id,
        player_id: supabaseUserId,
        level_type: entry.mode,
        difficulty_id: entry.difficulty,
        time_ms: entry.timeMs,
        attempts: entry.attempts,
        guesses: entry.guesses,
        distance: entry.distance,
        shortest: entry.shortest,
        found: entry.found,
        rule_id: entry.ruleId,
        rule_difficulty: entry.ruleDifficulty,
        start_id: entry.startId,
        target_id: entry.targetId,
        region: entry.region,
        week_key: entry.weekKey,
        day_key: entry.dayKey,
        created_at: entry.createdAt
      });
    }
  }

  function handleCopyResult() {
    if (!resultData) return;
    const timeLabel = formatTime(resultData.timeMs);
    const startName = startId ? comarcaById.get(startId)?.properties.name : "";
    const targetName = targetId ? comarcaById.get(targetId)?.properties.name : "";
    const guessNames = resultData.playerPath.map((entry) => entry.name).join(", ");
    const text = [
      `camicurt.cat: ${startName} → ${targetName}`,
      `Mode: ${resultData.mode}`,
      `Dificultat: ${resultData.difficulty}`,
      `Temps: ${timeLabel}`,
      `Intents: ${resultData.attempts}`,
      `Comarques: ${guessNames || "(cap)"}`,
      `Norma: ${resultData.ruleLabel}`,
      `Distància camí curt: +${resultData.distance}`,
      `Ratxa diària: ${resultData.streak || 0}`
    ].join("\n");

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopyStatus("copied");
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopyStatus("idle"), 1500);
      });
    }
  }

  const startName = startId ? comarcaById.get(startId)?.properties.name : null;
  const currentName = currentId ? comarcaById.get(currentId)?.properties.name : null;
  const targetName = targetId ? comarcaById.get(targetId)?.properties.name : null;
  const dailyRecord = getCompletionRecord("daily", dayKey);
  const weeklyRecord = getCompletionRecord("weekly", weekKey);
  const isDailyCompleted = Boolean(dailyRecord?.winningAttempt);
  const isWeeklyCompleted = Boolean(weeklyRecord?.winningAttempt);
  const shortestPathSet = useMemo(() => new Set(shortestPath), [shortestPath]);
  const shortestNeighborSet = useMemo(
    () => buildNeighborSet(shortestPath, adjacency),
    [shortestPath, adjacency]
  );
  const guessHistoryWithStatus = useMemo(() => {
    if (!guessHistory.length) return [];
    return guessHistory.map((entry) => {
      let status = "bad";
      if (shortestPathSet.has(entry.id)) {
        status = "good";
      } else if (shortestNeighborSet.has(entry.id)) {
        status = "near";
      }
      return { ...entry, status };
    });
  }, [guessHistory, shortestPathSet, shortestNeighborSet]);
  const usedCount = guessedIds.length;
  const optimalCount = shortestPath.length ? Math.max(shortestPath.length - 2, 0) : null;
  const currentPathCount = pathInGuesses.length
    ? Math.max(pathInGuesses.length - 2, 0)
    : null;
  const actionStatus = useMemo(() => {
    if (isComplete) return t("statusSolved");
    if (isFailed) return t("statusFailed");
    if (pathInGuesses.length && !ruleStatus.satisfied) return t("statusIncomplete");
    if (
      pathInGuesses.length &&
      ruleStatus.satisfied &&
      optimalCount !== null &&
      currentPathCount !== null &&
      currentPathCount > optimalCount
    ) {
      return t("statusSuboptimal");
    }
    if (guessHistory.length) return t("statusInProgress");
    return t("statusReady");
  }, [
    isComplete,
    isFailed,
    pathInGuesses.length,
    ruleStatus.satisfied,
    optimalCount,
    currentPathCount,
    guessHistory.length,
    t
  ]);
  const currentLevelKey = useMemo(() => {
    if (isDailyMode) return `daily:${activeDayKey}`;
    if (isWeeklyMode) return `weekly:${activeWeekKey}`;
    return `${gameMode}:${activeDifficulty}:${startId || "?"}:${targetId || "?"}:${activeRule?.id || "none"}`;
  }, [
    isDailyMode,
    isWeeklyMode,
    activeDayKey,
    activeWeekKey,
    gameMode,
    activeDifficulty,
    startId,
    targetId,
    activeRule?.id
  ]);
  const timeLeftUrgent = isTimedMode && timeLeftMs <= 10000;
  const shouldShowSuggestions = isSuggestionsOpen && suggestions.length > 0;
  const subtitleKey = isDailyMode
    ? "descriptionDaily"
    : isTimedMode
      ? "descriptionTimed"
      : isExploreMode
        ? "descriptionExplore"
        : "descriptionNormal";
  const musicOptions = useMemo(() => {
    if (audioManifest?.music) {
      return Object.entries(audioManifest.music).map(([id, file]) => ({
        id,
        label: (file.split("/").pop() || id).replace(/\.[^/.]+$/, "")
      }));
    }
    return MUSIC_TRACKS.map((track) => ({ id: track.id, label: track.label }));
  }, [audioManifest]);
  const todayLabel = useMemo(() => formatFullDayLabel(dayKey), [dayKey]);
  const showDailySkeleton = calendarStatus === "loading" && calendarDaily.length === 0;
  const hasDailyLevels = calendarDaily.some((entry) => entry.levelId);
  const calendarMonthLabel = useMemo(() => {
    return calendarMonth.toLocaleDateString("ca-ES", {
      month: "long",
      year: "numeric"
    });
  }, [calendarMonth]);
  const calendarMonthDays = useMemo(
    () => buildMonthGrid(calendarMonth),
    [calendarMonth]
  );
  const streakTierLabel = useMemo(() => getStreakTier(displayStreak), [displayStreak]);
  const gaussianViz = useMemo(() => {
    if (!resultData?.timeStats) return null;
    return buildGaussianViz(resultData.timeStats, resultData.timeMs);
  }, [resultData]);

  return (
    <ThemeProvider themeId={activeTheme} weatherState={weatherState}>
      <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-row">
            <button type="button" className="brand-button" onClick={handleTitleReset}>
              <h1>camicurt.cat</h1>
            </button>
            <span className="brand-date">{todayLabel}</span>
          </div>
          <p className="subtitle">{t(subtitleKey)}</p>
        </div>
        <div className="topbar-right">
          <div className="topbar-actions">
            <button
              type="button"
              className="topbar-button topbar-play-today"
              onClick={handlePlayToday}
              disabled={!isMapReady}
            >
              {t("playToday")}
            </button>
            <button
              type="button"
              className="calendar-icon-button topbar-calendar"
              onClick={() => handleCalendarOpen("daily")}
              aria-label={t("calendar")}
            >
              <span className="calendar-icon" aria-hidden="true" />
              <span>{t("calendar")}</span>
            </button>
            <div className="streak-card topbar-streak">
              <span className="label">Ratxa</span>
              <span className="value">
                {displayStreak} {displayStreak === 1 ? "dia" : "dies"}
              </span>
              <span className="muted">{streakTierLabel}</span>
            </div>
          </div>
          {!isOnline ? (
            <div className="status-stack">
              <span className="status-badge offline">{t("offline")}</span>
            </div>
          ) : null}
        </div>
      </header>

      <section className="game-layout">
        <div
          className={`map-wrap ${difficultyConfig.fog ? "fog" : ""} ${
            isTimedMode ? "timed-mode" : ""
          } ${isCountdownActive ? "countdown-active" : ""}`}
          aria-busy={!isMapReady}
        >
          {isTimedMode ? (
            <div className={`map-timer ${timeLeftUrgent ? "urgent" : ""}`}>
              {startedAt && !isCountdownActive ? formatTime(timeLeftMs) : ""}
            </div>
          ) : null}
          {isTimedMode && isCountdownActive ? (
            <div className="countdown-overlay" aria-live="polite">
              <span className="countdown-value">{countdownValue}</span>
            </div>
          ) : null}
          {!isMapReady ? (
            <div className="map-loading" role="status" aria-live="polite">
              Carregant mapa...
            </div>
          ) : null}
          <div className="prompt">
            <div className="route">
              {startName && targetName ? (
                <span>
                  Ruta: <strong>{startName}</strong> → <strong>{targetName}</strong>
                </span>
              ) : (
                <span>Carregant dades...</span>
              )}
            </div>
            <div className="status">
              {isExploreMode
                ? "Explora el mapa"
                : isComplete
                  ? `Has completat el camí.`
                  : isFailed
                    ? "Temps esgotat"
                    : currentName
                      ? `Darrera: ${currentName}`
                      : "—"}
            </div>
          </div>
          <div className="map-controls">
            <button
              type="button"
              onClick={() => {
                play("ui_select");
                handleZoomIn();
              }}
              aria-label="Apropar"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                play("ui_select");
                handleZoomOut();
              }}
              aria-label="Allunyar"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => {
                play("ui_select");
                handleRecenter();
              }}
            >
              Recentrar
            </button>
          </div>

          <svg
            ref={svgRef}
            className="map"
            viewBox={viewBox}
            role="img"
            aria-label="Mapa de Catalunya"
            onPointerDown={() => play("map_tap")}
          >
            <g ref={gRef}>
              {outlinePath ? <path className="outline" d={outlinePath} /> : null}
              {renderPaths.map((featureItem) => (
                <path
                  key={featureItem.id}
                  d={featureItem.path}
                  className={featureItem.classes}
                />
              ))}
              {showInitialsActive ? (
                <g className="initials">
                  {paths.map((featureItem) => {
                    const centroid = featureItem.centroid;
                    if (!centroid) return null;
                    const [x, y] = centroid;
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                    return (
                      <text
                        key={`init-${featureItem.id}`}
                        x={x}
                        y={y}
                        textAnchor="middle"
                        className="initial"
                      >
                        {initialsById.get(featureItem.id)}
                      </text>
                    );
                  })}
                </g>
              ) : null}
            </g>
          </svg>
        </div>

        <aside className="side-panel">
          <div className="panel-card action-card">
            <div className="action-header">
              <span className="label">{t("action")}</span>
              <span className="action-status muted">{actionStatus}</span>
            </div>
            <div className="action-progress muted">
              <span className="progress-item">
                {t("usedCount", { value: usedCount })}
              </span>
              {typeof optimalCount === "number" ? (
                <span className="progress-item">
                  {t("optimalCount", { value: optimalCount })}
                </span>
              ) : null}
              {typeof currentPathCount === "number" ? (
                <span className="progress-item">
                  {t("currentCount", { value: currentPathCount })}
                </span>
              ) : null}
            </div>
            <form className="guess-form action-form" onSubmit={handleGuessSubmit}>
              <label className="label" htmlFor="guess-input">
                {t("guessLabel")}
              </label>
              <input
                ref={guessInputRef}
                id="guess-input"
                type="text"
                value={guessValue}
                onChange={handleGuessChange}
                onFocus={handleGuessFocus}
                onBlur={handleGuessBlur}
                disabled={isComplete || isFailed || !isMapReady || isCountdownActive}
                className={guessError ? "input-error" : ""}
                aria-invalid={guessError}
                autoFocus
              />
              {shouldShowSuggestions ? (
                <div className="suggestions is-open">
                  {suggestions.map((name) => (
                    <button
                      className="suggestion"
                      type="button"
                      key={name}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSuggestionPick(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="submit"
                className="submit"
                disabled={isComplete || isFailed || !isMapReady || isCountdownActive}
              >
                {t("submit")}
              </button>
            </form>
            {guessFeedback ? (
              <div className="action-feedback muted" role="status" aria-live="polite">
                {guessFeedback.text}
              </div>
            ) : null}
          </div>

          <div className="panel-card challenge-card">
            <div className="section-header">
              <span className="label">{t("challenge")}</span>
            </div>
            <div className="stat-inline">
              <span className="label">{t("start")}:</span>
              <span className="value start">{startName || "—"}</span>
            </div>
            <div className="stat-inline">
              <span className="label">{t("target")}:</span>
              <span className="value target">{targetName || "—"}</span>
            </div>
            <span className="label">{t("rule")}</span>
            <div
              className={`rule-chip ${
                ruleStatus.failed ? "bad" : ruleStatus.satisfied ? "good" : ""
              }`}
            >
              {activeRule?.label || t("noRule")}
            </div>
            <div className="stat-inline">
              <span className="label">{t("difficulty")}:</span>
              <span className="value">{difficultyConfig.shortLabel}</span>
            </div>
            <div className="guess-history">
              {guessHistoryWithStatus.length ? (
                <ul className="guess-history-list">
                  {guessHistoryWithStatus.map((entry, index) => (
                    <li
                      key={`${entry.id}-${index}`}
                      className={`guess-history-item ${entry.status}`}
                    >
                      {entry.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted">—</span>
              )}
            </div>
          </div>

          <div className={`panel-card options-card ${optionsOpen ? "is-open" : ""}`}>
            <button
              type="button"
              className="options-toggle"
              onClick={() => {
                play("ui_select");
                setOptionsOpen((prev) => !prev);
              }}
              aria-expanded={optionsOpen}
              aria-controls="options-panel"
            >
              <span className="label">{t("options")}</span>
              <span className="chevron" aria-hidden="true">
                {optionsOpen ? "▴" : "▾"}
              </span>
            </button>
            <div id="options-panel" className="options-body" hidden={!optionsOpen}>
              <div className="options-section">
                <span className="label">{t("mode")}</span>
                <div className="mode-buttons">
                  {PRIMARY_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`mode-button ${gameMode === mode.id ? "active" : ""}`}
                      onClick={() => {
                        play("ui_select");
                        setGameMode(mode.id);
                      }}
                    >
                      {t(mode.id)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="options-section">
                <span className="label">{t("difficulty")}</span>
                <div className="difficulty-grid">
                  {DIFFICULTIES.map((entry) => {
                    const isUnlocked = unlockedDifficulties.has(entry.id);
                    const isActive = entry.id === activeDifficulty;
                    const isLocked = !isUnlocked && entry.id !== "pixapi";
                    const disabled =
                      (isFixedMode && !isActive) || (!isUnlocked && isLocked);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={`difficulty-button ${isActive ? "active" : ""} ${
                          isLocked ? "locked" : ""
                        }`}
                        onClick={() => {
                          if (isFixedMode) return;
                          if (isUnlocked) {
                            handleDifficultyPick(entry.id);
                          }
                        }}
                        disabled={disabled}
                        aria-pressed={isActive}
                      >
                        <span>{entry.label}</span>
                      </button>
                    );
                  })}
                </div>
                {isFixedMode ? (
                  <span className="muted">{t("fixedDifficulty")}</span>
                ) : null}
              </div>

              <div className="options-section">
                <button
                  type="button"
                  className="new-game-button"
                  onClick={handleStartNext}
                  disabled={!isMapReady}
                >
                  {t("newGame")}
                </button>
              </div>

              <div className="options-section">
                <span className="label">{t("powerups")}</span>
                <div className="powerups">
                  {POWERUPS.map((powerup) => {
                    const usesLeft = powerups[powerup.id] ?? 0;
                    const disabled =
                      isComplete ||
                      isFailed ||
                      isCountdownActive ||
                      (!isExploreMode && !isTimedMode && usesLeft <= 0);
                    return (
                      <button
                        key={powerup.id}
                        type="button"
                        className="powerup-button"
                        onClick={() => handlePowerupUse(powerup.id)}
                        disabled={disabled}
                      >
                        <span>{powerup.label}</span>
                        <span className="badge">{isExploreMode ? "∞" : usesLeft}</span>
                      </button>
                    );
                  })}
                </div>
                <span className="muted">5s</span>
              </div>

              <div className="options-section">
                <button
                  type="button"
                  className="config-button"
                  onClick={handleConfigOpen}
                >
                  {t("config")}
                </button>
              </div>
            </div>
          </div>
        </aside>
      </section>

      {calendarOpen ? (
        <div className="calendar-overlay" onClick={handleCalendarClose}>
          <div
            className={`calendar-panel ${calendarMode}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="calendar-header">
              <span className="label">{t("calendar")}</span>
              <button
                type="button"
                className="icon-button"
                onClick={handleCalendarClose}
                aria-label={t("close")}
              >
                ×
              </button>
            </div>
            <div className="calendar-body">
              <div className="calendar-month">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    play("ui_select");
                    handleCalendarPrevMonth();
                  }}
                  aria-label={t("previous")}
                >
                  ‹
                </button>
                <span className="calendar-month-label">{calendarMonthLabel}</span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    play("ui_select");
                    handleCalendarNextMonth();
                  }}
                  aria-label={t("next")}
                >
                  ›
                </button>
              </div>
              <div className="calendar-weekdays">
                {CALENDAR_WEEKDAYS.map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {showDailySkeleton
                  ? Array.from({ length: 42 }).map((_, index) => (
                      <div key={`day-skel-${index}`} className="calendar-day skeleton" />
                    ))
                  : calendarMonthDays.map((day) => {
                      const dailyEntry = calendarDailyMap.get(day.key) || null;
                      const isToday = day.key === dayKey;
                      const isDoneDaily = Boolean(
                        getCompletionRecord("daily", day.key)?.winningAttempt
                      );
                      const hasDailyLevel = Boolean(dailyEntry?.levelId);
                      const dayDotClass = hasDailyLevel
                        ? isDoneDaily
                          ? "calendar-dot done"
                          : "calendar-dot active"
                        : "calendar-dot empty";
                      const dayLabel = `${formatFullDayLabel(day.key)}${
                        hasDailyLevel ? "" : ` · ${t("calendarNoLevel")}`
                      }`;
                      return (
                        <button
                          key={day.key}
                          type="button"
                          className={`calendar-day ${day.inMonth ? "" : "muted"} ${
                            isToday ? "today" : ""
                          } ${isDoneDaily ? "done" : ""} ${
                            hasDailyLevel ? "has-level" : "disabled"
                          }`}
                          onClick={() => handleCalendarAction("daily", day.key)}
                          disabled={!hasDailyLevel}
                          aria-label={dayLabel}
                          data-calendar-day={day.key}
                          data-has-level={hasDailyLevel ? "true" : "false"}
                        >
                          <span className="calendar-day-label">{day.label}</span>
                          <span className={dayDotClass} />
                        </button>
                      );
                    })}
              </div>
              {!showDailySkeleton &&
              !hasDailyLevels &&
              (calendarStatus === "ready" || calendarStatus === "error") ? (
                <p className="muted">{t("calendarEmpty")}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {configOpen ? (
        <div className="modal-backdrop" onClick={handleConfigClose}>
          <div className="modal config-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{t("config")}</h2>
              <button
                type="button"
                className="icon-button"
                onClick={handleConfigClose}
                aria-label={t("close")}
              >
                ×
              </button>
            </div>
            <div className="config-content">
              <span className="label">{t("music")}</span>
              <select
                className="level-select"
                value={musicTrack}
                onChange={(event) => {
                  const nextTrack = event.target.value;
                  setMusicTrack(nextTrack);
                  startMusic(nextTrack);
                }}
              >
                {musicOptions.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                  </option>
                ))}
              </select>
              <div className="range-row">
                <span className="label">{t("volume")}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={musicVolume}
                  onChange={(event) => {
                    const nextVolume = Number(event.target.value);
                    setMusicVolume(nextVolume);
                    if (nextVolume > 0) {
                      startMusic(musicTrack, nextVolume);
                    }
                  }}
                />
              </div>

              <span className="label">{t("sounds")}</span>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={sfxEnabled}
                  onChange={(event) => setSfxEnabled(event.target.checked)}
                />
                <span>{t("soundToggle")}</span>
              </label>
              <div className="range-row">
                <span className="label">{t("masterVolume")}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={masterVolume}
                  onChange={(event) => setMasterVolume(Number(event.target.value))}
                  disabled={!sfxEnabled}
                />
              </div>
              <div className="range-row">
                <span className="label">{t("sfxVolume")}</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={sfxVolume}
                  onChange={(event) => setSfxVolume(Number(event.target.value))}
                  disabled={!sfxEnabled}
                />
              </div>

              <span className="label">{t("language")}</span>
              <select
                className="level-select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {showModal && resultData ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{isFailed ? t("timeOut") : t("congrats")}</h2>
            <p className="modal-subtitle">
              {t("attempts")}: {resultData.attempts}
            </p>
            <p className="modal-subtitle">
              {t("time")}: {formatTime(resultData.timeMs)}
            </p>
            {!isFailed ? (
              <div className="modal-section">
                <div className="modal-metrics">
                  <div className="stat-row">
                    <span className="label">{t("topTime")}</span>
                    <span className="value">
                      {formatTopPercent(resultData.topTimePercent)}
                    </span>
                  </div>
                  <div className="stat-row">
                    <span className="label">{t("topAttempts")}</span>
                    <span className="value">
                      {formatTopPercent(resultData.topAttemptsPercent)}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
            {!isFailed && gaussianViz ? (
              <div className="modal-section">
                <span className="label">{t("distribution")}</span>
                <div className="gauss-chart">
                  <svg
                    width={gaussianViz.width}
                    height={gaussianViz.height}
                    viewBox={`0 0 ${gaussianViz.width} ${gaussianViz.height}`}
                  >
                    <path className="gauss-path" d={gaussianViz.path} />
                    <line
                      className="gauss-marker"
                      x1={gaussianViz.markerX}
                      x2={gaussianViz.markerX}
                      y1="0"
                      y2={gaussianViz.height}
                    />
                  </svg>
                  <div className="gauss-labels">
                    <span>{formatTime(Math.round(gaussianViz.min))}</span>
                    <span>{formatTime(Math.round(gaussianViz.max))}</span>
                  </div>
                </div>
              </div>
            ) : null}
            {isFailed && (resultData.ruleExplanation || resultData.ruleComarques?.length) ? (
              <div className="modal-section">
                <span className="label">{t("rule")}</span>
                {resultData.ruleExplanation ? (
                  <p className="modal-subtitle">{resultData.ruleExplanation}</p>
                ) : null}
                {resultData.ruleComarques?.length ? (
                  <p className="modal-subtitle">
                    Comarques: {resultData.ruleComarques.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="modal-section">
              <span className="label">{t("yourPath")}</span>
              <ul className="path-list">
                {resultData.playerPath.map((entry, index) => (
                  <li key={`player-${entry.id}-${index}`} className="guess-item">
                    {entry.name}
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-section">
              <span className="label">{t("correctPath")}</span>
              <p className="modal-subtitle">
                {t("shortestCount", { value: resultData.shortestCount })}
              </p>
              <ol className="shortest-list">
                {resultData.shortestPath.map((name, index) => (
                  <li key={`short-${name}-${index}`}>{name}</li>
                ))}
              </ol>
            </div>
            <div className="modal-actions">
              <button className="reset" type="button" onClick={handleStartNext}>
                {t("newGame")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <nav className="bottom-nav" aria-label="Navegació principal">
        <button
          type="button"
          className={`bottom-nav-item${!calendarOpen ? " active" : ""}`}
          onClick={() => setCalendarOpen(false)}
        >
          <span className="bottom-nav-icon">🎮</span>
          <span className="bottom-nav-label">Joc</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-item${calendarOpen ? " active" : ""}`}
          onClick={() => setCalendarOpen(true)}
        >
          <span className="bottom-nav-icon">📅</span>
          <span className="bottom-nav-label">Calendari</span>
        </button>
        <button
          type="button"
          className="bottom-nav-item"
          onClick={() => setConfigOpen(true)}
        >
          <span className="bottom-nav-icon">⚙️</span>
          <span className="bottom-nav-label">Opcions</span>
        </button>
      </nav>
      </div>
    </ThemeProvider>
  );
}
