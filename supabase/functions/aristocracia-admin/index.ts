import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.camicurt.cat",
  "https://camicurt.cat"
];

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const extra = (Deno.env.get("ARISTOCRACIA_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowOrigin = allowed.has(origin) || isLocal ? origin : DEFAULT_ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json"
    }
  });
}

function cleanEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown, max = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanRole(value: unknown) {
  const role = String(value || "support").trim();
  return ["owner", "admin", "support"].includes(role) ? role : "support";
}

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function requireWorker(req: Request, supabase: any) {
  const token = getBearerToken(req);
  if (!token) throw new Error("Cal iniciar sessió.");

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError) throw userError;
  const user = userData?.user;
  if (!user?.id || !user?.email) throw new Error("Sessió no vàlida.");

  const email = cleanEmail(user.email);
  const { data: workerById, error: workerByIdError } = await supabase
    .from("aristocracia_workers")
    .select("id,user_id,email,full_name,role,status")
    .eq("status", "active")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (workerByIdError) throw workerByIdError;

  let worker = workerById;
  if (!worker) {
    const { data: workerByEmail, error: workerByEmailError } = await supabase
      .from("aristocracia_workers")
      .select("id,user_id,email,full_name,role,status")
      .eq("status", "active")
      .is("user_id", null)
      .eq("email_normalized", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (workerByEmailError) throw workerByEmailError;
    worker = workerByEmail;
  }

  if (!worker?.id || !["owner", "admin"].includes(worker.role)) {
    throw new Error("No autoritzat.");
  }
  if (!worker.user_id) {
    await supabase
      .from("aristocracia_workers")
      .update({ user_id: user.id, activated_at: new Date().toISOString() })
      .eq("id", worker.id);
  }
  return { ...worker, user_id: worker.user_id || user.id, actorEmail: email };
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Error desconegut"
    };
  } finally {
    clearTimeout(timer);
  }
}

function statusFromHttp(status: number | null, error: string | null) {
  if (error || status === null) return "offline";
  if (status >= 500) return "offline";
  if (status >= 400) return "degraded";
  return "online";
}

async function checkService(supabase: any, service: any, supabaseUrl: string, serviceKey: string) {
  let result;
  if (service.check_kind === "supabase_rest") {
    const started = Date.now();
    const { error } = await supabase
      .from("aristocracia_status_services")
      .select("id", { count: "exact", head: true });
    result = {
      status: error ? "offline" : "online",
      httpStatus: error ? null : 200,
      latencyMs: Date.now() - started,
      error: error?.message || null
    };
  } else if (service.check_kind === "edge_function") {
    const probe = await fetchWithTimeout(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/aula-session/join`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        },
        body: "{}"
      }
    );
    result = {
      status: probe.error || (probe.status !== null && probe.status >= 500) ? "offline" : "online",
      httpStatus: probe.status,
      latencyMs: probe.latencyMs,
      error: probe.error
    };
  } else {
    const probe = await fetchWithTimeout(service.check_url);
    result = {
      status: statusFromHttp(probe.status, probe.error),
      httpStatus: probe.status,
      latencyMs: probe.latencyMs,
      error: probe.error
    };
  }

  const { data, error } = await supabase
    .from("aristocracia_status_services")
    .update({
      automatic_status: result.status,
      last_http_status: result.httpStatus,
      last_latency_ms: result.latencyMs,
      last_error: result.error,
      last_checked_at: new Date().toISOString()
    })
    .eq("id", service.id)
    .select("*")
    .single();
  if (error) throw error;
  return {
    ...data,
    effective_status: data.manual_status || data.automatic_status
  };
}

async function handleHealthCheck(req: Request, supabase: any, supabaseUrl: string, serviceKey: string) {
  const { data: services, error } = await supabase
    .from("aristocracia_status_services")
    .select("*")
    .eq("auto_check", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const checked = [];
  for (const service of services || []) {
    if (service.check_kind === "http" && !service.check_url) continue;
    checked.push(await checkService(supabase, service, supabaseUrl, serviceKey));
  }
  return json(req, { ok: true, services: checked });
}

async function findUserByEmail(supabase: any, email: string) {
  let page = 1;
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = (data?.users || []).find(
      (user: any) => cleanEmail(user.email) === email
    );
    if (found) return found;
    if (!data?.users?.length || data.users.length < 1000) return null;
    page += 1;
  }
  return null;
}

async function upsertWorkerAuth(supabase: any, payload: any) {
  const email = cleanEmail(payload.email);
  const password = String(payload.password || "");
  const fullName = cleanText(payload.fullName || payload.full_name || "", 120);
  const role = cleanRole(payload.role);
  if (!email || !email.includes("@")) throw new Error("Correu no vàlid.");
  if (password.length < 10) throw new Error("La contrasenya ha de tenir com a mínim 10 caràcters.");

  const existingUser = await findUserByEmail(supabase, email);
  let user = existingUser;
  if (existingUser?.id) {
    const { data, error } = await supabase.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });
    if (error) throw error;
    user = data.user;
  }

  const { data: existingWorker, error: workerLookupError } = await supabase
    .from("aristocracia_workers")
    .select("id")
    .eq("email_normalized", email)
    .maybeSingle();
  if (workerLookupError) throw workerLookupError;

  const values = {
    user_id: user.id,
    email,
    full_name: fullName || email,
    role,
    status: "active",
    activated_at: new Date().toISOString()
  };

  const query = existingWorker?.id
    ? supabase.from("aristocracia_workers").update(values).eq("id", existingWorker.id)
    : supabase.from("aristocracia_workers").insert(values);
  const { data: worker, error: workerError } = await query
    .select("id,email,full_name,role,status,activated_at,last_seen_at")
    .single();
  if (workerError) throw workerError;
  return worker;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Mètode no permès." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(req, { error: "Falten variables d'entorn de Supabase." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const payload = await req.json().catch(() => ({}));
    const worker = await requireWorker(req, supabase);
    if (payload.action === "health-check") {
      return await handleHealthCheck(req, supabase, supabaseUrl, serviceKey);
    }
    if (payload.action === "upsert-worker" || payload.action === "reset-worker-password") {
      const updatedWorker = await upsertWorkerAuth(supabase, payload);
      await supabase.from("aristocracia_audit_logs").insert({
        actor_user_id: worker.user_id,
        actor_email: worker.actorEmail,
        action: payload.action,
        target_type: "aristocracia_worker",
        target_id: updatedWorker.id,
        metadata: { email: updatedWorker.email, role: updatedWorker.role }
      });
      return json(req, { ok: true, worker: updatedWorker });
    }
    return json(req, { error: "Acció desconeguda." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error intern.";
    const status = message === "No autoritzat." || message === "Cal iniciar sessió." ? 401 : 500;
    return json(req, { error: message }, status);
  }
});
