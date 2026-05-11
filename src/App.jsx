import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { feature, mesh, neighbors as topoNeighbors } from "topojson-client";
import { supabase, supabaseEnabled } from "./lib/supabase.js";
import { buildCentroidMap, buildNeighborSet } from "./lib/geography.js";
import { normalizeName, slugifyName } from "./lib/names.js";
import {
  buildShortestPathCache,
  deserializeShortestPathCache,
  findShortestPath,
  findShortestPathInSet,
  findShortestPathsWithRule
} from "./lib/pathfinding.js";
import { loadSettings, saveSettings } from "./lib/settings.js";
import { DEFAULT_LOCALE, translate } from "./lib/locales.js";
import { TOMAS_THEME_ID } from "./lib/themes.js";
import {
  RULES,
  getRulePayloadKind,
  normalizeRule,
  pickRuleForKey
} from "./lib/rules.js";
import { isDisabledRule } from "./lib/disabledRules.js";
import {
  classifyDifficultyByShortestCount,
  getDifficultyDistanceRange,
  getShortestInternalCount
} from "./lib/difficulty.js";
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
const CALENDAR_WEEKDAYS = ["dl", "dt", "dc", "dj", "dv", "ds", "dg"];
const CALENDAR_CACHE_KEY = "rumb-calendar-cache-v1";
const CALENDAR_CACHE_TTL_MS = 1000 * 60 * 15;
const CALENDAR_AVAILABILITY_COLUMNS = "date, level_id";
const CALENDAR_DETAIL_COLUMNS =
  "date, level_id, start_id, target_id, shortest_path, rule_id, avoid_ids, must_pass_ids, difficulty_id";
const RULE_HISTORY_KEY = "rumb-rule-history-v1";
const RULE_ASSIGNMENTS_KEY = "rumb-rule-assignments-v1";
const RULE_HISTORY_LIMIT = 60;
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
const BRAND_LOGO_SRC = "/logo/logo%20264x264_transparent.png";
const PING_URL = import.meta.env.VITE_PING_URL || "";
const TELEMETRY_QUEUE_KEY = "rumb-telemetry-queue-v1";
const ATTEMPTS_QUEUE_KEY = "rumb-attempts-queue-v1";
const MAX_TELEMETRY_QUEUE = 200;
const MAX_ATTEMPTS_QUEUE = 50;
const LEVEL_STATS_MAX = 200;

function clampVolumeValue(value) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(numeric, 1));
}

