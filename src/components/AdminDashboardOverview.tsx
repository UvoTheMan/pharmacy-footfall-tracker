import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, Clock3, RefreshCw, ShoppingBag, Users } from "lucide-react";
import { supabase } from "../lib/supabase";

type Branch = { id: string; name: string };
type Visit = { branch_id: string; outcome: "purchased" | "not_purchased" | "undecided" };

type BranchSummary = Branch & {
  total: number;
  purchases: number;
  noPurchase: number;
  conversion: number | null;
};

function lagosDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default function AdminDashboardOverview({ branches }: { branches: Branch[] }) {
  const today = useMemo(() => lagosDateKey(), []);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [pendingCorrections, setPendingCorrections] = useState<number | null>(null);
  const [pendingUnavailable, setPendingUnavailable] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async (manual = false) => {
    if (!supabase) {
      setError("The database connection is unavailable.");
      setLoading(false);
      return;
    }
    if (manual) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [correctionCount, unavailableCount] = await Promise.all([
        supabase
          .from("branch_correction_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
        supabase
          .from("unavailable_items")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);

      const rows: Visit[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await supabase
          .from("visits")
          .select("branch_id,outcome")
          .eq("visit_date", today)
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (result.error) throw result.error;
        const page = (result.data ?? []) as Visit[];
        rows.push(...page);
        if (page.length < 1000) break;
      }

      setVisits(rows);
      setPendingCorrections(correctionCount.error ? null : correctionCount.count ?? 0);
      setPendingUnavailable(unavailableCount.error ? null : unavailableCount.count ?? 0);
      const countErrors = [correctionCount.error, unavailableCount.error].filter(Boolean);
      if (countErrors.length) {
        setError("Daily performance loaded, but one or more outstanding-work counts could not be refreshed.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The admin overview could not be refreshed.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [today]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const summaries = useMemo<BranchSummary[]>(() => branches.map((branch) => {
    const rows = visits.filter((visit) => visit.branch_id === branch.id);
    const purchases = rows.filter((visit) => visit.outcome === "purchased").length;
    const noPurchase = rows.filter((visit) => visit.outcome === "not_purchased").length;
    const resolved = purchases + noPurchase;
    return {
      ...branch,
      total: rows.length,
      purchases,
      noPurchase,
      conversion: resolved ? Math.round((purchases / resolved) * 100) : null,
    };
  }), [branches, visits]);

  const totals = useMemo(() => summaries.reduce((sum, branch) => ({
    visits: sum.visits + branch.total,
    purchases: sum.purchases + branch.purchases,
    noPurchase: sum.noPurchase + branch.noPurchase,
  }), { visits: 0, purchases: 0, noPurchase: 0 }), [summaries]);
  const resolvedTotal = totals.purchases + totals.noPurchase;
  const conversion = resolvedTotal ? Math.round(totals.purchases / resolvedTotal * 100) : null;

  return (
    <section className="admin-overview" aria-label="All-branch daily overview">
      <div className="admin-overview-heading">
        <div>
          <p className="eyebrow">ALL-BRANCH OVERVIEW</p>
          <h2>Today's pharmacy performance</h2>
          <p>Combined activity across every branch, with a branch-by-branch view below.</p>
        </div>
        <button className="secondary-button admin-overview-refresh" type="button" onClick={() => void refresh(true)} disabled={refreshing || loading}>
          <RefreshCw size={15} className={refreshing ? "admin-refresh-spin" : ""} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {error && <p className="admin-overview-error" role="status"><AlertCircle size={15} />{error}</p>}

      <div className="admin-overview-kpis">
        <article><span><Users size={15} /> Total visits</span><strong>{loading ? "…" : totals.visits}</strong><small>All branches today</small></article>
        <article><span><ShoppingBag size={15} /> Purchases</span><strong>{loading ? "…" : totals.purchases}</strong><small>Completed purchases</small></article>
        <article><span><Activity size={15} /> No purchase</span><strong>{loading ? "…" : totals.noPurchase}</strong><small>Visits without a sale</small></article>
        <article><span><CheckCircle2 size={15} /> Conversion</span><strong>{loading ? "…" : conversion === null ? "—" : `${conversion}%`}</strong><small>Purchases ÷ resolved visits</small></article>
      </div>

      <div className="admin-overview-lower">
        <div className="admin-overview-branches">
          <div className="admin-overview-section-title"><h3>Branch performance</h3><span>Today</span></div>
          {summaries.map((branch) => (
            <article className="admin-overview-branch" key={branch.id}>
              <div className="admin-overview-branch-top"><strong>{branch.name}</strong><span>{loading ? "…" : `${branch.total} visits`}</span></div>
              <div className="admin-overview-branch-metrics">
                <span>{branch.purchases} purchases</span>
                <span>{branch.noPurchase} no purchase</span>
                <strong>{loading ? "…" : branch.conversion === null ? "—" : `${branch.conversion}% conversion`}</strong>
              </div>
            </article>
          ))}
        </div>

        <div className="admin-overview-work">
          <div className="admin-overview-section-title"><h3>Needs attention</h3><span><Clock3 size={13} /> Live counts</span></div>
          <article>
            <span>Branch correction requests</span>
            <strong>{pendingCorrections === null ? "—" : pendingCorrections}</strong>
            <small>{pendingCorrections === 1 ? "Request" : "Requests"} awaiting review</small>
          </article>
          <article>
            <span>Unavailable-item reports</span>
            <strong>{pendingUnavailable === null ? "—" : pendingUnavailable}</strong>
            <small>{pendingUnavailable === 1 ? "Report" : "Reports"} awaiting assessment</small>
          </article>
        </div>
      </div>
      <p className="admin-overview-footnote">Conversion excludes visits marked undecided. Counts refresh automatically every minute while this page is open.</p>
    </section>
  );
}
