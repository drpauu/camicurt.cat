import { useMemo, useState } from "react";
import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import { joinAulaSession } from "../lib/aulaApi.js";

export default function JoinSessionPage() {
  const initialCode = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("code") || "";
  }, []);
  const [joinCode, setJoinCode] = useState(initialCode);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const result = await joinAulaSession({
        joinCode: joinCode.trim(),
        displayName: displayName.trim()
      });
      const storageKey = `aula-participant:${result.sessionId}`;
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          participantId: result.participantId,
          participantToken: result.participantToken,
          displayName: displayName.trim(),
          challenge: result.challenge
        })
      );
      window.location.assign(`/aula/play/${result.sessionId}`);
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Codi invalid o sessio no disponible.");
    }
  }

  return (
    <AulaLayout>
      <div className="aula-narrow">
        <AulaCard>
          <p className="aula-eyebrow">Entrada d'alumnat</p>
          <h1>Entra a la sessio</h1>
          <form className="aula-form" onSubmit={handleSubmit}>
            <label>
              Codi de sessio
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                required
                maxLength={12}
                autoComplete="off"
              />
            </label>
            <label>
              Nom d'equip o pseudonim
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                minLength={1}
                maxLength={60}
                autoComplete="off"
              />
            </label>
            <AulaButton type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Entrant..." : "Comencar"}
            </AulaButton>
          </form>
          {message ? <p className="aula-message aula-message-error">{message}</p> : null}
        </AulaCard>
      </div>
    </AulaLayout>
  );
}
