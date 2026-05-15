import { useEffect, useMemo, useState } from "react";
import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import {
  createAulaSession,
  listChallengePacks,
  listChallenges,
  setAulaSessionStatus
} from "../lib/aulaApi.js";

export default function CreateSessionPage({ access }) {
  const [packs, setPacks] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [packId, setPackId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [title, setTitle] = useState("");
  const [settings, setSettings] = useState({
    mode: "equips",
    time_limit_seconds: "",
    show_ranking: true,
    show_solution_at_end: true,
    allow_powerups: false
  });
  const [created, setCreated] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([listChallengePacks(), listChallenges()])
      .then(([packItems, challengeItems]) => {
        if (cancelled) return;
        setPacks(packItems);
        setChallenges(challengeItems);
        setPackId(packItems[0]?.id || "");
        setStatus("ready");
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus("error");
          setMessage(error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredChallenges = useMemo(
    () => challenges.filter((challenge) => !packId || challenge.pack_id === packId),
    [challenges, packId]
  );

  useEffect(() => {
    if (!filteredChallenges.some((challenge) => challenge.id === challengeId)) {
      setChallengeId(filteredChallenges[0]?.id || "");
    }
  }, [filteredChallenges, challengeId]);

  function updateSetting(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    try {
      const cleanSettings = {
        ...settings,
        time_limit_seconds: settings.time_limit_seconds
          ? Number(settings.time_limit_seconds)
          : null
      };
      const session = await createAulaSession({
        challengeId,
        title,
        settings: cleanSettings
      });
      setCreated(session);
      setStatus("ready");
    } catch (error) {
      setStatus("ready");
      setMessage(error.message);
    }
  }

  async function handleOpen() {
    if (!created?.id) return;
    try {
      const updated = await setAulaSessionStatus(created.id, "open");
      setCreated(updated);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <AulaLayout access={access}>
      <section className="aula-panel-head">
        <div>
          <p className="aula-eyebrow">Sessió d'aula</p>
          <h1>Crear sessió</h1>
          <p>Tria un repte preparat i genera un codi temporal per a l'alumnat.</p>
        </div>
      </section>

      {status === "loading" ? <AulaLoading label="Carregant reptes..." /> : null}
      {message ? <p className="aula-message aula-message-error">{message}</p> : null}

      {created ? (
        <AulaCard>
          <p className="aula-eyebrow">Sessió creada</p>
          <h2>Codi de sessió: {created.join_code}</h2>
          <p>
            Enllaç per a l'alumnat:{" "}
            <a href={`/aula/join?code=${created.join_code}`}>/aula/join?code={created.join_code}</a>
          </p>
          <p>Estat actual: {created.status}</p>
          <div className="aula-actions">
            <AulaButton onClick={handleOpen} disabled={created.status === "open"}>
              Obrir sessió
            </AulaButton>
            <AulaButton href={`/aula/session/${created.id}/projector`} variant="secondary">
              Mode projector
            </AulaButton>
            <AulaButton href={`/aula/session/${created.id}/results`} variant="secondary">
              Resultats
            </AulaButton>
          </div>
        </AulaCard>
      ) : (
        <AulaCard>
          <form className="aula-form aula-form-grid" onSubmit={handleSubmit}>
            <label>
              Pack
              <select value={packId} onChange={(event) => setPackId(event.target.value)} required>
                {packs.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Repte
              <select
                value={challengeId}
                onChange={(event) => setChallengeId(event.target.value)}
                required
              >
                {filteredChallenges.map((challenge) => (
                  <option key={challenge.id} value={challenge.id}>
                    {challenge.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Títol de sessió
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Modalitat
              <select value={settings.mode} onChange={(event) => updateSetting("mode", event.target.value)}>
                <option value="equips">Equips</option>
                <option value="individual">Individual</option>
              </select>
            </label>
            <label>
              Límit de temps (segons)
              <input
                type="number"
                min="0"
                value={settings.time_limit_seconds}
                onChange={(event) => updateSetting("time_limit_seconds", event.target.value)}
              />
            </label>
            <label className="aula-check">
              <input
                type="checkbox"
                checked={settings.show_ranking}
                onChange={(event) => updateSetting("show_ranking", event.target.checked)}
              />
              Mostrar rànquing
            </label>
            <label className="aula-check">
              <input
                type="checkbox"
                checked={settings.show_solution_at_end}
                onChange={(event) =>
                  updateSetting("show_solution_at_end", event.target.checked)
                }
              />
              Mostrar solució al final
            </label>
            <label className="aula-check">
              <input
                type="checkbox"
                checked={settings.allow_powerups}
                onChange={(event) => updateSetting("allow_powerups", event.target.checked)}
              />
              Permetre comodins
            </label>
            <AulaButton type="submit" disabled={status === "saving" || !challengeId}>
              {status === "saving" ? "Creant..." : "Crear sessió"}
            </AulaButton>
          </form>
        </AulaCard>
      )}
    </AulaLayout>
  );
}
