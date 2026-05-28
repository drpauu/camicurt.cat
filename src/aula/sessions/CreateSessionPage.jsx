import { useEffect, useMemo, useState } from "react";
import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import {
  createAulaSession,
  listAulaLevels,
  setAulaSessionStatus
} from "../lib/aulaApi.js";
import { formatComarcaName } from "../lib/comarcaNames.js";

export default function CreateSessionPage({ access }) {
  const [levels, setLevels] = useState([]);
  const [levelFilter, setLevelFilter] = useState("all");
  const [challengeId, setChallengeId] = useState("");
  const [title, setTitle] = useState("");
  const [settings, setSettings] = useState({
    classroom_mode: "equips",
    time_limit_seconds: "",
    show_ranking: "level",
    show_solution_at_end: "level",
    allow_powerups: "level"
  });
  const [created, setCreated] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    listAulaLevels()
      .then((levelItems) => {
        if (cancelled) return;
        setLevels(levelItems);
        setChallengeId(levelItems[0]?.id || "");
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

  const filteredLevels = useMemo(
    () =>
      levels.filter((level) => {
        if (levelFilter === "custom") return level.source === "custom";
        if (levelFilter === "packs") return level.source !== "custom";
        return true;
      }),
    [levels, levelFilter]
  );

  useEffect(() => {
    if (!filteredLevels.some((level) => level.id === challengeId)) {
      setChallengeId(filteredLevels[0]?.id || "");
    }
  }, [filteredLevels, challengeId]);

  function updateSetting(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    try {
      const cleanSettings = {
        classroom_mode: settings.classroom_mode
      };
      if (settings.time_limit_seconds) {
        cleanSettings.time_limit_seconds = Number(settings.time_limit_seconds);
      }
      if (settings.show_ranking !== "level") {
        cleanSettings.show_ranking = settings.show_ranking === "true";
      }
      if (settings.show_solution_at_end !== "level") {
        cleanSettings.show_solution_at_end = settings.show_solution_at_end === "true";
      }
      if (settings.allow_powerups !== "level") {
        cleanSettings.allow_powerups = settings.allow_powerups === "true";
      }
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
              Biblioteca
              <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
                <option value="all">Tots els nivells</option>
                <option value="custom">Nivells propis</option>
                <option value="packs">Packs preparats</option>
              </select>
            </label>
            <label>
              Nivell
              <select
                value={challengeId}
                onChange={(event) => setChallengeId(event.target.value)}
                required
              >
                {filteredLevels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.source === "custom" ? "Propi · " : ""}
                    {level.title} ({formatComarcaName(level.start_id)} → {formatComarcaName(level.target_id)})
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
              <select
                value={settings.classroom_mode}
                onChange={(event) => updateSetting("classroom_mode", event.target.value)}
              >
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
            <label>
              Rànquing
              <select
                value={settings.show_ranking}
                onChange={(event) => updateSetting("show_ranking", event.target.value)}
              >
                <option value="level">Segons el nivell</option>
                <option value="true">Mostrar</option>
                <option value="false">Amagar</option>
              </select>
            </label>
            <label>
              Solució al final
              <select
                value={settings.show_solution_at_end}
                onChange={(event) => updateSetting("show_solution_at_end", event.target.value)}
              >
                <option value="level">Segons el nivell</option>
                <option value="true">Mostrar</option>
                <option value="false">Amagar</option>
              </select>
            </label>
            <label>
              Comodins
              <select
                value={settings.allow_powerups}
                onChange={(event) => updateSetting("allow_powerups", event.target.value)}
              >
                <option value="level">Segons el nivell</option>
                <option value="true">Permetre</option>
                <option value="false">Bloquejar</option>
              </select>
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
