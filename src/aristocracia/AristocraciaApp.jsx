import { useEffect, useMemo, useState } from "react";
import AdminLicenses from "../aula/admin/AdminLicenses.jsx";
import AdminOrganizations from "../aula/admin/AdminOrganizations.jsx";
import AulaButton from "../aula/components/AulaButton.jsx";
import AulaCard from "../aula/components/AulaCard.jsx";
import AulaLoading from "../aula/components/AulaLoading.jsx";
import {
  createAdminLicense,
  inviteTeacher
} from "../aula/lib/aulaAdminApi.js";
import {
  getAristocraciaAccess,
  getAristocraciaDashboard,
  runAristocraciaHealthChecks,
  signInAristocracia,
  signOutAristocracia,
  updateStatusOverride,
  upsertAristocraciaWorker,
  upsertSocialLink
} from "./lib/aristocraciaApi.js";

const tabs = [
  { id: "resum", label: "Resum" },
  { id: "llicencies", label: "Llicències" },
  { id: "status", label: "Status" },
  { id: "xarxes", label: "Xarxes" },
  { id: "treballadors", label: "Treballadors" }
];

const today = new Date().toISOString().slice(0, 10);
const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

function statusLabel(value) {
  const labels = {
    online: "Operatiu",
    degraded: "Degradat",
    offline: "Caigut",
    maintenance: "Manteniment",
    unknown: "Sense dades",
    active: "Actiu",
    trial: "Prova",
    expired: "Caducada",
    pending_payment: "Pagament pendent",
    suspended: "Suspesa",
    cancelled: "Cancel·lada",
    draft: "Esborrany",
    hidden: "Amagat",
    owner: "Owner",
    admin: "Admin",
    support: "Suport"
  };
  return labels[value] || value || "Sense dades";
}

function statusTone(value) {
  if (["online", "active", "owner", "admin"].includes(value)) return "online";
  if (["trial", "draft", "support", "pending_payment", "degraded", "maintenance"].includes(value)) {
    return "degraded";
  }
  if (["offline", "expired", "suspended", "cancelled", "hidden", "disabled", "removed"].includes(value)) {
    return "offline";
  }
  return "unknown";
}

function formatDateTime(value) {
  if (!value) return "Mai";
  return new Intl.DateTimeFormat("ca-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function normalizeLicenses(dashboard) {
  return Array.isArray(dashboard?.licenses) ? dashboard.licenses : [];
}

function StatusBadge({ value }) {
  return (
    <span className={`aristocracia-status-badge status-${statusTone(value)}`}>
      {statusLabel(value)}
    </span>
  );
}

function MetricCard({ label, value, detail, tone = "neutral" }) {
  return (
    <AulaCard className={`aristocracia-metric-card tone-${tone}`}>
      <p className="aula-eyebrow">{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </AulaCard>
  );
}

function SectionHeader({ eyebrow, title, description, children }) {
  return (
    <div className="aristocracia-section-header">
      <div>
        <p className="aula-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <div className="aristocracia-section-actions">{children}</div> : null}
    </div>
  );
}

function AristocraciaLogin({ initialMessage = "" }) {
  const [email, setEmail] = useState("pau@camicurt.cat");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState(initialMessage);

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      await signInAristocracia(email.trim(), password);
      const access = await getAristocraciaAccess();
      if (!access?.allowed) {
        throw new Error("Aquest usuari no té accés a Aristocracia.");
      }
      window.location.assign("/aristocracia");
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "No s'ha pogut iniciar sessió.");
    }
  }

  return (
    <div className="aula-shell aristocracia-shell">
      <main className="aula-main">
        <div className="aula-narrow">
          <AulaCard className="aristocracia-auth-card">
            <p className="aula-eyebrow">Backoffice intern</p>
            <h1>Aristocracia</h1>
            <p>Accés privat per gestionar Camicurt, Aula, llicències, status i equip intern.</p>
            <form className="aula-form" onSubmit={handleSubmit}>
              <label>
                Correu
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Contrasenya
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <AulaButton type="submit" disabled={status === "loading"}>
                {status === "loading" ? "Entrant..." : "Entrar"}
              </AulaButton>
            </form>
            {message ? (
              <p className={`aula-message aula-message-${status === "error" ? "error" : "ok"}`}>
                {message}
              </p>
            ) : null}
          </AulaCard>
        </div>
      </main>
    </div>
  );
}

