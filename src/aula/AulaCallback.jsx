import { useEffect, useState } from "react";
import AulaBlocked from "./components/AulaBlocked.jsx";
import AulaLayout from "./components/AulaLayout.jsx";
import AulaLoading from "./components/AulaLoading.jsx";
import { claimAulaTeacher, getAulaAccess } from "./lib/aulaApi.js";

export default function AulaCallback() {
  const [state, setState] = useState({ loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        await claimAulaTeacher();
        const access = await getAulaAccess();
        if (access?.allowed) {
          window.location.replace("/aula/panel");
          return;
        }
        throw new Error("Aquest correu no té cap llicència activa de Camicurt Aula.");
      } catch (error) {
        if (!cancelled) setState({ loading: false, error });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <AulaLayout>
        <AulaLoading label="Validant accés docent..." />
      </AulaLayout>
    );
  }

  return (
    <AulaLayout>
      <AulaBlocked message={state.error?.message} />
    </AulaLayout>
  );
}
