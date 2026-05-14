export default function AulaCard({ children, className = "", ...props }) {
  return (
    <section className={["aula-card", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </section>
  );
}
