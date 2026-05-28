import { useEffect, useMemo, useState } from "react";
import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import { createHomeworkSession, listAulaLevels, listTeacherSessions } from "../lib/aulaApi.js";
import { formatComarcaName } from "../lib/comarcaNames.js";

function formatDate(value) {
  if (!value) return "Sense data";
  return new Intl.DateTimeFormat("ca-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export default function HomeworkPage({ access }) {
  const [levels, setLevels] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState({
    challengeId: "",
    title: "",
    instructions: "",
    dueAt: "",
    copySettings: true
  });
  const [created, setCreated] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("ok");

  useEffect(() => {
    let cancelled = false;
    Promise.all([listAulaLevels(), listTeacherSessions(40)])
      .then(([levelItems, sessionItems]) => {
        if (cancelled) return;
        setLevels(levelItems);
        setSessions(sessionItems);
        setForm((prev) => ({ ...prev, challengeId: levelItems[0]?.id || "" }));
        setStatus("ready");
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus("error");
          setMessage(error.message);
          setMessageType("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const homeworkSessions = sessions.filter((session) => session.session_type === "homework");
  const selectedLevel = useMemo(
    () => levels.find((level) => level.id === form.challengeId) || null,
    [levels, form.challengeId]
  );

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function reloadSessions() {
    const items = await listTeacherSessions(40);
    setSessions(items);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    setMessageType("ok");
    try {
      const session = await createHomeworkSession({
        challengeId: form.challengeId,
        title: form.title || selectedLevel?.title || "Deures de Camicurt",
        instructions: form.instructions,
        dueAt: toIsoDate(form.dueAt),
        settings: form.copySettings ? selectedLevel?.game_settings || {} : {}
      });
      setCreated(session);
      await reloadSessions();
      setStatus("ready");
      setMessage("Deures creats.");
      setMessageType("ok");
    } catch (error) {
      setStatus("ready");
      setMessage(error.message);
      setMessageType("error");
    }
  }

  const joinUrl =
    created?.join_code && typeof window !== "undefined"
      ? `${window.location.origin}/aula/join?code=${created.join_code}`
      : created?.join_code
        ? `/aula/join?code=${created.join_code}`
        : "";

  return (
    <AulaLayout access={access} wide>
      <section className="aula-panel-head">
        <div>
          <p className="aula-eyebrow">Deures per classe</p>
          <h1>Assignar deures</h1>
          <p>L'alumnat entra amb un codi compartit i només escriu pseudònim o nom d'equip.</p>
        </div>
        <div className="aula-actions">
          <AulaButton href="/aula/levels" variant="secondary">
            Crear nivell
          </AulaButton>
        </div>
      </section>

      {status === "loading" ? <AulaLoading label="Carregant deures..." /> : null}
      {message ? (
        <p className={`aula-message ${messageType === "error" ? "aula-message-error" : "aula-message-ok"}`}>
          {message}
        </p>
      ) : null}

      {created ? (
        <AulaCard>
          <p className="aula-eyebrow">Deures publicats</p>
          <h2>Codi: {created.join_code}</h2>
          <p>
            Enllaç per a l'alumnat: <a href={joinUrl}>{joinUrl}</a>
          </p>
          <div className="aula-actions">
            <AulaButton href={`/aula/session/${created.id}/projector`}>Obrir pissarra</AulaButton>
            <AulaButton href={`/aula/session/${created.id}/results`} variant="secondary">
              Veure estadístiques
            </AulaButton>
          </div>
        </AulaCard>
      ) : null}

      <div className="aula-grid aula-grid-two">
        <AulaCard>
          <form className="aula-form" onSubmit={handleSubmit}>
            <label>
              Nivell
              <select
                value={form.challengeId}
                onChange={(event) => update("challengeId", event.target.value)}
                required
              >
                {levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.source === "custom" ? "Propi · " : ""}
                    {level.title}
                  </option>
                ))}
              </select>
            </label>
            {selectedLevel ? (
              <p className="aula-muted-line">
                {formatComarcaName(selectedLevel.start_id)} → {formatComarcaName(selectedLevel.target_id)} ·{" "}
                {selectedLevel.difficulty_id}
              </p>
            ) : null}
            <label>
              Títol dels deures
              <input value={form.title} onChange={(event) => update("title", event.target.value)} />
            </label>
            <label>
              Data límit
              <input
                type="datetime-local"
                value={form.dueAt}
                onChange={(event) => update("dueAt", event.target.value)}
              />
            </label>
            <label>
              Instruccions
              <textarea
                rows="4"
                value={form.instructions}
                onChange={(event) => update("instructions", event.target.value)}
              />
            </label>
            <label className="aula-check">
              <input
                type="checkbox"
                checked={form.copySettings}
                onChange={(event) => update("copySettings", event.target.checked)}
              />
              Fer servir la configuració del nivell
            </label>
            <AulaButton type="submit" disabled={status === "saving" || !form.challengeId}>
              {status === "saving" ? "Creant..." : "Crear deures"}
            </AulaButton>
          </form>
        </AulaCard>

        <AulaCard>
          <p className="aula-eyebrow">Seguiment</p>
          <h2>Últims deures</h2>
          {!homeworkSessions.length ? <p className="aula-empty">Encara no hi ha deures creats.</p> : null}
          {homeworkSessions.length ? (
            <div className="aula-table-wrap">
              <table className="aula-table">
                <thead>
                  <tr>
                    <th>Títol</th>
                    <th>Codi</th>
                    <th>Límit</th>
                    <th>Accions</th>
                  </tr>
                </thead>
                <tbody>
                  {homeworkSessions.map((session) => (
                    <tr key={session.id}>
                      <td>{session.title || "Deures sense títol"}</td>
                      <td>
                        <strong>{session.join_code}</strong>
                      </td>
                      <td>{formatDate(session.due_at || session.expires_at)}</td>
                      <td>
                        <a href={`/aula/session/${session.id}/results`}>Resultats</a>{" "}
                        <a href={`/aula/session/${session.id}/projector`}>Pissarra</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="aula-muted-line">
            Amb codi compartit es registren pseudònims que entren i envien resultat; no es pot saber qui falta si no hi ha una llista prèvia d'alumnes.
          </p>
        </AulaCard>
      </div>
    </AulaLayout>
  );
}
