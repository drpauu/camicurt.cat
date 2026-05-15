import { getSupabaseClient } from "../../lib/supabase.js";
import AulaButton from "./AulaButton.jsx";

export default function AulaLayout({ children, access = null, wide = false }) {
  const teacher = access?.teacher;
  const organization = access?.organization;
  const isAdmin = teacher?.role === "camicurt_admin";

  async function handleSignOut() {
    const supabase = await getSupabaseClient();
    await supabase?.auth.signOut();
    window.location.assign("/aula/login");
  }

  return (
    <div className={["aula-shell", wide ? "aula-shell-wide" : ""].filter(Boolean).join(" ")}>
      <header className="aula-header">
        <a className="aula-brand" href="/aula" aria-label="Camicurt Aula">
          <span className="aula-brand-mark">C</span>
          <span>
            <strong>Camicurt Aula</strong>
            <small>{organization?.name || "Recurs educatiu"}</small>
          </span>
        </a>
        <nav className="aula-nav" aria-label="Navegació Aula">
          <a href="/aula/panel">Panell</a>
          <a href="/aula/sessions/new">Crear sessió</a>
          <a href="/aula/materials">Materials</a>
          <a href="/aula/join">Entrar amb codi</a>
          {isAdmin ? <a href="/aula/admin">Admin</a> : null}
        </nav>
        <div className="aula-header-actions">
          {teacher ? (
            <button type="button" className="aula-link-button" onClick={handleSignOut}>
              Sortir
            </button>
          ) : (
            <AulaButton href="/aula/login" variant="secondary">
              Accés docent
            </AulaButton>
          )}
        </div>
      </header>
      <main className="aula-main">{children}</main>
    </div>
  );
}
