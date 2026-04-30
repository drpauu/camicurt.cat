import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "leaderboard.json");
const MAX_ENTRIES = 500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 40;
const rateMap = new Map();

const VALID_MODES = new Set(["normal", "timed", "explore", "daily"]);

function readEntries() {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  fs.writeFileSync(dataPath, JSON.stringify(entries, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(Math.max(num, min), max);
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeKey(value, maxLength, pattern) {
  const cleaned = cleanString(value, maxLength);
  if (!cleaned) return null;
  if (pattern && !pattern.test(cleaned)) return null;
  return cleaned;
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = cleanString(entry.id, 80);
  if (!id) return null;
  const mode = cleanString(entry.mode, 16);
  if (!mode || !VALID_MODES.has(mode)) return null;
  const difficulty = cleanString(entry.difficulty, 40) || "pixapi";
  const mapId = cleanString(entry.mapId, 40) || "catalunya";
  const timeMs = clampNumber(entry.timeMs, 0, 3_600_000);
  const attempts = clampNumber(entry.attempts, 0, 999);
  const distance = clampNumber(entry.distance, 0, 999);
  const shortest = clampNumber(entry.shortest, 0, 999);
  const found = clampNumber(entry.found, 0, 999);
  if (timeMs === null || attempts === null || distance === null) return null;

  const guesses = clampNumber(entry.guesses, 0, 999) ?? 0;
  const createdAt = new Date(entry.createdAt || Date.now());
  const createdAtIso = Number.isNaN(createdAt.getTime())
    ? new Date().toISOString()
    : createdAt.toISOString();

  return {
    id,
    playerId: cleanString(entry.playerId, 80) || null,
    mode,
    mapId,
    difficulty,
    timeMs,
    attempts,
    guesses,
    distance,
    shortest: shortest ?? 0,
    found: found ?? 0,
    ruleId: cleanString(entry.ruleId, 80) || null,
    ruleDifficulty: cleanString(entry.ruleDifficulty, 20) || null,
    ruleTags: Array.isArray(entry.ruleTags)
      ? entry.ruleTags.filter((tag) => typeof tag === "string").slice(0, 6)
      : [],
    startId: cleanString(entry.startId, 80) || null,
    targetId: cleanString(entry.targetId, 80) || null,
    region: cleanString(entry.region, 40) || null,
    group: normalizeKey(entry.group, 8, /^[0-9]{5}$/) || null,
    groupName: cleanString(entry.groupName, 60) || null,
    weekKey: null,
    dayKey: normalizeKey(entry.dayKey, 10, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) || null,
    coinsEarned: clampNumber(entry.coinsEarned, 0, 9999) ?? 0,
    createdAt: createdAtIso
  };
}

function hitRateLimit(ip) {
  if (!ip) return false;
  const now = Date.now();
  const current = rateMap.get(ip);
  if (!current || current.resetAt <= now) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) {
    return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url !== "/leaderboard") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, readEntries());
    return;
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const ip = req.socket?.remoteAddress || "";
      if (hitRateLimit(ip)) {
        sendJson(res, 429, { error: "Too many requests" });
        return;
      }
      try {
        const rawEntry = JSON.parse(body);
        const entry = sanitizeEntry(rawEntry);
        if (!entry) {
          sendJson(res, 400, { error: "Invalid payload" });
          return;
        }
        const entries = readEntries();
        entries.push(entry);
        writeEntries(entries.slice(-MAX_ENTRIES));
        sendJson(res, 201, { ok: true });
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
      }
    });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(5174, () => {
  console.log("Leaderboard server: http://localhost:5174/leaderboard");
});
