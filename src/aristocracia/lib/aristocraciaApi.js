import {
  getSupabaseClient,
  getSupabasePublicKey,
  getSupabaseUrl
} from "../../lib/supabase.js";

function normalizeError(error, fallback = "No s'ha pogut completar l'operació.") {
  if (!error) return new Error(fallback);
  if (error instanceof Error) return error;
  return new Error(error.message || fallback);
}

async function requireClient() {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error("Supabase no està configurat.");
  return supabase;
}

export async function signInAristocracia(email, password) {
  const supabase = await requireClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw normalizeError(error, "No s'ha pogut iniciar sessió.");
  return data;
}

export async function signOutAristocracia() {
  const supabase = await getSupabaseClient();
  await supabase?.auth.signOut();
}

export async function getAristocraciaAccess() {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return { allowed: false, reason: "no_supabase" };
  }
  const { data, error } = await supabase.rpc("aristocracia_get_access");
  if (error) throw normalizeError(error, "No s'ha pogut validar l'accés.");
  return data || { allowed: false, reason: "no_access" };
}

export async function getAristocraciaDashboard() {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aristocracia_get_dashboard");
  if (error) throw normalizeError(error, "No s'ha pogut carregar el backoffice.");
  return data || {};
}

export async function upsertSocialLink(link) {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aristocracia_upsert_social_link", {
    p_platform: link.platform,
    p_label: link.label,
    p_url: link.url || null,
    p_status: link.status || "draft",
    p_sort_order: Number(link.sort_order) || 0,
    p_notes: link.notes || null
  });
  if (error) throw normalizeError(error, "No s'ha pogut desar la xarxa.");
  return data;
}

export async function updateStatusOverride({ serviceKey, manualStatus, notes }) {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aristocracia_update_status_override", {
    p_service_key: serviceKey,
    p_manual_status: manualStatus || null,
    p_notes: notes || null
  });
  if (error) throw normalizeError(error, "No s'ha pogut actualitzar l'estat.");
  return data;
}

export async function listAristocraciaWorkers() {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aristocracia_list_workers");
  if (error) throw normalizeError(error, "No s'han pogut carregar els treballadors.");
  return data || [];
}

function getFunctionUrl() {
  const url = getSupabaseUrl();
  if (!url) throw new Error("Supabase no està configurat.");
  return `${url.replace(/\/$/, "")}/functions/v1/aristocracia-admin`;
}

async function callAdminFunction(payload) {
  const key = getSupabasePublicKey();
  if (!key) throw new Error("Supabase no està configurat.");
  const supabase = await requireClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw normalizeError(sessionError, "No s'ha pogut llegir la sessió.");
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Cal iniciar sessió.");

  const response = await fetch(getFunctionUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "No s'ha pogut completar l'acció interna.");
  }
  return data;
}

export function runAristocraciaHealthChecks() {
  return callAdminFunction({ action: "health-check" });
}

export function upsertAristocraciaWorker({ email, fullName, role, password }) {
  return callAdminFunction({
    action: "upsert-worker",
    email,
    fullName,
    role,
    password
  });
}
