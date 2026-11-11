// Daily footfall CSV backup. Deploy as Supabase Edge Function "daily-footfall-backup".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BRANCHES = [
  { slug: "gbagada", name: "Gbagada" },
  { slug: "akoka", name: "Akoka" },
  { slug: "sangotedo", name: "Sangotedo" },
] as const;

const COLUMNS = [
  "id", "branch_id", "branch_name", "visit_date", "recorded_at",
  "outcome", "reason", "batch_id", "created_by", "created_at", "updated_at",
] as const;

type Visit = Record<(typeof COLUMNS)[number], string | null>;

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(rows: Visit[]): string {
  const header = COLUMNS.map(csvCell).join(",");
  const body = rows.map((row) => COLUMNS.map((key) => csvCell(row[key])).join(","));
  // UTF-8 BOM improves compatibility with spreadsheet apps. Always use CRLF.
  return "\uFEFF" + [header, ...body].join("\r\n") + "\r\n";
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);

  const expectedSecret = Deno.env.get("BACKUP_CRON_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-backup-secret") ?? "";
  if (!expectedSecret || suppliedSecret.length !== expectedSecret.length ||
      !crypto.subtle || !(await constantTimeEqual(suppliedSecret, expectedSecret))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("BACKUP_FROM_EMAIL");
  const recipientConfig = Deno.env.get("BACKUP_RECIPIENTS") ?? "victorokolie911@gmail.com";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Backup database configuration incomplete", {
      supabaseUrl: Boolean(supabaseUrl), serviceRoleKey: Boolean(serviceRoleKey),
    });
    return json({ error: "Backup database service is not configured" }, 503);
  }
  const recipients = [...new Set(recipientConfig.split(",").map((x) => x.trim()).filter(Boolean))];
  if (!recipients.length || recipients.some((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) {
    return json({ error: "BACKUP_RECIPIENTS must contain valid comma-separated email addresses" }, 500);
  }

  let body: { date?: unknown; dryRun?: unknown } = {};
  try { body = await request.json(); } catch { /* Empty body means today's Lagos date. */ }
  const date = typeof body.date === "string" ? body.date : lagosDateKey();
  const parsedDate = new Date(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date) {
    return json({ error: "date must be a valid YYYY-MM-DD date" }, 400);
  }
  const dryRun = body.dryRun === true;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The service-role client is server-only. It reads all branches without changing staff RLS.
  const { data: branches, error: branchError } = await supabase
    .from("branches").select("id,slug,name").in("slug", BRANCHES.map((b) => b.slug));
  if (branchError) {
    console.error("Unable to load branch metadata", { date, error: branchError.message });
    return json({ error: "Unable to load branch metadata" }, 500);
  }
  const branchById = new Map((branches ?? []).map((b) => [b.id, b]));
  if (BRANCHES.some((expected) => !(branches ?? []).some((b) => b.slug === expected.slug))) {
    console.error("One or more expected branches are missing", { date });
    return json({ error: "Expected branch configuration is incomplete" }, 500);
  }

  // Supabase projects commonly cap a single response at 1,000 rows. Page through
  // the full date to avoid silently omitting visits from the backup.
  const rawVisits: Record<string, any>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error: visitsError } = await supabase
      .from("visits")
      .select("id,branch_id,visit_date,recorded_at,outcome,reason,batch_id,created_by,created_at,updated_at")
      .eq("visit_date", date)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (visitsError) {
      console.error("Unable to read visit records", { date, offset, error: visitsError.message });
      return json({ error: "Unable to read visit records" }, 500);
    }
    const rows = page ?? [];
    rawVisits.push(...rows);
    if (rows.length < 1000) break;
  }

  const visits: Visit[] = (rawVisits ?? []).map((v) => ({
    id: v.id, branch_id: v.branch_id, branch_name: branchById.get(v.branch_id)?.name ?? "Unknown",
    visit_date: v.visit_date, recorded_at: v.recorded_at, outcome: v.outcome, reason: v.reason,
    batch_id: v.batch_id, created_by: v.created_by, created_at: v.created_at, updated_at: v.updated_at,
  }));
  const reports = [
    ...BRANCHES.map((branch) => ({
      filename: `footfall_${branch.slug}_${date}.csv`,
      content: toCsv(visits.filter((v) => v.branch_id && branchById.get(v.branch_id)?.slug === branch.slug)),
    })),
    { filename: `footfall_combined_${date}.csv`, content: toCsv(visits) },
  ];
  const counts = Object.fromEntries(reports.map((r) => [
    r.filename, Math.max(0, r.content.split("\r\n").length - 2),
  ]));

  if (dryRun) {
    return json({ success: true, dryRun: true, date, visitCount: visits.length, reportCounts: counts,
      filenames: reports.map((r) => r.filename), recipients });
  }

  if (!resendKey || !fromEmail) {
    console.error("Email delivery configuration incomplete", {
      resendKey: Boolean(resendKey), fromEmail: Boolean(fromEmail),
    });
    return json({ error: "Email delivery is not fully configured" }, 503);
  }

  // Claim the date atomically. Never overwrite a concurrent "sending" or a completed run.
  // Failed runs may be retried, but only one retry can change failed -> sending.
  const { data: existing, error: lookupError } = await supabase
    .from("footfall_backup_runs").select("status").eq("backup_date", date).maybeSingle();
  if (lookupError) {
    console.error("Backup run log is unavailable. Apply the backup migration first.", { date, error: lookupError.message });
    return json({ error: "Backup run log is not configured" }, 500);
  }
  if (existing?.status === "sent") {
    return json({ success: true, skipped: true, reason: "already_sent", date });
  }
  if (existing?.status === "sending") {
    return json({ success: false, skipped: true, reason: "already_in_progress", date }, 409);
  }

  const runDetails = {
    status: "sending",
    started_at: new Date().toISOString(),
    finished_at: null,
    visit_count: visits.length,
    report_counts: counts,
    error_message: null,
  };
  if (existing?.status === "failed") {
    const { data: claimedRun, error: claimError } = await supabase
      .from("footfall_backup_runs")
      .update(runDetails)
      .eq("backup_date", date)
      .eq("status", "failed")
      .select("backup_date")
      .maybeSingle();
    if (claimError) {
      console.error("Could not claim failed backup run", { date, error: claimError.message });
      return json({ error: "Could not record backup run" }, 500);
    }
    if (!claimedRun) {
      return json({ success: false, skipped: true, reason: "run_claimed_concurrently", date }, 409);
    }
  } else {
    const { data: claimedRun, error: claimError } = await supabase
      .from("footfall_backup_runs")
      .insert({ backup_date: date, ...runDetails })
      .select("backup_date")
      .maybeSingle();
    if (claimError) {
      // A second invocation may have inserted this date after our initial lookup.
      if (claimError.code === "23505") {
        return json({ success: false, skipped: true, reason: "run_claimed_concurrently", date }, 409);
      }
      console.error("Could not create backup run claim", { date, error: claimError.message });
      return json({ error: "Could not record backup run" }, 500);
    }
    if (!claimedRun) {
      return json({ error: "Could not claim backup run" }, 500);
    }
  }

  try {
    const attachments = reports.map((report) => ({
      filename: report.filename,
      content: base64Utf8(report.content),
      content_type: "text/csv; charset=utf-8",
    }));
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `footfall-daily-backup-${date}`,
      },
      body: JSON.stringify({
        from: fromEmail, to: recipients,
        subject: `Pharmacy Footfall Tracker daily backup - ${date}`,
        text: `Attached are the four daily CSV reports for Lagos date ${date}. Combined visits: ${visits.length}.`,
        attachments,
      }),
    });
    const providerResult = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}: ${JSON.stringify(providerResult).slice(0, 500)}`);

    const { error: logError } = await supabase.from("footfall_backup_runs").update({
      status: "sent", finished_at: new Date().toISOString(), provider_message_id: providerResult.id ?? null,
      error_message: null,
    }).eq("backup_date", date);
    if (logError) {
      console.error("Email accepted but run log update failed", { date, providerMessageId: providerResult.id, error: logError.message });
      return json({ success: true, warning: "Email accepted, but run log update failed", date, providerMessageId: providerResult.id }, 202);
    }
    console.log("Daily backup sent", { date, visitCount: visits.length, reportCounts: counts, providerMessageId: providerResult.id });
    return json({ success: true, date, visitCount: visits.length, reportCounts: counts, providerMessageId: providerResult.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email delivery error";
    console.error("Daily backup failed", { date, error: message });
    await supabase.from("footfall_backup_runs").update({
      status: "failed", finished_at: new Date().toISOString(), error_message: message.slice(0, 1000),
    }).eq("backup_date", date);
    return json({ error: "Email delivery failed", date }, 502);
  }
});

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(b)),
  ]);
  const x = new Uint8Array(left), y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
