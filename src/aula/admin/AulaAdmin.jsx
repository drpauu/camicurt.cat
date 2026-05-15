import { useEffect, useMemo, useState } from "react";
import AulaButton from "../components/AulaButton.jsx";
import AulaCard from "../components/AulaCard.jsx";
import AulaLayout from "../components/AulaLayout.jsx";
import AulaLoading from "../components/AulaLoading.jsx";
import {
  createAdminLicense,
  inviteTeacher,
  listAdminLicenses
} from "../lib/aulaAdminApi.js";
import AdminLicenses from "./AdminLicenses.jsx";
import AdminOrganizations from "./AdminOrganizations.jsx";

const today = new Date().toISOString().slice(0, 10);
const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

export default function AulaAdmin({ access }) {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
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

  async function load() {
    setLoading(true);
    try {
      setLicenses(await listAdminLicenses());
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
      await load();
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
      await load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <AulaLayout access={access} wide>
      <section className="aula-panel-head">
        <div>
          <p className="aula-eyebrow">Admin Camicurt</p>
          <h1>Llicències i centres</h1>
          <p>Gestió funcional de centres, plans i docents convidats.</p>
        </div>
      </section>

      {message ? <p className="aula-message">{message}</p> : null}

      <div className="aula-grid aula-grid-two">
        <AulaCard>
          <p className="aula-eyebrow">Nova llicència</p>
          <h2>Crear centre</h2>
          <form className="aula-form aula-form-grid" onSubmit={handleCreate}>
            <label>
              Centre
              <input
                value={createForm.organizationName}
                onChange={(event) => updateCreate("organizationName", event.target.value)}
                required
              />
            </label>
            <label>
              Nom legal
              <input
                value={createForm.legalName}
                onChange={(event) => updateCreate("legalName", event.target.value)}
              />
            </label>
            <label>
              Ciutat
              <input
                value={createForm.city}
                onChange={(event) => updateCreate("city", event.target.value)}
              />
            </label>
            <label>
              Província
              <input
                value={createForm.province}
                onChange={(event) => updateCreate("province", event.target.value)}
              />
            </label>
            <label>
              Contacte
              <input
                type="email"
                value={createForm.contactEmail}
                onChange={(event) => updateCreate("contactEmail", event.target.value)}
              />
            </label>
            <label>
              Facturació
              <input
                type="email"
                value={createForm.billingEmail}
                onChange={(event) => updateCreate("billingEmail", event.target.value)}
              />
            </label>
            <label>
              Dominis permesos
              <input
                value={createForm.allowedDomainsText}
                onChange={(event) => updateCreate("allowedDomainsText", event.target.value)}
                placeholder="centre.cat, xtec.cat"
              />
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
              <select
                value={createForm.status}
                onChange={(event) => updateCreate("status", event.target.value)}
              >
                <option value="trial">prova</option>
                <option value="active">activa</option>
                <option value="pending_payment">pagament pendent</option>
              </select>
            </label>
            <label>
              Inici
              <input
                type="date"
                value={createForm.startsAt}
                onChange={(event) => updateCreate("startsAt", event.target.value)}
                required
              />
            </label>
            <label>
              Caducitat
              <input
                type="date"
                value={createForm.endsAt}
                onChange={(event) => updateCreate("endsAt", event.target.value)}
                required
              />
            </label>
            <label>
              Màx. docents
              <input
                type="number"
                min="1"
                value={createForm.maxTeachers}
                onChange={(event) => updateCreate("maxTeachers", event.target.value)}
              />
            </label>
            <label>
              Màx. alumnes/sessió
              <input
                type="number"
                min="1"
                value={createForm.maxParticipantsPerSession}
                onChange={(event) =>
                  updateCreate("maxParticipantsPerSession", event.target.value)
                }
              />
            </label>
            <label>
              Referència factura
              <input
                value={createForm.billingReference}
                onChange={(event) => updateCreate("billingReference", event.target.value)}
              />
            </label>
            <AulaButton type="submit">Crear llicència</AulaButton>
          </form>
        </AulaCard>

        <AulaCard>
          <p className="aula-eyebrow">Docents</p>
          <h2>Convidar docent</h2>
          <form className="aula-form" onSubmit={handleInvite}>
            <label>
              Centre
              <select
                value={inviteForm.organizationId}
                onChange={(event) => updateInvite("organizationId", event.target.value)}
                required
              >
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
              <input
                type="email"
                value={inviteForm.email}
                onChange={(event) => updateInvite("email", event.target.value)}
                required
              />
            </label>
            <label>
              Nom
              <input
                value={inviteForm.fullName}
                onChange={(event) => updateInvite("fullName", event.target.value)}
              />
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

      <AulaCard>
        <div className="aula-section-title">
          <div>
            <p className="aula-eyebrow">Llicències</p>
            <h2>Estat comercial</h2>
          </div>
          <AulaButton variant="secondary" onClick={load}>
            Actualitzar
          </AulaButton>
        </div>
        {loading ? <AulaLoading label="Carregant llicencies..." /> : null}
        {!loading ? <AdminLicenses licenses={licenses} onChanged={load} /> : null}
      </AulaCard>

      <AulaCard>
        <p className="aula-eyebrow">Centres</p>
        <h2>Organitzacions</h2>
        <AdminOrganizations licenses={licenses} />
      </AulaCard>
    </AulaLayout>
  );
}
