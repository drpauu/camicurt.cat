import { useEffect, useState } from "react";
import AulaButton from "./components/AulaButton.jsx";
import AulaCard from "./components/AulaCard.jsx";
import AulaLayout from "./components/AulaLayout.jsx";
import AulaLoading from "./components/AulaLoading.jsx";
import { listTeacherSessions } from "./lib/aulaApi.js";

function formatDate(value) {
  if (!value) return "Sense data";
  return new Intl.DateTimeFormat("ca-ES", { dateStyle: "medium" }).format(new Date(value));
}

export default function AulaPanel({ access }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listTeacherSessions()
      .then((items) => {
        if (!cancelled) {
          setSessions(items);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const license = access.license;

  return (
    <AulaLayout access={access}>
      <section className="aula-panel-head">
        <div>
          <p className="aula-eyebrow">Panel docent</p>
          <h1>{access.organization?.name || "Camicurt Aula"}</h1>
          <p>
            Pla {license?.plan || "sense pla"} · estat {license?.status || "desconegut"} · caduca
            el {license?.ends_at ? formatDate(license.ends_at) : "pendent"}
          </p>
        </div>
        <div className="aula-actions">
          <AulaButton href="/aula/sessions/new">Crear sessio</AulaButton>
          <AulaButton href="/aula/materials" variant="secondary">
            Materials docents
          </AulaButton>
        </div>
      </section>

      <AulaCard>
        <div className="aula-section-title">
          <div>
            <p className="aula-eyebrow">Activitat recent</p>
            <h2>Ultimes sessions</h2>
          </div>
        </div>
        {loading ? <AulaLoading label="Carregant sessions..." /> : null}
        {error ? <p className="aula-message aula-message-error">{error.message}</p> : null}
        {!loading && !sessions.length ? (
          <p className="aula-empty">Encara no has creat cap sessio d'aula.</p>
        ) : null}
        {sessions.length ? (
          <div className="aula-table-wrap">
            <table className="aula-table">
              <thead>
                <tr>
                  <th>Titol</th>
                  <th>Codi</th>
                  <th>Estat</th>
                  <th>Data</th>
                  <th>Accions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.title || "Sessio sense titol"}</td>
                    <td>
                      <strong>{session.join_code}</strong>
                    </td>
                    <td>{session.status}</td>
                    <td>{formatDate(session.created_at)}</td>
                    <td>
                      <a href={`/aula/session/${session.id}/projector`}>Projector</a>{" "}
                      <a href={`/aula/session/${session.id}/results`}>Resultats</a>
                    </td>
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
