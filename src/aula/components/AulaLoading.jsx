export default function AulaLoading({ label = "Carregant..." }) {
  return (
    <div className="aula-loading" role="status" aria-live="polite">
      <span className="aula-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
