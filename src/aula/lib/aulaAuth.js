import { getSupabaseClient } from "../../lib/supabase.js";

const DEFAULT_AULA_REDIRECT_ORIGIN = "https://www.camicurt.cat";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
const SESSION_WAIT_TIMEOUT_MS = 3500;

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function withAulaCallback(originOrCallback) {
  const value = cleanUrl(originOrCallback);
  if (!value) return "";
  return value.endsWith("/aula/callback") ? value : `${value}/aula/callback`;
}

export function getAulaMagicLinkRedirectTo() {
  const configuredRedirect = withAulaCallback(
    import.meta.env.VITE_AULA_AUTH_REDIRECT_ORIGIN || import.meta.env.VITE_PUBLIC_SITE_URL
  );
  if (configuredRedirect) return configuredRedirect;

  const currentOrigin =
    typeof window !== "undefined" && window.location ? cleanUrl(window.location.origin) : "";
  const redirectOrigin = isLocalOrigin(currentOrigin) ? DEFAULT_AULA_REDIRECT_ORIGIN : currentOrigin;

  return withAulaCallback(redirectOrigin || DEFAULT_AULA_REDIRECT_ORIGIN);
}

function getUrlAuthParams() {
  if (typeof window === "undefined" || !window.location) return new URLSearchParams();

  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
  const hashParams = new URLSearchParams(hash);
  hashParams.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });

  return params;
}

function getRedirectError() {
  const params = getUrlAuthParams();
  const error = params.get("error") || params.get("error_code");
  const description = params.get("error_description");
  if (!error && !description) return null;

  const details = description || error;
  const suffix = details ? ` Detall: ${details}` : "";
  return new Error(
    `L'enllaç d'accés no és vàlid o ha caducat. Torna a demanar-ne un des d'Accés docent.${suffix}`
  );
}

function waitForAuthStateSession(supabase, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription = null;

    function finish(error, session = null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.unsubscribe();
      if (error) reject(error);
      else resolve(session);
    }

    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data?.session?.access_token) {
          finish(null, data.session);
          return;
        }
        finish(
          new Error(
            "No s'ha pogut iniciar sessió amb aquest enllaç. Demana un enllaç nou des d'Accés docent."
          )
        );
      } catch (error) {
        finish(error);
      }
    }, timeoutMs);

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) finish(null, session);
    });
    subscription = data?.subscription || null;
  });
}

export async function waitForAulaMagicLinkSession({ timeoutMs = SESSION_WAIT_TIMEOUT_MS } = {}) {
  const redirectError = getRedirectError();
  const supabase = await getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase no està configurat.");
  }
  if (redirectError) throw redirectError;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data?.session?.access_token) return data.session;

  return waitForAuthStateSession(supabase, timeoutMs);
}

export async function sendAulaMagicLink(email) {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase no està configurat.");
  }

  const redirectTo = getAulaMagicLinkRedirectTo();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true
    }
  });

  if (error) throw error;
}
