import { useEffect, useMemo, useState } from "react";
import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import { createCustomLevel, listAulaLevels, updateCustomLevel } from "../lib/aulaApi.js";
import { COMARCA_OPTIONS, formatComarcaName, formatComarcaPath } from "../lib/comarcaNames.js";
import {
  loadAulaMapGraph,
  parseComarcaList,
  validateLevelDraft
} from "../lib/aulaLevelValidation.js";

const DIFFICULTIES = [
  { id: "pixapi", label: "Pixapí" },
  { id: "dominguero", label: "Dominguero" },
  { id: "rondinaire", label: "Rondinaire" },
  { id: "cap-colla-rutes", label: "Cap de colla de rutes" }
];

const emptyForm = {
  title: "",
  description: "",
  startId: "segarra",
  targetId: "terra-alta",
  difficultyId: "pixapi",
  pathText: "segarra > conca-de-barbera > baix-camp > baix-ebre > terra-alta",
  ruleKind: "",
  ruleLabel: "",
  ruleComarquesText: "",
  studentPrompt: "",
  teacherExplanation: "",
  mode: "normal",
  maxAttempts: "",
  timeLimitSeconds: "",
  allowPowerups: false,
  revealNext: 0,
  revealRule: 0,
  tempInitials: 0,
  showRanking: true,
  showSolutionAtEnd: true
};

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function formToDraft(form) {
  const shortestPath = parseComarcaList(form.pathText);
  const ruleComarcaIds = parseComarcaList(form.ruleComarquesText);
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    startId: form.startId,
    targetId: form.targetId,
    difficultyId: form.difficultyId,
    ruleKind: form.ruleKind || null,
    ruleLabel: form.ruleLabel.trim(),
    ruleComarcaIds,
    shortestPath,
    studentPrompt: form.studentPrompt.trim(),
    teacherExplanation: form.teacherExplanation.trim(),
    gameSettings: {
      mode: form.mode,
      max_attempts: numberOrNull(form.maxAttempts),
      time_limit_seconds: form.mode === "timed" ? numberOrNull(form.timeLimitSeconds) : null,
      allow_powerups: Boolean(form.allowPowerups),
      show_ranking: Boolean(form.showRanking),
      show_solution_at_end: Boolean(form.showSolutionAtEnd),
      powerups: {
        "reveal-next": Math.max(0, Number(form.revealNext) || 0),
        "reveal-rule": Math.max(0, Number(form.revealRule) || 0),
        "temp-initials": Math.max(0, Number(form.tempInitials) || 0)
      }
    }
  };
}

function levelToForm(level) {
  const settings = level.game_settings || {};
  const powerups = settings.powerups || {};
  const rule = level.rule || {};
  const ruleKind =
    rule.kind ||
    (Array.isArray(level.avoid_ids) && level.avoid_ids.length
      ? "avoid"
      : Array.isArray(level.must_pass_ids) && level.must_pass_ids.length
        ? "mustIncludeAny"
        : "");
  const ruleIds = ruleKind === "avoid" ? level.avoid_ids || [] : level.must_pass_ids || [];
  return {
    ...emptyForm,
    title: level.title || "",
    description: level.description || "",
    startId: level.start_id || emptyForm.startId,
    targetId: level.target_id || emptyForm.targetId,
    difficultyId: level.difficulty_id || "pixapi",
    pathText: formatComarcaPath(level.manual_shortest_path || level.shortest_path || [], " > "),
    ruleKind,
    ruleLabel: rule.label || "",
    ruleComarquesText: formatComarcaPath(ruleIds, ", "),
    studentPrompt: level.student_prompt || "",
    teacherExplanation: level.teacher_explanation || "",
    mode: settings.mode || "normal",
    maxAttempts: settings.max_attempts || "",
    timeLimitSeconds: settings.time_limit_seconds || "",
    allowPowerups: Boolean(settings.allow_powerups),
    revealNext: powerups["reveal-next"] || 0,
    revealRule: powerups["reveal-rule"] || 0,
    tempInitials: powerups["temp-initials"] || 0,
    showRanking: settings.show_ranking !== false,
    showSolutionAtEnd: settings.show_solution_at_end !== false
  };
}

function draftToSnapshot(draft) {
  return {
    id: "preview",
    mode: "aula",
    difficultyId: draft.difficultyId,
    startId: draft.startId,
    targetId: draft.targetId,
    rule: draft.ruleKind
      ? {
          id: "custom-rule",
          kind: draft.ruleKind,
          label: draft.ruleLabel,
          comarcaIds: draft.ruleComarcaIds,
          comarques: draft.ruleComarcaIds.map(formatComarcaName)
        }
      : null,
    avoidIds: draft.ruleKind === "avoid" ? draft.ruleComarcaIds : [],
    mustPassIds: draft.ruleKind === "mustIncludeAny" ? draft.ruleComarcaIds : [],
    shortestPath: draft.shortestPath,
    shortestInternalCount: Math.max(draft.shortestPath.length - 2, 0),
    studentPrompt: draft.studentPrompt,
    gameSettings: draft.gameSettings
  };
}

