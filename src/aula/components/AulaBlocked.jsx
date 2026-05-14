import AulaButton from "./AulaButton.jsx";
import AulaCard from "./AulaCard.jsx";

const REASON_TEXT = {
  unauthenticated: "Cal iniciar sessio amb el correu docent.",
  no_teacher: "Aquest correu no esta convidat a cap centre.",
  teacher_disabled: "Aquest docent no te l'acces actiu.",
  no_active_license: "Aquest centre no te cap llicencia activa de Camicurt Aula.",
  no_supabase: "La configuracio de Supabase no esta disponible."
};

export default function AulaBlocked({ reason, message }) {
  return (
    <AulaCard className="aula-blocked">
      <p className="aula-eyebrow">Acces restringit</p>
      <h1>Camicurt Aula</h1>
      <p>{message || REASON_TEXT[reason] || REASON_TEXT.no_active_license}</p>
      <div className="aula-actions">
        <AulaButton href="/aula/login">Acces docent</AulaButton>
        <AulaButton href="/aula" variant="secondary">
          Tornar a Aula
        </AulaButton>
      </div>
    </AulaCard>
  );
}
