import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BRANCHES = [
  { slug: "gbagada", name: "Gbagada" },
  { slug: "akoka", name: "Akoka" },
  { slug: "sangotedo", name: "Sangotedo" },
] as const;

const COLUMNS = [
  "id", "branch_id", "branch_name", "visit_date", "recorded_at", "outcome",
  "reason", "unavailable_item_requested", "batch_id", "created_by", "created_at", "updated_at",
] as const;

type Visit = Record<(typeof COLUMNS)[number], string | boolean | null>;

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

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(rows: Visit[]): string {
  const header = COLUMNS.map(csvCell).join(",");
  const body = rows.map((row) => COLUMNS.map((key) => csvCell(row[key])).join(","));
  return "\uFEFF" + [header, ...body].join("\r\n") + "\r\n";
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
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
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
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("BACKUP_FROM_EMAIL");
  const recipientConfig = Deno.env.get("BACKUP_RECIPIENTS") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("Manual backup database configuration incomplete.");
    return json({ error: "Manual backup service is not configured." }, 503, origin);
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

  let body: { startDate?: unknown; endDate?: unknown; dryRun?: unknown } = {};
  try { body = await request.json(); } catch { return json({ error: "A date range is required." }, 400, origin); }
  const startDate = body.startDate;
  const endDate = body.endDate;
  const today = lagosDateKey();
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate || endDate > today) {
    return json({ error: "Choose valid dates in the past or today, with the start date no later than the end date." }, 400, origin);
  }
  const dayCount = Math.floor((new Date(endDate + "T00:00:00Z").getTime() - new Date(startDate + "T00:00:00Z").getTime()) / 86400000) + 1;
  if (dayCount > 366) return json({ error: "A single manual export can cover up to 366 days." }, 400, origin);
  if (!resendKey || !fromEmail) {
    console.error("Manual backup email delivery configuration incomplete.");
    return json({ error: "Email delivery is not configured." }, 503, origin);
  }
  const recipients = [...new Set(recipientConfig.split(",").map((item) => item.trim()).filter(Boolean))];
  if (recipients.length < 2 || recipients.some((item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))) {
    console.error("Manual backup recipient configuration is incomplete.");
    return json({ error: "The two backup email recipients are not configured correctly." }, 503, origin);
  }

  const { data: branches, error: branchError } = await serviceClient
    .from("branches").select("id,slug,name").in("slug", BRANCHES.map((item) => item.slug));
  if (branchError || BRANCHES.some((expected) => !(branches ?? []).some((item) => item.slug === expected.slug))) {
    console.error("Manual backup branch lookup failed.", branchError?.message ?? "Expected branch missing");
    return json({ error: "The branch configuration is incomplete." }, 500, origin);
  }
  const branchById = new Map((branches ?? []).map((item) => [item.id, item]));

  const rawVisits: Record<string, any>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error: visitsError } = await serviceClient
      .from("visits")
      .select("id,branch_id,visit_date,recorded_at,outcome,reason,unavailable_item_requested,batch_id,created_by,created_at,updated_at")
      .gte("visit_date", startDate).lte("visit_date", endDate)
      .order("visit_date", { ascending: true }).order("recorded_at", { ascending: true })
      .order("id", { ascending: true }).range(offset, offset + 999);
    if (visitsError) {
      console.error("Manual backup visit query failed.", visitsError.message);
      return json({ error: "Could not read visit records for that period." }, 500, origin);
    }
    rawVisits.push(...(page ?? []));
    if ((page ?? []).length < 1000) break;
  }

  const visits: Visit[] = rawVisits.map((visit) => ({
    id: visit.id, branch_id: visit.branch_id,
    branch_name: branchById.get(visit.branch_id)?.name ?? "Unknown",
    visit_date: visit.visit_date, recorded_at: visit.recorded_at, outcome: visit.outcome,
    reason: visit.reason, unavailable_item_requested: visit.unavailable_item_requested ?? false,
    batch_id: visit.batch_id, created_by: visit.created_by, created_at: visit.created_at, updated_at: visit.updated_at,
  }));

  const periodLabel = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
  const reports = [
    ...BRANCHES.map((branch) => ({
      filename: `footfall_${branch.slug}_${periodLabel}.csv`,
      content: toCsv(visits.filter((visit) => visit.branch_id && branchById.get(visit.branch_id)?.slug === branch.slug)),
    })),
    { filename: `footfall_combined_${periodLabel}.csv`, content: toCsv(visits) },
  ];
  const counts = Object.fromEntries(reports.map((report) => [
    report.filename, Math.max(0, report.content.split("\r\n").length - 2),
  ]));

  if (body.dryRun === true) {
    return json({ success: true, dryRun: true, startDate, endDate, visitCount: visits.length, reportCounts: counts, recipients: recipients.length }, 200, origin);
  }

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: recipients,
      subject: `Footlytics manual CSV backup - ${periodLabel}`,
      text: `Attached are the four collated Footlytics CSV reports for Lagos date period ${startDate} through ${endDate}. Total visit records: ${visits.length}. Requested by an authorized ${profile.role} account.`,
      attachments: reports.map((report) => ({
        filename: report.filename,
        content: base64Utf8(report.content),
      })),
    }),
  });
  if (!emailResponse.ok) {
    const detail = await emailResponse.text();
    console.error("Resend rejected manual backup email.", emailResponse.status, detail.slice(0, 500));
    return json({ error: "The email provider could not send the backup. Please try again later." }, 502, origin);
  }
  const emailResult = await emailResponse.json();
  return json({
    success: true, startDate, endDate, visitCount: visits.length,
    reportCounts: counts, recipientCount: recipients.length, emailId: emailResult.id ?? null,
  }, 200, origin);
});
