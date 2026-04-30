import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabase = Boolean(supabaseUrl && supabaseKey);

export const supabase = hasSupabase ? createClient(supabaseUrl, supabaseKey) : null;
export const supabaseEnabled = hasSupabase;
