import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, RefreshCw, TrendingUp, Users } from "lucide-react";
import { supabase } from "../lib/supabase";

type Branch = { id: string; name: string; slug: string };
type Visit = {
  id: string;
  branch_id: string;
  visit_date: string;
  outcome: "purchased" | "not_purchased" | "undecided";
  reason: string | null;
  unavailable_item_requested: boolean;
};

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

export default function AdminAnalytics({ branches }: { branches: Branch[] }) {
  const today = useMemo(() => dateKey(new Date()), []);
  const earliest = shiftDate(today, -89);
  const [startDate, setStartDate] = useState(shiftDate(today, -29));
  const [endDate, setEndDate] = useState(today);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRange, setLoadedRange] = useState("");

  const load = useCallback(async () => {
    if (!supabase) return;
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
    return { ...branch, total: rows.length, purchases, noPurchase, undecided, conversion: percent(purchases, rows.length - undecided),
      unavailable: rows.filter((visit) => visit.outcome === "purchased" && visit.unavailable_item_requested).length };
  }), [branches, visits]);
  const purchases = visits.filter((visit) => visit.outcome === "purchased").length;
  const noPurchase = visits.filter((visit) => visit.outcome === "not_purchased").length;
  const undecided = visits.filter((visit) => visit.outcome === "undecided").length;
  const conversion = percent(purchases, visits.length - undecided);
  const dailyStats = useMemo(() => {
    const days: { date: string; total: number; purchases: number }[] = [];
    for (let cursor = startDate; cursor <= endDate; cursor = shiftDate(cursor, 1)) {
      const rows = visits.filter((visit) => visit.visit_date === cursor);
      days.push({ date: cursor, total: rows.length, purchases: rows.filter((visit) => visit.outcome === "purchased").length });
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

  return (
    <section className="panel admin-analytics-panel" id="admin-analytics" aria-labelledby="admin-analytics-title">
      <div className="panel-heading">
        <div><p className="eyebrow">ADMIN WORKSPACE</p><h2 id="admin-analytics-title"><BarChart3 size={20} /> Analysis &amp; analytics</h2></div>
        <span className="date-pill">All branches</span>
      </div>
      <p className="panel-description">Compare branch activity, purchase conversion, daily trends, and reasons for missed sales across a selected reporting period. Data is read-only.</p>
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
      <p className="analytics-range">{loadedRange ? `Reporting period: ${loadedRange}` : "Preparing reporting period…"} · Maximum window: 90 days</p>
      <div className="history-summary analytics-kpis">
        <div><strong>{visits.length}</strong><span><Users size={13} /> Total visits</span></div>
        <div><strong>{purchases}</strong><span>Purchases</span></div>
        <div><strong>{noPurchase}</strong><span>No purchase</span></div>
        <div><strong>{conversion}%</strong><span>Purchase conversion</span></div>
        <div><strong>{branchStats.reduce((sum, item) => sum + item.unavailable, 0)}</strong><span>Stockout requests despite purchase</span></div>
      </div>

      <div className="analytics-grid">
        <section className="analytics-subpanel">
          <h3><TrendingUp size={16} /> Branch comparison</h3>
          <p className="analytics-help">Visit volume and purchase conversion for each branch.</p>
          {branchStats.map((item) => (
            <div className="analytics-branch-row" key={item.id}>
              <div className="analytics-row-label"><strong>{item.name}</strong><span>{item.total} visits · {item.conversion}% conversion</span></div>
              <div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${item.total / maxBranch * 100}%` }} /></div>
              <div className="analytics-row-meta"><span>{item.purchases} purchases</span><span>{item.noPurchase} no purchase</span></div>
            </div>
          ))}
        </section>
        <section className="analytics-subpanel">
          <h3><BarChart3 size={16} /> No-purchase reasons</h3>
          <p className="analytics-help">Most common reasons visits did not convert.</p>
          {reasonStats.length === 0 ? <p className="corrections-empty">No no-purchase reasons recorded in this period.</p> : reasonStats.map((item) => (
            <div className="analytics-reason-row" key={item.reason}>
              <div className="analytics-row-label"><strong>{item.reason}</strong><span>{item.count} · {percent(item.count, noPurchase)}%</span></div>
              <div className="progress-track"><span className="progress-fill no-purchase-fill" style={{ width: `${item.count / Math.max(1, noPurchase) * 100}%` }} /></div>
            </div>
          ))}
        </section>
      </div>

      <section className="analytics-subpanel analytics-trend">
        <h3><CalendarDays size={16} /> Daily visit trend</h3>
        <p className="analytics-help">Each bar shows recorded visits on that Lagos calendar date. Scroll horizontally to view the full period.</p>
        <div className="analytics-daily-chart" role="img" aria-label="Daily visit counts for the selected reporting period">
          {dailyStats.map((day) => (
            <div className="analytics-day" key={day.date} title={`${day.date}: ${day.total} visits, ${day.purchases} purchases`}>
              <span className="analytics-day-count">{day.total || ""}</span>
              <span className="analytics-day-bar" style={{ height: `${Math.max(day.total ? 8 : 2, day.total / peak * 100)}%` }} />
              <span className="analytics-day-label">{day.date.slice(5)}</span>
            </div>
          ))}
        </div>
        <p className="analytics-help">Undecided visits: <strong>{undecided}</strong>. Daily bars show all visit outcomes combined.</p>
      </section>
      <p className="history-footnote">Analytics use saved visit records only. This view does not edit, move, or delete data.</p>
    </section>
  );
}
