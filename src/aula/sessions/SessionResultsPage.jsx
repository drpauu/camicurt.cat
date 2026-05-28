import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import useAulaResults from "../hooks/useAulaResults.js";
import { downloadResultsCsv } from "../lib/aulaCsv.js";
import { setAulaSessionStatus } from "../lib/aulaApi.js";
import { formatComarcaName, formatComarcaPath } from "../lib/comarcaNames.js";

function formatAverage(value, suffix = "") {
  if (!Number.isFinite(value)) return "—";
  return `${Math.round(value * 10) / 10}${suffix}`;
}

function getFailureLabel(reason) {
  if (reason === "attempts") return "Intents esgotats";
  if (reason === "time") return "Temps esgotat";
  if (reason === "abandoned") return "Abandonat";
  return "No completat";
}

export default function SessionResultsPage({ access, sessionId }) {
  const { loading, bundle, results, error } = useAulaResults(sessionId, { pollMs: 10000 });
  const participants = bundle?.participants || [];
  const completed = results.filter((result) => result.completed);
  const submittedIds = new Set(results.map((result) => result.participant_id));
  const pendingParticipants = participants.filter((participant) => !submittedIds.has(participant.id));
  const avgAttempts =
    results.length > 0
      ? results.reduce((sum, result) => sum + (Number(result.attempts_count) || 0), 0) / results.length
      : NaN;
  const avgTime =
    completed.length > 0
      ? completed.reduce((sum, result) => sum + (Number(result.time_seconds) || 0), 0) / completed.length
      : NaN;
  const avgPrecision =
    completed.length > 0
      ? completed.reduce((sum, result) => sum + (Number(result.precision) || 0), 0) / completed.length
      : NaN;
  const optimalSet = new Set(bundle?.challenge?.shortest_path || []);
  const confusion = [...results.reduce((map, result) => {
    (result.attempts || []).forEach((id) => {
      if (!id || optimalSet.has(id)) return;
      map.set(id, (map.get(id) || 0) + 1);
    });
    return map;
  }, new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  async function closeSession() {
    await setAulaSessionStatus(sessionId, "closed");
    window.location.reload();
  }

  return (
    <AulaLayout access={access} wide>
      <section className="aula-panel-head">
        <div>
          <p className="aula-eyebrow">Resultats</p>
          <h1>{bundle?.session?.title || bundle?.challenge?.title || "Sessió Aula"}</h1>
        </div>
        <div className="aula-actions">
          <AulaButton onClick={() => downloadResultsCsv(sessionId, results)} variant="secondary">
            Exportar CSV
          </AulaButton>
          <AulaButton href={`/aula/session/${sessionId}/projector`} variant="secondary">
            Mode projector
          </AulaButton>
          <AulaButton onClick={closeSession} variant="secondary">
            Tancar sessió
          </AulaButton>
        </div>
      </section>
      <div className="aula-grid aula-grid-four">
        <AulaCard>
          <p className="aula-eyebrow">Participants</p>
          <h2>{participants.length}</h2>
        </AulaCard>
        <AulaCard>
          <p className="aula-eyebrow">Enviats</p>
          <h2>{results.length}</h2>
        </AulaCard>
        <AulaCard>
          <p className="aula-eyebrow">Completats</p>
          <h2>{completed.length}</h2>
        </AulaCard>
        <AulaCard>
          <p className="aula-eyebrow">Mitjana</p>
          <h2>{formatAverage(avgPrecision, "%")}</h2>
        </AulaCard>
      </div>
      <div className="aula-grid aula-grid-two">
        <AulaCard>
          <p className="aula-eyebrow">Indicadors</p>
          <p>Temps mitjà completat: {formatAverage(avgTime, " s")}</p>
          <p>Intents mitjans: {formatAverage(avgAttempts)}</p>
          <p>Pendents d'enviar resultat: {pendingParticipants.length}</p>
        </AulaCard>
        <AulaCard>
          <p className="aula-eyebrow">Comarques a revisar</p>
          {!confusion.length ? <p className="aula-empty">Encara no hi ha prou intents per detectar patrons.</p> : null}
          {confusion.length ? (
            <div className="aula-chip-list">
              {confusion.map(([id, count]) => (
                <span key={id}>
                  {formatComarcaName(id)} · {count}
                </span>
              ))}
            </div>
          ) : null}
        </AulaCard>
      </div>
      <AulaCard>
        {loading ? <AulaLoading label="Carregant resultats..." /> : null}
        {error ? <p className="aula-message aula-message-error">{error.message}</p> : null}
        {!loading && !results.length ? (
          <p className="aula-empty">Encara no hi ha resultats enviats.</p>
        ) : null}
        {results.length ? (
          <div className="aula-table-wrap">
            <table className="aula-table">
              <thead>
                <tr>
                  <th>Equip</th>
                  <th>Estat</th>
                  <th>Motiu</th>
                  <th>Intents</th>
                  <th>Temps</th>
                  <th>Precisió</th>
                  <th>Distància respecte a l'òptim</th>
                  <th>Camí trobat</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.display_name}</td>
                    <td>{result.completed ? "Completat" : "No completat"}</td>
                    <td>{result.completed ? "—" : getFailureLabel(result.failure_reason)}</td>
                    <td>{result.attempts_count}</td>
                    <td>{result.time_seconds ?? ""}</td>
                    <td>{result.precision ?? ""}</td>
                    <td>{result.distance_from_optimal ?? ""}</td>
                    <td>{formatComarcaPath(result.found_path)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </AulaCard>
    </AulaLayout>
  );
}