export default function LevelBuilderPage({ access, PublicGameApp }) {
  const [form, setForm] = useState(emptyForm);
  const [levels, setLevels] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [graph, setGraph] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("ok");
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listAulaLevels(), loadAulaMapGraph().catch(() => null)])
      .then(([items, graphData]) => {
        if (cancelled) return;
        setLevels(items);
        setGraph(graphData);
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

  const draft = useMemo(() => formToDraft(form), [form]);
  const validation = useMemo(() => validateLevelDraft(draft, graph), [draft, graph]);
  const customLevels = levels.filter((level) => level.source === "custom");
  const previewSnapshot =
    validation.errors.length === 0 && draft.shortestPath.length ? draftToSnapshot(draft) : null;

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setPreviewOpen(false);
    setMessage("");
    setMessageType("ok");
  }

  async function reloadLevels() {
    const items = await listAulaLevels();
    setLevels(items);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("ok");
    setStatus("saving");
    try {
      if (validation.errors.length) {
        throw new Error(validation.errors[0]);
      }
      const payload = {
        ...draft,
        validationWarnings: validation.warnings
      };
      const saved = editingId
        ? await updateCustomLevel(editingId, payload)
        : await createCustomLevel(payload);
      setEditingId(saved.id);
      setForm(levelToForm(saved));
      await reloadLevels();
      setStatus("ready");
      setMessage(editingId ? "Nivell actualitzat." : "Nivell creat.");
      setMessageType("ok");
    } catch (error) {
      setStatus("ready");
      setMessage(error.message);
      setMessageType("error");
    }
  }

  return (
    <AulaLayout access={access} wide>
      <section className="aula-panel-head">
        <div>
          <p className="aula-eyebrow">Nivells personalitzats</p>
          <h1>Crear nivell</h1>
          <p>Defineix inici, destí, norma, camí correcte i condicions de joc.</p>
        </div>
        <div className="aula-actions">
          <AulaButton href="/aula/homework" variant="secondary">
            Assignar deures
          </AulaButton>
          <AulaButton onClick={resetForm} variant="secondary">
            Nou nivell
          </AulaButton>
        </div>
      </section>

      {status === "loading" ? <AulaLoading label="Carregant nivells..." /> : null}
      {message ? (
        <p className={`aula-message ${messageType === "error" ? "aula-message-error" : "aula-message-ok"}`}>
          {message}
        </p>
      ) : null}

      <div className="aula-grid aula-grid-two aula-level-builder">
        <AulaCard>
          <form className="aula-form aula-form-grid" onSubmit={handleSubmit}>
            <label>
              Títol
              <input value={form.title} onChange={(event) => update("title", event.target.value)} />
            </label>
            <label>
              Dificultat
              <select
                value={form.difficultyId}
                onChange={(event) => update("difficultyId", event.target.value)}
              >
                {DIFFICULTIES.map((difficulty) => (
                  <option key={difficulty.id} value={difficulty.id}>
                    {difficulty.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Inici
              <select value={form.startId} onChange={(event) => update("startId", event.target.value)}>
                {COMARCA_OPTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Destí
              <select value={form.targetId} onChange={(event) => update("targetId", event.target.value)}>
                {COMARCA_OPTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="aula-field-wide">
              Camí curt correcte
              <textarea
                rows="3"
                value={form.pathText}
                onChange={(event) => update("pathText", event.target.value)}
              />
            </label>
            <label>
              Norma
              <select value={form.ruleKind} onChange={(event) => update("ruleKind", event.target.value)}>
                <option value="">Sense norma</option>
                <option value="mustIncludeAny">Ha de passar per</option>
                <option value="avoid">No pot passar per</option>
              </select>
            </label>
            <label>
              Comarques de la norma
              <input
                value={form.ruleComarquesText}
                onChange={(event) => update("ruleComarquesText", event.target.value)}
              />
            </label>
            <label className="aula-field-wide">
              Text de la norma
              <input value={form.ruleLabel} onChange={(event) => update("ruleLabel", event.target.value)} />
            </label>
            <label>
              Mode de joc
              <select value={form.mode} onChange={(event) => update("mode", event.target.value)}>
                <option value="normal">Normal</option>
                <option value="timed">Contrarellotge</option>
                <option value="explore">Explora</option>
              </select>
            </label>
            <label>
              Intents màxims
              <input
                type="number"
                min="1"
                value={form.maxAttempts}
                onChange={(event) => update("maxAttempts", event.target.value)}
              />
            </label>
            <label>
              Temps en segons
              <input
                type="number"
                min="10"
                value={form.timeLimitSeconds}
                onChange={(event) => update("timeLimitSeconds", event.target.value)}
                disabled={form.mode !== "timed"}
              />
            </label>
            <label className="aula-check">
              <input
                type="checkbox"
                checked={form.allowPowerups}
                onChange={(event) => update("allowPowerups", event.target.checked)}
              />
              Activar comodins
            </label>
            <label>
              Comodí revela pas
              <input
                type="number"
                min="0"
                value={form.revealNext}
                onChange={(event) => update("revealNext", event.target.value)}
                disabled={!form.allowPowerups}
              />
            </label>
            <label>
              Comodí norma
              <input
                type="number"
                min="0"
                value={form.revealRule}
                onChange={(event) => update("revealRule", event.target.value)}
                disabled={!form.allowPowerups}
              />
            </label>
            <label>
              Comodí inicials
              <input
                type="number"
                min="0"
                value={form.tempInitials}
                onChange={(event) => update("tempInitials", event.target.value)}
                disabled={!form.allowPowerups}
              />
            </label>
            <label className="aula-check">
              <input
                type="checkbox"
                checked={form.showRanking}
                onChange={(event) => update("showRanking", event.target.checked)}
              />
              Mostrar rànquing
            </label>
            <label className="aula-check">
              <input
                type="checkbox"
                checked={form.showSolutionAtEnd}
                onChange={(event) => update("showSolutionAtEnd", event.target.checked)}
              />
              Mostrar solució al final
            </label>
            <label className="aula-field-wide">
              Enunciat per a l'alumnat
              <textarea
                rows="2"
                value={form.studentPrompt}
                onChange={(event) => update("studentPrompt", event.target.value)}
              />
            </label>
            <label className="aula-field-wide">
              Explicació docent
              <textarea
                rows="2"
                value={form.teacherExplanation}
                onChange={(event) => update("teacherExplanation", event.target.value)}
              />
            </label>
            <div className="aula-field-wide aula-actions">
              <AulaButton type="submit" disabled={status === "saving" || validation.errors.length > 0}>
                {status === "saving" ? "Desant..." : editingId ? "Actualitzar nivell" : "Crear nivell"}
              </AulaButton>
              <AulaButton
                type="button"
                variant="secondary"
                onClick={() => setPreviewOpen((value) => !value)}
                disabled={!previewSnapshot}
              >
                Vista prèvia
              </AulaButton>
            </div>
          </form>
        </AulaCard>

        <div className="aula-grid">
          <AulaCard>
            <p className="aula-eyebrow">Validació</p>
            {validation.errors.length ? (
              <div className="aula-message aula-message-error">
                {validation.errors.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : (
              <p className="aula-message aula-message-ok">El nivell és publicable.</p>
            )}
            {validation.warnings.length ? (
              <div className="aula-message">
                {validation.warnings.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : null}
          </AulaCard>

          <AulaCard>
            <div className="aula-section-title">
              <div>
                <p className="aula-eyebrow">Biblioteca del centre</p>
                <h2>Nivells creats</h2>
              </div>
            </div>
            {!customLevels.length ? <p className="aula-empty">Encara no hi ha nivells propis.</p> : null}
            {customLevels.length ? (
              <div className="aula-table-wrap">
                <table className="aula-table aula-table-compact">
                  <thead>
                    <tr>
                      <th>Títol</th>
                      <th>Ruta</th>
                      <th>Estat</th>
                      <th>Accions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customLevels.map((level) => (
                      <tr key={level.id}>
                        <td>{level.title}</td>
                        <td>
                          {formatComarcaName(level.start_id)} → {formatComarcaName(level.target_id)}
                        </td>
                        <td>{level.validation_status === "warning" ? "Amb avisos" : "Correcte"}</td>
                        <td>
                          <button
                            type="button"
                            className="aula-link-button"
                            onClick={() => {
                              setEditingId(level.id);
                              setForm(levelToForm(level));
                              setPreviewOpen(false);
                            }}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </AulaCard>
        </div>
      </div>

      {previewOpen && previewSnapshot && PublicGameApp ? (
        <AulaCard className="aula-preview-card">
          <p className="aula-eyebrow">Vista prèvia jugable</p>
          <div className="aula-preview-frame">
            <PublicGameApp
              variant="aula"
              fixedLevelSnapshot={previewSnapshot}
              hidePublicChrome
              disableModeSwitch
              disableCalendar
              disableLocalRecords
            />
          </div>
        </AulaCard>
      ) : null}
    </AulaLayout>
  );
}
