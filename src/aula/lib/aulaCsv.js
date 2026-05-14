const CSV_HEADERS = [
  "equip",
  "completat",
  "intents",
  "temps_segons",
  "precisio",
  "distancia_optima",
  "cami_trobat"
];

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function resultsToCsv(results = []) {
  const rows = results.map((result) => [
    result.display_name || result.participant?.display_name || "",
    result.completed ? "si" : "no",
    result.attempts_count ?? "",
    result.time_seconds ?? "",
    result.precision ?? "",
    result.distance_from_optimal ?? "",
    Array.isArray(result.found_path) ? result.found_path.join(" > ") : ""
  ]);
  return [CSV_HEADERS, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export function downloadResultsCsv(sessionId, results = []) {
  const blob = new Blob([resultsToCsv(results)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `camicurt-aula-resultats-${sessionId}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
