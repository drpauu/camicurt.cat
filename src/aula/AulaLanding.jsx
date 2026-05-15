import AulaButton from "./components/AulaButton.jsx";
import AulaCard from "./components/AulaCard.jsx";
import AulaLayout from "./components/AulaLayout.jsx";

const steps = [
  "El docent tria un repte.",
  "Camicurt genera un codi d'aula.",
  "L'alumnat entra sense compte.",
  "Cada equip busca la ruta curta.",
  "El docent consulta resultats i solució."
];

const included = [
  "Sessions d'aula",
  "Codis temporals",
  "Mode projector",
  "Reptes preparats",
  "Materials docents",
  "Resultats de classe",
  "Exportació CSV"
];

export default function AulaLanding() {
  return (
    <AulaLayout>
      <section className="aula-hero">
        <div>
          <p className="aula-eyebrow">Per a centres educatius</p>
          <h1>Camicurt Aula</h1>
          <p className="aula-hero-copy">
            Recurs educatiu en català per treballar comarques, orientació territorial i
            pensament lògic a classe.
          </p>
          <div className="aula-actions">
            <AulaButton href="mailto:hola@camicurt.cat?subject=Prova%20gratu%C3%AFta%20Camicurt%20Aula">
              Demanar prova gratuïta
            </AulaButton>
            <AulaButton href="/aula/login" variant="secondary">
              Accés docent
            </AulaButton>
          </div>
        </div>
        <div className="aula-hero-panel" aria-label="Resum de privacitat">
          <strong>L'alumnat no necessita correu ni compte.</strong>
          <span>Els equips entren amb un codi temporal de sessió.</span>
        </div>
      </section>

      <section className="aula-grid aula-grid-two">
        <AulaCard>
          <p className="aula-eyebrow">Com funciona</p>
          <ol className="aula-number-list">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </AulaCard>
        <AulaCard>
          <p className="aula-eyebrow">Què inclou</p>
          <div className="aula-chip-list">
            {included.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </AulaCard>
      </section>
    </AulaLayout>
  );
}
