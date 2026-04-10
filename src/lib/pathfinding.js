const DEFAULT_MAX_PATHS = 64;

function sortedNeighbors(adjacency, id, allowedSet) {
  const neighbors = adjacency.get(id) || new Set();
  return [...neighbors]
    .filter((neighborId) => !allowedSet || allowedSet.has(neighborId))
    .sort((a, b) => String(a).localeCompare(String(b), "ca"));
}

function clonePath(path) {
  return Array.isArray(path) ? [...path] : [];
}

function normalizeCachedResult(entry) {
  if (!entry) return null;
  if (Array.isArray(entry)) {
    const primaryPath = clonePath(entry);
    return {
      distance: primaryPath.length ? primaryPath.length - 1 : Infinity,
      primaryPath,
      paths: primaryPath.length ? [primaryPath] : [],
      truncated: false
    };
  }
  const primaryPath = clonePath(entry.primaryPath);
  const paths = Array.isArray(entry.paths)
    ? entry.paths.map(clonePath).filter((path) => path.length)
    : primaryPath.length
      ? [primaryPath]
      : [];
  return {
    distance:
      typeof entry.distance === "number"
        ? entry.distance
        : primaryPath.length
          ? primaryPath.length - 1
          : Infinity,
    primaryPath,
    paths,
    truncated: Boolean(entry.truncated)
  };
}

function reconstructShortestPaths(startId, targetId, predecessors, maxPaths) {
  const paths = [];
  let truncated = false;

  function walk(nodeId, suffix) {
    if (paths.length >= maxPaths) {
      truncated = true;
      return;
    }
    if (nodeId === startId) {
      paths.push([startId, ...suffix]);
      return;
    }
    const prevList = predecessors.get(nodeId) || [];
    for (const previous of prevList) {
      walk(previous, [nodeId, ...suffix]);
      if (truncated) return;
    }
  }

  walk(targetId, []);
  return { paths, truncated };
}

function createResult(primaryPath = [], paths = [], distance = Infinity, extra = {}) {
  const cleanPrimary = clonePath(primaryPath);
  const cleanPaths = paths.length
    ? paths.map(clonePath).filter((path) => path.length)
    : cleanPrimary.length
      ? [cleanPrimary]
      : [];
  return {
    distance,
    primaryPath: cleanPrimary,
    paths: cleanPaths,
    truncated: Boolean(extra.truncated),
    astarPath: clonePath(extra.astarPath),
    astarConsistent: extra.astarConsistent !== false
  };
}

export function dijkstraAllShortestPaths(
  startId,
  targetId,
  adjacency,
  options = {}
) {
  const { allowedSet = null, cache = null, maxPaths = DEFAULT_MAX_PATHS } = options;
  if (!startId || !targetId || !adjacency?.size) return createResult();
  if (allowedSet && (!allowedSet.has(startId) || !allowedSet.has(targetId))) {
    return createResult();
  }
  if (startId === targetId) return createResult([startId], [[startId]], 0);
  if (!allowedSet) {
    const cached = normalizeCachedResult(cache?.get(startId)?.get(targetId));
    if (cached) return createResult(cached.primaryPath, cached.paths, cached.distance, cached);
  }

  const distances = new Map([[startId, 0]]);
  const predecessors = new Map();
  const queue = [{ id: startId, distance: 0 }];
  let targetDistance = Infinity;

  while (queue.length) {
    queue.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id, "ca"));
    const { id: current, distance } = queue.shift();
    if (distance !== distances.get(current)) continue;
    if (distance > targetDistance) break;

    for (const next of sortedNeighbors(adjacency, current, allowedSet)) {
      const nextDistance = distance + 1;
      const knownDistance = distances.get(next);
      if (knownDistance === undefined || nextDistance < knownDistance) {
        distances.set(next, nextDistance);
        predecessors.set(next, [current]);
        queue.push({ id: next, distance: nextDistance });
        if (next === targetId) targetDistance = nextDistance;
      } else if (nextDistance === knownDistance) {
        const prevList = predecessors.get(next) || [];
        if (!prevList.includes(current)) {
          prevList.push(current);
          prevList.sort((a, b) => a.localeCompare(b, "ca"));
          predecessors.set(next, prevList);
        }
      }
    }
  }

  const distance = distances.get(targetId);
  if (distance === undefined) return createResult();
  const { paths, truncated } = reconstructShortestPaths(
    startId,
    targetId,
    predecessors,
    maxPaths
  );
  return createResult(paths[0] || [], paths, distance, { truncated });
}

