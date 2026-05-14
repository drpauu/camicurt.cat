import AulaCard from "./components/AulaCard.jsx";
import AulaLayout from "./components/AulaLayout.jsx";
import fitxaAlumne from "./materials/fitxa-alumne.md?raw";
import guiaDocent from "./materials/guia-docent.md?raw";
import sessio45Minuts from "./materials/sessio-45-minuts.md?raw";
import solucionari from "./materials/solucionari.md?raw";

const materials = [
  {
    title: "Guia docent",
    type: "teacher_guide",
    description:
      "Objectius, proposta de dinamica i consells per introduir les rutes entre comarques.",
    content: guiaDocent
  },
  {
    title: "Fitxa d'alumne",
    type: "worksheet",
    description:
      "Full imprimible per anotar hipotesis, comarques candidates i reflexio final.",
    content: fitxaAlumne
  },
  {
    title: "Solucionari",
    type: "solutionary",
    description: "Criteris per comentar una ruta optima i alternatives equivalents.",
    content: solucionari
  },
  {
    title: "Sessio de 45 minuts",
    type: "slides",
    description: "Estructura breu per a una classe amb inici, joc en equips i posada en comu.",
    content: sessio45Minuts
  }
];

export default function AulaMaterials({ access }) {
  return (
    <AulaLayout access={access}>
      <section className="aula-panel-head">
        <div>
          <p className="aula-eyebrow">Materials docents</p>
          <h1>Recursos per preparar la classe</h1>
          <p>Materials inicials en HTML. Els PDF es podran afegir mes endavant.</p>
        </div>
      </section>
      <div className="aula-grid aula-grid-two">
        {materials.map((material) => (
          <AulaCard key={material.type}>
            <p className="aula-eyebrow">{material.type}</p>
            <h2>{material.title}</h2>
            <p>{material.description}</p>
            <details className="aula-material">
              <summary>Veure contingut</summary>
              <pre>{material.content}</pre>
            </details>
            <button type="button" className="aula-button aula-button-secondary" onClick={() => window.print()}>
              Imprimir
            </button>
          </AulaCard>
        ))}
      </div>
    </AulaLayout>
  );
}
