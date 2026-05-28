import { feature, neighbors as topoNeighbors } from "topojson-client";
import { findShortestPathsWithRule, isPathOptimal } from "../../lib/pathfinding.js";
import { slugifyName } from "../../lib/names.js";
import { COMARCA_OPTIONS, formatComarcaName } from "./comarcaNames.js";

const MAP_TOPO_URL = "/catalunya-comarques.topojson";

let graphPromise = null;

export function normalizeComarcaInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const byId = new Set(COMARCA_OPTIONS.map((item) => item.id));
  if (byId.has(raw)) return raw;
  const slug = slugifyName(raw);
  return byId.has(slug) ? slug : raw;
}

export function parseComarcaList(value) {
  return String(value || "")
    .split(/[>,;\n]+|,/)
    .map(normalizeComarcaInput)
    .filter(Boolean);
}

export async function loadAulaMapGraph() {
  if (!graphPromise) {
    graphPromise = fetch(MAP_TOPO_URL, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("No s'ha pogut carregar el mapa.");
        return response.json();
      })
      .then((topology) => {
        const objectKey = Object.keys(topology.objects || {})[0];
        const object = topology.objects[objectKey];
        const collection = feature(topology, object);
        const ids = (collection.features || []).map((item) => item.properties.id);
        const idSet = new Set(ids);
        const neighborIndex = topoNeighbors(object.geometries || []);
        const adjacency = new Map();
        neighborIndex.forEach((neighbors, index) => {
          adjacency.set(
            ids[index],
            new Set(neighbors.map((neighborIndexItem) => ids[neighborIndexItem]).filter(Boolean))
          );
        });
        return { ids, idSet, adjacency };
      });
  }
  return graphPromise;
}

function pathIsContinuous(path, adjacency) {
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    if (!adjacency.get(from)?.has(to)) return false;
  }
  return true;
}

function createRule(draft) {
  const ruleKind = draft.ruleKind || "";
  const comarcaIds = Array.isArray(draft.ruleComarcaIds) ? draft.ruleComarcaIds : [];
  if (!ruleKind || !comarcaIds.length) return null;
  return {
    id: "custom-rule",
    kind: ruleKind,
    comarcaIds,
    comarques: comarcaIds.map(formatComarcaName),
    label: draft.ruleLabel || ""
  };
}

export function validateLevelDraft(draft, graph = null) {
  const errors = [];
  const warnings = [];
  const idSet = graph?.idSet || new Set(COMARCA_OPTIONS.map((item) => item.id));
  const shortestPath = Array.isArray(draft.shortestPath) ? draft.shortestPath : [];
  const ruleComarcaIds = Array.isArray(draft.ruleComarcaIds) ? draft.ruleComarcaIds : [];
  const gameSettings = draft.gameSettings || {};

  if (!String(draft.title || "").trim()) errors.push("Cal posar un títol al nivell.");
  if (!draft.startId || !idSet.has(draft.startId)) errors.push("Cal triar una comarca inicial vàlida.");
  if (!draft.targetId || !idSet.has(draft.targetId)) errors.push("Cal triar una comarca de destí vàlida.");
  if (draft.startId && draft.targetId && draft.startId === draft.targetId) {
    errors.push("La comarca inicial i el destí han de ser diferents.");
  }
  if (shortestPath.length < 2) errors.push("Cal indicar un camí amb inici i destí.");
  if (shortestPath.some((id) => !idSet.has(id))) {
    errors.push("El camí conté alguna comarca que no existeix al mapa.");
  }
  if (shortestPath.length && shortestPath[0] !== draft.startId) {
    errors.push("El camí ha de començar per la comarca inicial.");
  }
  if (shortestPath.length && shortestPath[shortestPath.length - 1] !== draft.targetId) {
    errors.push("El camí ha d'acabar a la comarca de destí.");
  }
  if (draft.ruleKind && !["avoid", "mustIncludeAny"].includes(draft.ruleKind)) {
    errors.push("La norma no és vàlida.");
  }
  if (draft.ruleKind && !ruleComarcaIds.length) {
    errors.push("Cal triar comarques per a la norma.");
  }
  if (ruleComarcaIds.some((id) => !idSet.has(id))) {
    errors.push("La norma conté alguna comarca que no existeix al mapa.");
  }
  if (gameSettings.mode === "timed" && !Number(gameSettings.time_limit_seconds)) {
    errors.push("El mode contrarellotge necessita un límit de temps.");
  }

  const duplicated = new Set();
  shortestPath.forEach((id, index) => {
    if (shortestPath.indexOf(id) !== index) duplicated.add(id);
  });
  if (duplicated.size) {
    warnings.push(
      `El camí repeteix ${[...duplicated].map(formatComarcaName).join(", ")}; comprova que no sigui una volta.`
    );
  }

  if (draft.ruleKind === "avoid") {
    const forbidden = shortestPath.filter((id) => ruleComarcaIds.includes(id));
    if (forbidden.length) {
      warnings.push(
        `La norma diu d'evitar ${forbidden.map(formatComarcaName).join(", ")}, però surt al camí.`
      );
    }
  }
  if (draft.ruleKind === "mustIncludeAny" && ruleComarcaIds.length) {
    const includesRequired = ruleComarcaIds.some((id) => shortestPath.includes(id));
    if (!includesRequired) {
      warnings.push("La norma demana passar per una comarca que no apareix al camí manual.");
    }
  }

  const internalCount = Math.max(shortestPath.length - 2, 0);
  const maxAttempts = Number(gameSettings.max_attempts || 0);
  const timeLimit = Number(gameSettings.time_limit_seconds || 0);
  if (maxAttempts && maxAttempts < internalCount) {
    warnings.push("Els intents màxims són inferiors al nombre de passos interns del camí.");
  }
  if (gameSettings.mode === "timed" && timeLimit && internalCount && timeLimit < internalCount * 5) {
    warnings.push("El temps és molt ajustat per al camí indicat.");
  }

  if (graph?.adjacency && !errors.length) {
    if (!pathIsContinuous(shortestPath, graph.adjacency)) {
      errors.push("El camí manual no és continu: alguna comarca no toca la següent.");
    } else {
      const rule = createRule(draft);
      const result = findShortestPathsWithRule(
        draft.startId,
        draft.targetId,
        graph.adjacency,
        rule,
        graph.ids,
        { maxPaths: 64 }
      );
      if (!result.primaryPath.length) {
        errors.push("No hi ha cap camí jugable amb aquesta norma.");
      } else if (!isPathOptimal(shortestPath, result.paths)) {
        warnings.push(
          `El camí manual no sembla òptim. Una opció curta és ${result.primaryPath
            .map(formatComarcaName)
            .join(" > ")}.`
        );
      }
    }
  }

  return { errors, warnings };
}
