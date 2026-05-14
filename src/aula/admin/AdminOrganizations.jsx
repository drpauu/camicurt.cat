export default function AdminOrganizations({ licenses }) {
  const organizations = Array.from(
    new Map(
      licenses.map((license) => [
        license.organization_id,
        {
          id: license.organization_id,
          name: license.organization_name,
          city: license.city,
          contactEmail: license.contact_email,
          status: license.organization_status
        }
      ])
    ).values()
  );

  if (!organizations.length) {
    return <p className="aula-empty">Encara no hi ha centres creats.</p>;
  }

  return (
    <div className="aula-grid aula-grid-two">
      {organizations.map((organization) => (
        <section className="aula-mini-card" key={organization.id}>
          <h3>{organization.name}</h3>
          <p>{organization.city || "Sense ciutat"}</p>
          <p>{organization.contactEmail || "Sense contacte"}</p>
          <span>{organization.status}</span>
        </section>
      ))}
    </div>
  );
}
