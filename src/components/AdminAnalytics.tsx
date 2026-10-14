import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, GitCompare, RefreshCw, Search, TrendingUp, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import "./AdminAnalytics.css";

type Branch = { id: string; name: string; slug: string };
type Visit = {
  id: string;
  branch_id: string;
  visit_date: string;
  outcome: "purchased" | "not_purchased" | "undecided";
  reason: string | null;
  unavailable_item_requested: boolean;
};
type AnalysisTab = "overview" | "branches" | "trends" | "reasons";

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function shiftDate(key: string, amount: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function percent(numerator: number, denominator: number) {
  return denominator ? Math.round(numerator / denominator * 100) : 0;
}
const TABS: { id: AnalysisTab; label: string; description: string }[] = [
  { id: "overview", label: "Overview", description: "Key metrics and a quick summary of branch activity." },
  { id: "branches", label: "Branches", description: "Compare visit volume, outcomes and conversion across branches." },
  { id: "trends", label: "Trends", description: "Review daily visit patterns over the selected period." },
  { id: "reasons", label: "Reasons", description: "Understand the most common reasons visits did not convert." },
];

export default function AdminAnalytics({ branches }: { branches: Branch[] }) {
  const today = useMemo(() => dateKey(new Date()), []);
  const earliest = shiftDate(today, -89);
  const [startDate, setStartDate] = useState(shiftDate(today, -29));
  const [endDate, setEndDate] = useState(today);
  const [activeTab, setActiveTab] = useState<AnalysisTab>("overview");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRange, setLoadedRange] = useState("");

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Analytics is unavailable because the database connection is not configured.");
      return;
    }
    if (!startDate || !endDate || startDate < earliest || endDate > today || startDate > endDate) {
      setError(`Choose a valid range from ${earliest} through ${today}, with the start date no later than the end date.`);
      return;
    }
    setLoading(true);
    setError("");
    const rows: Visit[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("visits")
        .select("id,branch_id,visit_date,outcome,reason,unavailable_item_requested")
        .gte("visit_date", startDate)
        .lte("visit_date", endDate)
        .order("visit_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (result.error) {
        setError(`Could not load analytics: ${result.error.message}`);
        setVisits([]);
        setLoading(false);
        return;
      }
      const page = (result.data ?? []) as Visit[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    setVisits(rows);
    setLoadedRange(`${startDate} to ${endDate}`);
    setLoading(false);
  }, [startDate, endDate, earliest, today]);

  useEffect(() => { void load(); }, [load]);

  const branchStats = useMemo(() => branches.map((branch) => {
    const rows = visits.filter((visit) => visit.branch_id === branch.id);
    const purchases = rows.filter((visit) => visit.outcome === "purchased").length;
    const noPurchase = rows.filter((visit) => visit.outcome === "not_purchased").length;
    const undecided = rows.filter((visit) => visit.outcome === "undecided").length;
    const resolved = purchases + noPurchase;
    return {
      ...branch,
      total: rows.length,
      purchases,
      noPurchase,
      undecided,
      resolved,
      conversion: percent(purchases, resolved),
      unavailable: rows.filter((visit) => visit.unavailable_item_requested).length,
    };
  }), [branches, visits]);

  const purchases = visits.filter((visit) => visit.outcome === "purchased").length;
  const noPurchase = visits.filter((visit) => visit.outcome === "not_purchased").length;
  const undecided = visits.filter((visit) => visit.outcome === "undecided").length;
  const resolved = purchases + noPurchase;
  const conversion = percent(purchases, resolved);
  const noPurchaseRate = percent(noPurchase, resolved);
  const unavailableRequests = visits.filter((visit) => visit.unavailable_item_requested).length;

  const dailyStats = useMemo(() => {
    const days: { date: string; total: number; purchases: number; noPurchase: number; undecided: number }[] = [];
    for (let cursor = startDate; cursor <= endDate; cursor = shiftDate(cursor, 1)) {
      const rows = visits.filter((visit) => visit.visit_date === cursor);
      days.push({
        date: cursor,
        total: rows.length,
        purchases: rows.filter((visit) => visit.outcome === "purchased").length,
        noPurchase: rows.filter((visit) => visit.outcome === "not_purchased").length,
        undecided: rows.filter((visit) => visit.outcome === "undecided").length,
      });
    }
    return days;
  }, [visits, startDate, endDate]);

  const reasonStats = useMemo(() => {
    const counts = new Map<string, number>();
    visits.filter((visit) => visit.outcome === "not_purchased").forEach((visit) => {
      const reason = visit.reason?.trim() || "Other / Unknown";
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    });
    return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  }, [visits]);

  const peak = Math.max(1, ...dailyStats.map((day) => day.total));
  const maxBranch = Math.max(1, ...branchStats.map((branch) => branch.total));
  const topBranch = [...branchStats].filter((item) => item.resolved > 0).sort((a, b) => b.conversion - a.conversion)[0];

  return (
    <section className="panel admin-analytics-panel" id="admin-analytics" aria-labelledby="admin-analytics-title">
      <div className="panel-heading">
        <div><p className="eyebrow">ADMIN WORKSPACE</p><h2 id="admin-analytics-title"><BarChart3 size={20} /> Analysis &amp; analytics</h2></div>
        <span className="date-pill">All branches</span>
      </div>
      <p className="panel-description">Explore pharmacy performance using saved visit records. Choose a reporting period, then switch between overview, branches, trends and reasons. This workspace is read-only.</p>

      <div className="history-filters analytics-filters">
        <label className="history-date-field" htmlFor="analytics-start"><span><CalendarDays size={15} /> Start date</span>
          <input id="analytics-start" type="date" min={earliest} max={endDate || today} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="history-date-field" htmlFor="analytics-end"><span><CalendarDays size={15} /> End date</span>
          <input id="analytics-end" type="date" min={startDate || earliest} max={today} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <button type="button" className="secondary-button analytics-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? "Refreshing…" : "Refresh analysis"}</button>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="analytics-range-row">
        <p className="analytics-range">{loadedRange ? `Reporting period: ${loadedRange}` : "Preparing reporting period…"} · Maximum window: 90 days</p>
        <span className="analytics-record-count">{loading ? "Updating records…" : `${visits.length.toLocaleString()} visits loaded`}</span>
      </div>

      <nav className="analytics-tabs" aria-label="Analysis sections">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? "analytics-tab active" : "analytics-tab"}
            aria-current={activeTab === tab.id ? "page" : undefined}
            onClick={() => setActiveTab(tab.id)}>
            {tab.id === "overview" ? <BarChart3 size={15} /> : tab.id === "branches" ? <GitCompare size={15} /> : tab.id === "trends" ? <TrendingUp size={15} /> : <Search size={15} />}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
      <p className="analytics-tab-description">{TABS.find((tab) => tab.id === activeTab)?.description}</p>

      {activeTab === "overview" && (
        <div className="analytics-tab-content">
          <div className="history-summary analytics-kpis">
            <div><strong>{visits.length.toLocaleString()}</strong><span><Users size={13} /> Total visits</span></div>
            <div><strong>{purchases.toLocaleString()}</strong><span>Purchases</span></div>
            <div><strong>{noPurchase.toLocaleString()}</strong><span>No purchase</span></div>
            <div><strong>{conversion}%</strong><span>Conversion of resolved visits</span></div>
            <div><strong>{undecided.toLocaleString()}</strong><span>Undecided visits</span></div>
            <div><strong>{unavailableRequests.toLocaleString()}</strong><span>Unavailable-item requests</span></div>
          </div>
          <div className="analytics-grid">
            <section className="analytics-subpanel">
              <h3><GitCompare size={16} /> Branch snapshot</h3>
              <p className="analytics-help">A quick view of recorded activity across all branches.</p>
              {branchStats.map((item) => (
                <div className="analytics-branch-row" key={item.id}>
                  <div className="analytics-row-label"><strong>{item.name}</strong><span>{item.total} visits</span></div>
                  <div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${item.total / maxBranch * 100}%` }} /></div>
                  <div className="analytics-row-meta"><span>{item.purchases} purchases</span><span>{item.noPurchase} no purchase</span></div>
                </div>
              ))}
              {branchStats.length === 0 && <p className="corrections-empty">No branches are available for analysis.</p>}
            </section>
            <section className="analytics-subpanel analytics-insight-panel">
              <h3><TrendingUp size={16} /> Quick insights</h3>
              {visits.length === 0 ? <p className="corrections-empty">No visits were recorded in this reporting period.</p> : (
                <ul className="analytics-insight-list">
                  <li><strong>{conversion}%</strong> purchase conversion among visits with a resolved outcome.</li>
                  <li><strong>{noPurchaseRate}%</strong> of resolved visits ended without a purchase.</li>
                  <li>{topBranch ? <><strong>{topBranch.name}</strong> has the highest conversion among branches with resolved visits.</> : "There are not yet enough resolved visits to compare branch conversion."}</li>
                  <li><strong>{undecided}</strong> visits still have an undecided outcome.</li>
                </ul>
              )}
              <p className="analytics-help">These are descriptive summaries, not proof of why performance changed.</p>
            </section>
          </div>
        </div>
      )}

      {activeTab === "branches" && (
        <div className="analytics-tab-content">
          <div className="history-summary analytics-kpis">
            <div><strong>{branchStats.length}</strong><span>Branches included</span></div>
            <div><strong>{Math.max(0, ...branchStats.map((item) => item.total)).toLocaleString()}</strong><span>Most visits at one branch</span></div>
            <div><strong>{topBranch?.conversion ?? 0}%</strong><span>Highest branch conversion</span></div>
          </div>
          <div className="analytics-grid">
            <section className="analytics-subpanel analytics-wide-subpanel">
              <h3><GitCompare size={16} /> Branch performance comparison</h3>
              <p className="analytics-help">Compare visit volume, outcomes and conversion. Conversion excludes undecided visits from its denominator.</p>
              {branchStats.map((item) => (
                <div className="analytics-branch-row" key={item.id}>
                  <div className="analytics-row-label"><strong>{item.name}</strong><span>{item.total.toLocaleString()} visits · {item.conversion}% conversion</span></div>
                  <div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${item.total / maxBranch * 100}%` }} /></div>
                  <div className="analytics-row-meta"><span>{item.purchases} purchases</span><span>{item.noPurchase} no purchase</span></div>
                  <div className="analytics-row-meta"><span>{item.undecided} undecided</span><span>{item.unavailable} unavailable-item requests</span></div>
                </div>
              ))}
              {branchStats.length === 0 && <p className="corrections-empty">No branches are available for analysis.</p>}
            </section>
          </div>
        </div>
      )}

      {activeTab === "trends" && (
        <div className="analytics-tab-content">
          <section className="analytics-subpanel analytics-trend">
            <h3><CalendarDays size={16} /> Daily visit trend</h3>
            <p className="analytics-help">Each bar shows all recorded visits for that Lagos calendar date. Scroll horizontally on smaller screens to see the full period.</p>
            <div className="analytics-daily-chart" role="img" aria-label="Daily visit counts for the selected reporting period">
              {dailyStats.map((day) => (
                <div className="analytics-day" key={day.date} title={`${day.date}: ${day.total} visits, ${day.purchases} purchases, ${day.noPurchase} no purchase, ${day.undecided} undecided`}>
                  <span className="analytics-day-count">{day.total || ""}</span>
                  <span className="analytics-day-bar" style={{ height: `${Math.max(day.total ? 8 : 2, day.total / peak * 100)}%` }} />
                  <span className="analytics-day-label">{day.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="analytics-trend-summary">
              <span>Visits <strong>{visits.length.toLocaleString()}</strong></span>
              <span>Purchases <strong>{purchases.toLocaleString()}</strong></span>
              <span>No purchase <strong>{noPurchase.toLocaleString()}</strong></span>
              <span>Undecided <strong>{undecided.toLocaleString()}</strong></span>
            </div>
          </section>
        </div>
      )}

      {activeTab === "reasons" && (
        <div className="analytics-tab-content">
          <div className="history-summary analytics-kpis">
            <div><strong>{noPurchase.toLocaleString()}</strong><span>No-purchase visits</span></div>
            <div><strong>{reasonStats.length}</strong><span>Reason categories</span></div>
            <div><strong>{reasonStats[0]?.count ?? 0}</strong><span>Most frequent reason</span></div>
          </div>
          <section className="analytics-subpanel analytics-reasons-panel">
            <h3><Search size={16} /> No-purchase reasons</h3>
            <p className="analytics-help">Counts and percentages are based on no-purchase visits in the selected period. Blank reasons are grouped as Other / Unknown.</p>
            {reasonStats.length === 0 ? <p className="corrections-empty">No no-purchase reasons recorded in this period.</p> : reasonStats.map((item) => (
              <div className="analytics-reason-row" key={item.reason}>
                <div className="analytics-row-label"><strong>{item.reason}</strong><span>{item.count.toLocaleString()} · {percent(item.count, noPurchase)}%</span></div>
                <div className="progress-track"><span className="progress-fill no-purchase-fill" style={{ width: `${item.count / Math.max(1, noPurchase) * 100}%` }} /></div>
              </div>
            ))}
          </section>
        </div>
      )}
      <p className="history-footnote">Analytics use saved visit records only. This view does not edit, move, or delete data.</p>
    </section>
  );
}
