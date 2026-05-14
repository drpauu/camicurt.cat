import AulaBlocked from "./components/AulaBlocked.jsx";
import AulaLayout from "./components/AulaLayout.jsx";
import AulaLoading from "./components/AulaLoading.jsx";
import useAulaAccess from "./hooks/useAulaAccess.js";

export default function AulaProtectedRoute({ children, adminOnly = false }) {
  const { loading, access, error } = useAulaAccess();

  if (loading) {
    return (
      <AulaLayout>
        <AulaLoading label="Carregant acces..." />
      </AulaLayout>
    );
  }

  if (error) {
    return (
      <AulaLayout>
        <AulaBlocked message={error.message} />
      </AulaLayout>
    );
  }

  if (!access?.allowed) {
    return (
      <AulaLayout>
        <AulaBlocked reason={access?.reason} />
      </AulaLayout>
    );
  }

  if (adminOnly && access.teacher?.role !== "camicurt_admin") {
    return (
      <AulaLayout access={access}>
        <AulaBlocked message="Aquest apartat es nomes per a l'administracio de Camicurt." />
      </AulaLayout>
    );
  }

  return typeof children === "function" ? children(access) : children;
}