function AristocraciaLayout({ access, activeTab, onTabChange, children }) {
  async function handleSignOut() {
    await signOutAristocracia();
    window.location.assign("/aristocracia/login");
  }

  return (
    <div className="aula-shell aula-shell-wide aristocracia-shell">
      <header className="aula-header">
        <a className="aula-brand" href="/aristocracia" aria-label="Aristocracia">
          <span className="aula-brand-mark">A</span>
          <span>
            <strong>Aristocracia</strong>
            <small>{access?.worker?.email || "Backoffice intern"}</small>
          </span>
        </a>
        <nav className="aula-nav" aria-label="Navegació Aristocracia">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`aristocracia-tab ${activeTab === tab.id ? "is-active" : ""}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="aula-header-actions">
          <span className="aristocracia-role-pill">{statusLabel(access?.worker?.role)}</span>
          <button type="button" className="aula-link-button" onClick={handleSignOut}>
            Sortir
          </button>
        </div>
      </header>
      <main className="aula-main">{children}</main>
    </div>
  );
}

function OverviewTab({ dashboard }) {
  const summary = dashboard?.license_summary || {};
  const services = dashboard?.status_services || [];
  const workers = dashboard?.workers || [];
  const licenses = normalizeLicenses(dashboard);
  const incidents = services.filter((service) =>
    ["degraded", "offline", "maintenance"].includes(service.effective_status)
  );
  const latestLicenses = licenses.slice(0, 5);

  return (
    <div className="aula-grid aristocracia-dashboard">
      <div className="aula-grid aula-grid-four aristocracia-metrics">
        <MetricCard
          label="Llicències"
          value={summary.total || 0}
          detail={`${summary.active || 0} actives · ${summary.trial || 0} en prova`}
          tone="good"
        />
        <MetricCard
          label="Alertes comercials"
          value={(summary.expired || 0) + (summary.pending_payment || 0)}
          detail={`${summary.expired || 0} caducades · ${summary.pending_payment || 0} pendents`}
          tone={summary.expired || summary.pending_payment ? "warning" : "good"}
        />
        <MetricCard
          label="Serveis"
          value={services.length}
          detail={incidents.length ? `${incidents.length} incidències` : "Tot operatiu o sense avisos"}
          tone={incidents.length ? "warning" : "good"}
        />
        <MetricCard
          label="Treballadors"
          value={workers.length}
          detail={`${workers.filter((worker) => worker.status === "active").length} actius`}
          tone="neutral"
        />
      </div>

      <div className="aula-grid aula-grid-two aristocracia-overview-grid">
        <AulaCard className="aristocracia-panel-card">
          <SectionHeader
            eyebrow="Status ràpid"
            title="Salut dels serveis"
            description="Última lectura automàtica o override manual actiu."
          />
          <div className="aristocracia-status-list">
            {services.map((service) => (
              <div key={service.id} className="aristocracia-status-row">
                <div>
                  <strong>{service.name}</strong>
                  <span>{service.description}</span>
                </div>
                <StatusBadge value={service.effective_status} />
              </div>
            ))}
          </div>
        </AulaCard>

        <AulaCard className="aristocracia-panel-card">
          <SectionHeader
            eyebrow="Moviment"
            title="Últimes llicències"
            description="Centres ordenats per activitat comercial recent."
          />
          {latestLicenses.length ? (
            <div className="aristocracia-license-list">
              {latestLicenses.map((license) => (
                <div className="aristocracia-license-item" key={license.license_id}>
                  <div>
                    <strong>{license.organization_name}</strong>
                    <span>{license.city || "Sense ciutat"} · {license.plan}</span>
                  </div>
                  <StatusBadge value={license.status} />
                </div>
              ))}
            </div>
          ) : (
            <p className="aula-empty">Encara no hi ha llicències creades.</p>
          )}
        </AulaCard>
      </div>

      <AulaCard className="aristocracia-panel-card">
        <SectionHeader
          eyebrow="Equip"
          title="Accés intern"
          description="Treballadors actius amb permisos sobre aquest backoffice."
        />
        <div className="aristocracia-status-list">
          {workers.map((worker) => (
            <div key={worker.id} className="aristocracia-status-row">
              <div>
                <strong>{worker.full_name || worker.email}</strong>
                <span>{worker.email} · Últim accés: {formatDateTime(worker.last_seen_at)}</span>
              </div>
              <StatusBadge value={worker.role} />
            </div>
          ))}
        </div>
      </AulaCard>
    </div>
  );
}

function LicensesTab({ dashboard, onReload }) {
  const licenses = normalizeLicenses(dashboard);
  const [message, setMessage] = useState("");
  const [createForm, setCreateForm] = useState({
    organizationName: "",
    legalName: "",
    city: "",
    province: "",
    contactEmail: "",
    billingEmail: "",
    allowedDomainsText: "",
    plan: "pilot",
    status: "trial",
    startsAt: today,
    endsAt: nextMonth,
    maxTeachers: 1,
    maxClasses: "",
    maxSessionsPerMonth: "",
    maxParticipantsPerSession: 30,
    priceCents: "",
    billingReference: "",
    notes: ""
  });
  const [inviteForm, setInviteForm] = useState({
    organizationId: "",
    email: "",
    fullName: "",
    role: "teacher"
  });
  const organizations = useMemo(
    () =>
      licenses.map((license) => ({
        id: license.organization_id,
        name: license.organization_name
      })),
    [licenses]
  );

  function updateCreate(key, value) {
    setCreateForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateInvite(key, value) {
    setInviteForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(event) {
    event.preventDefault();
    setMessage("");
    try {
      await createAdminLicense({
        ...createForm,
        allowedDomains: createForm.allowedDomainsText
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      });
      setMessage("Organització i llicència creades.");
      await onReload();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function handleInvite(event) {
    event.preventDefault();
    setMessage("");
    try {
      await inviteTeacher(inviteForm);
      setMessage("Docent convidat.");
      setInviteForm((prev) => ({ ...prev, email: "", fullName: "" }));
      await onReload();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="aula-grid aristocracia-dashboard">
      {message ? <p className="aula-message aristocracia-floating-message">{message}</p> : null}
      <div className="aula-grid aula-grid-two aristocracia-editor-grid">
        <AulaCard className="aristocracia-panel-card">
          <SectionHeader
            eyebrow="Nova llicència"
            title="Crear centre"
            description="Alta comercial ràpida amb dates, límits i contacte principal."
          />
          <form className="aula-form aula-form-grid" onSubmit={handleCreate}>
            <label>
              Centre
              <input value={createForm.organizationName} onChange={(event) => updateCreate("organizationName", event.target.value)} required />
            </label>
            <label>
              Nom legal
              <input value={createForm.legalName} onChange={(event) => updateCreate("legalName", event.target.value)} />
            </label>
            <label>
              Ciutat
              <input value={createForm.city} onChange={(event) => updateCreate("city", event.target.value)} />
            </label>
            <label>
              Província
              <input value={createForm.province} onChange={(event) => updateCreate("province", event.target.value)} />
            </label>
            <label>
              Contacte
              <input type="email" value={createForm.contactEmail} onChange={(event) => updateCreate("contactEmail", event.target.value)} />
            </label>
            <label>
              Facturació
              <input type="email" value={createForm.billingEmail} onChange={(event) => updateCreate("billingEmail", event.target.value)} />
            </label>
            <label className="aula-field-wide">
              Dominis permesos
              <input value={createForm.allowedDomainsText} onChange={(event) => updateCreate("allowedDomainsText", event.target.value)} placeholder="centre.cat, xtec.cat" />
            </label>
            <label>
              Pla
              <select value={createForm.plan} onChange={(event) => updateCreate("plan", event.target.value)}>
                <option value="pilot">pilot</option>
                <option value="basic">basic</option>
                <option value="plus">plus</option>
                <option value="centre">centre</option>
              </select>
            </label>
            <label>
              Estat
              <select value={createForm.status} onChange={(event) => updateCreate("status", event.target.value)}>
                <option value="trial">prova</option>
                <option value="active">activa</option>
                <option value="pending_payment">pagament pendent</option>
              </select>
            </label>
            <label>
              Inici
              <input type="date" value={createForm.startsAt} onChange={(event) => updateCreate("startsAt", event.target.value)} required />
            </label>
            <label>
              Caducitat
              <input type="date" value={createForm.endsAt} onChange={(event) => updateCreate("endsAt", event.target.value)} required />
            </label>
            <label>
              Màx. docents
              <input type="number" min="1" value={createForm.maxTeachers} onChange={(event) => updateCreate("maxTeachers", event.target.value)} />
            </label>
            <label>
              Màx. alumnes/sessió
              <input type="number" min="1" value={createForm.maxParticipantsPerSession} onChange={(event) => updateCreate("maxParticipantsPerSession", event.target.value)} />
            </label>
            <label className="aula-field-wide">
              Referència factura
              <input value={createForm.billingReference} onChange={(event) => updateCreate("billingReference", event.target.value)} />
            </label>
            <AulaButton type="submit">Crear llicència</AulaButton>
          </form>
        </AulaCard>

        <AulaCard className="aristocracia-panel-card">
          <SectionHeader
            eyebrow="Docents Aula"
            title="Convidar docent"
            description="Vincula el primer docent al centre seleccionat."
          />
          <form className="aula-form" onSubmit={handleInvite}>
            <label>
              Centre
              <select value={inviteForm.organizationId} onChange={(event) => updateInvite("organizationId", event.target.value)} required>
                <option value="">Selecciona centre</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Correu
              <input type="email" value={inviteForm.email} onChange={(event) => updateInvite("email", event.target.value)} required />
            </label>
            <label>
              Nom
              <input value={inviteForm.fullName} onChange={(event) => updateInvite("fullName", event.target.value)} />
            </label>
            <label>
              Rol
              <select value={inviteForm.role} onChange={(event) => updateInvite("role", event.target.value)}>
                <option value="teacher">docent</option>
                <option value="school_admin">admin centre</option>
                <option value="camicurt_admin">admin Camicurt</option>
              </select>
            </label>
            <AulaButton type="submit">Convidar</AulaButton>
          </form>
        </AulaCard>
      </div>

      <AulaCard className="aristocracia-panel-card aristocracia-table-card">
        <SectionHeader
          eyebrow="Llicències"
          title="Estat comercial"
          description={`${licenses.length} registres disponibles per renovar, suspendre o activar.`}
        >
          <AulaButton variant="secondary" onClick={onReload}>Actualitzar</AulaButton>
        </SectionHeader>
        <AdminLicenses licenses={licenses} onChanged={onReload} />
      </AulaCard>

      <AulaCard className="aristocracia-panel-card">
        <SectionHeader
          eyebrow="Centres"
          title="Organitzacions"
          description="Vista ràpida dels centres creats i el seu contacte principal."
        />
        <AdminOrganizations licenses={licenses} />
      </AulaCard>
    </div>
  );
}

function StatusTab({ dashboard, onReload }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const services = dashboard?.status_services || [];

  async function runChecks() {
    setBusy(true);
    setMessage("");
    try {
      await runAristocraciaHealthChecks();
      setMessage("Checks executats.");
      await onReload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeOverride(service, manualStatus) {
    const notes = window.prompt("Nota interna opcional", service.notes || "") || service.notes || "";
    setBusy(true);
    setMessage("");
    try {
      await updateStatusOverride({
        serviceKey: service.service_key,
        manualStatus,
        notes
      });
      setMessage("Override actualitzat.");
      await onReload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AulaCard className="aristocracia-panel-card aristocracia-table-card">
      <SectionHeader
        eyebrow="Status"
        title="Serveis Camicurt"
        description="Checks automàtics i overrides manuals per comunicar incidències internes."
      >
        <AulaButton onClick={runChecks} disabled={busy}>
          {busy ? "Comprovant..." : "Executar checks"}
        </AulaButton>
      </SectionHeader>
      {message ? <p className="aula-message">{message}</p> : null}
      <div className="aula-table-wrap">
        <table className="aula-table">
          <thead>
            <tr>
              <th>Servei</th>
              <th>Estat</th>
              <th>Auto</th>
              <th>Manual</th>
              <th>Últim check</th>
              <th>Nota</th>
              <th>Accions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.id}>
                <td>
                  <strong>{service.name}</strong>
                  <br />
                  <span>{service.description}</span>
                </td>
                <td>
                  <StatusBadge value={service.effective_status} />
                </td>
                <td>{statusLabel(service.automatic_status)}</td>
                <td>{service.manual_status ? statusLabel(service.manual_status) : "Sense override"}</td>
                <td>{formatDateTime(service.last_checked_at)}</td>
                <td>{service.notes || ""}</td>
                <td className="aula-table-actions">
                  <button type="button" onClick={() => changeOverride(service, "maintenance")}>Manteniment</button>
                  <button type="button" onClick={() => changeOverride(service, "degraded")}>Incidència</button>
                  <button type="button" onClick={() => changeOverride(service, null)}>Treure</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AulaCard>
  );
}

function SocialTab({ dashboard, onReload }) {
  const [drafts, setDrafts] = useState({});
  const [message, setMessage] = useState("");
  const links = dashboard?.social_links || [];

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        links.map((link) => [
          link.platform,
          {
            ...link,
            url: link.url || "",
            notes: link.notes || ""
          }
        ])
      )
    );
  }, [links]);

  function update(platform, key, value) {
    setDrafts((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        [key]: value
      }
    }));
  }

  async function save(platform) {
    setMessage("");
    try {
      await upsertSocialLink(drafts[platform]);
      setMessage("Xarxa desada.");
      await onReload();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <AulaCard className="aristocracia-panel-card">
      <SectionHeader
        eyebrow="Xarxes i canals"
        title="Enllaços públics"
        description="Slots editables per deixar preparada la presència pública de Camicurt."
      />
      {message ? <p className="aula-message">{message}</p> : null}
      <div className="aristocracia-social-grid">
        {links.map((link) => {
          const draft = drafts[link.platform] || link;
          return (
            <section className="aula-mini-card aristocracia-social-card" key={link.platform}>
              <div className="aristocracia-social-card-head">
                <strong>{draft.label || link.platform}</strong>
                <StatusBadge value={draft.status || "draft"} />
              </div>
              <label>
                Plataforma
                <input value={draft.label || ""} onChange={(event) => update(link.platform, "label", event.target.value)} />
              </label>
              <label>
                URL o mailto
                <input value={draft.url || ""} onChange={(event) => update(link.platform, "url", event.target.value)} placeholder="https://..." />
              </label>
              <label>
                Estat
                <select value={draft.status || "draft"} onChange={(event) => update(link.platform, "status", event.target.value)}>
                  <option value="draft">Esborrany</option>
                  <option value="active">Actiu</option>
                  <option value="hidden">Amagat</option>
                </select>
              </label>
              <AulaButton type="button" variant="secondary" onClick={() => save(link.platform)}>
                Desar
              </AulaButton>
            </section>
          );
        })}
      </div>
    </AulaCard>
  );
}

function WorkersTab({ dashboard, onReload }) {
  const [form, setForm] = useState({
    email: "pau@camicurt.cat",
    fullName: "Pau",
    role: "owner",
    password: ""
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const workers = dashboard?.workers || [];

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await upsertAristocraciaWorker(form);
      setMessage("Treballador creat o actualitzat. La contrasenya no queda desada al repo.");
      setForm((prev) => ({ ...prev, password: "" }));
      await onReload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="aula-grid aula-grid-two aristocracia-editor-grid">
      <AulaCard className="aristocracia-panel-card aristocracia-table-card">
        <SectionHeader
          eyebrow="Treballadors"
          title="Accés intern"
          description="Persones amb rol actiu dins del backoffice."
        />
        <div className="aula-table-wrap">
          <table className="aula-table aula-table-compact">
            <thead>
              <tr>
                <th>Correu</th>
                <th>Nom</th>
                <th>Rol</th>
                <th>Estat</th>
                <th>Últim accés</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id}>
                  <td>{worker.email}</td>
                  <td>{worker.full_name || ""}</td>
                  <td><StatusBadge value={worker.role} /></td>
                  <td><StatusBadge value={worker.status} /></td>
                  <td>{formatDateTime(worker.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AulaCard>

      <AulaCard className="aristocracia-panel-card">
        <SectionHeader
          eyebrow="Alta o reset"
          title="Crear credencial"
          description="La contrasenya és temporal i només viatja a l'Edge Function."
        />
        <form className="aula-form" onSubmit={handleSubmit}>
          <label>
            Correu
            <input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} required />
          </label>
          <label>
            Nom
            <input value={form.fullName} onChange={(event) => update("fullName", event.target.value)} />
          </label>
          <label>
            Rol
            <select value={form.role} onChange={(event) => update("role", event.target.value)}>
              <option value="owner">owner</option>
              <option value="admin">admin</option>
              <option value="support">support</option>
            </select>
          </label>
          <label>
            Contrasenya temporal
            <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} minLength={10} required />
          </label>
          <AulaButton type="submit" disabled={busy}>
            {busy ? "Desant..." : "Crear o actualitzar"}
          </AulaButton>
        </form>
        {message ? <p className="aula-message">{message}</p> : null}
      </AulaCard>
    </div>
  );
}

function Dashboard({ access }) {
  const [activeTab, setActiveTab] = useState("resum");
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadDashboard(options = {}) {
    const silent = Boolean(options.silent);
    if (!silent) setLoading(true);
    setMessage("");
    try {
      setDashboard(await getAristocraciaDashboard());
    } catch (error) {
      setMessage(error.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function reloadDashboard() {
    return loadDashboard({ silent: true });
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  return (
    <AristocraciaLayout access={access} activeTab={activeTab} onTabChange={setActiveTab}>
      <section className="aula-panel-head aristocracia-hero">
        <div>
          <p className="aula-eyebrow">Camicurt intern</p>
          <h1>Aristocracia</h1>
          <p>Control central de llicències, status, canals públics i equip intern.</p>
        </div>
        <div className="aula-actions">
          <AulaButton href="/aula/admin" variant="secondary">Admin Aula</AulaButton>
          <AulaButton href="/" variant="secondary">Web pública</AulaButton>
        </div>
      </section>
      {loading ? <AulaLoading label="Carregant backoffice..." /> : null}
      {message ? <p className="aula-message aula-message-error">{message}</p> : null}
      {!loading && dashboard && activeTab === "resum" ? <OverviewTab dashboard={dashboard} /> : null}
      {!loading && dashboard && activeTab === "llicencies" ? <LicensesTab dashboard={dashboard} onReload={reloadDashboard} /> : null}
      {!loading && dashboard && activeTab === "status" ? <StatusTab dashboard={dashboard} onReload={reloadDashboard} /> : null}
      {!loading && dashboard && activeTab === "xarxes" ? <SocialTab dashboard={dashboard} onReload={reloadDashboard} /> : null}
      {!loading && dashboard && activeTab === "treballadors" ? <WorkersTab dashboard={dashboard} onReload={reloadDashboard} /> : null}
    </AristocraciaLayout>
  );
}

export default function AristocraciaApp() {
  const pathname =
    typeof window === "undefined" ? "/aristocracia" : window.location.pathname.replace(/\/+$/, "") || "/";
  const [state, setState] = useState({ loading: true, access: null, error: null });

  useEffect(() => {
    document.documentElement.classList.add("aristocracia-route");
    document.body.classList.add("aristocracia-route");
    return () => {
      document.documentElement.classList.remove("aristocracia-route");
      document.body.classList.remove("aristocracia-route");
    };
  }, []);

  useEffect(() => {
    if (pathname === "/aristocracia/login") {
      setState({ loading: false, access: null, error: null });
      return;
    }
    let cancelled = false;
    getAristocraciaAccess()
      .then((access) => {
        if (!cancelled) setState({ loading: false, access, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, access: null, error });
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (pathname === "/aristocracia/login") return <AristocraciaLogin />;
  if (state.loading) {
    return (
      <div className="aula-shell aristocracia-shell">
        <main className="aula-main">
          <AulaLoading label="Validant accés intern..." />
        </main>
      </div>
    );
  }
  if (state.error) {
    return <AristocraciaLogin initialMessage={state.error.message} />;
  }
  if (!state.access?.allowed) {
    return <AristocraciaLogin initialMessage="Inicia sessió per entrar al backoffice intern." />;
  }
  return <Dashboard access={state.access} />;
}
