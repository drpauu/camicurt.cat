import { useState } from "react";
import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import useAulaSession from "../hooks/useAulaSession.js";
import { setAulaSessionStatus } from "../lib/aulaApi.js";
import { formatComarcaName, formatComarcaPath } from "../lib/comarcaNames.js";

function formatSeconds(value) {
  if (value === null || value === undefined) return "";
  const seconds = Number(value) || 0;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

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
  const results = bundle?.results || [];
  const showRanking = session?.settings?.show_ranking ?? challenge?.game_settings?.show_ranking ?? true;
  const ranking = [...results]
    .filter((result) => result.completed)
    .sort(
      (a, b) =>
        (a.distance_from_optimal ?? 999) - (b.distance_from_optimal ?? 999) ||
        (a.attempts_count ?? 999) - (b.attempts_count ?? 999) ||
        (a.time_seconds ?? 999999) - (b.time_seconds ?? 999999)
    )
    .slice(0, 6);
  const joinUrl =
    session?.join_code && typeof window !== "undefined"
      ? `${window.location.origin}/aula/join?code=${session.join_code}`
      : session?.join_code
        ? `/aula/join?code=${session.join_code}`
        : "";
  const qrUrl = joinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}`
    : "";
  const completedCount = results.filter((result) => result.completed).length;

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
              <strong>{formatComarcaName(challenge.start_id)}</strong>
            </div>
            <div>
              <span>Destí</span>
              <strong>{formatComarcaName(challenge.target_id)}</strong>
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
              <span>Completats</span>
              <strong>
                {completedCount}/{bundle.participants.length}
              </strong>
            </div>
            <div>
              <span>Estat</span>
              <strong>{session.status}</strong>
            </div>
            <div>
              <span>Tipus</span>
              <strong>{session.session_type === "homework" ? "Deures" : "Aula"}</strong>
            </div>
          </div>
          <div className="aula-projector-live">
            <div>
              <p className="aula-eyebrow">Entrada</p>
              {qrUrl ? <img className="aula-qr" src={qrUrl} alt={`QR per entrar amb el codi ${session.join_code}`} /> : null}
              <p>
                <a href={joinUrl}>{joinUrl}</a>
              </p>
            </div>
            <div>
              <p className="aula-eyebrow">Rànquing en directe</p>
              {!showRanking ? <p className="aula-empty">Rànquing ocult per a aquesta activitat.</p> : null}
              {showRanking && !ranking.length ? <p className="aula-empty">Esperant resultats...</p> : null}
              {showRanking && ranking.length ? (
                <ol className="aula-ranking">
                  {ranking.map((result) => (
                    <li key={result.id}>
                      <strong>{result.display_name}</strong>
                      <span>
                        {result.attempts_count} intents · {formatSeconds(result.time_seconds)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </div>
          {challenge.student_prompt ? <p>{challenge.student_prompt}</p> : null}
          {showSolution ? (
            <div className="aula-solution">
              <strong>Solució:</strong> {formatComarcaPath(challenge.shortest_path)}
            </div>
          ) : null}
          <div className="aula-actions">
            <AulaButton onClick={() => updateStatus("open")} disabled={session.status === "open"}>
              Obrir sessió
            </AulaButton>
            <AulaButton
              variant="secondary"
              onClick={() => updateStatus("closed")}
              disabled={session.status === "closed"}
            >
              Tancar sessió
            </AulaButton>
            <AulaButton href={`/aula/session/${session.id}/results`} variant="secondary">
              Veure resultats
            </AulaButton>
            <AulaButton variant="secondary" onClick={() => setShowSolution((prev) => !prev)}>
              Mostrar solució
            </AulaButton>
          </div>
        </AulaCard>
      ) : null}
    </AulaLayout>
  );
}
