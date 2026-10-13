import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200, origin = "") {
  const allowedOrigin = origin === "https://footlytics.vercel.app" ||
    origin === "https://footlyticsapp.vercel.app" ||
    /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/i.test(origin);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": allowedOrigin ? origin : "https://footlytics.vercel.app",
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function lagosDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (p: string) => parts.find((item) => item.type === p)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (request.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (request.method !== "POST") return json({ error: "POST required" }, 405, origin);

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Please sign in before sending a backup." }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const githubToken = Deno.env.get("GITHUB_BACKUP_WORKFLOW_TOKEN");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("Manual backup database configuration incomplete.");
    return json({ error: "Manual backup service is not configured in staging." }, 503, origin);
  }
  if (!githubToken) {
    return json({ error: "Manual backup is not connected to GitHub Actions yet. Add the GITHUB_BACKUP_WORKFLOW_TOKEN secret to the staging Supabase project." }, 503, origin);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Your session could not be verified. Please sign in again." }, 401, origin);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles").select("role,active").eq("user_id", authData.user.id).maybeSingle();
  if (profileError) {
    console.error("Could not verify backup permission:", profileError.message);
    return json({ error: "Could not verify your account permissions." }, 500, origin);
  }
  if (!profile?.active || !["staff", "admin"].includes(profile.role)) {
    return json({ error: "Only active staff and admin accounts can send manual backups." }, 403, origin);
  }

  let body: { startDate?: unknown; endDate?: unknown; branchSlug?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "A date range is required." }, 400, origin); }
  const startDate = body.startDate;
  const endDate = body.endDate;

  let reportScope = "all";
  if (profile.role === "staff") {
    if (typeof body.branchSlug !== "string" || !body.branchSlug.trim()) {
      return json({ error: "Choose your assigned active branch before requesting a backup." }, 400, origin);
    }
    const { data: selectedBranch, error: branchError } = await serviceClient
      .from("branches").select("id,slug").eq("slug", body.branchSlug.trim().toLowerCase()).eq("active", true).maybeSingle();
    if (branchError) {
      console.error("Could not verify requested branch:", branchError.message);
      return json({ error: "Could not verify your branch access." }, 500, origin);
    }
    if (!selectedBranch) return json({ error: "That branch is not active or does not exist." }, 403, origin);
    const { data: membership, error: membershipError } = await serviceClient
      .from("branch_memberships").select("user_id").eq("user_id", authData.user.id).eq("branch_id", selectedBranch.id).maybeSingle();
    if (membershipError) {
      console.error("Could not verify branch membership:", membershipError.message);
      return json({ error: "Could not verify your branch assignment." }, 500, origin);
    }
    if (!membership) return json({ error: "You can only export data for a branch assigned to your account." }, 403, origin);
    reportScope = selectedBranch.slug;
  }
  const today = lagosDateKey();
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || endDate > today) {
    return json({ error: "Choose valid dates in the past or today, with the start date no later than the end date." }, 400, origin);
  }
  const dayCount = Math.floor((new Date(endDate + "T00:00:00Z").getTime() - new Date(startDate + "T00:00:00Z").getTime()) / 86400000) + 1;
  if (dayCount > 366) return json({ error: "A single manual export can cover up to 366 days." }, 400, origin);

  const response = await fetch("https://api.github.com/repos/UvoTheMan/pharmacy-footfall-tracker/actions/workflows/daily-footfall-backup.yml/dispatches", {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "preview/manual-email-backup",
      inputs: {
        target_environment: "staging",
        send_email: "true",
        start_date: startDate,
        end_date: endDate,
        report_scope: reportScope,
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("GitHub Actions dispatch failed.", response.status, detail.slice(0, 400));
    return json({ error: "GitHub Actions could not queue the backup. Check that the staging GitHub token has Actions: write permission and the workflow is enabled." }, 502, origin);
  }

  return json({
    success: true,
    queued: true,
    startDate,
    endDate,
    message: "The backup job was queued in GitHub Actions.",
  }, 202, origin);
});