function pointDistance(a, b) {
  if (!a || !b) return 0;
  const ax = Number(a.lon ?? a[0]);
  const ay = Number(a.lat ?? a[1]);
  const bx = Number(b.lon ?? b[0]);
  const by = Number(b.lat ?? b[1]);
  if (![ax, ay, bx, by].every(Number.isFinite)) return 0;
  return Math.hypot(ax - bx, ay - by);
}

function maxNeighborDistance(adjacency, centroidMap) {
  if (!centroidMap?.size) return 1;
  let max = 0;
  adjacency.forEach((neighbors, id) => {
    const from = centroidMap.get(id);
    neighbors.forEach((neighborId) => {
      const distance = pointDistance(from, centroidMap.get(neighborId));
      if (distance > max) max = distance;
    });
  });
  return max || 1;
}

export function aStarShortestPath(startId, targetId, adjacency, options = {}) {
  const { allowedSet = null, centroidMap = null } = options;
  if (!startId || !targetId || !adjacency?.size) return [];
  if (allowedSet && (!allowedSet.has(startId) || !allowedSet.has(targetId))) return [];
  if (startId === targetId) return [startId];

  const edgeScale = maxNeighborDistance(adjacency, centroidMap);
  const heuristic = (id) =>
    centroidMap?.size
      ? pointDistance(centroidMap.get(id), centroidMap.get(targetId)) / edgeScale
      : 0;

  const open = [{ id: startId, fScore: heuristic(startId) }];
  const cameFrom = new Map();
  const gScore = new Map([[startId, 0]]);
  const openIds = new Set([startId]);

  while (open.length) {
    open.sort((a, b) => a.fScore - b.fScore || a.id.localeCompare(b.id, "ca"));
    const current = open.shift().id;
    openIds.delete(current);
    if (current === targetId) {
      const path = [targetId];
      let step = targetId;
      while (cameFrom.has(step)) {
        step = cameFrom.get(step);
        path.push(step);
      }
      return path.reverse();
    }

    const currentScore = gScore.get(current) ?? Infinity;
    for (const next of sortedNeighbors(adjacency, current, allowedSet)) {
      const tentativeScore = currentScore + 1;
      if (tentativeScore >= (gScore.get(next) ?? Infinity)) continue;
      cameFrom.set(next, current);
      gScore.set(next, tentativeScore);
      const fScore = tentativeScore + heuristic(next);
      if (!openIds.has(next)) {
        open.push({ id: next, fScore });
        openIds.add(next);
      } else {
        const entry = open.find((item) => item.id === next);
        if (entry) entry.fScore = fScore;
      }
    }
  }

  return [];
}

function hasDuplicateIds(path) {
  return new Set(path).size !== path.length;
}

function mergePathResults(results, maxPaths) {
  let bestDistance = Infinity;
  let truncated = false;
  const paths = [];
  const seen = new Set();

  results.forEach((result) => {
    if (!result?.primaryPath?.length) return;
    const distance = result.primaryPath.length - 1;
    if (distance < bestDistance) {
      bestDistance = distance;
      paths.length = 0;
      seen.clear();
    }
    if (distance !== bestDistance) return;
    result.paths.forEach((path) => {
      if (paths.length >= maxPaths) {
        truncated = true;
        return;
      }
      const key = path.join("|");
      if (seen.has(key)) return;
      seen.add(key);
      paths.push(path);
    });
    if (result.truncated) truncated = true;
  });

  return createResult(paths[0] || [], paths, bestDistance, { truncated });
}

function combineViaNode(first, second, maxPaths) {
  const paths = [];
  let truncated = false;
  for (const firstPath of first.paths) {
    for (const secondPath of second.paths) {
      if (paths.length >= maxPaths) {
        truncated = true;
        break;
      }
      const combined = firstPath.concat(secondPath.slice(1));
      if (!hasDuplicateIds(combined)) paths.push(combined);
    }
    if (truncated) break;
  }
  const distance = paths[0]?.length ? paths[0].length - 1 : Infinity;
  return createResult(paths[0] || [], paths, distance, {
    truncated: truncated || first.truncated || second.truncated
  });
}