function BrandLogo({ className = "" }) {
  return (
    <span
      className={["brand-logo", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <img
        className="brand-logo-image"
        src={BRAND_LOGO_SRC}
        width="264"
        height="264"
        alt=""
        decoding="async"
      />
    </span>
  );
}

const DIFFICULTIES = [
  {
    id: "pixapi",
    labelKey: "difficultyPixapi",
    shortLabel: "pixapi",
    minInternal: 0,
    maxInternal: 3,
    hintsDisabled: false,
    fog: false
  },
  {
    id: "dominguero",
    labelKey: "difficultyDominguero",
    shortLabel: "dominguero",
    minInternal: 4,
    maxInternal: 5,
    hintsDisabled: false,
    fog: false
  },
  {
    id: "rondinaire",
    labelKey: "difficultyRondinaire",
    shortLabel: "rondinaire",
    minInternal: 6,
    maxInternal: 8,
    hintsDisabled: true,
    fog: true
  },
  {
    id: "cap-colla-rutes",
    labelKey: "difficultyCapCollaRutes",
    shortLabel: "cap de colla",
    minInternal: 9,
    maxInternal: Infinity,
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
const EXPLORE_MIN_INTERNAL = 8;
const ATTEMPT_MARGIN_BY_DIFFICULTY = {
  pixapi: 4,
  dominguero: 3,
  rondinaire: 1,
  "cap-colla-rutes": 0
};

const POWERUPS = [
  {
    id: "reveal-next",
    labelKey: "powerupRevealNext",
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
    id: "temp-initials",
    labelKey: "powerupTempInitials",
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
const HARDEST_DIFFICULTY_ID = DIFFICULTIES[DIFFICULTIES.length - 1]?.id || "cap-colla-rutes";

const COMPLETION_MODAL_DELAY_MS = 520;

const MUSIC_TRACKS = [
  {
    id: "segadors",
    label: "els Segadors"
  },
  {
    id: "himne-del-barca",
    label: "Himne del Barça"
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

function getInitialFontSize(initials, centroid, bounds) {
  if (!Array.isArray(centroid) || !Array.isArray(bounds)) return 12;
  const [[x0, y0], [x1, y1]] = bounds;
  const [cx, cy] = centroid;
  if (![x0, y0, x1, y1, cx, cy].every(Number.isFinite)) return 12;

  const letters = Math.max(String(initials || "").length, 1);
  const horizontalRoom = Math.max(1, Math.min(cx - x0, x1 - cx) * 2 * 0.84);
  const verticalRoom = Math.max(1, Math.min(cy - y0, y1 - cy) * 2 * 0.82);
  const desired = Math.min(x1 - x0, y1 - y0) * 0.52;
  const widthLimit = horizontalRoom / (letters * 0.68);
  const safeSize = Math.min(desired, widthLimit, verticalRoom, 28);

  if (!Number.isFinite(safeSize)) return 12;
  return safeSize < 12 ? Math.max(8, safeSize) : Math.max(12, safeSize);
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return "\u2014";
  const total = Math.max(ms, 0);
  const seconds = Math.floor(total / 1000);
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

function formatTopPercent(value) {
  if (!Number.isFinite(value)) return "\u2014";
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

function calendarAvailabilityEntryFromRow(row) {
  const date = normalizeDayKey(row?.date);
  if (!date) return null;
  return {
    date,
    levelId: row.level_id || row.levelId || null,
    level: row.level || null
  };
}

function calendarDetailEntryFromRow(row) {
  const base = calendarAvailabilityEntryFromRow(row);
  if (!base?.levelId) return base;
  return {
    ...base,
    level: {
      id: row.level_id || row.levelId,
      start_id: row.start_id,
      target_id: row.target_id,
      shortest_path: row.shortest_path,
      rule_id: row.rule_id,
      avoid_ids: row.avoid_ids,
      must_pass_ids: row.must_pass_ids,
      difficulty_id: row.difficulty_id
    }
  };
}

function mergeCalendarEntries(currentEntries, incomingEntries) {
  const byDate = new Map();
  currentEntries.forEach((entry) => {
    if (entry?.date) byDate.set(entry.date, entry);
  });
  incomingEntries.forEach((entry) => {
    if (!entry?.date) return;
    const previous = byDate.get(entry.date) || {};
    byDate.set(entry.date, {
      ...previous,
      ...entry,
      levelId: entry.levelId || previous.levelId || null,
      level: entry.level || previous.level || null
    });
  });
  return [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function cloneRuleForSnapshot(rule) {
  if (!rule) return null;
  return {
    ...rule,
    comarques: Array.isArray(rule.comarques) ? [...rule.comarques] : [],
    comarcaIds: Array.isArray(rule.comarcaIds) ? [...rule.comarcaIds] : [],
    tags: Array.isArray(rule.tags) ? [...rule.tags] : []
  };
}

function normalizeLevelSnapshot(snapshot) {
  if (!snapshot?.startId || !snapshot?.targetId) return null;
  const shortestPath = Array.isArray(snapshot.shortestPath)
    ? snapshot.shortestPath.filter(Boolean)
    : [];
  if (!shortestPath.length) return null;
  const shortestPaths = Array.isArray(snapshot.shortestPaths)
    ? snapshot.shortestPaths
        .filter((path) => Array.isArray(path) && path.length)
        .map((path) => path.filter(Boolean))
    : [];
  return {
    mode: snapshot.mode || "normal",
    difficulty: snapshot.difficulty || HARDEST_DIFFICULTY_ID,
    dayKey: snapshot.dayKey || null,
    startId: snapshot.startId,
    targetId: snapshot.targetId,
    shortestPath,
    shortestPaths: shortestPaths.length ? shortestPaths : [shortestPath],
    rule: cloneRuleForSnapshot(snapshot.rule)
  };
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

function getLatestUnlockedCalendarDay(entries, maxDayKey) {
  return entries.find((entry) => entry.date <= maxDayKey)?.date || "";
}

function serializeAdjacency(adjacencyMap) {
  return [...adjacencyMap.entries()].map(([id, neighbors]) => [id, [...neighbors]]);
}

function deserializeAdjacency(list) {
  if (!Array.isArray(list)) return new Map();
  return new Map(list.map(([id, neighbors]) => [id, new Set(neighbors || [])]));
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
    return {
      ...parsed,
      daily: Array.isArray(parsed.daily) ? parsed.daily : []
    };
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
  if (typeof window === "undefined") return { daily: [] };
  const raw = localStorage.getItem(RULE_HISTORY_KEY);
  if (!raw) return { daily: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      daily: Array.isArray(parsed?.daily) ? parsed.daily : []
    };
  } catch {
    return { daily: [] };
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
  if (typeof window === "undefined") return { daily: {} };
  const raw = localStorage.getItem(RULE_ASSIGNMENTS_KEY);
  if (!raw) return { daily: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      daily: parsed?.daily && typeof parsed.daily === "object" ? parsed.daily : {}
    };
  } catch {
    return { daily: {} };
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

function getMaxAttemptsForDifficulty(difficultyId, shortestCount) {
  const optimal = Math.max(Number(shortestCount) || 0, 0);
  if (!optimal) return null;
  const margin = ATTEMPT_MARGIN_BY_DIFFICULTY[difficultyId] ?? 2;
  return Math.max(optimal + margin, 1);
}

function formatRuleDifficulty(value) {
  if (value === "easy") return "Fàcil";
  if (value === "medium") return "Mitjà";
  if (value === "hard") return "Difícil";
  if (value === "expert") return "Expert";
  return "\u2014";
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getRouteAccuracy(result) {
  if (result?.failed) return 0;
  const optimal = Math.max(Number(result?.shortestCount) || 0, 0);
  const attempts = Math.max(Number(result?.attempts) || 0, optimal);
  if (!optimal || !attempts) return 100;
  return Math.max(0, Math.min(100, Math.round((optimal / attempts) * 100)));
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

function hasPathViaNode(startId, targetId, nodeId, adjacency, allowedSet) {
  if (!allowedSet.has(nodeId)) return false;
  const toNode = findShortestPathInSet(startId, nodeId, adjacency, allowedSet);
  if (!toNode.length) return false;
  const toTarget = findShortestPathInSet(nodeId, targetId, adjacency, allowedSet);
  return toTarget.length > 0;
}

function resolveRule(def, ctx) {
  if (def.kind !== "avoid-random") return def;
  const pool = ctx.comarcaNames.filter(
    (name) => name !== ctx.startName && name !== ctx.targetName
  );
  const pick = pool.length ? pickRandom(pool, ctx.rng) : ctx.comarcaNames[0];
  return {
    id: `${def.id}-${slugifyName(pick)}`,
    kind: "avoid",
    label: `No pots passar per ${pick}.`,
    comarques: [pick],
    difficulty: "medium"
  };
}

function prepareRule(def, ctx) {
  const resolved = resolveRule(def, ctx);
  const difficulty = resolved.difficulty || "medium";
  const tags = resolved.tags || getRuleTags(def);
  const names = resolved.comarques || [];
  const comarcaIds = names
    .map((name) => ctx.normalizedToId.get(normalizeName(name)))
    .filter(Boolean);
  return { ...resolved, comarcaIds, difficulty, tags };
}

function buildRuleFromLevel(level, comarcaById, normalizedToId) {
  if (!level?.rule_id) return null;
  if (isDisabledRule(level.rule_id)) return null;
  const base = RULE_DEFS.find((def) => def.id === level.rule_id) || null;
  if (!base || isDisabledRule(base)) return null;
  const avoidIds = Array.isArray(level.avoid_ids) ? level.avoid_ids : [];
  const mustPassIds = Array.isArray(level.must_pass_ids) ? level.must_pass_ids : [];
  const kind = getRulePayloadKind(level.rule_id, avoidIds, mustPassIds, RULE_DEFS);
  let comarcaIds = kind === "avoid" ? avoidIds : mustPassIds;
  if (!comarcaIds.length && base?.comarques?.length && normalizedToId) {
    comarcaIds = base.comarques
      .map((name) => normalizedToId.get(normalizeName(name)))
      .filter(Boolean);
  }
  if (!comarcaIds.length) return null;
  const comarques = comarcaIds
    .map((id) => comarcaById.get(id)?.properties.name)
    .filter(Boolean);
  if (!comarques.length) return null;
  let label = base?.label;
  if (!label) {
    const name = comarques[0];
    if (kind === "avoid") {
      label = `No pots passar per ${name}.`;
    } else {
      label = `Has de passar per ${name}.`;
    }
  }
  const difficulty = "medium";
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
  const [shortestPaths, setShortestPaths] = useState([]);
  const [activeRule, setActiveRule] = useState(null);
  const [resultData, setResultData] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [completionCelebrating, setCompletionCelebrating] = useState(false);
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
    sfxVolume,
    setSfxVolume
  } = useSound();
  const [musicEnabled, setMusicEnabled] = useState(initialSettings.musicEnabled);
  const [musicVolume, setMusicVolume] = useState(initialSettings.musicVolume);
  const [musicTrack, setMusicTrack] = useState(initialSettings.musicTrack);
  const [activeTheme, setActiveTheme] = useState(initialSettings.theme);
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
  const [calendarMode, setCalendarMode] = useState("daily");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [calendarDaily, setCalendarDaily] = useState([]);
  const [calendarStatus, setCalendarStatus] = useState("idle");
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [calendarSelection, setCalendarSelection] = useState(null);
  const [calendarLoadingDayKey, setCalendarLoadingDayKey] = useState(null);
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
  const completionModalTimerRef = useRef(null);
  const guessInputRef = useRef(null);
  const lastGuessRef = useRef(null);
  const userZoomedRef = useRef(false);
  const weatherFetchRef = useRef(null);
  const playerIdRef = useRef(getPlayerId());
  const supabaseUserIdRef = useRef(null);
  const calendarApplyRef = useRef(null);
  const calendarResetRef = useRef(null);
  const calendarAutoSetRef = useRef({ daily: false });
  const calendarLoadingRef = useRef(false);
  const calendarDetailRequestsRef = useRef(new Map());
  const pendingRepeatSnapshotRef = useRef(null);
  const calendarCountsRef = useRef({ daily: 0 });
  const calendarMonthRef = useRef(calendarMonth);
  const telemetryFlushRef = useRef(false);
  const attemptsFlushRef = useRef(false);
  const completionMigrationRef = useRef(false);
  const pendingStartNextRef = useRef(null);

  const leaderboardEndpoint = import.meta.env.VITE_LEADERBOARD_URL || "";
  const isSupabaseReady = useMemo(
    () => Boolean(supabaseEnabled && supabase && !supabaseBlocked),
    [supabaseBlocked]
  );
  const isExploreMode = gameMode === "explore";
  const isTimedMode = gameMode === "timed";
  const isDailyMode = gameMode === "daily";
  const isFixedMode = isDailyMode;
  const shouldLoadCalendar = isSupabaseReady || calendarOpen || isDailyMode;
  const routeDifficulty = classifyDifficultyByShortestCount(
    shortestPath.length ? Math.max(shortestPath.length - 2, 0) : 0
  );
  const activeDifficulty = isFixedMode ? routeDifficulty : difficulty;
  const difficultyConfig = useMemo(() => {
    return DIFFICULTIES.find((entry) => entry.id === activeDifficulty) || DIFFICULTIES[0];
  }, [activeDifficulty]);
  const timeLeftMs = Math.max(timeLimitMs - elapsedMs - timePenaltyMs, 0);
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
  const activeDayKey =
    gameMode === "daily" && calendarSelection?.mode === "daily"
      ? calendarSelection.key
      : dayKey;
  const activeCalendarEntry = useMemo(() => {
    if (!calendarSelection) return null;
    if (calendarSelection.mode === "daily") {
      return calendarDailyMap.get(calendarSelection.key) || null;
    }
    return null;
  }, [calendarSelection, calendarDailyMap]);
  const isCalendarModeActive = Boolean(
    calendarSelection &&
      calendarSelection.mode === gameMode &&
      (activeCalendarEntry?.level || activeCalendarEntry?.levelId)
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
  const t = useMemo(() => (key, vars = {}) => translate(DEFAULT_LOCALE, key, vars), []);
  const playManifestSfx = useCallback(
    (kind, volumeMul = 1) => {
      if (!audioManifest?.sfx?.[kind]) return;
      if (!audioManagerRef.current) return;
      if (!sfxEnabled || sfxVolume <= 0) return;
      const volume = clampVolumeValue(sfxVolume * volumeMul);
      if (volume <= 0) return;
      audioManagerRef.current.playSfx(kind, activeTheme, volume);
    },
    [activeTheme, audioManifest, sfxEnabled, sfxVolume]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("rumb-mode", gameMode);
    localStorage.setItem("rumb-difficulty", difficulty);
    localStorage.setItem(ACTIVE_THEME_KEY, activeTheme);
  }, [gameMode, difficulty, activeTheme]);

  useEffect(() => {
    supabaseUserIdRef.current = supabaseUserId;
  }, [supabaseUserId]);

  useEffect(() => {
    saveSettings({
      theme: activeTheme,
      musicEnabled,
      musicVolume,
      musicTrack,
      sfxEnabled,
      sfxVolume
    });
  }, [activeTheme, musicEnabled, musicVolume, musicTrack, sfxEnabled, sfxVolume]);

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
    if (musicTrack !== "random" && !ids.includes(musicTrack)) {
      setMusicTrack("random");
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
    if (!optionsOpen || typeof window === "undefined") return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        playManifestSfx("close", 0.75);
        setOptionsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [optionsOpen, playManifestSfx]);

  useEffect(() => () => clearCompletionModalTimer(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (Object.keys(dailyResults).length > 60) {
      setDailyResults((prev) => trimResults(prev, 60));
      return;
    }
    localStorage.setItem(DAILY_RESULTS_KEY, JSON.stringify(dailyResults));
  }, [dailyResults]);

  useEffect(() => {
    if (completionMigrationRef.current) return;
    const hasRecords = completionRecords && Object.keys(completionRecords).length > 0;
    const hasLegacy = Object.keys(dailyResults).length > 0;
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
    completionMigrationRef.current = true;
    setCompletionRecords(next);
  }, [completionRecords, dailyResults]);

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
      if (!PING_URL) {
        setIsOnline(navigator.onLine !== false);
        return;
      }
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
    if (!isTimedMode || !isCountdownActive || countdownValue === null) return;
    playManifestSfx("countdown", 0.55);
  }, [isTimedMode, isCountdownActive, countdownValue, playManifestSfx]);

  useEffect(() => {
    if (!isTimedMode || !isCountdownActive) return;
    if (countdownValue === null) return;
    const timer = setTimeout(() => {
      if (countdownValue <= 1) {
        setIsCountdownActive(false);
        setCountdownValue(null);
        setStartedAt(Date.now());
        return;
      }
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
          maxAttempts,
          timeMs: elapsedMs,
          playerPath: guessHistory,
          ruleLabel: activeRule?.label || t("noRule"),
          ruleDifficulty: activeRule?.difficulty || null,
          ruleExplanation: activeRule?.explanation || "",
          ruleComarques: activeRule?.comarques || [],
          shortestPath: [],
          shortestCount: 0,
          distance: 0,
          mode: gameMode,
          difficulty: activeDifficulty,
          streak: displayStreak,
          levelSnapshot: buildCurrentLevelSnapshot()
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
    play,
    t
  ]);

  useEffect(() => {
    if (!comarques.length || !adjacency.size) return;
    if (isCalendarModeActive) return;
    const forceNew = pendingStartNextRef.current;
    pendingStartNextRef.current = null;
    resetGame(forceNew ?? false);
  }, [comarques, adjacency, gameMode, activeDifficulty, isCalendarModeActive]);

  useEffect(() => {
    const snapshot = pendingRepeatSnapshotRef.current;
    if (!snapshot || !comarques.length || !adjacency.size) return;
    const targetMode = snapshot.mode || gameMode;
    const targetDifficulty = snapshot.difficulty || difficulty;
    const modeReady = targetMode === gameMode;
    const difficultyReady = targetMode === "daily" || targetDifficulty === difficulty;
    if (!modeReady || !difficultyReady) return;
    pendingRepeatSnapshotRef.current = null;
    applyRepeatSnapshot(snapshot);
  }, [comarques, adjacency, gameMode, difficulty]);

  useEffect(() => {
    if (!calendarSelection || !activeCalendarEntry?.level) return;
    if (calendarSelection.mode !== gameMode) return;
    const key = `${calendarSelection.mode}:${calendarSelection.key}`;
    const forceReset = calendarResetRef.current === key;
    if (calendarApplyRef.current === key && !forceReset) return;
    const record = getCompletionRecord(calendarSelection.mode, calendarSelection.key);
    const result = forceReset ? null : record?.winningAttempt || null;
    if (
      !forceReset &&
      !result &&
      gameMode === "daily" &&
      (attempts > 0 || guessHistory.length > 0)
    ) {
      calendarApplyRef.current = key;
      return;
    }
    applyCalendarLevel(activeCalendarEntry.level, {
      result,
      showResult: Boolean(result)
    });
    if (forceReset) {
      calendarResetRef.current = null;
    }
    calendarApplyRef.current = key;
  }, [
    calendarSelection,
    activeCalendarEntry,
    gameMode,
    completionRecords,
    attempts,
    guessHistory.length
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
      const cached = readCalendarCache();
      const hasCache = Boolean(cached?.daily?.length);
      if (hasCache && isMounted) {
        setCalendarDaily(cached.daily || []);
        setCalendarStatus("ready");
        setCalendarLoaded(true);
      }
      if (!canReadCalendar) {
        if (isMounted && !hasCache) setCalendarStatus("error");
        return;
      }
      calendarLoadingRef.current = true;
      setCalendarStatus(hasCache ? "refreshing" : "loading");
      try {
        const dailyRes = await withRetry(
          () =>
            supabase
              .from("calendar_daily")
              .select(CALENDAR_AVAILABILITY_COLUMNS)
              .lte("date", dayKey)
              .order("date", { ascending: false })
              .range(0, 1499),
          { retries: 2, backoffMs: 500 }
        );
        if (dailyRes.error) throw dailyRes.error;

        const dailyRows = Array.isArray(dailyRes.data) ? dailyRes.data : [];
        const dailyEntries = dailyRows
          .map((row) => calendarAvailabilityEntryFromRow(row))
          .filter(Boolean);
        const mergedEntries = mergeCalendarEntries(cached?.daily || [], dailyEntries);
        if (isMounted) {
          setCalendarDaily(mergedEntries);
          setCalendarStatus("ready");
          setCalendarLoaded(true);
          writeCalendarCache({ daily: mergedEntries });
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
  }, [shouldLoadCalendar, calendarLoaded, dayKey]);

  useEffect(() => {
    if (!calendarLoaded || !calendarDaily.length) return;
    writeCalendarCache({ daily: calendarDaily });
  }, [calendarLoaded, calendarDaily]);

  useEffect(() => {
    if (gameMode === "daily") return;
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
    calendarCountsRef.current = {
      daily: calendarDaily.length
    };
    const monthRef = calendarMonthRef.current;
    if (calendarMode === "daily" && !calendarAutoSetRef.current.daily) {
      const latestDay = getLatestUnlockedCalendarDay(calendarDaily, dayKey);
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
      const latestDay = getLatestUnlockedCalendarDay(calendarDaily, dayKey);
      if (latestDay) {
        const parsed = new Date(`${latestDay}T00:00:00`);
        if (!Number.isNaN(parsed.valueOf())) {
          setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
        }
      }
    }
  }, [calendarLoaded, calendarMode, calendarDaily, dayKey]);

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
          if (typeof playerData.music_enabled === "boolean") {
            setMusicEnabled(playerData.music_enabled);
          }
          if (typeof playerData.music_volume === "number") {
            setMusicVolume(clampVolumeValue(playerData.music_volume));
          }
          if (typeof playerData.music_track === "string") {
            setMusicTrack(playerData.music_track);
          }
          if (typeof playerData.sfx_enabled === "boolean") {
            setSfxEnabled(playerData.sfx_enabled);
          }
          if (typeof playerData.sfx_volume === "number") {
            setSfxVolume(clampVolumeValue(playerData.sfx_volume));
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

  const completedPathSet = useMemo(() => {
    if (!isComplete || !pathInGuesses.length) return new Set();
    return new Set(pathInGuesses);
  }, [isComplete, pathInGuesses]);

  const ruleStatus = useMemo(() => {
    return evaluateRule(activeRule, {
      startId,
      targetId,
      adjacency,
      allowedSet,
      guessedSet
    });
  }, [activeRule, startId, targetId, adjacency, allowedSet, guessedSet]);

  const optimalCount = useMemo(
    () => (shortestPath.length ? Math.max(shortestPath.length - 2, 0) : null),
    [shortestPath]
  );
  const currentPathCount = useMemo(
    () => (pathInGuesses.length ? Math.max(pathInGuesses.length - 2, 0) : null),
    [pathInGuesses]
  );
  const maxAttempts = useMemo(() => {
    if (isExploreMode || optimalCount === null) return null;
    return getMaxAttemptsForDifficulty(activeDifficulty, optimalCount);
  }, [activeDifficulty, isExploreMode, optimalCount]);

  function resolveShortestPaths(start, target, rule, fallbackPath = []) {
    const allIds = comarques.map((featureItem) => featureItem.properties.id);
    const fallback = Array.isArray(fallbackPath) ? fallbackPath : [];
    if (!start || !target || !adjacency.size || !allIds.length) {
      return {
        primaryPath: fallback,
        paths: fallback.length ? [fallback] : [],
        distance: fallback.length ? fallback.length - 1 : Infinity,
        truncated: false,
        astarConsistent: true
      };
    }
    const result = findShortestPathsWithRule(start, target, adjacency, rule, allIds, {
      cache: shortestPathCache,
      centroidMap,
      maxPaths: 64
    });
    const primaryPath = result.primaryPath.length ? result.primaryPath : fallback;
    return {
      ...result,
      primaryPath,
      paths: result.paths.length ? result.paths : primaryPath.length ? [primaryPath] : []
    };
  }

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

    const mapped = comarques.map((featureItem) => {
      const initials = getInitials(featureItem.properties.name);
      const centroid = generator.centroid(featureItem);
      const bounds = generator.bounds(featureItem);
      return {
        id: featureItem.properties.id,
        name: featureItem.properties.name,
        path: generator(featureItem),
        centroid,
        bounds,
        initials,
        initialFontSize: getInitialFontSize(initials, centroid, bounds)
      };
    });

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
      const isCompletionPath = completedPathSet.has(featureItem.id);
      const isRevealed = isStart || isTarget || isGuessed || isReplay || isPowerReveal;
      const isNeighbor =
        showNeighborHintActive &&
        !isRevealed &&
        neighborSet.has(featureItem.id) &&
        !isStart &&
        !isTarget;
      const isHidden = false;
      const isOutline = showInitialsActive && isHidden;

      const classes = [
        "comarca",
        isHidden && "is-hidden",
        isOutline && "is-outline",
        isGuessed && "is-guessed",
        isStart && "is-start",
        isTarget && "is-target",
        isCurrent && "is-current",
        isCompletionPath && "is-complete-route",
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
    completedPathSet,
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
    if (isComplete || isFailed || isExploreMode || !maxAttempts) return;
    if (attempts < maxAttempts) return;
    if (pathInGuesses.length && ruleStatus.satisfied) return;
    finishFailedByAttemptLimit(attempts, guessHistory, pathInGuesses);
  }, [
    isComplete,
    isFailed,
    isExploreMode,
    maxAttempts,
    attempts,
    guessHistory,
    pathInGuesses,
    ruleStatus
  ]);

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
      week_key: null,
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

  function getAvailableMusicTrackIds() {
    if (audioManifest?.music) return Object.keys(audioManifest.music);
    return MUSIC_TRACKS.map((track) => track.id);
  }

  function resolveMusicTrack(trackId = musicTrack) {
    const ids = getAvailableMusicTrackIds();
    if (!ids.length) return "";
    if (trackId === "random" || !ids.includes(trackId)) {
      return pickRandom(ids);
    }
    return trackId;
  }

  function startMusic(trackId = musicTrack, volumeOverride, options = {}) {
    if (!musicEnabled && !options.force) return;
    if (audioManagerRef.current) {
      const resolvedTrackId = resolveMusicTrack(trackId);
      if (!resolvedTrackId) return;
      const nextVolume =
        typeof volumeOverride === "number" && Number.isFinite(volumeOverride)
          ? volumeOverride
          : musicVolume;
      if (nextVolume <= 0) {
        stopMusic();
        return;
      }
      const playPromise = audioManagerRef.current.playMusic(
        resolvedTrackId,
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

  function clearCompletionModalTimer() {
    if (completionModalTimerRef.current) {
      clearTimeout(completionModalTimerRef.current);
      completionModalTimerRef.current = null;
    }
  }

  function revealCompletionModalAfterMap() {
    clearCompletionModalTimer();
    setCompletionCelebrating(true);
    completionModalTimerRef.current = setTimeout(() => {
      completionModalTimerRef.current = null;
      setCompletionCelebrating(false);
      setShowModal(true);
    }, COMPLETION_MODAL_DELAY_MS);
  }

  function handleMusicToggle(nextEnabled) {
    playManifestSfx("toggle", 0.55);
    setMusicEnabled(nextEnabled);
    if (!nextEnabled) {
      stopMusic();
      return;
    }
    const nextVolume = musicVolume > 0 ? musicVolume : 1;
    if (musicVolume <= 0) setMusicVolume(nextVolume);
    startMusic(musicTrack, nextVolume, { force: true });
  }

  function handleSfxToggle(nextEnabled) {
    if (sfxEnabled || nextEnabled) {
      playManifestSfx("toggle", 0.55);
    }
    setSfxEnabled(nextEnabled);
    if (!nextEnabled) return;
    if (sfxVolume <= 0) setSfxVolume(1);
  }

  function applyCalendarLevel(level, options = {}) {
    if (!level) return;
    const { result, showResult } = options;
    const start = level.start_id;
    const target = level.target_id;
    const rule = buildRuleFromLevel(level, comarcaById, normalizedToId);
    const storedShortest = Array.isArray(level.shortest_path) ? level.shortest_path : [];
    const pathResult = resolveShortestPaths(start, target, rule, storedShortest);
    const nextShortest = pathResult.primaryPath;
    const nextShortestPaths = pathResult.paths;
    const playerPath = Array.isArray(result?.playerPath) ? result.playerPath : [];
    const levelDifficulty =
      level.difficulty_id ||
      classifyDifficultyByShortestCount(Math.max(nextShortest.length - 2, 0));
    const basePowerups = getPowerupUses(levelDifficulty);

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
    clearCompletionModalTimer();
    setShowModal(Boolean(result && showResult));
    setCompletionCelebrating(false);
    setResultData(result || null);
    setShortestPath(nextShortest);
    setShortestPaths(nextShortestPaths);
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
          week_key: null
        }
      );
    }
  }

  function getCompletionRecord(mode, key) {
    if (!mode || !key) return null;
    return completionRecords[`${mode}:${key}`] || null;
  }

  function openCompletionModal(record, context = {}) {
    if (!record?.winningAttempt) return;
    const dayKeyForRecord = record.dayKey || context.key || null;
    const calendarEntry =
      context.mode === "daily" || record.mode === "daily"
        ? calendarDailyMap.get(dayKeyForRecord)
        : null;
    const level = calendarEntry?.level || null;
    const levelRule = level ? buildRuleFromLevel(level, comarcaById, normalizedToId) : null;
    const levelSnapshot = level
      ? (() => {
          const storedShortest = Array.isArray(level.shortest_path)
            ? level.shortest_path
            : [];
          const pathResult = resolveShortestPaths(
            level.start_id,
            level.target_id,
            levelRule,
            storedShortest
          );
          return normalizeLevelSnapshot({
            mode: record.mode || context.mode || "daily",
            difficulty:
              level.difficulty_id ||
              classifyDifficultyByShortestCount(pathResult.primaryPath),
            dayKey: dayKeyForRecord,
            startId: level.start_id,
            targetId: level.target_id,
            shortestPath: pathResult.primaryPath,
            shortestPaths: pathResult.paths,
            rule: levelRule
          });
        })()
      : normalizeLevelSnapshot(record.winningAttempt.levelSnapshot);
    const levelStartName = level?.start_id
      ? comarcaById.get(level.start_id)?.properties.name || ""
      : "";
    const levelTargetName = level?.target_id
      ? comarcaById.get(level.target_id)?.properties.name || ""
      : "";
    const payload = {
      ...record.winningAttempt,
      mode: record.mode || context.mode || record.winningAttempt.mode || "daily",
      dayKey: dayKeyForRecord,
      startName: record.winningAttempt.startName || levelStartName,
      targetName: record.winningAttempt.targetName || levelTargetName,
      ruleLabel:
        record.winningAttempt.ruleLabel || levelRule?.label || record.winningAttempt.rule || "",
      ruleExplanation:
        record.winningAttempt.ruleExplanation || levelRule?.explanation || "",
      ruleComarques:
        record.winningAttempt.ruleComarques || levelRule?.comarques || [],
      shortestPath: record.shortestPath || record.winningAttempt.shortestPath || [],
      shortestCount:
        typeof record.shortestCount === "number"
          ? record.shortestCount
          : record.winningAttempt.shortestCount || 0,
      difficulty:
        record.winningAttempt.difficulty ||
        level?.difficulty_id ||
        classifyDifficultyByShortestCount(record.shortestCount || record.winningAttempt.shortestCount || 0),
      levelSnapshot
    };
    if (level) {
      applyCalendarLevel(level, { result: payload, showResult: false });
    }
    clearCompletionModalTimer();
    setCompletionCelebrating(false);
    setResultData(payload);
    setIsFailed(Boolean(payload.failed));
    setShowModal(true);
  }

  function beginTimedCountdown() {
    setCountdownValue(5);
    setIsCountdownActive(true);
    setStartedAt(null);
  }

  function buildCurrentLevelSnapshot(overrides = {}) {
    return normalizeLevelSnapshot({
      mode: overrides.mode || gameMode,
      difficulty: overrides.difficulty || activeDifficulty,
      dayKey: overrides.dayKey ?? (isDailyMode ? activeDayKey : null),
      startId: overrides.startId || startId,
      targetId: overrides.targetId || targetId,
      shortestPath: overrides.shortestPath || shortestPath,
      shortestPaths: overrides.shortestPaths || shortestPaths,
      rule: overrides.rule === undefined ? activeRule : overrides.rule
    });
  }

  function resetGame(forceNew = false) {
    if (!comarques.length) return;
    if (guessFeedbackTimerRef.current) clearTimeout(guessFeedbackTimerRef.current);
    setGuessFeedback(null);
    lastGuessRef.current = null;
    const ids = comarques.map((featureItem) => featureItem.properties.id);
    const todayKey = getDayKey();
    const baseSeed = gameMode === "daily" ? todayKey : null;
    const seed = baseSeed && !forceNew ? baseSeed : null;
    const rng = seed ? mulberry32(hashString(seed)) : Math.random;
    const targetRange = isDailyMode
      ? { minInternal: DAILY_MIN_INTERNAL, maxInternal: Infinity }
      : isExploreMode
        ? { minInternal: EXPLORE_MIN_INTERNAL, maxInternal: Infinity }
        : getDifficultyDistanceRange(activeDifficulty);
    const comarcaNames = comarques.map((featureItem) => featureItem.properties.name);
    const pool = RULE_DEFS;
    const isPathInTargetRange = (path) => {
      const internalCount = getShortestInternalCount(path);
      return (
        internalCount >= targetRange.minInternal &&
        internalCount <= targetRange.maxInternal
      );
    };
    const fixedMode = isDailyMode;
    const fixedKey = isDailyMode ? activeDayKey : null;
    const previousPairs =
      forceNew && !fixedMode && startId && targetId
        ? new Set([`${startId}:${targetId}`, `${targetId}:${startId}`])
        : null;
    let fixedRuleDef = null;
    if (!isExploreMode && fixedMode && fixedKey) {
      const assignments = readRuleAssignments();
      const history = readRuleHistory();
      const modeKey = "daily";
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
    let nextShortestPaths = [];
    let selectedRule = null;
    let attemptsLeft = 500;

    while (attemptsLeft > 0) {
      attemptsLeft -= 1;
      const candidateStart = pickRandom(ids, rng);
      const candidateTarget = pickRandom(ids, rng);
      if (candidateTarget === candidateStart) continue;
      if (previousPairs?.has(`${candidateStart}:${candidateTarget}`)) continue;
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
      const pathResult = findShortestPathsWithRule(
        candidateStart,
        candidateTarget,
        adjacency,
        candidateRule,
        ids,
        { cache: shortestPathCache, centroidMap, maxPaths: 64 }
      );
      const path = pathResult.primaryPath;
      const basePath =
        !isExploreMode && candidateRule
          ? findShortestPath(candidateStart, candidateTarget, adjacency, shortestPathCache)
          : [];
      if (!path.length) continue;
      if (!isExploreMode && candidateRule && basePath.length && path.length <= basePath.length) {
        continue;
      }
      if (!isPathInTargetRange(path)) continue;
      start = candidateStart;
      target = candidateTarget;
      nextShortest = path;
      nextShortestPaths = pathResult.paths;
      selectedRule = candidateRule;
      break;
    }

    if (!start || !target) {
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
        const pathResult = findShortestPathsWithRule(
          candidateStart,
          candidateTarget,
          adjacency,
          candidateRule,
          ids,
          { cache: shortestPathCache, centroidMap, maxPaths: 64 }
        );
        const path = pathResult.primaryPath;
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
        if (!isPathInTargetRange(path)) continue;
        start = candidateStart;
        target = candidateTarget;
        nextShortest = path;
        nextShortestPaths = pathResult.paths;
        selectedRule = candidateRule;
        break;
      }
    }
    if (!start || !target) {
      for (const candidateStart of ids) {
        for (const candidateTarget of ids) {
          if (candidateTarget === candidateStart) continue;
          const neighbors = adjacency.get(candidateStart);
          if (neighbors && neighbors.has(candidateTarget)) continue;
          const pathResult = findShortestPathsWithRule(
            candidateStart,
            candidateTarget,
            adjacency,
            null,
            ids,
            { cache: shortestPathCache, centroidMap, maxPaths: 64 }
          );
          if (!pathResult.primaryPath.length || !isPathInTargetRange(pathResult.primaryPath)) {
            continue;
          }
          start = candidateStart;
          target = candidateTarget;
          nextShortest = pathResult.primaryPath;
          nextShortestPaths = pathResult.paths;
          break;
        }
        if (start && target) break;
      }
      if (!start || !target) {
        start = ids[0];
        target = ids[1] || ids[0];
        const pathResult = findShortestPathsWithRule(start, target, adjacency, null, ids, {
          cache: shortestPathCache,
          centroidMap,
          maxPaths: 64
        });
        nextShortest = pathResult.primaryPath;
        nextShortestPaths = pathResult.paths;
      }
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
        const candidatePathResult = findShortestPathsWithRule(
          start,
          target,
          adjacency,
          candidateRule,
          ids,
          { cache: shortestPathCache, centroidMap, maxPaths: 64 }
        );
        const candidatePath = candidatePathResult.primaryPath;
        const basePath = findShortestPath(start, target, adjacency, shortestPathCache);
        if (
          candidatePath.length &&
          basePath.length &&
          candidatePath.length > basePath.length &&
          isPathInTargetRange(candidatePath)
        ) {
          selectedRule = candidateRule;
          nextShortest = candidatePath;
          nextShortestPaths = candidatePathResult.paths;
        }
      }
    }
    if (!nextShortestPaths.length && nextShortest.length) {
      nextShortestPaths = [nextShortest];
    }
    const generatedDifficulty = classifyDifficultyByShortestCount(nextShortest);

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
    const basePowerups = getPowerupUses(generatedDifficulty);
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
    clearCompletionModalTimer();
    setShowModal(false);
    setCompletionCelebrating(false);
    setResultData(null);
    setShortestPath(nextShortest);
    setShortestPaths(nextShortestPaths);
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
        week_key: null,
        difficulty_id: generatedDifficulty,
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
        week_key: null
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
      playManifestSfx("error");
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
            ruleLabel: activeRule?.label || t("noRule"),
            ruleDifficulty: activeRule?.difficulty || null,
            shortestPath: [],
            shortestCount: 0,
            distance: 0,
            mode: gameMode,
            difficulty: generatedDifficulty,
            streak: displayStreak,
            levelSnapshot: buildCurrentLevelSnapshot()
          }
        );
      }
      return;
    }
    playManifestSfx("powerup", 0.85);
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

  function finishFailedByAttemptLimit(nextAttempts, nextGuessHistory, nextPath = []) {
    if (isComplete || isFailed) return;
    const totalTime = startedAt ? Date.now() - startedAt : elapsedMs;
    const shortestCount = shortestPath.length ? Math.max(shortestPath.length - 2, 0) : 0;
    const resultDifficulty = classifyDifficultyByShortestCount(shortestCount);
    const foundCount = nextPath.length ? Math.max(nextPath.length - 2, 0) : 0;
    const shortestNames = shortestPath
      .filter((id) => id !== startId && id !== targetId)
      .map((pathId) => comarcaById.get(pathId)?.properties.name || pathId);
    playManifestSfx("error");
    play("level_lose", { bypassCooldown: true });
    setIsFailed(true);
    setShowModal(true);
    setCompletionCelebrating(false);
    setResultData({
      failed: true,
      failureReason: "attempts",
      attempts: nextAttempts,
      maxAttempts,
      timeMs: totalTime,
      playerPath: nextGuessHistory,
      shortestPath: shortestNames,
      shortestCount,
      foundCount,
      distance: Math.max(foundCount - shortestCount, 0),
      startName: startId ? comarcaById.get(startId)?.properties.name || "" : "",
      targetName: targetId ? comarcaById.get(targetId)?.properties.name || "" : "",
      ruleLabel: activeRule?.label || t("noRule"),
      ruleDifficulty: activeRule?.difficulty || null,
      ruleExplanation: activeRule?.explanation || "",
      ruleComarques: activeRule?.comarques || [],
      hintsUsed,
      mode: gameMode,
      difficulty: resultDifficulty,
      dayKey: isDailyMode ? activeDayKey : null,
      streak: displayStreak,
      levelSnapshot: buildCurrentLevelSnapshot()
    });
    enqueueTelemetry("level_fail", {
      reason: "attempt_limit",
      attempts: nextAttempts,
      maxAttempts,
      timeMs: totalTime,
      shortestCount,
      foundCount,
      ruleDifficulty: activeRule?.difficulty || null
    });
  }

  function handleGuessSubmit(event) {
    event.preventDefault();
    if (!startId || !targetId || isComplete || isFailed) return;

    const trimmed = guessValue.trim();
    if (!trimmed) {
      playManifestSfx("error", 0.65);
      focusGuessInput();
      return;
    }
    playManifestSfx("submit", 0.65);

    const normalized = normalizeName(trimmed);
    const id = normalizedToId.get(normalized);
    if (!id) {
      triggerGuessError();
      playManifestSfx("error");
      play("wrong_comarca");
      pushGuessFeedback(t("feedbackNoMatch"), "bad");
      focusGuessInput();
      return;
    }

    if (id === startId || id === targetId) {
      triggerGuessError();
      playManifestSfx("error");
      play("wrong_comarca");
      pushGuessFeedback(t("feedbackStartTarget"), "warn");
      focusGuessInput();
      return;
    }

    if (guessedSet.has(id)) {
      triggerGuessError();
      playManifestSfx("repeat");
      play("wrong_comarca");
      pushGuessFeedback(t("feedbackRepeated"), "warn");
      focusGuessInput();
      return;
    }

    if (!startedAt && !isTimedMode) {
      setStartedAt(Date.now());
    }

    const name = comarcaById.get(id)?.properties.name || trimmed;

    setAttempts((prev) => prev + 1);
    setCurrentId(id);
    setGuessValue("");
    setIsSuggestionsOpen(false);
    lastGuessRef.current = id;

    setGuessHistory((prev) => [...prev, { id, name }]);
    if (shortestPathSet.has(id)) {
      playManifestSfx("correct");
      play("correct_comarca");
    } else if (shortestNeighborSet.has(id)) {
      playManifestSfx("neutral");
      play("almost_comarca");
    } else {
      playManifestSfx("neutral", 0.75);
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
    playManifestSfx("neutral", 0.45);
    setGuessValue(name);
    setIsSuggestionsOpen(false);
    focusGuessInput();
  }

  async function fetchCalendarDetails(keys) {
    if (!supabaseEnabled || !supabase) return [];
    const uniqueKeys = [...new Set(keys)]
      .map((key) => normalizeDayKey(key))
      .filter((key) => key && key <= dayKey);
    const missingKeys = uniqueKeys.filter((key) => {
      const entry = calendarDailyMap.get(key);
      return entry?.levelId && !entry.level;
    });
    if (!missingKeys.length) return [];

    const requestKey = missingKeys.sort().join("|");
    const existingRequest = calendarDetailRequestsRef.current.get(requestKey);
    if (existingRequest) return existingRequest;

    const request = withRetry(
      () =>
        supabase
          .from("daily_calendar_public")
          .select(CALENDAR_DETAIL_COLUMNS)
          .in("date", missingKeys)
          .order("date", { ascending: false })
          .range(0, missingKeys.length - 1),
      { retries: 2, backoffMs: 350 }
    )
      .then((result) => {
        if (result.error) throw result.error;
        const entries = (Array.isArray(result.data) ? result.data : [])
          .map((row) => calendarDetailEntryFromRow(row))
          .filter(Boolean);
        if (entries.length) {
          setCalendarDaily((prev) => mergeCalendarEntries(prev, entries));
        }
        return entries;
      })
      .catch(() => [])
      .finally(() => {
        calendarDetailRequestsRef.current.delete(requestKey);
      });
    calendarDetailRequestsRef.current.set(requestKey, request);
    return request;
  }

  async function fetchCalendarDetail(key) {
    const normalizedKey = normalizeDayKey(key);
    if (!normalizedKey) return null;
    const existing = calendarDailyMap.get(normalizedKey);
    if (existing?.level) return existing.level;
    const entries = await fetchCalendarDetails([normalizedKey]);
    return entries.find((entry) => entry.date === normalizedKey)?.level || null;
  }

  function handleCalendarPick(mode, key) {
    if (mode === "daily" && key > dayKey) {
      playManifestSfx("error");
      return;
    }
    const record = getCompletionRecord(mode, key);
    if (record?.winningAttempt) {
      openCompletionModal(record, { mode, key });
      return;
    }
    const entry = calendarDailyMap.get(key);
    calendarApplyRef.current = null;
    setCalendarMode("daily");
    if (!entry?.level) {
      if (entry?.levelId) {
        handleCalendarAction("daily", key);
        return;
      }
      setCalendarSelection(null);
      if (gameMode !== "daily") {
        setGameMode("daily");
      } else {
        resetGame();
      }
      return;
    }
    setCalendarSelection({ mode: "daily", key });
    if (gameMode !== "daily") {
      setGameMode("daily");
      return;
    }
    const result = record?.winningAttempt || null;
    applyCalendarLevel(entry.level, { result, showResult: Boolean(result) });
    calendarApplyRef.current = `daily:${key}`;
  }

  async function handlePlayToday() {
    playManifestSfx("click");
    clearCompletionModalTimer();
    setCompletionCelebrating(false);
    setShowModal(false);
    setResultData(null);
    setIsFailed(false);
    setIsComplete(false);
    setOptionsOpen(false);
    setCalendarOpen(false);
    const key = dayKey;
    const selectionKey = `daily:${key}`;
    const entry = calendarDailyMap.get(key);
    let level = entry?.level || null;
    if (!level && entry?.levelId) {
      setCalendarLoadingDayKey(key);
      level = await fetchCalendarDetail(key);
      setCalendarLoadingDayKey((current) => (current === key ? null : current));
    }
    if (level && entry?.levelId && !entry.level) {
      setCalendarDaily((prev) =>
        mergeCalendarEntries(prev, [
          {
            date: key,
            levelId: entry.levelId,
            level
          }
        ])
      );
    }
    calendarResetRef.current = selectionKey;
    calendarApplyRef.current = null;
    setCalendarMode("daily");
    setCalendarSelection({ mode: "daily", key });
    if (gameMode !== "daily") {
      setGameMode("daily");
      return;
    }
    if (level) {
      calendarResetRef.current = null;
      applyCalendarLevel(level);
      calendarApplyRef.current = selectionKey;
    } else if (!entry?.levelId) {
      resetGame();
    }
  }

  function getNextDailyCalendarKey(fromKey) {
    const normalizedKey = normalizeDayKey(fromKey);
    if (!normalizedKey || normalizedKey >= dayKey) return null;
    return (
      calendarDaily
        .filter((entry) => entry?.levelId && entry.date > normalizedKey && entry.date <= dayKey)
        .map((entry) => entry.date)
        .sort((a, b) => String(a).localeCompare(String(b)))[0] || null
    );
  }

  async function startDailyCalendarKey(key) {
    const normalizedKey = normalizeDayKey(key);
    if (!normalizedKey || normalizedKey > dayKey) return false;
    const entry = calendarDailyMap.get(normalizedKey);
    if (!entry?.levelId) return false;

    let level = entry.level;
    if (!level) {
      setCalendarLoadingDayKey(normalizedKey);
      level = await fetchCalendarDetail(normalizedKey);
      setCalendarLoadingDayKey((current) =>
        current === normalizedKey ? null : current
      );
    }
    if (!level) return false;

    setCalendarDaily((prev) =>
      mergeCalendarEntries(prev, [
        {
          date: normalizedKey,
          levelId: entry.levelId,
          level
        }
      ])
    );

    const selectionKey = `daily:${normalizedKey}`;
    calendarResetRef.current = selectionKey;
    calendarApplyRef.current = null;
    setCalendarMode("daily");
    setCalendarSelection({ mode: "daily", key: normalizedKey });
    if (gameMode !== "daily") {
      setGameMode("daily");
      return true;
    }

    calendarResetRef.current = null;
    applyCalendarLevel(level);
    calendarApplyRef.current = selectionKey;
    return true;
  }

  function startRandomNormalMap() {
    setCalendarSelection(null);
    calendarApplyRef.current = null;
    calendarResetRef.current = null;
    if (gameMode !== "normal") {
      pendingStartNextRef.current = true;
      setGameMode("normal");
      return;
    }
    resetGame(true);
  }

  async function handleStartNext() {
    playManifestSfx("click");
    const resultMode = resultData?.mode || (isDailyMode ? "daily" : gameMode);
    const resultDayKey = resultData?.dayKey || (isDailyMode ? activeDayKey : null);
    clearCompletionModalTimer();
    setCompletionCelebrating(false);
    setShowModal(false);
    setResultData(null);
    setIsFailed(false);
    setIsComplete(false);
    setCalendarOpen(false);
    setOptionsOpen(false);

    if (resultMode === "daily") {
      const nextDailyKey = getNextDailyCalendarKey(resultDayKey);
      if (nextDailyKey) {
        const startedDaily = await startDailyCalendarKey(nextDailyKey);
        if (startedDaily) return;
      }
      startRandomNormalMap();
      return;
    }

    setCalendarSelection(null);
    calendarApplyRef.current = null;
    resetGame(true);
  }

  function handleRepeatLevel() {
    const snapshot =
      normalizeLevelSnapshot(resultData?.levelSnapshot) ||
      buildCurrentLevelSnapshot();
    if (!snapshot) return;
    playManifestSfx("repeat", 0.75);
    const targetMode = snapshot.mode || gameMode;
    const targetDifficulty = snapshot.difficulty || difficulty;
    pendingRepeatSnapshotRef.current = snapshot;
    if (targetMode === "daily") {
      setCalendarSelection({ mode: "daily", key: snapshot.dayKey || dayKey });
      calendarApplyRef.current = `repeat:${snapshot.dayKey || dayKey}`;
    } else {
      setCalendarSelection(null);
      calendarApplyRef.current = null;
    }
    if (targetMode !== gameMode) {
      setGameMode(targetMode);
    }
    if (targetMode !== "daily" && targetDifficulty && targetDifficulty !== difficulty) {
      setDifficulty(targetDifficulty);
    }
    if (
      targetMode !== gameMode ||
      (targetMode !== "daily" && targetDifficulty && targetDifficulty !== difficulty)
    ) {
      return;
    }
    pendingRepeatSnapshotRef.current = null;
    applyRepeatSnapshot(snapshot);
  }

  function applyRepeatSnapshot(snapshot) {
    const repeatSnapshot = normalizeLevelSnapshot(snapshot);
    if (!repeatSnapshot) return;
    clearCompletionModalTimer();
    setCompletionCelebrating(false);
    setStartId(repeatSnapshot.startId);
    setTargetId(repeatSnapshot.targetId);
    setCurrentId(repeatSnapshot.startId);
    setGuessHistory([]);
    setAttempts(0);
    setHintsUsed(0);
    setGuessError(false);
    setGuessFeedback(null);
    Object.values(hintTimersRef.current).forEach((timer) => clearTimeout(timer));
    hintTimersRef.current = {};
    setTempRevealId(null);
    setTempNeighborHint(false);
    setTempInitialsHint(false);
    const snapshotDifficulty =
      repeatSnapshot.mode === "daily"
        ? repeatSnapshot.difficulty ||
          classifyDifficultyByShortestCount(repeatSnapshot.shortestPath)
        : repeatSnapshot.difficulty || activeDifficulty;
    const basePowerups = getPowerupUses(snapshotDifficulty);
    const explorePowerups = Object.fromEntries(
      POWERUPS.map((powerup) => [powerup.id, 99])
    );
    setPowerups(repeatSnapshot.mode === "explore" ? explorePowerups : basePowerups);
    setReplayMode(null);
    setReplayOrder([]);
    setReplayIndex(0);
    setGuessValue("");
    setIsSuggestionsOpen(false);
    setIsComplete(false);
    setIsFailed(false);
    setShowModal(false);
    setResultData(null);
    setShortestPath(repeatSnapshot.shortestPath);
    setShortestPaths(repeatSnapshot.shortestPaths);
    setActiveRule(repeatSnapshot.rule);
    setElapsedMs(0);
    setStartedAt(null);
    setTimePenaltyMs(0);
    setLastEntryId(null);
    setCopyStatus("idle");
    if (repeatSnapshot.mode === "timed") {
      const internalCount = Math.max(repeatSnapshot.shortestPath.length - 2, 0);
      setTimeLimitMs(Math.max(15000, internalCount * 5000));
      beginTimedCountdown();
    } else {
      setTimeLimitMs(DEFAULT_TIME_LIMIT_MS);
      setIsCountdownActive(false);
      setCountdownValue(null);
    }
  }

  function handleViewCompletedMap() {
    playManifestSfx("close", 0.65);
    clearCompletionModalTimer();
    setCompletionCelebrating(false);
    setShowModal(false);
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

  function handleDifficultyPick(difficultyId) {
    if (!unlockedDifficulties.has(difficultyId)) {
      playManifestSfx("error");
      return;
    }
    playManifestSfx("toggle");
    setDifficulty(difficultyId);
  }

  function handleCalendarOpen() {
    playManifestSfx("open");
    setOptionsOpen(false);
    const now = new Date();
    let targetMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (!calendarDailyMap.has(dayKey)) {
      const latestDay = getLatestUnlockedCalendarDay(calendarDaily, dayKey);
      if (latestDay) {
        const parsed = new Date(`${latestDay}T00:00:00`);
        if (!Number.isNaN(parsed.valueOf())) {
          targetMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
        }
      }
    }
    setCalendarMonth(targetMonth);
    setCalendarMode("daily");
    setCalendarOpen(true);
  }

  function handleCalendarPrevMonth() {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function handleCalendarNextMonth() {
    setCalendarMonth((prev) => {
      const next = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
      const latestAssignedDay = calendarDaily[0]?.date || dayKey;
      const latestAssignedDate = new Date(`${latestAssignedDay}T00:00:00`);
      const max = Number.isNaN(latestAssignedDate.valueOf())
        ? prev
        : new Date(latestAssignedDate.getFullYear(), latestAssignedDate.getMonth(), 1);
      return next > max ? prev : next;
    });
  }

  async function handleCalendarAction(mode, key) {
    if (mode === "daily" && key > dayKey) {
      playManifestSfx("error");
      return;
    }
    const hasCalendarData = calendarDaily.length > 0;
    if (!hasCalendarData && calendarStatus !== "ready") return;
    playManifestSfx("click");
    const record = getCompletionRecord("daily", key);
    if (record?.winningAttempt) {
      openCompletionModal(record, { mode, key });
      setCalendarOpen(false);
      return;
    }
    const entry = calendarDailyMap.get(key);
    if (!entry?.levelId) return;
    let level = entry.level;
    if (!level) {
      setCalendarLoadingDayKey(key);
      level = await fetchCalendarDetail(key);
      setCalendarLoadingDayKey((current) => (current === key ? null : current));
    }
    if (!level) return;
    setCalendarDaily((prev) =>
      mergeCalendarEntries(prev, [
        {
          date: key,
          levelId: entry.levelId,
          level
        }
      ])
    );
    setCalendarSelection({ mode: "daily", key });
    setCalendarOpen(false);
    if (gameMode !== "daily") {
      setGameMode("daily");
      return;
    }
    applyCalendarLevel(level);
    calendarApplyRef.current = `daily:${key}`;
  }

  function handleCalendarClose() {
    playManifestSfx("close", 0.75);
    setCalendarOpen(false);
  }

  function handleModePick(modeId) {
    playManifestSfx("toggle");
    setGameMode(modeId);
    if (modeId === "timed") {
      setOptionsOpen(false);
    }
  }

  function handleTitleReset() {
    playManifestSfx("click");
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
    playManifestSfx("click", 0.65);
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
    const resultDifficulty = classifyDifficultyByShortestCount(shortestCount);
    const optimalPathCount = shortestPaths.length || (shortestPath.length ? 1 : 0);
    const foundCount = path.length ? Math.max(path.length - 2, 0) : 0;
    const distance = Math.max(foundCount - shortestCount, 0);
    const startName = startId ? comarcaById.get(startId)?.properties.name : "";
    const targetName = targetId ? comarcaById.get(targetId)?.properties.name : "";
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
      : `${gameMode}:${activeDifficulty}:${startId || "?"}:${targetId || "?"}:${ruleId || "none"}`;

    const allDifficultyIds = DIFFICULTIES.map((entry) => entry.id);
    const missingDailyUnlocks = allDifficultyIds.some(
      (difficultyId) => !unlockedDifficulties.has(difficultyId)
    );
    const shouldUnlockAllDifficulties = isDailyMode && missingDailyUnlocks;
    const nextDifficulty =
      distance === 0 && gameMode === "normal"
        ? getNextDifficultyId(activeDifficulty)
        : null;
    const shouldUnlock =
      shouldUnlockAllDifficulties ||
      (Boolean(nextDifficulty) && !unlockedDifficulties.has(nextDifficulty));
    const nextDifficultyEntry = nextDifficulty
      ? DIFFICULTIES.find((entryItem) => entryItem.id === nextDifficulty)
      : null;
    const nextDifficultyLabel = nextDifficultyEntry
      ? t(nextDifficultyEntry.labelKey)
      : nextDifficulty || "";
    const unlockLabel = shouldUnlockAllDifficulties
      ? t("allDifficultiesUnlocked")
      : shouldUnlock && nextDifficultyLabel
        ? t("newDifficultyUnlocked", { value: nextDifficultyLabel })
        : "";
    if (shouldUnlockAllDifficulties) {
      setUnlockedDifficulties(new Set(allDifficultyIds));
    } else if (shouldUnlock && nextDifficulty) {
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
      difficulty: resultDifficulty,
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
      weekKey: null,
      dayKey: isDailyMode ? activeDayKey : null,
      createdAt: new Date().toISOString()
    };

    const shortestNames = shortestPath
      .filter((id) => id !== startId && id !== targetId)
      .map((pathId) => comarcaById.get(pathId)?.properties.name || pathId);

    setIsComplete(true);
    playManifestSfx("win");
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
        difficulty: resultDifficulty,
        timeMs: totalTime,
        attempts,
        distance,
        shortest: shortestCount,
        found: foundCount,
        rule: activeRule?.label || t("noRule")
      };
      return [...prev, historyEntry].slice(-20);
    });

    const baseResultPayload = {
      attempts,
      maxAttempts,
      timeMs: totalTime,
      playerPath: guessHistory,
      shortestPath: shortestNames,
      shortestCount,
      optimalPathCount,
      foundCount,
      distance,
      startName,
      targetName,
      ruleLabel: activeRule?.label || t("noRule"),
      ruleDifficulty,
      ruleExplanation: activeRule?.explanation || "",
      ruleComarques: activeRule?.comarques || [],
      hintsUsed,
      bonusMs,
      entryId: entry.id,
      mode: gameMode,
      difficulty: resultDifficulty,
      streak: nextStreak.count || 0,
      unlockLabel,
      isNewBest: shouldReward,
      levelSnapshot: buildCurrentLevelSnapshot()
    };

    setResultData(baseResultPayload);
    revealCompletionModalAfterMap();

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
        : null;
      setCompletionRecords((prev) =>
        upsertCompletionRecord(prev, levelKey, {
          levelId,
          mode: gameMode,
          dayKey: isDailyMode ? activeDayKey : null,
          shortestPath: shortestNames,
          shortestCount,
          attempt: resultPayload
        })
      );
      if (isDailyMode) {
        setDailyResults((prev) => ({ ...prev, [activeDayKey]: resultPayload }));
      }
      setResultData((prev) =>
        prev?.entryId === entry.id ? { ...prev, ...resultPayload } : prev
      );
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
        week_key: null,
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
      `camicurt.cat: ${startName} â†’ ${targetName}`,
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
  const usedCount = guessedIds.length;
  const completionSummary = useMemo(() => {
    if (!resultData) return null;
    const failed = Boolean(resultData.failed || isFailed);
    const failedByAttempts = resultData.failureReason === "attempts";
    const resultMode = resultData.mode || gameMode;
    const resultStart = resultData.startName || startName || "";
    const resultTarget = resultData.targetName || targetName || "";
    const foundCount =
      typeof resultData.foundCount === "number"
        ? resultData.foundCount
        : Array.isArray(resultData.playerPath)
          ? resultData.playerPath.length
          : 0;
    const shortestCount =
      typeof resultData.shortestCount === "number" ? resultData.shortestCount : 0;
    const distance =
      typeof resultData.distance === "number"
        ? resultData.distance
        : Math.max(foundCount - shortestCount, 0);
    const normalizedResult = {
      ...resultData,
      failed,
      foundCount,
      shortestCount,
      distance
    };
    const resultMaxAttempts = Number(resultData.maxAttempts) || null;
    const title = failed
      ? failedByAttempts
        ? t("attemptsOut")
        : t("timeOut")
      : resultMode === "daily"
        ? t("dailyCompletedTitle")
        : t("routeCompletedTitle");
    const subtitle =
      resultStart && resultTarget
        ? t("routeFromTo", { start: resultStart, target: resultTarget })
        : t("routeReviewed");
    const resultDifficulty =
      resultData.difficulty || (resultMode === "daily" ? HARDEST_DIFFICULTY_ID : "");
    const referencedComarques = Array.isArray(resultData.ruleComarques)
      ? resultData.ruleComarques.filter(Boolean)
      : [];
    const learningText =
      !failed &&
      resultDifficulty === HARDEST_DIFFICULTY_ID &&
      referencedComarques.length
        ? t("referenceCounty", { value: referencedComarques.join(", ") })
        : "";
    const accuracy = getRouteAccuracy(normalizedResult);
    return {
      title,
      subtitle,
      learningText,
      accuracyText: t("accuracyText", { value: accuracy }),
      attemptsText: resultMaxAttempts
        ? `${t("attempts")}: ${resultData.attempts || 0}/${resultMaxAttempts}`
        : `${t("attempts")}: ${resultData.attempts || 0}`,
      showOptimalPath: !failed && distance > 0 && resultData.shortestPath?.length,
      primaryLabel: t("nextMap")
    };
  }, [
    resultData,
    isFailed,
    gameMode,
    startName,
    targetName,
    t
  ]);
  const dailyRecord = getCompletionRecord("daily", dayKey);
  const isDailyCompleted = Boolean(dailyRecord?.winningAttempt);
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
    return `${gameMode}:${activeDifficulty}:${startId || "?"}:${targetId || "?"}:${activeRule?.id || "none"}`;
  }, [
    isDailyMode,
    activeDayKey,
    gameMode,
    activeDifficulty,
    startId,
    targetId,
    activeRule?.id
  ]);
  const timeLeftUrgent = isTimedMode && timeLeftMs <= 10000;
  const shouldShowSuggestions = isSuggestionsOpen && suggestions.length > 0;
  const musicOptions = useMemo(() => {
    const randomOption = { id: "random", label: t("randomTrack") };
    if (audioManifest?.music) {
      return [
        randomOption,
        ...Object.entries(audioManifest.music).map(([id, file]) => ({
          id,
          label: (file.split("/").pop() || id).replace(/\.[^/.]+$/, "")
        }))
      ];
    }
    return [randomOption, ...MUSIC_TRACKS.map((track) => ({ id: track.id, label: track.label }))];
  }, [audioManifest, t]);
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
  const canShowNextCalendarMonth = useMemo(() => {
    const latestAssignedDay = calendarDaily[0]?.date || dayKey;
    const latestAssignedDate = new Date(`${latestAssignedDay}T00:00:00`);
    const maxMonth = Number.isNaN(latestAssignedDate.valueOf())
      ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
      : new Date(
          latestAssignedDate.getFullYear(),
          latestAssignedDate.getMonth(),
          1
        );
    const nextMonth = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() + 1,
      1
    );
    return nextMonth <= maxMonth;
  }, [calendarDaily, calendarMonth, dayKey]);
  const streakTierLabel = useMemo(() => getStreakTier(displayStreak), [displayStreak]);

  useEffect(() => {
    if (!calendarLoaded || !calendarDaily.length) return;
    const keys = new Set([dayKey]);
    if (isDailyMode && activeDayKey) keys.add(activeDayKey);
    if (calendarOpen) {
      calendarMonthDays.forEach((day) => {
        if (day.inMonth && day.key <= dayKey) keys.add(day.key);
      });
    }
    const missingKeys = [...keys].filter((key) => {
      const entry = calendarDailyMap.get(key);
      return entry?.levelId && !entry.level;
    });
    if (!missingKeys.length) return;
    fetchCalendarDetails(missingKeys);
  }, [
    calendarLoaded,
    calendarDaily,
    calendarDailyMap,
    calendarOpen,
    calendarMonthDays,
    dayKey,
    isDailyMode,
    activeDayKey
  ]);

  return (
    <ThemeProvider themeId={activeTheme} weatherState={weatherState}>
      <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-row">
            <button
              type="button"
              className="brand-button"
              onClick={handlePlayToday}
              aria-label={t("playToday")}
              title={t("playToday")}
            >
              <BrandLogo />
              <h1>camicurt.cat</h1>
            </button>
            <span className="brand-date">{todayLabel}</span>
          </div>
        </div>
        <div className="topbar-right">
          <div className="topbar-actions">
            <button
              type="button"
              className="topbar-button topbar-new-game"
              onClick={handleStartNext}
              disabled={!isMapReady}
            >
              {t("newGame")}
            </button>
            <button
              type="button"
              className={`topbar-challenge ${isDailyMode ? "active" : ""}`}
              onClick={handlePlayToday}
              disabled={!isMapReady}
              aria-pressed={isDailyMode}
            >
              {t("daily")}
            </button>
            <button
              type="button"
              className="calendar-icon-button topbar-calendar"
              onClick={handleCalendarOpen}
              aria-label={t("calendar")}
            >
              <span className="calendar-icon" aria-hidden="true" />
              <span>{t("calendar")}</span>
            </button>
          </div>
        </div>
      </header>

      <section className="game-layout">
        <div
          className={`map-wrap ${difficultyConfig.fog ? "fog" : ""} ${
            isTimedMode ? "timed-mode" : ""
          } ${isCountdownActive ? "countdown-active" : ""} ${
            completionCelebrating ? "completion-celebrating" : ""
          }`}
          aria-busy={!isMapReady}
        >
          <div className="prompt map-brief">
            {startName && targetName ? (
              <>
                <div className="route">
                  <span className="route-point route-start">
                    <strong>{t("start")}:</strong> {startName}
                  </span>
                  <span className="route-point route-target">
                    <strong>{t("target")}:</strong> {targetName}
                  </span>
                </div>
                <div className="status rule-line">
                  <strong>{t("rule")}:</strong> {activeRule?.label || t("noRule")}
                </div>
              </>
            ) : (
              <span>{t("loadingData")}</span>
            )}
          </div>
          <div className="map-stage">
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
                {t("loadingMap")}
              </div>
            ) : null}
            <div className="map-controls">
              <button
                type="button"
                onClick={() => {
                  playManifestSfx("click", 0.55);
                  handleZoomIn();
                }}
                aria-label={t("zoomIn")}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => {
                  playManifestSfx("click", 0.55);
                  handleZoomOut();
                }}
                aria-label={t("zoomOut")}
              >
                {"\u2212"}
              </button>
              <button
                type="button"
                onClick={() => {
                  playManifestSfx("click", 0.55);
                  handleRecenter();
                }}
              >
                {t("recenter")}
              </button>
            </div>

            <svg
              ref={svgRef}
              className="map"
              viewBox={viewBox}
              role="img"
              aria-label={t("mapAriaLabel")}
              onPointerDown={() => play("map_tap")}
            >
              <g ref={gRef}>
                {outlinePath ? <path className="outline" d={outlinePath} /> : null}
                {renderPaths.map((featureItem) => (
                  <path
                    key={featureItem.id}
                    d={featureItem.path}
                    className={featureItem.classes}
                    data-comarca-id={featureItem.id}
                    data-comarca-name={featureItem.name}
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
                          dominantBaseline="central"
                          className="initial"
                          data-comarca-id={featureItem.id}
                          style={{ fontSize: `${featureItem.initialFontSize}px` }}
                        >
                          {featureItem.initials}
                        </text>
                      );
                    })}
                  </g>
                ) : null}
              </g>
            </svg>
          </div>
        </div>

        <aside className="side-panel">
          <div className="panel-card action-card play-card">
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
            {maxAttempts ? (
              <div className="attempt-limit" aria-label={t("attempts")}>
                <span>{t("attempts")}</span>
                <strong>
                  {attempts}/{maxAttempts}
                </strong>
              </div>
            ) : null}
            <div className="side-powerups">
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
                      <span>{t(powerup.labelKey)}</span>
                      <span className="badge">{isExploreMode ? "\u221e" : usesLeft}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              className="options-launch-button"
              onClick={() => {
                playManifestSfx("open");
                setOptionsOpen(true);
              }}
              aria-haspopup="dialog"
            >
              {t("options")}
            </button>
          </div>
        </aside>
      </section>

      {optionsOpen ? (
        <div
          className="modal-backdrop options-modal-backdrop"
          onClick={() => {
            playManifestSfx("close", 0.75);
            setOptionsOpen(false);
          }}
        >
          <div
            id="options-panel"
            className="modal options-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("options")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{t("options")}</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  playManifestSfx("close", 0.75);
                  setOptionsOpen(false);
                }}
                aria-label={t("close")}
              >
                {"\u00d7"}
              </button>
            </div>
            <div className="options-body">
              <div className="options-section">
                <span className="label">{t("mode")}</span>
                <div className="mode-buttons">
                  {PRIMARY_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`mode-button ${gameMode === mode.id ? "active" : ""}`}
                      onClick={() => handleModePick(mode.id)}
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
                        <span>{t(entry.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
                {isFixedMode ? (
                  <span className="muted">{t("fixedDifficulty")}</span>
                ) : null}
              </div>

              <div className="options-section">
                <span className="label">{t("music")}</span>
                <div className="options-audio-controls">
                  <button
                    type="button"
                    className={`toggle-button ${musicEnabled ? "active" : ""}`}
                    aria-pressed={musicEnabled}
                    onClick={() => handleMusicToggle(!musicEnabled)}
                  >
                    {musicEnabled ? t("on") : t("off")}
                  </button>
                  <select
                    className="level-select"
                    value={musicTrack}
                    onChange={(event) => {
                      playManifestSfx("toggle", 0.55);
                      const nextTrack = event.target.value;
                      setMusicTrack(nextTrack);
                      if (musicEnabled && musicVolume > 0) {
                        startMusic(nextTrack, musicVolume, { force: true });
                      }
                    }}
                  >
                    {musicOptions.map((track) => (
                      <option key={track.id} value={track.id}>
                        {track.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="options-section">
                <span className="label">{t("sounds")}</span>
                <button
                  type="button"
                  className={`toggle-button ${sfxEnabled ? "active" : ""}`}
                  aria-pressed={sfxEnabled}
                  onClick={() => handleSfxToggle(!sfxEnabled)}
                >
                  {sfxEnabled ? t("on") : t("off")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
                {"\u00d7"}
              </button>
            </div>
            <div className="calendar-body">
              <div className="calendar-month">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    playManifestSfx("click", 0.55);
                    handleCalendarPrevMonth();
                  }}
                  aria-label={t("previous")}
                >
                  {"\u2039"}
                </button>
                <span className="calendar-month-label">{calendarMonthLabel}</span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    playManifestSfx("click", 0.55);
                    handleCalendarNextMonth();
                  }}
                  disabled={!canShowNextCalendarMonth}
                  aria-label={t("next")}
                >
                  {"\u203a"}
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
                      const isFuture = day.key > dayKey;
                      const isLoadingDaily = calendarLoadingDayKey === day.key;
                      const isDoneDaily = Boolean(
                        getCompletionRecord("daily", day.key)?.winningAttempt
                      );
                      const hasAssignedDailyLevel = Boolean(dailyEntry?.levelId);
                      const hasDailyLevel = hasAssignedDailyLevel && !isFuture;
                      const isLockedDaily = hasAssignedDailyLevel && isFuture;
                      const dayDotClass = isLockedDaily
                        ? "calendar-dot locked"
                        : hasDailyLevel
                          ? isDoneDaily
                            ? "calendar-dot done"
                            : "calendar-dot active"
                          : "calendar-dot empty";
                      const dayLabel = `${formatFullDayLabel(day.key)}${
                        isLockedDaily
                          ? ` \u00b7 ${t("calendarLockedSuffix")}`
                          : hasDailyLevel
                            ? isLoadingDaily
                              ? ` \u00b7 ${t("calendarLoadingSuffix")}`
                              : ""
                            : ` \u00b7 ${t("calendarNoLevel")}`
                      }`;
                      return (
                        <button
                          key={day.key}
                          type="button"
                          className={`calendar-day ${day.inMonth ? "" : "muted"} ${
                            isToday ? "today" : ""
                          } ${isDoneDaily ? "done" : ""} ${
                            hasDailyLevel ? "has-level" : "disabled"
                          } ${isLockedDaily ? "locked" : ""} ${
                            isFuture ? "future" : ""
                          } ${isLoadingDaily ? "loading" : ""}`}
                          onClick={() => handleCalendarAction("daily", day.key)}
                          disabled={!hasDailyLevel || isLoadingDaily}
                          aria-label={dayLabel}
                          data-calendar-day={day.key}
                          data-has-level={hasDailyLevel ? "true" : "false"}
                          data-locked={isLockedDaily ? "true" : "false"}
                          data-loading={isLoadingDaily ? "true" : "false"}
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

      {showModal && resultData && completionSummary ? (
        <div className="modal-backdrop result-backdrop">
          <div
            className="modal result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-title"
          >
            <div className="result-hero">
              <span className="label">{t("resultLabel")}</span>
              <h2 id="result-title">{completionSummary.title}</h2>
              <p className="modal-subtitle">{completionSummary.subtitle}</p>
            </div>

            <div className="result-score-row" aria-label={t("stats")}>
              <span className="result-score-pill">{completionSummary.accuracyText}</span>
              <span className="result-score-pill">{completionSummary.attemptsText}</span>
              <span className="result-score-pill">
                {t("time")}: {formatTime(resultData.timeMs)}
              </span>
            </div>

            {completionSummary.learningText ? (
              <div className="modal-section result-learning">
                <span className="label">{t("learningLabel")}</span>
                <p className="modal-subtitle">{completionSummary.learningText}</p>
              </div>
            ) : null}

            {completionSummary.showOptimalPath ? (
              <div className="modal-section result-optimal">
                <span className="label">{t("optimalPathLabel")}</span>
                <ol className="shortest-list">
                  {resultData.shortestPath.map((name, index) => (
                    <li key={`short-${name}-${index}`}>{name}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className="modal-actions result-actions">
              <button
                className="reset result-primary"
                type="button"
                onClick={handleStartNext}
              >
                {completionSummary.primaryLabel}
              </button>
              <button
                className="result-secondary"
                type="button"
                onClick={handleViewCompletedMap}
              >
                {t("viewMap")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <nav className="bottom-nav" aria-label={t("mainNavigation")}>
        <button
          type="button"
          className={`bottom-nav-item${calendarOpen ? " active" : ""}`}
          onClick={handleCalendarOpen}
          disabled={!isMapReady}
        >
          <span className="bottom-nav-label">{t("calendar")}</span>
        </button>
        <button
          type="button"
          className="bottom-nav-new-game"
          onClick={handleStartNext}
          disabled={!isMapReady}
        >
          <span className="bottom-nav-label">{t("newGame")}</span>
        </button>
        <button
          type="button"
          className={`bottom-nav-item${optionsOpen ? " active" : ""}`}
          onClick={() => {
            playManifestSfx("open");
            setCalendarOpen(false);
            setOptionsOpen(true);
          }}
        >
          <span className="bottom-nav-label">{t("options")}</span>
        </button>
      </nav>
      </div>
    </ThemeProvider>
  );
}

