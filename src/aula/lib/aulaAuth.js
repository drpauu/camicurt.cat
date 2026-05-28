import { getSupabaseClient } from "../../lib/supabase.js";

const DEFAULT_AULA_REDIRECT_ORIGIN = "https://www.camicurt.cat";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

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
