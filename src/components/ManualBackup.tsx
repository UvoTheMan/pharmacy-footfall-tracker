import { useMemo, useState } from "react";
import { CalendarDays, Mail, Send } from "lucide-react";
import { supabase } from "../lib/supabase";

function lagosDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

type Props = { role: "staff" | "admin"; branchSlug?: string };

export default function ManualBackup({ role, branchSlug }: Props) {
  const today = lagosDateKey();
  const scopeLabel = role === "admin" ? "all three branch CSVs and the combined report" : `the active branch CSV only (${branchSlug ?? "active branch"})`;
  const [mode, setMode] = useState<"day" | "range">("day");
  const [expanded, setExpanded] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const days = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const start = new Date(`${startDate}T00:00:00Z`).getTime();
    const end = new Date(`${endDate}T00:00:00Z`).getTime();
    return Math.floor((end - start) / 86400000) + 1;
  }, [startDate, endDate]);

  async function sendBackup() {
    if (!supabase || sending) return;
    setError("");
    setNotice("");
    if (!startDate || !endDate || endDate < startDate) {
      setError("Choose a valid start date and end date.");
      return;
    }
    if (days > 366) {
      setError("For reliability, a single manual export can cover up to 366 days.");
      return;
    }
    const period = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
    if (!window.confirm(`Email ${scopeLabel} for ${period} to the configured backup email recipients? This will send an email now.`)) return;

    setSending(true);
    const result = await supabase.functions.invoke("manual-footfall-backup", {
      body: { startDate, endDate, branchSlug },
    });
    if (result.error || result.data?.success !== true) {
      let serverMessage = result.data?.error as string | undefined;
      const context = (result.error as (Error & { context?: unknown }) | null)?.context;
      if (!serverMessage && context instanceof Response) {
        try {
          const payload = await context.clone().json() as { error?: string };
          serverMessage = payload.error;
        } catch {
          // Fall back to the SDK error when the response isn't JSON.
        }
      }
      setError(serverMessage ?? result.error?.message ?? "The backup email could not be sent. Please try again or contact the administrator.");
    } else {
      setNotice(`Backup email job queued for ${period}. ${scopeLabel} will be generated and emailed. Check the GitHub Actions run for final delivery status.`);
    }
    setSending(false);
  }

  return (
    <section className={`panel manual-backup-panel${expanded ? " expanded" : ""}`}>
      <button type="button" className="manual-backup-summary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className="manual-backup-title">
          <span className="eyebrow">EMAIL EXPORT</span>
          <strong>Manual data backup</strong>
          <small>{role === "admin" ? "Queue all three branch reports plus the combined report." : `Queue a CSV for the active branch (${branchSlug ?? "not selected"}) only.`}</small>
        </span>
        <span className="heading-chip"><Mail size={14} /> Staff and admin</span>
        <span className="manual-backup-toggle" aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && <div className="manual-backup-content">
        <p className="panel-description">
          Choose one day or a date range. This queues a GitHub Actions job to generate the report permitted for your account: admins receive one CSV per branch plus a combined report; staff receive only the active branch CSV.
        </p>
      <div className="manual-backup-mode" role="group" aria-label="Export period">
        <button type="button" className={mode === "day" ? "admin-branch-tab active" : "admin-branch-tab"} aria-pressed={mode === "day"} onClick={() => { setMode("day"); setEndDate(startDate || today); setError(""); setNotice(""); }}>Single day</button>
        <button type="button" className={mode === "range" ? "admin-branch-tab active" : "admin-branch-tab"} aria-pressed={mode === "range"} onClick={() => { setMode("range"); setError(""); setNotice(""); }}>Date range</button>
      </div>
      <div className="manual-backup-fields">
        <label className="field-label">
          {mode === "day" ? "Date to export" : "Start date"}
          <input className="number-input" type="date" value={startDate} max={today} onChange={(event) => { setStartDate(event.target.value); if (mode === "day") setEndDate(event.target.value); setError(""); setNotice(""); }} required />
        </label>
        {mode === "range" && <label className="field-label">
          End date
          <input className="number-input" type="date" value={endDate} min={startDate || undefined} max={today} onChange={(event) => { setEndDate(event.target.value); setError(""); setNotice(""); }} required />
        </label>}
      </div>
      {mode === "range" && startDate && endDate && endDate >= startDate && (
        <p className="manual-backup-range"><CalendarDays size={14} /> {days} calendar day{days === 1 ? "" : "s"} selected{days > 366 ? " · Maximum is 366 days" : ""}</p>
      )}
      <button className="primary-button manual-backup-submit" type="button" onClick={() => void sendBackup()} disabled={sending || !startDate || !endDate || endDate < startDate || days > 366}>
        <Send size={16} /> {sending ? "Queueing backup…" : role === "admin" ? "Email all branch reports" : "Email active branch CSV"}
      </button>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
        <p className="setup-footnote">{role === "admin" ? "Includes Gbagada, Akoka, Sangotedo, and the combined CSV. " : "Only the active branch report will be sent. "}{role === "admin" ? "This action does not change visit records." : "This action is for reporting only and does not change visit records."}</p>
      </div>}
    </section>
  );
}
