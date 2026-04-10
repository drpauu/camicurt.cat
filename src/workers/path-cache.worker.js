import {
  buildShortestPathCache,
  serializeShortestPathCache
} from "../lib/pathfinding.js";

function deserializeAdjacency(list) {
  if (!Array.isArray(list)) return new Map();
  return new Map(list.map(([id, neighbors]) => [id, new Set(neighbors || [])]));
}

self.onmessage = (event) => {
  const adjacency = deserializeAdjacency(event.data?.adjacency);
  const cache = buildShortestPathCache(adjacency, { maxPaths: 32 });
  self.postMessage({ cache: serializeShortestPathCache(cache) });
};
