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
  outcome: "purchased" | "not_purchased" | "undecided";
  reason: string | null;
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
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + offset);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
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
  const today = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  }, []);
  const minDate = dateOffset(today, -90);
  const maxDate = dateOffset(today, -1);
  const [selectedDate, setSelectedDate] = useState(maxDate);
  const [adminBranchFilter, setAdminBranchFilter] = useState("all");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const branchNames = useMemo(() => new Map(branches.map((item) => [item.id, item.name])), [branches]);
  const canLoad = Boolean(supabase && profile && (profile.role === "admin" || branch));

  async function loadHistory() {
    if (!supabase || !profile || (profile.role !== "admin" && !branch)) return;
    setLoading(true);
    setError("");
    setNotice("");
    let query = supabase
      .from("visits")
      .select("id,branch_id,visit_date,recorded_at,outcome,reason,batch_id,created_by,created_at,updated_at")
      .eq("visit_date", selectedDate)
      .order("recorded_at", { ascending: false })
      .range(0, 9999);

    if (profile.role !== "admin") {
      query = query.eq("branch_id", branch!.id);
    } else if (adminBranchFilter !== "all") {
      query = query.eq("branch_id", adminBranchFilter);
    }

    const result = await query;
    if (result.error) {
      setError(`Could not load historical visits: ${result.error.message}`);
      setVisits([]);
    } else {
      setVisits((result.data ?? []) as Visit[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadHistory();
    // The request is intentionally refreshed when the selected date or authorized branch filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, adminBranchFilter, branch?.id, profile?.role]);

  function exportCsv() {
    const headers = [
      "id", "branch_id", "branch_name", "visit_date", "recorded_at", "outcome",
      "reason", "batch_id", "created_by", "created_at", "updated_at",
    ];
    const rows = visits.map((visit) => [
      visit.id, visit.branch_id, branchNames.get(visit.branch_id) ?? visit.branch_id,
      visit.visit_date, visit.recorded_at, visit.outcome, visit.reason, visit.batch_id,
      visit.created_by, visit.created_at, visit.updated_at,
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    const scope = profile?.role === "admin" && adminBranchFilter === "all"
      ? "all-branches"
      : (branchNames.get(profile?.role === "admin" ? adminBranchFilter : branch?.id ?? "") ?? "branch")
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    link.href = url;
    link.download = `footfall-history-${scope}-${selectedDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice("Historical CSV exported to this device.");
  }

  const purchases = visits.filter((visit) => visit.outcome === "purchased").length;
  const noPurchases = visits.filter((visit) => visit.outcome === "not_purchased").length;
  const undecided = visits.filter((visit) => visit.outcome === "undecided").length;

  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">HISTORICAL RECORDS</p><h2>Past visits</h2></div>
        <span className="date-pill">Last 90 days</span>
      </div>
      <p className="panel-description">Choose a past date to review visits and export the records you are authorized to access. Older records remain stored in the database.</p>

      <div className="history-filters">
        <label className="history-date-field" htmlFor="history-date">
          <span><CalendarDays size={15} /> Date</span>
          <input id="history-date" type="date" min={minDate} max={maxDate} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        </label>
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
        {undecided > 0 && <div><strong>{undecided}</strong><span>Undecided</span></div>}
      </div>

      <div className="history-toolbar">
        <span>{loading ? "Loading records…" : `${visits.length} ${visits.length === 1 ? "record" : "records"} for ${selectedDate}`}</span>
        <div>
          <button type="button" className="secondary-button" onClick={() => void loadHistory()} disabled={!canLoad || loading}><RefreshCw size={14} /> Refresh</button>
          <button type="button" className="secondary-button" onClick={exportCsv} disabled={loading || visits.length === 0}><Download size={14} /> Export CSV</button>
        </div>
      </div>

      {!loading && visits.length === 0 ? (
        <div className="corrections-empty">No visits found for this date and branch selection.</div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead><tr><th>Time (Lagos)</th><th>Branch</th><th>Outcome</th><th>Reason</th><th>Record ID</th></tr></thead>
            <tbody>
              {visits.map((visit) => (
                <tr key={visit.id}>
                  <td>{formatTime(visit.recorded_at)}</td>
                  <td>{branchNames.get(visit.branch_id) ?? "Unknown branch"}</td>
                  <td><span className={`correction-badge ${visit.outcome === "not_purchased" ? "not-purchased" : "purchased"}`}>{visit.outcome === "purchased" ? "Purchased" : visit.outcome === "not_purchased" ? "No purchase" : "Undecided"}</span></td>
                  <td>{visit.reason ?? "—"}</td>
                  <td><code>{visit.id}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="history-footnote">Branch visibility is still enforced by Supabase. Staff can only read records permitted for their assigned branch. Admins can view one branch or all branches combined.</p>
    </section>
  );
}
