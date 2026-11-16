import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, RefreshCw, Search } from "lucide-react";
import { supabase } from "../lib/supabase";

type Branch = { id: string; slug: string; name: string };
type Profile = { role: "staff" | "admin" };
type Visit = {
  id: string;
  branch_id: string;
  visit_date: string;
  recorded_at: string;
  outcome: "purchased" | "not_purchased";
  reason: string | null;
  unavailable_item_requested: boolean;
  batch_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type Props = {
  branch: Branch | null;
  branches: Branch[];
  profile: Profile | null;
};

function dateOffset(dateKey: string, offset: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function lagosDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value));
}

export default function HistoricalVisits({ branch, branches, profile }: Props) {
  const today = useMemo(() => lagosDateKey(), []);
  const minDate = dateOffset(today, -90);
  const maxDate = dateOffset(today, -1);
  const [viewMode, setViewMode] = useState<"date" | "range">("date");
  const [selectedDate, setSelectedDate] = useState(maxDate);
  const [rangeStartDate, setRangeStartDate] = useState(dateOffset(maxDate, -6));
  const [rangeEndDate, setRangeEndDate] = useState(maxDate);
  const [exportStartDate, setExportStartDate] = useState(maxDate);
  const [exportEndDate, setExportEndDate] = useState(maxDate);
  const [adminBranchFilter, setAdminBranchFilter] = useState("all");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const branchNames = useMemo(() => new Map(branches.map((item) => [item.id, item.name])), [branches]);
  const canLoad = Boolean(supabase && profile && (profile.role === "admin" || branch));
  const validHistoricalDate = (value: string) => Boolean(value && value >= minDate && value <= maxDate);
  const validExportDate = (value: string) => Boolean(value && value >= minDate && value <= today);

  async function loadHistory() {
    if (!supabase || !profile || (profile.role !== "admin" && !branch)) return;
    if (viewMode === "date" && !validHistoricalDate(selectedDate)) {
      setError("Choose a date from the previous 90 days through yesterday.");
      setVisits([]);
      return;
    }
    if (viewMode === "range" && (
      !validHistoricalDate(rangeStartDate) ||
      !validHistoricalDate(rangeEndDate) ||
      rangeStartDate > rangeEndDate
    )) {
      setError("Choose a valid date range from the previous 90 days through yesterday.");
      setVisits([]);
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    const allVisits: Visit[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = supabase
        .from("visits")
        .select("id,branch_id,visit_date,recorded_at,outcome,reason,unavailable_item_requested,batch_id,created_by,created_at,updated_at");

      query = viewMode === "date"
        ? query.eq("visit_date", selectedDate)
        : query.gte("visit_date", rangeStartDate).lte("visit_date", rangeEndDate);

      if (profile.role !== "admin") {
        query = query.eq("branch_id", branch!.id);
      } else if (adminBranchFilter !== "all") {
        query = query.eq("branch_id", adminBranchFilter);
      }

      query = query
        .order("visit_date", { ascending: false })
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + 999);

      const result = await query;
      if (result.error) {
        setError(`Could not load historical visits: ${result.error.message}`);
        setVisits([]);
        setLoading(false);
        return;
      }
      const page = (result.data ?? []) as Visit[];
      allVisits.push(...page);
      if (page.length < 1000) break;
    }
    setVisits(allVisits);
    setLoading(false);
  }

  useEffect(() => {
    void loadHistory();
    // Refresh when the view period or authorized branch filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedDate, rangeStartDate, rangeEndDate, adminBranchFilter, branch?.id, profile?.role]);

  function applyHistoricalRangeStart(value: string) {
    if (!validHistoricalDate(value) || value > rangeEndDate) {
      setError("The start date must be within the previous 90 days and cannot be later than the end date.");
      return;
    }
    setError("");
    setRangeStartDate(value);
  }

  function applyHistoricalRangeEnd(value: string) {
    if (!validHistoricalDate(value) || value < rangeStartDate) {
      setError("The end date must be within the previous 90 days and cannot be earlier than the start date.");
      return;
    }
    setError("");
    setRangeEndDate(value);
  }

  function applyQuickDuration(days: 7 | 30) {
    setError("");
    setRangeStartDate(dateOffset(maxDate, -(days - 1)));
    setRangeEndDate(maxDate);
    setViewMode("range");
  }

  function applyHistoricalDate(value: string) {
    if (!validHistoricalDate(value)) {
      setError("Only dates from the previous 90 days through yesterday are available. Today and future dates are not allowed.");
      return;
    }
    setError("");
    setSelectedDate(value);
  }

  function applyExportStartDate(value: string) {
    if (!validExportDate(value)) {
      setError("The export start date must be within the previous 90 days through today.");
      return;
    }
    if (value > exportEndDate) {
      setError("The export start date cannot be later than the end date.");
      return;
    }
    setError("");
    setExportStartDate(value);
  }

  function applyExportEndDate(value: string) {
    if (!validExportDate(value)) {
      setError("The export end date must be within the previous 90 days through today.");
      return;
    }
    if (value < exportStartDate) {
      setError("The export end date cannot be earlier than the start date.");
      return;
    }
    setError("");
    setExportEndDate(value);
  }

  async function exportCsv() {
    if (!supabase || !profile || (profile.role !== "admin" && !branch)) return;
    if (!validExportDate(exportStartDate) || !validExportDate(exportEndDate) || exportStartDate > exportEndDate) {
      setError("Choose a valid export range within the previous 90 days through today.");
      return;
    }

    setExporting(true);
    setError("");
    setNotice("");
    const exportVisits: Visit[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = supabase
        .from("visits")
        .select("id,branch_id,visit_date,recorded_at,outcome,reason,unavailable_item_requested,batch_id,created_by,created_at,updated_at")
        .gte("visit_date", exportStartDate)
        .lte("visit_date", exportEndDate)
        .order("visit_date", { ascending: true })
        .order("recorded_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + 999);

      if (profile.role !== "admin") {
        query = query.eq("branch_id", branch!.id);
      } else if (adminBranchFilter !== "all") {
        query = query.eq("branch_id", adminBranchFilter);
      }

      const result = await query;
      if (result.error) {
        setError(`Could not export historical visits: ${result.error.message}`);
        setExporting(false);
        return;
      }
      const page = (result.data ?? []) as Visit[];
      exportVisits.push(...page);
      if (page.length < 1000) break;
    }

    const headers = [
      "id", "branch_id", "branch_name", "visit_date", "recorded_at", "outcome",
      "reason", "unavailable_item_requested", "batch_id", "created_by", "created_at", "updated_at",
    ];
    const rows = exportVisits.map((visit) => [
      visit.id, visit.branch_id, branchNames.get(visit.branch_id) ?? visit.branch_id,
      visit.visit_date, visit.recorded_at, visit.outcome, visit.reason, visit.unavailable_item_requested, visit.batch_id,
      visit.created_by, visit.created_at, visit.updated_at,
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    const scope = profile.role === "admin" && adminBranchFilter === "all"
      ? "all-branches"
      : (branchNames.get(profile.role === "admin" ? adminBranchFilter : branch?.id ?? "") ?? "branch")
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    link.href = url;
    link.download = `footfall-history-${scope}-${exportStartDate}-to-${exportEndDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`CSV exported: ${exportVisits.length} record(s) from ${exportStartDate} to ${exportEndDate}.`);
    setExporting(false);
  }

  const purchases = visits.filter((visit) => visit.outcome === "purchased").length;
  const noPurchases = visits.filter((visit) => visit.outcome === "not_purchased").length;
  const unavailableDespitePurchase = visits.filter((visit) => visit.outcome === "purchased" && visit.unavailable_item_requested).length;

  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">HISTORICAL RECORDS</p><h2>Past visits</h2></div>
        <span className="date-pill">Last 90 days</span>
      </div>
      <p className="panel-description">Choose a past date to review visits. Historical viewing ends yesterday; CSV exports can include today and any date within the previous 90 days. Older records remain stored in the database.</p>

      <div className="history-view-controls">
        <div className="history-view-mode" role="group" aria-label="Historical view mode">
          <button type="button" className={viewMode === "date" ? "active" : ""} onClick={() => { setError(""); setViewMode("date"); }}>Specific date</button>
          <button type="button" className={viewMode === "range" ? "active" : ""} onClick={() => { setError(""); setViewMode("range"); }}>Date range</button>
        </div>
        {viewMode === "date" ? (
          <div className="history-filters">
            <label className="history-date-field" htmlFor="history-date">
              <span><CalendarDays size={15} /> View date</span>
              <input id="history-date" type="date" min={minDate} max={maxDate} value={selectedDate} onChange={(event) => applyHistoricalDate(event.target.value)} />
            </label>
          </div>
        ) : (
          <>
            <div className="history-quick-durations" role="group" aria-label="Quick date ranges">
              <span>Quick view</span>
              <button type="button" onClick={() => applyQuickDuration(7)} className={rangeStartDate === dateOffset(maxDate, -6) && rangeEndDate === maxDate ? "active" : ""}>Last 7 days</button>
              <button type="button" onClick={() => applyQuickDuration(30)} className={rangeStartDate === dateOffset(maxDate, -29) && rangeEndDate === maxDate ? "active" : ""}>Last 30 days</button>
            </div>
            <div className="history-filters">
              <label className="history-date-field" htmlFor="history-range-start">
                <span><CalendarDays size={15} /> Start date</span>
                <input id="history-range-start" type="date" min={minDate} max={maxDate} value={rangeStartDate} onChange={(event) => applyHistoricalRangeStart(event.target.value)} />
              </label>
              <label className="history-date-field" htmlFor="history-range-end">
                <span><CalendarDays size={15} /> End date</span>
                <input id="history-range-end" type="date" min={minDate} max={maxDate} value={rangeEndDate} onChange={(event) => applyHistoricalRangeEnd(event.target.value)} />
              </label>
            </div>
          </>
        )}
      </div>
      <div className="history-filters">
        {profile?.role === "admin" && (
          <label className="history-date-field" htmlFor="history-branch">
            <span><Search size={15} /> Branch</span>
            <select id="history-branch" value={adminBranchFilter} onChange={(event) => setAdminBranchFilter(event.target.value)}>
              <option value="all">All branches combined</option>
              {branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="history-summary">
        <div><strong>{visits.length}</strong><span>Total visits</span></div>
        <div><strong>{purchases}</strong><span>Purchases</span></div>
        <div><strong>{noPurchases}</strong><span>No purchase</span></div>
        <div><strong>{unavailableDespitePurchase}</strong><span>Purchased despite stockout</span></div>
      </div>

      <div className="history-toolbar">
        <span>{loading ? "Loading records…" : viewMode === "date"
          ? `${visits.length} ${visits.length === 1 ? "record" : "records"} for ${selectedDate}`
          : `${visits.length} ${visits.length === 1 ? "record" : "records"} from ${rangeStartDate} to ${rangeEndDate}`}</span>
        <div>
          <button type="button" className="secondary-button" onClick={() => void loadHistory()} disabled={!canLoad || loading}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {!loading && visits.length === 0 ? (
        <div className="corrections-empty">No visits found for this {viewMode === "date" ? "date" : "date range"} and branch selection.</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead><tr><th>Time (Lagos)</th><th>Branch</th><th>Outcome</th><th>Reason</th><th>Unavailable request</th><th>Record ID</th></tr></thead>
            <tbody>
              {visits.map((visit) => (
                <tr key={visit.id}>
                  <td>{formatTime(visit.recorded_at)}</td>
                  <td>{branchNames.get(visit.branch_id) ?? "Unknown branch"}</td>
                  <td><span className={`correction-badge ${visit.outcome === "not_purchased" ? "not-purchased" : "purchased"}`}>{visit.outcome === "purchased" ? "Purchased" : "No purchase"}</span></td>
                  <td>{visit.reason ?? "—"}</td>
                  <td>{visit.outcome === "purchased" && visit.unavailable_item_requested ? "Yes" : "—"}</td>
                  <td><code>{visit.id}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="history-export-range">
        <h3>Export CSV by date range</h3>
        <p className="panel-description">Choose the first and last dates to include. The export range can include today, but not future dates or dates older than 90 days.</p>
        <div className="history-filters">
          <label className="history-date-field" htmlFor="history-export-start">
            <span><CalendarDays size={15} /> Start date</span>
            <input id="history-export-start" type="date" min={minDate} max={today} value={exportStartDate} onChange={(event) => applyExportStartDate(event.target.value)} />
          </label>
          <label className="history-date-field" htmlFor="history-export-end">
            <span><CalendarDays size={15} /> End date</span>
            <input id="history-export-end" type="date" min={minDate} max={today} value={exportEndDate} onChange={(event) => applyExportEndDate(event.target.value)} />
          </label>
          <button type="button" className="secondary-button" onClick={() => void exportCsv()} disabled={!canLoad || exporting}>
            <Download size={14} /> {exporting ? "Preparing CSV…" : "Export date range"}
          </button>
        </div>
      </div>
      <p className="history-footnote">Branch visibility is still enforced by Supabase. Staff can only read records permitted for their assigned branch. Admins can view one branch or all branches combined.</p>
    </section>
  );
}
