import { useEffect } from "react";
import AulaAdmin from "./admin/AulaAdmin.jsx";
import AulaCallback from "./AulaCallback.jsx";
import AulaLanding from "./AulaLanding.jsx";
import AulaLogin from "./AulaLogin.jsx";
import AulaMaterials from "./AulaMaterials.jsx";
import AulaPanel from "./AulaPanel.jsx";
import AulaProtectedRoute from "./AulaProtectedRoute.jsx";
import AulaBlocked from "./components/AulaBlocked.jsx";
import AulaLayout from "./components/AulaLayout.jsx";
import AulaPlayPage from "./sessions/AulaPlayPage.jsx";
import CreateSessionPage from "./sessions/CreateSessionPage.jsx";
import JoinSessionPage from "./sessions/JoinSessionPage.jsx";
import SessionProjectorPage from "./sessions/SessionProjectorPage.jsx";
import SessionResultsPage from "./sessions/SessionResultsPage.jsx";

function getSessionRoute(pathname) {
  const projector = pathname.match(/^\/aula\/session\/([^/]+)\/projector\/?$/);
  if (projector) return { name: "projector", sessionId: projector[1] };
  const results = pathname.match(/^\/aula\/session\/([^/]+)\/results\/?$/);
  if (results) return { name: "results", sessionId: results[1] };
  const play = pathname.match(/^\/aula\/play\/([^/]+)\/?$/);
  if (play) return { name: "play", sessionId: play[1] };
  return null;
}

export default function AulaApp({ PublicGameApp }) {
  const pathname =
    typeof window === "undefined" ? "/aula" : window.location.pathname.replace(/\/+$/, "") || "/";
  const sessionRoute = getSessionRoute(pathname);

  useEffect(() => {
    document.body.classList.add("aula-route");
    return () => document.body.classList.remove("aula-route");
  }, []);

  if (pathname === "/aula") return <AulaLanding />;
  if (pathname === "/aula/login") return <AulaLogin />;
  if (pathname === "/aula/callback") return <AulaCallback />;
  if (pathname === "/aula/join") return <JoinSessionPage />;
  if (pathname === "/aula/panel") {
    return <AulaProtectedRoute>{(access) => <AulaPanel access={access} />}</AulaProtectedRoute>;
  }
  if (pathname === "/aula/materials") {
    return (
      <AulaProtectedRoute>{(access) => <AulaMaterials access={access} />}</AulaProtectedRoute>
    );
  }
  if (pathname === "/aula/admin") {
    return (
      <AulaProtectedRoute adminOnly>
        {(access) => <AulaAdmin access={access} />}
      </AulaProtectedRoute>
    );
  }
  if (pathname === "/aula/sessions/new") {
    return (
      <AulaProtectedRoute>
        {(access) => <CreateSessionPage access={access} />}
      </AulaProtectedRoute>
    );
  }
  if (sessionRoute?.name === "projector") {
    return (
      <AulaProtectedRoute>
        {(access) => <SessionProjectorPage access={access} sessionId={sessionRoute.sessionId} />}
      </AulaProtectedRoute>
    );
  }
  if (sessionRoute?.name === "results") {
    return (
      <AulaProtectedRoute>
        {(access) => <SessionResultsPage access={access} sessionId={sessionRoute.sessionId} />}
      </AulaProtectedRoute>
    );
  }
  if (sessionRoute?.name === "play") {
    return <AulaPlayPage sessionId={sessionRoute.sessionId} PublicGameApp={PublicGameApp} />;
  }

  return (
    <AulaLayout>
      <AulaBlocked message="Aquesta pagina d'Aula no existeix." />
    </AulaLayout>
  );
}
