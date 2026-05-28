import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const ownerEmail = (process.env.ARISTOCRACIA_OWNER_EMAIL || "pau@camicurt.cat")
  .trim()
  .toLowerCase();
const ownerPassword = process.env.ARISTOCRACIA_OWNER_PASSWORD || "";

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Falten SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

if (!ownerEmail || !ownerEmail.includes("@")) {
  console.error("ARISTOCRACIA_OWNER_EMAIL no és vàlid.");
  process.exit(1);
}

if (ownerPassword.length < 10) {
  console.error("ARISTOCRACIA_OWNER_PASSWORD ha de tenir com a mínim 10 caràcters.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function findUserByEmail(email) {
  let page = 1;
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = (data?.users || []).find(
      (user) => String(user.email || "").trim().toLowerCase() === email
    );
    if (found) return found;
    if (!data?.users?.length || data.users.length < 1000) return null;
    page += 1;
  }
  return null;
}

const existingUser = await findUserByEmail(ownerEmail);
const userResult = existingUser?.id
  ? await supabase.auth.admin.updateUserById(existingUser.id, {
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { full_name: "Pau" }
    })
  : await supabase.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { full_name: "Pau" }
    });

if (userResult.error) throw userResult.error;
const user = userResult.data.user;

const { data: existingWorker, error: workerLookupError } = await supabase
  .from("aristocracia_workers")
  .select("id")
  .eq("email_normalized", ownerEmail)
  .maybeSingle();
if (workerLookupError) throw workerLookupError;

const workerPayload = {
  user_id: user.id,
  email: ownerEmail,
  full_name: "Pau",
  role: "owner",
  status: "active",
  activated_at: new Date().toISOString(),
  notes: "Owner inicial creat per scripts/create-aristocracia-owner.mjs"
};

const workerResult = existingWorker?.id
  ? await supabase.from("aristocracia_workers").update(workerPayload).eq("id", existingWorker.id)
  : await supabase.from("aristocracia_workers").insert(workerPayload);

if (workerResult.error) throw workerResult.error;

console.log(`Aristocracia owner configurat: ${ownerEmail}`);
