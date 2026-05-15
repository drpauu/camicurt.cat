import { getSupabaseClient } from "../../lib/supabase.js";

async function requireClient() {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error("Supabase no està configurat.");
  return supabase;
}

function throwIfError(error, fallback) {
  if (error) throw new Error(error.message || fallback);
}

export async function listAdminLicenses() {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aula_admin_list_licenses");
  throwIfError(error, "No s'han pogut carregar les llicències.");
  return data || [];
}

export async function createAdminLicense(values) {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aula_admin_create_license", {
    p_organization_name: values.organizationName,
    p_legal_name: values.legalName || null,
    p_city: values.city || null,
    p_province: values.province || null,
    p_contact_email: values.contactEmail || null,
    p_billing_email: values.billingEmail || null,
    p_allowed_domains: values.allowedDomains || [],
    p_plan: values.plan,
    p_status: values.status,
    p_starts_at: values.startsAt,
    p_ends_at: values.endsAt,
    p_max_teachers: Number(values.maxTeachers) || 1,
    p_max_classes: values.maxClasses ? Number(values.maxClasses) : null,
    p_max_sessions_per_month: values.maxSessionsPerMonth
      ? Number(values.maxSessionsPerMonth)
      : null,
    p_max_participants_per_session: values.maxParticipantsPerSession
      ? Number(values.maxParticipantsPerSession)
      : null,
    p_price_cents: values.priceCents ? Number(values.priceCents) : null,
    p_billing_reference: values.billingReference || null,
    p_notes: values.notes || null
  });
  throwIfError(error, "No s'ha pogut crear la llicència.");
  return data;
}

export async function inviteTeacher({ organizationId, email, fullName, role }) {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aula_admin_invite_teacher", {
    p_organization_id: organizationId,
    p_email: email,
    p_full_name: fullName || null,
    p_role: role || "teacher"
  });
  throwIfError(error, "No s'ha pogut convidar el docent.");
  return data;
}

export async function renewLicense({ licenseId, newEndsAt, billingReference }) {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aula_admin_renew_license", {
    p_license_id: licenseId,
    p_new_ends_at: newEndsAt,
    p_billing_reference: billingReference || null
  });
  throwIfError(error, "No s'ha pogut renovar la llicència.");
  return data;
}

export async function setLicenseStatus({ licenseId, status, notes }) {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aula_admin_set_license_status", {
    p_license_id: licenseId,
    p_status: status,
    p_notes: notes || null
  });
  throwIfError(error, "No s'ha pogut canviar l'estat.");
  return data;
}
