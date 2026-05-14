const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABESE_ANON_KEY;
const hasSupabase = Boolean(supabaseUrl && supabaseKey);

export const supabaseEnabled = hasSupabase;

export function getSupabaseUrl() {
  return supabaseUrl || "";
}

export function getSupabasePublicKey() {
  return supabaseKey || "";
}

let clientPromise = null;

export async function getSupabaseClient() {
  if (!hasSupabase) return null;
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(supabaseUrl, supabaseKey)
    );
  }
  return clientPromise;
}
