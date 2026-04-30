const COMPLETION_KEY = "rumb-completion-records-v1";

export function loadCompletionRecords() {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(COMPLETION_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveCompletionRecords(records) {
  if (typeof window === "undefined") return;
  localStorage.setItem(COMPLETION_KEY, JSON.stringify(records || {}));
}

export function upsertCompletionRecord(records, levelKey, payload) {
  if (!levelKey || !payload) return records;
  const next = { ...(records || {}) };
  const current = next[levelKey] || { attemptsList: [] };
  const attemptsList = Array.isArray(current.attemptsList)
    ? [...current.attemptsList]
    : [];
  attemptsList.push(payload.attempt);
  const winningAttempt = selectWinningAttempt(attemptsList);
  next[levelKey] = {
    ...current,
    levelKey,
    levelId: payload.levelId || current.levelId || null,
    mode: payload.mode || current.mode || null,
    dayKey: payload.dayKey || current.dayKey || null,
    completedAt: payload.completedAt || current.completedAt || new Date().toISOString(),
    attemptsList,
    winningAttempt,
    shortestPath: payload.shortestPath || current.shortestPath || [],
    shortestCount:
      typeof payload.shortestCount === "number"
        ? payload.shortestCount
        : current.shortestCount || 0
  };
  return next;
}

export function selectWinningAttempt(attemptsList) {
  if (!Array.isArray(attemptsList) || attemptsList.length === 0) return null;
  return attemptsList.reduce((best, current) => {
    if (!best) return current;
    if (current.attempts < best.attempts) return current;
    if (current.attempts === best.attempts && current.timeMs < best.timeMs) return current;
    return best;
  }, null);
}

export { COMPLETION_KEY };
