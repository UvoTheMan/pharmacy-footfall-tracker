import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://springfootfall.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : "https://springfootfall.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!accessToken) {
    return jsonResponse({ error: "Sign in before changing your password." }, 401, origin);
  }

  const expectedToken = Deno.env.get("ADMIN_PASSWORD_CHANGE_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!expectedToken || expectedToken.length < 32 || !supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Password-change function is missing required server configuration.");
    return jsonResponse({ error: "Password-change service is not configured." }, 503, origin);
  }

  let body: { password?: unknown; adminToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400, origin);
  }

  const password = typeof body.password === "string" ? body.password : "";
  const adminToken = typeof body.adminToken === "string" ? body.adminToken : "";
  if (password.length < 10 || password.length > 128) {
    return jsonResponse({ error: "Password must be between 10 and 128 characters." }, 400, origin);
  }
  if (!adminToken || !(await constantTimeEqual(adminToken, expectedToken))) {
    return jsonResponse({ error: "Admin authorization failed." }, 403, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return jsonResponse({ error: "Your session is invalid or expired. Sign in again." }, 401, origin);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    userData.user.id,
    { password },
  );
  if (updateError) {
    console.error("Password update failed for authenticated user.");
    return jsonResponse({ error: "Password could not be updated." }, 400, origin);
  }

  return jsonResponse({ success: true }, 200, origin);
});
