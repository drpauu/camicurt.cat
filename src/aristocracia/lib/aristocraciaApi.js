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

function getMockApi() {
  if (typeof window === "undefined") return null;
  if (!import.meta.env.DEV && import.meta.env.MODE !== "test") return null;
  return window.__CAMICURT_ARISTOCRACIA_MOCK__ || null;
}

function cloneMockValue(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function mockCalls(mock) {
  if (!Array.isArray(mock.calls)) mock.calls = [];
  return mock.calls;
}

function mutateMockDashboard(mock, mutator) {
  if (!mock.dashboard || typeof mock.dashboard !== "object") return null;
  mutator(mock.dashboard);
  return cloneMockValue(mock.dashboard);
}

async function requireClient() {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error("Supabase no està configurat.");
  return supabase;
}

export async function signInAristocracia(email, password) {
  const mock = getMockApi();
  if (mock) {
    mockCalls(mock).push({ action: "sign-in", email });
    if (mock.signInError) throw new Error(mock.signInError);
    return { user: { email }, session: { access_token: "mock-token" }, passwordLength: password.length };
  }
  const supabase = await requireClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw normalizeError(error, "No s'ha pogut iniciar sessió.");
  return data;
}

export async function signOutAristocracia() {
  const mock = getMockApi();
  if (mock) {
    mockCalls(mock).push({ action: "sign-out" });
    return;
  }
  const supabase = await getSupabaseClient();
  await supabase?.auth.signOut();
}

export async function getAristocraciaAccess() {
  const mock = getMockApi();
  if (mock) {
    return cloneMockValue(
      mock.access || {
        allowed: true,
        worker: {
          email: "pau@camicurt.cat",
          full_name: "Pau",
          role: "owner",
          status: "active"
        }
      }
    );
  }
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return { allowed: false, reason: "no_supabase" };
  }
  const { data, error } = await supabase.rpc("aristocracia_get_access");
  if (error) throw normalizeError(error, "No s'ha pogut validar l'accés.");
  return data || { allowed: false, reason: "no_access" };
}

export async function getAristocraciaDashboard() {
  const mock = getMockApi();
  if (mock) return cloneMockValue(mock.dashboard || {});
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aristocracia_get_dashboard");
  if (error) throw normalizeError(error, "No s'ha pogut carregar el backoffice.");
  return data || {};
}

export async function upsertSocialLink(link) {
  const mock = getMockApi();
  if (mock) {
    mockCalls(mock).push({ action: "social-link-upsert", link: cloneMockValue(link) });
    mutateMockDashboard(mock, (dashboard) => {
      const links = Array.isArray(dashboard.social_links) ? dashboard.social_links : [];
      const index = links.findIndex((item) => item.platform === link.platform);
      const next = {
        ...(index >= 0 ? links[index] : {}),
        ...link,
        url: link.url || null,
        status: link.status || "draft",
        sort_order: Number(link.sort_order) || 0
      };
      dashboard.social_links = index >= 0
        ? links.map((item, itemIndex) => (itemIndex === index ? next : item))
        : [...links, next];
    });
    return cloneMockValue(link);
  }
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
  const mock = getMockApi();
  if (mock) {
    mockCalls(mock).push({ action: "status-override", serviceKey, manualStatus, notes });
    let updated = null;
    mutateMockDashboard(mock, (dashboard) => {
      dashboard.status_services = (dashboard.status_services || []).map((service) => {
        if (service.service_key !== serviceKey) return service;
        updated = {
          ...service,
          manual_status: manualStatus || null,
          effective_status: manualStatus || service.automatic_status,
          notes: notes || service.notes || ""
        };
        return updated;
      });
    });
    return cloneMockValue(updated || {});
  }
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
  const mock = getMockApi();
  if (mock) return cloneMockValue(mock.dashboard?.workers || []);
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
  const mock = getMockApi();
  if (mock) {
    mockCalls(mock).push({ action: "health-check" });
    const dashboard = mutateMockDashboard(mock, (currentDashboard) => {
      currentDashboard.status_services = (currentDashboard.status_services || []).map((service) => ({
        ...service,
        automatic_status: service.automatic_status === "unknown" ? "online" : service.automatic_status,
        effective_status: service.manual_status || (service.automatic_status === "unknown" ? "online" : service.automatic_status),
        last_http_status: service.last_http_status || 200,
        last_latency_ms: service.last_latency_ms || 84,
        last_checked_at: new Date().toISOString()
      }));
    });
    return Promise.resolve({ ok: true, services: dashboard?.status_services || [] });
  }
  return callAdminFunction({ action: "health-check" });
}

export function upsertAristocraciaWorker({ email, fullName, role, password }) {
  const mock = getMockApi();
  if (mock) {
    mockCalls(mock).push({
      action: "worker-upsert",
      email,
      fullName,
      role,
      passwordLength: String(password || "").length
    });
    const worker = {
      id: `worker-${String(email).toLowerCase()}`,
      email,
      full_name: fullName || email,
      role: role || "support",
      status: "active",
      activated_at: new Date().toISOString(),
      last_seen_at: null
    };
    mutateMockDashboard(mock, (dashboard) => {
      const workers = Array.isArray(dashboard.workers) ? dashboard.workers : [];
      const index = workers.findIndex((item) => item.email === email);
      dashboard.workers = index >= 0
        ? workers.map((item, itemIndex) => (itemIndex === index ? { ...item, ...worker } : item))
        : [...workers, worker];
    });
    return Promise.resolve({ ok: true, worker: cloneMockValue(worker) });
  }
  return callAdminFunction({
    action: "upsert-worker",
    email,
    fullName,
    role,
    password
  });
}
