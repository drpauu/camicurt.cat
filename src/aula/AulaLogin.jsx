import { useState } from "react";
import { sendAulaMagicLink } from "./lib/aulaAuth.js";
import AulaButton from "./components/AulaButton.jsx";
import AulaCard from "./components/AulaCard.jsx";
import AulaLayout from "./components/AulaLayout.jsx";

export default function AulaLogin() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      await sendAulaMagicLink(email.trim());
      setStatus("sent");
      setMessage("T'hem enviat un enllaç d'accés. Obre'l des del mateix navegador.");
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "No s'ha pogut enviar l'enllaç d'accés.");
    }
  }

  return (
    <AulaLayout>
      <div className="aula-narrow">
        <AulaCard>
          <p className="aula-eyebrow">Accés docent</p>
          <h1>Entra a Camicurt Aula</h1>
          <p>Introdueix el correu del teu centre per accedir a Camicurt Aula.</p>
          <form className="aula-form" onSubmit={handleSubmit}>
            <label htmlFor="aula-email">Correu docent</label>
            <input
              id="aula-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              placeholder="docent@centre.cat"
            />
            <AulaButton type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Enviant..." : "Enviar enllaç d'accés"}
            </AulaButton>
          </form>
          {message ? (
            <p className={`aula-message aula-message-${status === "error" ? "error" : "ok"}`}>
              {message}
            </p>
          ) : null}
        </AulaCard>
      </div>
    </AulaLayout>
  );
}
