import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Clock3, Download, GitCompare, RefreshCw, Search, TrendingUp, Users } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "../lib/supabase";
import "./AdminAnalytics.css";

type Branch = { id: string; name: string; slug: string };
type Visit = {
  id: string;
  branch_id: string;
  visit_date: string;
  recorded_at: string;
  outcome: "purchased" | "not_purchased";
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
  const [selectedBranchId, setSelectedBranchId] = useState("all");
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
        .select("id,branch_id,visit_date,recorded_at,outcome,reason,unavailable_item_requested")
        .gte("visit_date", shiftDate(startDate, -Math.max(0, Math.round((Date.parse(endDate + "T12:00:00Z") - Date.parse(startDate + "T12:00:00Z")) / 86400000))))
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

  const currentVisits = useMemo(() => visits.filter((visit) => visit.visit_date >= startDate && visit.visit_date <= endDate), [visits, startDate, endDate]);
  const rangeDays = Math.max(1, Math.round((Date.parse(endDate + "T12:00:00Z") - Date.parse(startDate + "T12:00:00Z")) / 86400000) + 1);
  const previousStartDate = shiftDate(startDate, -rangeDays);
  const previousEndDate = shiftDate(startDate, -1);
  const scopedCurrentVisits = useMemo(() => selectedBranchId === "all" ? currentVisits : currentVisits.filter((visit) => visit.branch_id === selectedBranchId), [currentVisits, selectedBranchId]);
  const previousVisits = useMemo(() => visits.filter((visit) => visit.visit_date >= previousStartDate && visit.visit_date <= previousEndDate && (selectedBranchId === "all" || visit.branch_id === selectedBranchId)), [visits, previousStartDate, previousEndDate, selectedBranchId]);
  const analysisVisits = scopedCurrentVisits;
  const analysisBranches = useMemo(() => selectedBranchId === "all" ? branches : branches.filter((branch) => branch.id === selectedBranchId), [branches, selectedBranchId]);

  const branchStats = useMemo(() => analysisBranches.map((branch) => {
    const rows = analysisVisits.filter((visit) => visit.branch_id === branch.id);
    const purchases = rows.filter((visit) => visit.outcome === "purchased").length;
    const noPurchase = rows.filter((visit) => visit.outcome === "not_purchased").length;
    const resolved = rows.length;
    return {
      ...branch,
      total: rows.length,
      purchases,
      noPurchase,
      resolved,
      conversion: percent(purchases, resolved),
      unavailable: rows.filter((visit) => visit.unavailable_item_requested).length,
    };
  }), [analysisBranches, analysisVisits]);

  const purchases = analysisVisits.filter((visit) => visit.outcome === "purchased").length;
  const noPurchase = analysisVisits.filter((visit) => visit.outcome === "not_purchased").length;
  const resolved = analysisVisits.length;
  const conversion = percent(purchases, resolved);
  const noPurchaseRate = percent(noPurchase, resolved);
  const unavailableRequests = analysisVisits.filter((visit) => visit.unavailable_item_requested).length;
  const previousPurchases = previousVisits.filter((visit) => visit.outcome === "purchased").length;
  const previousNoPurchase = previousVisits.filter((visit) => visit.outcome === "not_purchased").length;
  const previousConversion = percent(previousPurchases, previousVisits.length);
  const comparisonStats = [
    { label: "Total visits", current: analysisVisits.length, previous: previousVisits.length },
    { label: "Purchases", current: purchases, previous: previousPurchases },
    { label: "No purchase", current: noPurchase, previous: previousNoPurchase },
    { label: "Conversion", current: conversion, previous: previousConversion, percentagePoints: true },
  ].map((item) => ({ ...item, delta: item.current - item.previous, change: item.previous ? Math.round((item.current - item.previous) / item.previous * 100) : null }));
  const busyHourStats = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, label: new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "numeric", hour12: true }).format(new Date(Date.UTC(2026, 0, 1, hour))), total: 0 }));
    analysisVisits.forEach((visit) => {
      const date = new Date(visit.recorded_at);
      if (Number.isNaN(date.getTime())) return;
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hourCycle: "h23" }).format(date));
      if (hour >= 0 && hour < 24) hours[hour].total += 1;
    });
    return hours;
  }, [analysisVisits]);
  const activeDays = dailyStats.filter((day) => day.total > 0);
  const averageDailyFootfall = activeDays.length ? analysisVisits.length / activeDays.length : 0;
  const busiestDay = [...activeDays].sort((a, b) => b.total - a.total)[0];
  const quietestRecordedDay = [...activeDays].sort((a, b) => a.total - b.total)[0];
  const peakHour = [...busyHourStats].filter((hour) => hour.total > 0).sort((a, b) => b.total - a.total)[0];
  const quietHour = [...busyHourStats].filter((hour) => hour.total > 0).sort((a, b) => a.total - b.total)[0];

  const dailyStats = useMemo(() => {
    const days: { date: string; total: number; purchases: number; noPurchase: number }[] = [];
    for (let cursor = startDate; cursor <= endDate; cursor = shiftDate(cursor, 1)) {
      const rows = analysisVisits.filter((visit) => visit.visit_date === cursor);
      days.push({
        date: cursor,
        total: rows.length,
        purchases: rows.filter((visit) => visit.outcome === "purchased").length,
        noPurchase: rows.filter((visit) => visit.outcome === "not_purchased").length,
      });
    }
    return days;
  }, [analysisVisits, startDate, endDate]);

  const reasonStats = useMemo(() => {
    const counts = new Map<string, number>();
    analysisVisits.filter((visit) => visit.outcome === "not_purchased").forEach((visit) => {
      const reason = visit.reason?.trim() || "Other / Unknown";
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    });
    return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  }, [analysisVisits]);

  const reasonBranchStats = useMemo(() => analysisBranches.map((branch) => {
    const branchNoPurchase = analysisVisits.filter((visit) => visit.branch_id === branch.id && visit.outcome === "not_purchased");
    const counts = new Map<string, number>();
    branchNoPurchase.forEach((visit) => {
      const reason = visit.reason?.trim() || "Other / Unknown";
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    });
    return { ...branch, total: branchNoPurchase.length, reasons: [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) };
  }), [analysisBranches, analysisVisits]);

  const weekdayStats = useMemo(() => {
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const totals = labels.map((label, index) => ({ label, index, total: 0, purchases: 0, noPurchase: 0 }));
    dailyStats.forEach((day) => {
      const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
      totals[weekday].total += day.total;
      totals[weekday].purchases += day.purchases;
      totals[weekday].noPurchase += day.noPurchase;
    });
    return totals;
  }, [dailyStats]);
  const outcomeStats = [
    { label: "Purchased", count: purchases, color: "#23875b" },
    { label: "No purchase", count: noPurchase, color: "#e27b48" },
  ];
  const peak = Math.max(1, ...dailyStats.map((day) => day.total));
  const maxHour = Math.max(1, ...busyHourStats.map((hour) => hour.total));
  const maxBranch = Math.max(1, ...branchStats.map((branch) => branch.total));
  const topBranch = [...branchStats].filter((item) => item.resolved > 0).sort((a, b) => b.conversion - a.conversion)[0];

  const downloadAnalysisPdf = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = 48;
    const green: [number, number, number] = [23, 77, 59];
    const muted: [number, number, number] = [105, 123, 111];
    const ensure = (space: number) => { if (y + space > pageHeight - 16) { doc.addPage(); y = 18; } };
    const section = (label: string) => {
      ensure(13); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(green[0], green[1], green[2]);
      doc.text(label, margin, y); y += 3; doc.setDrawColor(216, 230, 219); doc.line(margin, y, pageWidth - margin, y); y += 7;
    };
    const line = (label: string, value: string) => {
      ensure(8); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(muted[0], muted[1], muted[2]); doc.text(label, margin, y);
      doc.setFont("helvetica", "bold"); doc.setTextColor(39, 66, 49); doc.text(value, pageWidth - margin, y, { align: "right" }); y += 7;
    };
    const bars = (items: {label:string;value:number;color?:[number,number,number]}[]) => {
      const max = Math.max(1, ...items.map(item => item.value));
      items.forEach(item => {
        ensure(10); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(53, 76, 61);
        const label = doc.splitTextToSize(item.label, contentWidth * 0.48)[0] || item.label;
        doc.text(label, margin, y + 2.5);
        const x = margin + contentWidth * 0.51; const track = contentWidth * 0.35;
        doc.setFillColor(238, 243, 239); doc.roundedRect(x, y - 1, track, 4, 1.5, 1.5, "F");
        const color = item.color || [43, 139, 91]; doc.setFillColor(color[0], color[1], color[2]);
        if (item.value > 0) doc.roundedRect(x, y - 1, Math.max(1, track * item.value / max), 4, 1.5, 1.5, "F");
        doc.setFont("helvetica", "bold"); doc.setTextColor(39, 66, 49); doc.text(String(item.value), pageWidth - margin, y + 2.5, { align: "right" }); y += 9;
      });
      y += 2;
    };
    doc.setFillColor(23, 77, 59); doc.rect(0, 0, pageWidth, 40, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text("FOOTLYTICS", margin, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text("PHARMACY FOOTFALL INTELLIGENCE", margin, 22);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text((TABS.find(tab => tab.id === activeTab)?.label || "Analysis") + " report", margin, 30);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(startDate + " to " + endDate + " | " + (selectedBranchId === "all" ? "All branches combined" : (analysisBranches[0]?.name || "Selected branch")), margin, 36);
    doc.setFontSize(8); doc.setTextColor(muted[0], muted[1], muted[2]); doc.text("Prepared from saved records. Comparisons are descriptive, not causal.", margin, y); y += 10;
    section("Performance at a glance");
    line("Total visits", analysisVisits.length.toLocaleString()); line("Purchases", purchases.toLocaleString()); line("No-purchase visits", noPurchase.toLocaleString()); line("Purchase conversion", conversion + "%");
    section("Previous-period comparison");
    line("Comparison dates", previousStartDate + " to " + previousEndDate);
    comparisonStats.forEach(item => line(item.label, String(item.current) + (item.percentagePoints ? "%" : "") + " | " + (item.delta > 0 ? "+" : "") + item.delta + (item.percentagePoints ? " pp" : "") + (item.change === null ? " · no baseline" : " (" + (item.change > 0 ? "+" : "") + item.change + "%)")));
    if (activeTab === "overview") {
      section("Outcome distribution"); bars([{label:"Purchased",value:purchases,color:[35,135,91]},{label:"No purchase",value:noPurchase,color:[226,123,72]}]);
      section("Visits by weekday"); bars(weekdayStats.map(day => ({label:day.label,value:day.total})));
      section("Branch snapshot"); bars(branchStats.map(item => ({label:item.name + " · " + item.conversion + "% conversion",value:item.total})));
      section("Quick insights"); line("Purchase conversion", conversion + "%"); line("No-purchase rate", noPurchaseRate + "%");
      if (topBranch) line("Highest branch conversion", topBranch.name + " · " + topBranch.conversion + "%");
    } else if (activeTab === "branches") {
      section("Branch performance"); bars(branchStats.map(item => ({label:item.name + " · " + item.conversion + "% conversion",value:item.total})));
      branchStats.forEach(item => line(item.name + " · purchases / no purchase", item.purchases + " / " + item.noPurchase));
    } else if (activeTab === "trends") {
      section("Daily visits"); bars(dailyStats.filter(day => day.total > 0).map(day => ({label:day.date,value:day.total})));
      section("Daily averages and peak days"); line("Average on recorded days", averageDailyFootfall.toFixed(1) + " visits");
      line("Busiest recorded day", busiestDay ? busiestDay.date + " · " + busiestDay.total + " visits" : "No data");
      line("Quietest recorded day", quietestRecordedDay ? quietestRecordedDay.date + " · " + quietestRecordedDay.total + " visits" : "No data");
      line("Days with visits", String(activeDays.length)); section("Busy hours · Lagos time");
      bars(busyHourStats.filter(hour => hour.total > 0).map(hour => ({label:hour.label,value:hour.total,color:[226,123,72]})));
      line("Peak hour", peakHour ? peakHour.label + " · " + peakHour.total + " visits" : "No timestamped visits");
    } else {
      section("No-purchase reasons");
      const colors: [number,number,number][] = [[226,123,72],[123,131,216],[35,149,168],[200,94,145],[123,155,69],[186,138,56]];
      bars(reasonStats.map((item,index) => ({label:item.reason + " · " + percent(item.count,noPurchase) + "%",value:item.count,color:colors[index % colors.length]})));
      section("Reasons by branch");
      reasonBranchStats.forEach(branch => { line(branch.name, branch.total + " no-purchase visits"); bars(branch.reasons.slice(0,5).map((item,index) => ({label:item.reason,value:item.count,color:colors[index % colors.length]}))); });
    }
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page); doc.setDrawColor(222, 232, 224); doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text("FOOTLYTICS · INTERNAL MANAGEMENT REPORT", margin, pageHeight - 6); doc.text("Page " + page + " of " + pages, pageWidth - margin, pageHeight - 6, { align: "right" });
    }
    doc.save("Footlytics-" + activeTab + "-" + startDate + "-to-" + endDate + ".pdf");
  };

  return (
    <section className="panel admin-analytics-panel" id="admin-analytics" aria-labelledby="admin-analytics-title">
      <div className="panel-heading">
        <div><p className="eyebrow">ADMIN WORKSPACE</p><h2 id="admin-analytics-title"><BarChart3 size={20} /> Analysis &amp; analytics</h2></div>
        <span className="date-pill">{selectedBranchId === "all" ? "Combined analysis" : analysisBranches[0]?.name ?? "Single branch"}</span>
      </div>
      <p className="panel-description">Explore pharmacy performance using saved visit records. Choose one branch or combine all branches, adjust the reporting dates, and explore the interactive summaries. This workspace is read-only.</p>

      <div className="history-filters analytics-filters">
        <label className="history-date-field analytics-branch-field" htmlFor="analytics-branch"><span><GitCompare size={15} /> Analyze</span>
          <select id="analytics-branch" value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}>
            <option value="all">All branches combined</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} only</option>)}
          </select>
        </label>
        <label className="history-date-field" htmlFor="analytics-start"><span><CalendarDays size={15} /> Start date</span>
          <input id="analytics-start" type="date" min={earliest} max={endDate || today} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="history-date-field" htmlFor="analytics-end"><span><CalendarDays size={15} /> End date</span>
          <input id="analytics-end" type="date" min={startDate || earliest} max={today} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <button type="button" className="secondary-button analytics-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? "Refreshing…" : "Refresh analysis"}</button>
      </div>
      <div className="analytics-date-presets" aria-label="Quick reporting periods">
        <span>Quick range</span>
        {[{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }].map((preset) => <button key={preset.days} type="button" className={startDate === shiftDate(endDate, -(preset.days - 1)) ? "analytics-preset active" : "analytics-preset"} onClick={() => { setEndDate(today); setStartDate(shiftDate(today, -(preset.days - 1))); }} disabled={loading}>{preset.label}</button>)}
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="analytics-range-row">
        <p className="analytics-range">{loadedRange ? `Reporting period: ${loadedRange}` : "Preparing reporting period…"} · Maximum window: 90 days</p>
        <span className="analytics-record-count">{loading ? "Updating records…" : `${analysisVisits.length.toLocaleString()} visits in view`}</span>
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
      <div className="analytics-action-row">
        <span><strong>Period comparison</strong><small>{previousStartDate} to {previousEndDate} vs {startDate} to {endDate}</small></span>
        <button type="button" className="analytics-export-button" onClick={downloadAnalysisPdf} disabled={loading || Boolean(error)}><Download size={15} /> Export current view to PDF</button>
      </div>
      <section className="analytics-comparison-grid" aria-label="Previous-period comparison">
        {comparisonStats.map((item) => <article className="analytics-comparison-card" key={item.label}>
          <span>{item.label}</span><strong>{item.current}{item.percentagePoints ? "%" : ""}</strong>
          <small className={item.delta > 0 ? "comparison-up" : item.delta < 0 ? "comparison-down" : ""}>{item.delta > 0 ? "+" : ""}{item.delta}{item.percentagePoints ? " pp" : ""} vs previous {item.change === null ? "· no baseline" : "(" + (item.change > 0 ? "+" : "") + item.change + "%)"}</small>
        </article>)}
      </section>

      {activeTab === "overview" && (
        <div className="analytics-tab-content">
          <div className="history-summary analytics-kpis">
            <div><strong>{analysisVisits.length.toLocaleString()}</strong><span><Users size={13} /> Total visits</span></div>
            <div><strong>{purchases.toLocaleString()}</strong><span>Purchases</span></div>
            <div><strong>{noPurchase.toLocaleString()}</strong><span>No purchase</span></div>
            <div><strong>{conversion}%</strong><span>Purchase conversion</span></div>

            <div><strong>{unavailableRequests.toLocaleString()}</strong><span>Unavailable-item requests</span></div>
          </div>
          <div className="analytics-grid">
            <section className="analytics-subpanel analytics-chart-card">
              <h3><BarChart3 size={16} /> Outcome distribution</h3>
              <p className="analytics-help">How recorded visits ended during this period.</p>
              <div className="analytics-outcome-total"><strong>{analysisVisits.length.toLocaleString()}</strong><span>total visits</span></div>
              <div className="analytics-outcome-bar" role="img" aria-label={outcomeStats.map((item) => `${item.label}: ${item.count}`).join(", ")}>
                {outcomeStats.filter((item) => item.count > 0).map((item) => <span key={item.label} style={{ width: `${item.count / Math.max(1, analysisVisits.length) * 100}%`, background: item.color }} />)}
              </div>
              <div className="analytics-legend">
                {outcomeStats.map((item) => <div key={item.label}><span className="analytics-legend-dot" style={{ background: item.color }} /><span>{item.label}</span><strong>{item.count.toLocaleString()}</strong><small>{percent(item.count, analysisVisits.length)}%</small></div>)}
              </div>
              <p className="analytics-help">Conversion is purchases divided by all recorded visits.</p>
            </section>
            <section className="analytics-subpanel analytics-chart-card">
              <h3><CalendarDays size={16} /> Visits by weekday</h3>
              <p className="analytics-help">Combined recorded visits by day of the week within the selected dates.</p>
              <div className="analytics-weekday-chart">
                {weekdayStats.map((day) => <div className="analytics-weekday" key={day.label} title={`${day.label}: ${day.total} visits`}>
                  <strong>{day.total || ""}</strong><span className="analytics-weekday-track"><i style={{ height: `${Math.max(day.total ? 5 : 2, day.total / Math.max(1, ...weekdayStats.map((item) => item.total)) * 100)}%` }} /></span><small>{day.label}</small>
                </div>)}
              </div>
              <p className="analytics-help">Patterns are descriptive. Different date coverage can affect comparisons.</p>
            </section>
            <section className="analytics-subpanel">
              <h3><GitCompare size={16} /> Branch snapshot</h3>
              <p className="analytics-help">A quick view of recorded activity for the selected branch scope.</p>
              {branchStats.map((item) => (
                <div className="analytics-branch-row" key={item.id}>
                  <div className="analytics-row-label"><strong>{item.name}</strong><span>{item.total} visits</span></div>
                  <div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${item.total / maxBranch * 100}%` }} /></div>
                  <div className="analytics-stacked-bar" aria-label={`${item.name}: ${item.purchases} purchased, ${item.noPurchase} no purchase`}>
                    {[
                      { count: item.purchases, color: "#23875b" },
                      { count: item.noPurchase, color: "#e27b48" },
                    ].filter((part) => part.count > 0).map((part, index) => <span key={index} style={{ width: `${part.count / Math.max(1, item.total) * 100}%`, background: part.color }} />)}
                  </div>
                  <div className="analytics-row-meta"><span>{item.purchases} purchases</span><span>{item.noPurchase} no purchase</span></div>
                </div>
              ))}
              {branchStats.length === 0 && <p className="corrections-empty">No branches are available for analysis.</p>}
            </section>
            <section className="analytics-subpanel analytics-insight-panel">
              <h3><TrendingUp size={16} /> Quick insights</h3>
              {analysisVisits.length === 0 ? <p className="corrections-empty">No visits were recorded in this reporting period.</p> : (
                <ul className="analytics-insight-list">
                  <li><strong>{conversion}%</strong> purchase conversion across all recorded visits.</li>
                  <li><strong>{noPurchaseRate}%</strong> of recorded visits ended without a purchase.</li>
                  <li>{topBranch ? selectedBranchId === "all" ? <><strong>{topBranch.name}</strong> has the highest conversion among branches with recorded visits.</> : <>The selected branch, <strong>{topBranch.name}</strong>, has a conversion rate of <strong>{topBranch.conversion}%</strong>.</> : "There are not yet enough recorded visits to compare branch conversion."}</li>

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
              <h3><GitCompare size={16} /> {selectedBranchId === "all" ? "Branch performance comparison" : "Selected branch performance"}</h3>
              <p className="analytics-help">Review visit volume, outcomes and conversion for the selected branch scope. Conversion is purchases divided by all recorded visits.</p>
              {branchStats.map((item) => (
                <div className="analytics-branch-row" key={item.id}>
                  <div className="analytics-row-label"><strong>{item.name}</strong><span>{item.total.toLocaleString()} visits · {item.conversion}% conversion</span></div>
                  <div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${item.total / maxBranch * 100}%` }} /></div>
                  <div className="analytics-row-meta"><span>{item.purchases} purchases</span><span>{item.noPurchase} no purchase</span></div>
                  <div className="analytics-row-meta"><span>{item.unavailable} unavailable-item requests</span></div>
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
            <div className="analytics-daily-chart analytics-daily-chart-stacked" role="img" aria-label="Daily visit counts by outcome for the selected reporting period">
              {dailyStats.map((day) => (
                <div className="analytics-day" key={day.date} title={`${day.date}: ${day.total} visits, ${day.purchases} purchases, ${day.noPurchase} no purchase`}>
                  <span className="analytics-day-count">{day.total || ""}</span>
                  <span className="analytics-day-stack" style={{ height: `${Math.max(day.total ? 8 : 2, day.total / peak * 100)}%` }}>
                    {day.purchases > 0 && <i className="analytics-stack-purchased" style={{ height: `${day.purchases / Math.max(1, day.total) * 100}%` }} />}
                    {day.noPurchase > 0 && <i className="analytics-stack-no-purchase" style={{ height: `${day.noPurchase / Math.max(1, day.total) * 100}%` }} />}
                  </span>
                  <span className="analytics-day-label">{day.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="analytics-legend analytics-trend-legend">
              {outcomeStats.map((item) => <div key={item.label}><span className="analytics-legend-dot" style={{ background: item.color }} /><span>{item.label}</span></div>)}
            </div>
            <div className="analytics-grid analytics-secondary-trends">
              <section className="analytics-subpanel analytics-chart-card">
                <h3><TrendingUp size={16} /> Purchase conversion by weekday</h3>
                <p className="analytics-help">Purchases divided by all recorded visits for each weekday.</p>
                <div className="analytics-weekday-chart">
                  {weekdayStats.map((day) => {
                    const rate = percent(day.purchases, day.purchases + day.noPurchase);
                    return <div className="analytics-weekday" key={day.label} title={`${day.label}: ${rate}% conversion from ${day.purchases + day.noPurchase} visits`}>
                      <strong>{day.purchases + day.noPurchase ? `${rate}%` : "—"}</strong><span className="analytics-weekday-track conversion-track"><i style={{ height: `${Math.max(rate ? 5 : 2, rate)}%` }} /></span><small>{day.label}</small>
                    </div>;
                  })}
                </div>
              </section>
              <section className="analytics-subpanel analytics-chart-card">
                <h3><Users size={16} /> Outcome totals</h3>
                <p className="analytics-help">Counts and share of all recorded visits.</p>
                <div className="analytics-legend">
                  {outcomeStats.map((item) => <div key={item.label}><span className="analytics-legend-dot" style={{ background: item.color }} /><span>{item.label}</span><strong>{item.count.toLocaleString()}</strong><small>{percent(item.count, analysisVisits.length)}%</small></div>)}
                </div>
              </section>
            </div>
            <div className="analytics-trend-summary">
              <span>Visits <strong>{analysisVisits.length.toLocaleString()}</strong></span>
              <span>Purchases <strong>{purchases.toLocaleString()}</strong></span>
              <span>No purchase <strong>{noPurchase.toLocaleString()}</strong></span>
            </div>
            <section className="analytics-subpanel analytics-pattern-panel">
              <h3><Clock3 size={16} /> Busy hours &amp; footfall patterns</h3>
              <p className="analytics-help">Visit recording times converted to Lagos local time. Hours with no visits are shown as empty bars.</p>
              <div className="analytics-hour-chart" role="img" aria-label="Visits by hour of day in Lagos time">
                {busyHourStats.map((hour) => <div className="analytics-hour" key={hour.hour} title={hour.label + ": " + hour.total + " visits"}>
                  <strong>{hour.total || ""}</strong><span className="analytics-hour-track"><i style={{ height: (hour.total ? Math.max(5, hour.total / maxHour * 100) : 2) + "%" }} /></span><small>{hour.hour % 3 === 0 ? hour.label.replace(" AM","a").replace(" PM","p") : ""}</small>
                </div>)}
              </div>
              <div className="analytics-pattern-highlights">
                <div><span>Peak recorded hour</span><strong>{peakHour?.label ?? "No data"}</strong><small>{peakHour ? peakHour.total + " visits" : "No timestamped visits"}</small></div>
                <div><span>Quietest active hour</span><strong>{quietHour?.label ?? "No data"}</strong><small>{quietHour ? quietHour.total + " visits" : "No timestamped visits"}</small></div>
              </div>
            </section>
            <section className="analytics-subpanel analytics-daily-summary">
              <h3><TrendingUp size={16} /> Daily averages &amp; peak days</h3>
              <p className="analytics-help">The average uses days with at least one recorded visit. Dates with no records are not assumed to be closed or zero-footfall days.</p>
              <div className="analytics-pattern-highlights">
                <div><span>Average on recorded days</span><strong>{averageDailyFootfall.toFixed(1)}</strong><small>visits per active recorded day</small></div>
                <div><span>Busiest recorded day</span><strong>{busiestDay?.date ?? "No data"}</strong><small>{busiestDay ? busiestDay.total + " visits" : "No visits in range"}</small></div>
                <div><span>Quietest recorded day</span><strong>{quietestRecordedDay?.date ?? "No data"}</strong><small>{quietestRecordedDay ? quietestRecordedDay.total + " visits" : "No visits in range"}</small></div>
              </div>
              <div className="analytics-daily-average-chart">
                {dailyStats.map(day => <div key={day.date} title={day.date + ": " + day.total + " visits"}><span style={{height: Math.max(day.total ? 4 : 1, day.total / Math.max(1,...dailyStats.map(item=>item.total))*100) + "%" }} /><small>{day.date.slice(8)}</small></div>)}
              </div>
            </section>
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
            {reasonStats.length === 0 ? <p className="corrections-empty">No no-purchase reasons recorded in this period.</p> : reasonStats.map((item, index) => {
              const colors = ["#e27b48", "#7b83d8", "#2395a8", "#c85e91", "#7b9b45", "#ba8a38"];
              return <div className="analytics-reason-row" key={item.reason}>
                <div className="analytics-row-label"><strong>{item.reason}</strong><span>{item.count.toLocaleString()} · {percent(item.count, noPurchase)}%</span></div>
                <div className="progress-track"><span className="analytics-reason-fill" style={{ width: `${item.count / Math.max(1, noPurchase) * 100}%`, background: colors[index % colors.length] }} /></div>
              </div>;
            })}
          </section>
          <section className="analytics-subpanel analytics-reason-branch-panel">
            <h3><GitCompare size={16} /> Reasons by branch</h3>
            <p className="analytics-help">See which reasons are being recorded at each branch. Counts reflect no-purchase visits within the selected date range.</p>
            <div className="analytics-reason-branch-grid">
              {reasonBranchStats.map((branch) => <article className="analytics-reason-branch-card" key={branch.id}>
                <div className="analytics-row-label"><strong>{branch.name}</strong><span>{branch.total} no-purchase visits</span></div>
                {branch.reasons.length === 0 ? <p className="corrections-empty">No reasons recorded.</p> : branch.reasons.slice(0, 5).map((item, index) => {
                  const colors = ["#e27b48", "#7b83d8", "#2395a8", "#c85e91", "#7b9b45", "#ba8a38"];
                  return <div className="analytics-reason-branch-row" key={item.reason}>
                    <div className="analytics-row-label"><span>{item.reason}</span><strong>{item.count}</strong></div>
                    <div className="progress-track"><span style={{ width: `${item.count / Math.max(1, branch.total) * 100}%`, background: colors[index % colors.length] }} /></div>
                  </div>;
                })}
              </article>)}
            </div>
          </section>
        </div>
      )}
      <p className="history-footnote">Analytics use saved visit records only. This view does not edit, move, or delete data.</p>
    </section>
  );
}
