export const DISTANCE_DIFFICULTY_RANGES = [
  { id: "pixapi", minInternal: 0, maxInternal: 3 },
  { id: "dominguero", minInternal: 4, maxInternal: 5 },
  { id: "rondinaire", minInternal: 6, maxInternal: 8 },
  { id: "cap-colla-rutes", minInternal: 9, maxInternal: Infinity }
];

export function getShortestInternalCount(pathOrCount) {
  if (Array.isArray(pathOrCount)) {
    return Math.max(pathOrCount.length - 2, 0);
  }
  const count = Number(pathOrCount);
  return Number.isFinite(count) ? Math.max(Math.trunc(count), 0) : 0;
}

export function classifyDifficultyByShortestCount(shortestCount) {
  const internalCount = getShortestInternalCount(shortestCount);
  return (
    DISTANCE_DIFFICULTY_RANGES.find(
      (range) =>
        internalCount >= range.minInternal && internalCount <= range.maxInternal
    )?.id || DISTANCE_DIFFICULTY_RANGES[DISTANCE_DIFFICULTY_RANGES.length - 1].id
  );
}

export function getDifficultyDistanceRange(difficultyId) {
  return (
    DISTANCE_DIFFICULTY_RANGES.find((range) => range.id === difficultyId) ||
    DISTANCE_DIFFICULTY_RANGES[0]
  );
}

export function isShortestCountInDifficulty(shortestCount, difficultyId) {
  const internalCount = getShortestInternalCount(shortestCount);
  const range = getDifficultyDistanceRange(difficultyId);
  return internalCount >= range.minInternal && internalCount <= range.maxInternal;
}
