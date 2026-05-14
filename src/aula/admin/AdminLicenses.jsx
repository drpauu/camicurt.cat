import { useState } from "react";
import { renewLicense, setLicenseStatus } from "../lib/aulaAdminApi.js";

function daysRemaining(dateValue) {
  if (!dateValue) return "";
  const end = new Date(`${dateValue}T23:59:59`);
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}

export default function AdminLicenses({ licenses, onChanged }) {
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  async function handleRenew(license) {
    const current = license.ends_at || new Date().toISOString().slice(0, 10);
    const date = window.prompt("Nova data de caducitat (YYYY-MM-DD)", current);
    if (!date) return;
    setBusyId(license.license_id);
    setMessage("");
    try {
      await renewLicense({
        licenseId: license.license_id,
        newEndsAt: date,
        billingReference: license.billing_reference || null
      });
      setMessage("Llicencia renovada.");
      onChanged?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusyId("");
    }
  }

  async function handleStatus(license, status) {
    setBusyId(license.license_id);
    setMessage("");
    try {
      await setLicenseStatus({
        licenseId: license.license_id,
        status,
        notes: `Canvi manual a ${status}`
      });
      setMessage("Estat actualitzat.");
      onChanged?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div>
      {message ? <p className="aula-message">{message}</p> : null}
      <div className="aula-table-wrap">
        <table className="aula-table">
          <thead>
            <tr>
              <th>Centre</th>
              <th>Ciutat</th>
              <th>Pla</th>
              <th>Estat</th>
              <th>Inici</th>
              <th>Caduca</th>
              <th>Dies restants</th>
              <th>Docents actius</th>
              <th>Factura</th>
              <th>Accions</th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((license) => (
              <tr key={license.license_id}>
                <td>{license.organization_name}</td>
                <td>{license.city || ""}</td>
                <td>{license.plan}</td>
                <td>{license.status}</td>
                <td>{license.starts_at}</td>
                <td>{license.ends_at}</td>
                <td>{daysRemaining(license.ends_at)}</td>
                <td>{license.active_teachers}</td>
                <td>{license.billing_reference || ""}</td>
                <td className="aula-table-actions">
                  <button
                    type="button"
                    onClick={() => handleRenew(license)}
                    disabled={busyId === license.license_id}
                  >
                    Renovar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStatus(license, "suspended")}
                    disabled={busyId === license.license_id}
                  >
                    Suspendre
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStatus(license, "active")}
                    disabled={busyId === license.license_id}
                  >
                    Activar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
