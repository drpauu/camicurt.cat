import AulaButton from "./AulaButton.jsx";
import AulaCard from "./AulaCard.jsx";

const REASON_TEXT = {
  unauthenticated: "Cal iniciar sessió amb el correu docent.",
  no_teacher: "Aquest correu no està convidat a cap centre.",
  teacher_disabled: "Aquest docent no té l'accés actiu.",
  no_active_license: "Aquest centre no té cap llicència activa de Camicurt Aula.",
  no_supabase: "La configuració de Supabase no està disponible."
};

export default function AulaBlocked({ reason, message }) {
  return (
    <AulaCard className="aula-blocked">
      <p className="aula-eyebrow">Accés restringit</p>
      <h1>Camicurt Aula</h1>
      <p>{message || REASON_TEXT[reason] || REASON_TEXT.no_active_license}</p>
      <div className="aula-actions">
        <AulaButton href="/aula/login">Accés docent</AulaButton>
        <AulaButton href="/aula" variant="secondary">
          Tornar a Aula
        </AulaButton>
      </div>
    </AulaCard>
  );
}
