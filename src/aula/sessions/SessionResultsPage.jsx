import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import useAulaResults from "../hooks/useAulaResults.js";
import { downloadResultsCsv } from "../lib/aulaCsv.js";
import { setAulaSessionStatus } from "../lib/aulaApi.js";

export default function SessionResultsPage({ access, sessionId }) {
  const { loading, bundle, results, error } = useAulaResults(sessionId, { pollMs: 10000 });

  async function closeSession() {
    await setAulaSessionStatus(sessionId, "closed");
    window.location.reload();
  }

  return (
    <AulaLayout access={access} wide>
      <section className="aula-panel-head">
        <div>
          <p className="aula-eyebrow">Resultats</p>
          <h1>{bundle?.session?.title || bundle?.challenge?.title || "Sessio Aula"}</h1>
        </div>
        <div className="aula-actions">
          <AulaButton onClick={() => downloadResultsCsv(sessionId, results)} variant="secondary">
            Exportar CSV
          </AulaButton>
          <AulaButton href={`/aula/session/${sessionId}/projector`} variant="secondary">
            Mode projector
          </AulaButton>
          <AulaButton onClick={closeSession} variant="secondary">
            Tancar sessio
          </AulaButton>
        </div>
      </section>
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
                  <th>Intents</th>
                  <th>Temps</th>
                  <th>Precisio</th>
                  <th>Distancia respecte l'optim</th>
                  <th>Cami trobat</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.display_name}</td>
                    <td>{result.completed ? "Completat" : "No completat"}</td>
                    <td>{result.attempts_count}</td>
                    <td>{result.time_seconds ?? ""}</td>
                    <td>{result.precision ?? ""}</td>
                    <td>{result.distance_from_optimal ?? ""}</td>
                    <td>{Array.isArray(result.found_path) ? result.found_path.join(" > ") : ""}</td>
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
