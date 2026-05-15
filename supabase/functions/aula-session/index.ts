import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.camicurt.cat",
  "https://camicurt.cat"
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const extra = (Deno.env.get("AULA_ALLOWED_ORIGINS") || "")
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
      ...getCorsHeaders(req),
      "Content-Type": "application/json"
    }
  });
}

function normalizeJoinCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function cleanDisplayName(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function isTextArray(value: unknown, maxLength = 200) {
  return (
    Array.isArray(value) &&
    value.length <= maxLength &&
    value.every((item) => typeof item === "string" && item.length <= 120)
  );
}

function clampInt(value: unknown, fallback: number | null, min: number, max: number) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function challengeSnapshot(challenge: any) {
  return {
    id: challenge.id,
    title: challenge.title,
    startId: challenge.start_id,
    targetId: challenge.target_id,
    difficultyId: challenge.difficulty_id,
    rule: challenge.rule || null,
    avoidIds: challenge.avoid_ids || [],
    mustPassIds: challenge.must_pass_ids || [],
    shortestPath: challenge.shortest_path || [],
    shortestInternalCount: challenge.shortest_internal_count,
    studentPrompt: challenge.student_prompt || ""
  };
}

async function requireActiveLicense(supabase: any, organizationId: string) {
  const { data: organization, error: orgError } = await supabase
    .from("aula_organizations")
    .select("id,status")
    .eq("id", organizationId)
    .maybeSingle();
  if (orgError) throw orgError;
  if (!organization || organization.status !== "active") {
    throw new Error("El centre no està actiu.");
  }

  const { data: license, error: licenseError } = await supabase
    .from("aula_licenses")
    .select("id,status,starts_at,ends_at,max_participants_per_session")
    .eq("organization_id", organizationId)
    .in("status", ["trial", "active"])
    .lte("starts_at", todayKey())
    .gte("ends_at", todayKey())
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (licenseError) throw licenseError;
  if (!license) throw new Error("El centre no té llicència activa.");
  return license;
}

async function handleJoin(req: Request, supabase: any, payload: any) {
  const joinCode = normalizeJoinCode(payload.joinCode);
  const displayName = cleanDisplayName(payload.displayName);
  if (!joinCode) return json(req, { error: "Cal indicar el codi de sessió." }, 400);
  if (displayName.length < 1 || displayName.length > 60) {
    return json(req, { error: "El nom d'equip ha de tenir entre 1 i 60 caràcters." }, 400);
  }

  const { data: session, error: sessionError } = await supabase
    .from("aula_sessions")
    .select("*, challenge:aula_challenges(*)")
    .eq("join_code", joinCode)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return json(req, { error: "Codi invàlid o sessió no trobada." }, 404);
  if (session.status !== "open") {
    return json(req, { error: "La sessió encara no està oberta." }, 409);
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    return json(req, { error: "La sessió ha caducat." }, 410);
  }

  const license = await requireActiveLicense(supabase, session.organization_id);
  if (license.max_participants_per_session !== null) {
    const { count, error: countError } = await supabase
      .from("aula_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id);
    if (countError) throw countError;
    if ((count || 0) >= license.max_participants_per_session) {
      return json(req, { error: "La sessió ha arribat al límit de participants." }, 409);
    }
  }

  const participantToken = createToken();
  const participantTokenHash = await sha256Hex(participantToken);
  const { data: participant, error: participantError } = await supabase
    .from("aula_participants")
    .insert({
      session_id: session.id,
      display_name: displayName,
      participant_token_hash: participantTokenHash,
      last_seen_at: new Date().toISOString()
    })
    .select("id")
    .single();
  if (participantError) throw participantError;

  return json(req, {
    sessionId: session.id,
    participantId: participant.id,
    participantToken,
    challenge: challengeSnapshot(session.challenge)
  });
}

async function handleSubmit(req: Request, supabase: any, payload: any) {
  const sessionId = String(payload.sessionId || "");
  const participantId = String(payload.participantId || "");
  const participantToken = String(payload.participantToken || "");
  if (!sessionId || !participantId || !participantToken) {
    return json(req, { error: "Falten dades de participant." }, 400);
  }

  const { data: participant, error: participantError } = await supabase
    .from("aula_participants")
    .select("id,session_id,participant_token_hash")
    .eq("id", participantId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (participantError) throw participantError;
  if (!participant) return json(req, { error: "Participant no trobat." }, 404);

  const tokenHash = await sha256Hex(participantToken);
  if (tokenHash !== participant.participant_token_hash) {
    return json(req, { error: "Token de participant invàlid." }, 401);
  }

  const { data: session, error: sessionError } = await supabase
    .from("aula_sessions")
    .select("id,status,organization_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session || session.status === "archived") {
    return json(req, { error: "La sessió no accepta resultats." }, 409);
  }
  await requireActiveLicense(supabase, session.organization_id);

  const attempts = isTextArray(payload.attempts, 250) ? payload.attempts : [];
  const foundPath = isTextArray(payload.foundPath, 100) ? payload.foundPath : [];
  const optimalPath = isTextArray(payload.optimalPath, 100) ? payload.optimalPath : [];
  const attemptsCount = clampInt(payload.attemptsCount, attempts.length, 0, 500);
  const timeSeconds = clampInt(payload.timeSeconds, null, 0, 86400);
  const precision = clampInt(payload.precision, null, 0, 100);
  const optimalInternalCount = clampInt(payload.optimalInternalCount, null, 0, 100);
  const foundInternalCount = clampInt(payload.foundInternalCount, null, 0, 100);
  const distanceFromOptimal = clampInt(payload.distanceFromOptimal, null, 0, 100);
  const clientPayload =
    payload.clientPayload && typeof payload.clientPayload === "object"
      ? payload.clientPayload
      : {};

  const { data: result, error: resultError } = await supabase
    .from("aula_results")
    .upsert(
      {
        session_id: sessionId,
        participant_id: participantId,
        completed: Boolean(payload.completed),
        attempts_count: attemptsCount,
        time_seconds: timeSeconds,
        precision,
        optimal_internal_count: optimalInternalCount,
        found_internal_count: foundInternalCount,
        distance_from_optimal: distanceFromOptimal,
        attempts,
        found_path: foundPath,
        optimal_path: optimalPath,
        client_payload: clientPayload,
        verified: false,
        submitted_at: new Date().toISOString()
      },
      { onConflict: "session_id,participant_id" }
    )
    .select("id")
    .single();
  if (resultError) throw resultError;

  await supabase
    .from("aula_participants")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", participantId);
  await supabase.from("aula_audit_logs").insert({
    organization_id: session.organization_id,
    action: "student_result_submitted",
    target_type: "aula_result",
    target_id: result.id,
    metadata: { session_id: sessionId, participant_id: participantId }
  });

  return json(req, { ok: true, resultId: result.id });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
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

  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const payload = await req.json().catch(() => ({}));
    if (action === "join") return await handleJoin(req, supabase, payload);
    if (action === "submit-result") return await handleSubmit(req, supabase, payload);
    return json(req, { error: "Endpoint Aula desconegut." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error intern d'Aula.";
    return json(req, { error: message }, 500);
  }
});
