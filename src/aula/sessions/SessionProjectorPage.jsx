import { useState } from "react";
import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import useAulaSession from "../hooks/useAulaSession.js";
import { setAulaSessionStatus } from "../lib/aulaApi.js";

export default function SessionProjectorPage({ access, sessionId }) {
  const { loading, bundle, error } = useAulaSession(sessionId, { pollMs: 7000 });
  const [showSolution, setShowSolution] = useState(false);
  const [message, setMessage] = useState("");

  async function updateStatus(status) {
    try {
      await setAulaSessionStatus(sessionId, status);
      window.location.reload();
    } catch (err) {
      setMessage(err.message);
    }
  }

  const session = bundle?.session;
  const challenge = bundle?.challenge;

  return (
    <AulaLayout access={access} wide>
      {loading ? <AulaLoading label="Carregant projector..." /> : null}
      {error ? <p className="aula-message aula-message-error">{error.message}</p> : null}
      {message ? <p className="aula-message aula-message-error">{message}</p> : null}
      {session && challenge ? (
        <AulaCard className="aula-projector-card">
          <p className="aula-eyebrow">Camicurt Aula</p>
          <h1>{session.title || challenge.title}</h1>
          <div className="aula-projector-grid">
            <div>
              <span>Inici</span>
              <strong>{challenge.start_id}</strong>
            </div>
            <div>
              <span>Desti</span>
              <strong>{challenge.target_id}</strong>
            </div>
            <div>
              <span>Dificultat</span>
              <strong>{challenge.difficulty_id}</strong>
            </div>
            <div>
              <span>Codi d'aula</span>
              <strong>{session.join_code}</strong>
            </div>
            <div>
              <span>Participants</span>
              <strong>{bundle.participants.length}</strong>
            </div>
            <div>
              <span>Estat</span>
              <strong>{session.status}</strong>
            </div>
          </div>
          {challenge.student_prompt ? <p>{challenge.student_prompt}</p> : null}
          {showSolution ? (
            <div className="aula-solution">
              <strong>Solucio:</strong> {challenge.shortest_path.join(" > ")}
            </div>
          ) : null}
          <div className="aula-actions">
            <AulaButton onClick={() => updateStatus("open")} disabled={session.status === "open"}>
              Obrir sessio
            </AulaButton>
            <AulaButton
              variant="secondary"
              onClick={() => updateStatus("closed")}
              disabled={session.status === "closed"}
            >
              Tancar sessio
            </AulaButton>
            <AulaButton href={`/aula/session/${session.id}/results`} variant="secondary">
              Veure resultats
            </AulaButton>
            <AulaButton variant="secondary" onClick={() => setShowSolution((prev) => !prev)}>
              Mostrar solucio
            </AulaButton>
          </div>
        </AulaCard>
      ) : null}
    </AulaLayout>
  );
}
