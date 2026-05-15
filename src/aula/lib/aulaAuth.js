import { getSupabaseClient } from "../../lib/supabase.js";

export async function sendAulaMagicLink(email) {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase no està configurat.");
  }

  const redirectTo = `${window.location.origin}/aula/callback`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true
    }
  });

  if (error) throw error;
}