function aStarWithRule(startId, targetId, adjacency, rule, allIds, options = {}) {
  if (!rule) return aStarShortestPath(startId, targetId, adjacency, options);
  if (rule.kind === "avoid") {
    const blocked = new Set(rule.comarcaIds || []);
    const allowedSet = new Set(allIds.filter((id) => !blocked.has(id)));
    return aStarShortestPath(startId, targetId, adjacency, { ...options, allowedSet });
  }
  if (rule.kind === "mustIncludeAny") {
    let best = [];
    for (const nodeId of rule.comarcaIds || []) {
      const first = aStarShortestPath(startId, nodeId, adjacency, options);
      const second = aStarShortestPath(nodeId, targetId, adjacency, options);
      if (!first.length || !second.length) continue;
      const combined = first.concat(second.slice(1));
      if (hasDuplicateIds(combined)) continue;
      if (!best.length || combined.length < best.length) best = combined;
    }
    return best;
  }
  return aStarShortestPath(startId, targetId, adjacency, options);
}

export function findShortestPathsWithRule(
  startId,
  targetId,
  adjacency,
  rule,
  allIds = [],
  options = {}
) {
  const { maxPaths = DEFAULT_MAX_PATHS } = options;
  let result;

  if (!rule) {
    result = dijkstraAllShortestPaths(startId, targetId, adjacency, options);
  } else if (rule.kind === "avoid") {
    const blocked = new Set(rule.comarcaIds || []);
    const allowedSet = new Set(allIds.filter((id) => !blocked.has(id)));
    result = dijkstraAllShortestPaths(startId, targetId, adjacency, {
      ...options,
      allowedSet
    });
  } else if (rule.kind === "mustIncludeAny") {
    const viaResults = (rule.comarcaIds || []).map((nodeId) => {
      const first = dijkstraAllShortestPaths(startId, nodeId, adjacency, options);
      const second = dijkstraAllShortestPaths(nodeId, targetId, adjacency, options);
      if (!first.primaryPath.length || !second.primaryPath.length) return createResult();
      return combineViaNode(first, second, maxPaths);
    });
    result = mergePathResults(viaResults, maxPaths);
  } else {
    result = dijkstraAllShortestPaths(startId, targetId, adjacency, options);
  }

  const astarPath = aStarWithRule(startId, targetId, adjacency, rule, allIds, options);
  const astarConsistent =
    !result.primaryPath.length ||
    !astarPath.length ||
    astarPath.length === result.primaryPath.length;
  return createResult(result.primaryPath, result.paths, result.distance, {
    truncated: result.truncated,
    astarPath,
    astarConsistent
  });
}

export function findShortestPath(startId, targetId, adjacency, cacheOrOptions = null) {
  const options = cacheOrOptions instanceof Map ? { cache: cacheOrOptions } : cacheOrOptions || {};
  return dijkstraAllShortestPaths(startId, targetId, adjacency, options).primaryPath;
}

export function findShortestPathInSet(startId, targetId, adjacency, allowedSet) {
  return dijkstraAllShortestPaths(startId, targetId, adjacency, { allowedSet }).primaryPath;
}

export function buildShortestPathCache(adjacency, options = {}) {
  if (!adjacency || !adjacency.size) return new Map();
  const ids = [...adjacency.keys()];
  const cache = new Map();
  ids.forEach((startId) => {
    const targetMap = new Map();
    ids.forEach((targetId) => {
      const result = dijkstraAllShortestPaths(startId, targetId, adjacency, {
        ...options,
        cache: null
      });
      if (result.primaryPath.length) {
        targetMap.set(targetId, {
          distance: result.distance,
          primaryPath: result.primaryPath,
          paths: result.paths,
          truncated: result.truncated
        });
      }
    });
    cache.set(startId, targetMap);
  });
  return cache;
}

export function serializeShortestPathCache(cache) {
  if (!cache || !cache.size) return [];
  return [...cache.entries()].map(([startId, targets]) => [
    startId,
    [...targets.entries()].map(([targetId, value]) => [targetId, normalizeCachedResult(value)])
  ]);
}

export function deserializeShortestPathCache(list) {
  if (!Array.isArray(list)) return new Map();
  return new Map(
    list.map(([startId, targets]) => [
      startId,
      new Map((targets || []).map(([targetId, value]) => [targetId, normalizeCachedResult(value)]))
    ])
  );
}

export function isPathOptimal(path, shortestPaths) {
  if (!Array.isArray(path) || !path.length || !Array.isArray(shortestPaths)) return false;
  const key = path.join("|");
  return shortestPaths.some((shortestPath) => shortestPath.join("|") === key);
}
