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

export async function getAulaAccess() {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return { allowed: false, reason: "no_supabase" };
  }
  const { data, error } = await supabase.rpc("aula_get_access");
  if (error) throw normalizeError(error, "No s'ha pogut validar l'accés.");
  return data || { allowed: false, reason: "no_access" };
}

export async function claimAulaTeacher() {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aula_claim_teacher");
  if (error) throw normalizeError(error, "No s'ha pogut activar el docent.");
  return data;
}

export async function listChallengePacks() {
  const supabase = await requireClient();
  const { data, error } = await supabase
    .from("aula_challenge_packs")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw normalizeError(error, "No s'han pogut carregar els packs.");
  return data || [];
}

export async function listChallenges(packId) {
  const supabase = await requireClient();
  let query = supabase
    .from("aula_challenges")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  if (packId) query = query.eq("pack_id", packId);
  const { data, error } = await query;
  if (error) throw normalizeError(error, "No s'han pogut carregar els reptes.");
  return data || [];
}

export async function listTeacherSessions(limit = 12) {
  const supabase = await requireClient();
  const { data, error } = await supabase
    .from("aula_sessions")
    .select("id,title,join_code,status,created_at,opened_at,closed_at,expires_at,challenge_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw normalizeError(error, "No s'han pogut carregar les sessions.");
  return data || [];
}

export async function createAulaSession({ classId = null, challengeId, title, settings }) {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aula_create_session", {
    p_class_id: classId,
    p_challenge_id: challengeId,
    p_title: title || null,
    p_settings: settings || {}
  });
  if (error) throw normalizeError(error, "No s'ha pogut crear la sessió.");
  return data;
}

export async function setAulaSessionStatus(sessionId, status) {
  const supabase = await requireClient();
  const { data, error } = await supabase.rpc("aula_set_session_status", {
    p_session_id: sessionId,
    p_status: status
  });
  if (error) throw normalizeError(error, "No s'ha pogut actualitzar la sessió.");
  return data;
}

export async function getAulaSessionBundle(sessionId) {
  const supabase = await requireClient();
  const sessionResult = await supabase
    .from("aula_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionResult.error) {
    throw normalizeError(sessionResult.error, "No s'ha pogut carregar la sessió.");
  }
  const session = sessionResult.data;
  if (!session) return { session: null, challenge: null, participants: [], results: [] };

  const [challengeResult, participantsResult, resultsResult] = await Promise.all([
    supabase.from("aula_challenges").select("*").eq("id", session.challenge_id).maybeSingle(),
    supabase
      .from("aula_participants")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    supabase
      .from("aula_results")
      .select("*, participant:aula_participants(display_name)")
      .eq("session_id", sessionId)
      .order("submitted_at", { ascending: false })
  ]);

  if (challengeResult.error) throw normalizeError(challengeResult.error);
  if (participantsResult.error) throw normalizeError(participantsResult.error);
  if (resultsResult.error) throw normalizeError(resultsResult.error);

  return {
    session,
    challenge: challengeResult.data || null,
    participants: participantsResult.data || [],
    results: (resultsResult.data || []).map((result) => ({
      ...result,
      display_name: result.participant?.display_name || ""
    }))
  };
}

function getFunctionUrl(action) {
  const url = getSupabaseUrl();
  if (!url) throw new Error("Supabase no està configurat.");
  return `${url.replace(/\/$/, "")}/functions/v1/aula-session/${action}`;
}

async function callAulaFunction(action, payload) {
  const key = getSupabasePublicKey();
  if (!key) throw new Error("Supabase no està configurat.");
  const response = await fetch(getFunctionUrl(action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "No s'ha pogut completar la petició d'Aula.");
  }
  return data;
}

export function joinAulaSession(payload) {
  return callAulaFunction("join", payload);
}

export function submitAulaResult(payload) {
  return callAulaFunction("submit-result", payload);
}
