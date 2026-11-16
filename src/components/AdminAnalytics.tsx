import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Clock3, Download, GitCompare, RefreshCw, Search, TrendingUp, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import "./AdminAnalytics.css";

const GO_LIVE_DATE = "2026-10-14";
const MIN_BRANCH_SAMPLE = 30;

type Branch = { id: string; name: string; slug: string };
type Visit = {
  id: string;
  branch_id: string;
  visit_date: string;
  recorded_at: string;
  batch_id: string | null;
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
function laterDate(first: string, second: string) {
  return first > second ? first : second;
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
  const [today, setToday] = useState(() => dateKey(new Date()));
  const earliest = laterDate(GO_LIVE_DATE, shiftDate(today, -89));
  const [startDate, setStartDate] = useState(() => laterDate(GO_LIVE_DATE, shiftDate(today, -30)));
  const [endDate, setEndDate] = useState(today);
  const [includeToday, setIncludeToday] = useState(false);
  const analysisEndDate = endDate === today && !includeToday ? shiftDate(today, -1) : endDate;
  const comparisonEndDate = endDate === today ? shiftDate(today, -1) : analysisEndDate;
  const comparisonRangeDays = comparisonEndDate >= startDate ? Math.round((Date.parse(comparisonEndDate + "T12:00:00Z") - Date.parse(startDate + "T12:00:00Z")) / 86400000) + 1 : 0;
  const rawPreviousStartDate = comparisonRangeDays > 0 ? shiftDate(startDate, -comparisonRangeDays) : shiftDate(startDate, -1);
  const previousStartDate = laterDate(GO_LIVE_DATE, rawPreviousStartDate);
  const previousEndDate = shiftDate(startDate, -1);
  const previousPeriodComplete = comparisonRangeDays > 0 && rawPreviousStartDate >= GO_LIVE_DATE;
  const previousPeriodDays = previousEndDate >= previousStartDate ? Math.round((Date.parse(previousEndDate + "T12:00:00Z") - Date.parse(previousStartDate + "T12:00:00Z")) / 86400000) + 1 : 0;
  const previousPeriodLabel = previousPeriodDays > 0 ? previousStartDate + " to " + previousEndDate : "No operational previous period";
  const [activeTab, setActiveTab] = useState<AnalysisTab>("overview");
  const [visibleData, setVisibleData] = useState<Record<string, boolean>>({});
  const sectionOptions: Record<AnalysisTab, { id: string; label: string }[]> = {
    overview: [
      { id: "kpi-unavailable", label: "Unavailable-item requests" }, { id: "outcomes", label: "Outcome distribution chart" },
      { id: "weekday", label: "Visits by weekday" }, { id: "branch-snapshot", label: "Branch snapshot" },
      { id: "insights", label: "Quick insights" }, { id: "overview-comparison", label: "Previous-period comparison" },
    ],
    branches: [
      { id: "branch-kpis", label: "Branch summary metrics" }, { id: "branch-performance", label: "Branch performance breakdown" },
      { id: "branches-comparison", label: "Previous-period comparison" }, { id: "branch-period-chart", label: "Branch current vs previous comparison chart" },
    ],
    trends: [
      { id: "daily-trend", label: "Daily visit trend" }, { id: "weekday-conversion", label: "Purchase conversion by weekday" },
      { id: "outcome-totals", label: "Outcome totals" }, { id: "hourly", label: "Record entry times by hour" },
      { id: "daily-averages", label: "Daily averages and peak days" }, { id: "trend-summary", label: "Trend summary totals" },
      { id: "trends-comparison", label: "Previous-period comparison" }, { id: "period-daily-chart", label: "Daily visits: current vs previous period" }, { id: "weekday-outcomes", label: "Visit outcomes by weekday" },
    ],
    reasons: [
      { id: "reason-kpis", label: "Reason summary metrics" }, { id: "reason-breakdown", label: "No-purchase reasons" },
      { id: "reason-branches", label: "Reasons by branch" }, { id: "reasons-comparison", label: "Previous-period comparison" },
    ],
  };
  const isVisible = (id: string) => visibleData[id] !== false;
  const toggleData = (id: string, checked: boolean) => setVisibleData((current) => ({ ...current, [id]: checked }));
  const [minimumHourlyVisits, setMinimumHourlyVisits] = useState("0");
  const minimumHourlyVisitThreshold = Math.max(0, Math.floor(Number(minimumHourlyVisits) || 0));
  const [expandedReasonBranches, setExpandedReasonBranches] = useState<Record<string, boolean>>({});
  const [expandedBranchDetails, setExpandedBranchDetails] = useState<Record<string, boolean>>({});
  const setAllCurrent = (checked: boolean) => setVisibleData((current) => ({
    ...current,
    ...Object.fromEntries(sectionOptions[activeTab].map((item) => [item.id, checked])),
  }));
  const [selectedBranchId, setSelectedBranchId] = useState("all");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRange, setLoadedRange] = useState("");

  useEffect(() => {
    const refreshToday = () => {
      if (document.visibilityState !== "visible") return;
      const nextToday = dateKey(new Date());
      if (nextToday === today) return;
      const nextEarliest = laterDate(GO_LIVE_DATE, shiftDate(nextToday, -89));
      setToday(nextToday);
      setStartDate((current) => current === laterDate(GO_LIVE_DATE, shiftDate(today, -30))
        ? laterDate(GO_LIVE_DATE, shiftDate(nextToday, -30))
        : current < nextEarliest ? nextEarliest : current);
      setEndDate((current) => current === today ? nextToday : current);
    };
    window.addEventListener("focus", refreshToday);
    document.addEventListener("visibilitychange", refreshToday);
    return () => {
      window.removeEventListener("focus", refreshToday);
      document.removeEventListener("visibilitychange", refreshToday);
    };
  }, [today]);

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Analytics is unavailable because the database connection is not configured.");
      return;
    }
    if (!startDate || !endDate || startDate < earliest || startDate < GO_LIVE_DATE || endDate > today || startDate > analysisEndDate) {
      setError(`Choose a valid range from ${earliest} through ${analysisEndDate}. To analyse today, turn on Include today.`);
      return;
    }
    setLoading(true);
    setError("");
    const rows: Visit[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("visits")
        .select("id,branch_id,visit_date,recorded_at,batch_id,outcome,reason,unavailable_item_requested")
        .gte("visit_date", previousStartDate)
        .lte("visit_date", analysisEndDate)
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
    setLoadedRange(`${startDate} to ${analysisEndDate}`);
    setLoading(false);
  }, [startDate, analysisEndDate, previousStartDate, earliest, today]);

  useEffect(() => { void load(); }, [load]);

  const currentVisits = useMemo(() => visits.filter((visit) => visit.visit_date >= startDate && visit.visit_date <= analysisEndDate), [visits, startDate, analysisEndDate]);
  const comparisonCurrentVisits = useMemo(() => visits.filter((visit) => visit.visit_date >= startDate && visit.visit_date <= comparisonEndDate), [visits, startDate, comparisonEndDate]);
  const rangeDays = comparisonRangeDays;
  const scopedCurrentVisits = useMemo(() => selectedBranchId === "all" ? currentVisits : currentVisits.filter((visit) => visit.branch_id === selectedBranchId), [currentVisits, selectedBranchId]);
  const scopedComparisonVisits = useMemo(() => selectedBranchId === "all" ? comparisonCurrentVisits : comparisonCurrentVisits.filter((visit) => visit.branch_id === selectedBranchId), [comparisonCurrentVisits, selectedBranchId]);
  const previousVisits = useMemo(() => visits.filter((visit) => visit.visit_date >= previousStartDate && visit.visit_date <= previousEndDate && (selectedBranchId === "all" || visit.branch_id === selectedBranchId)), [visits, previousStartDate, previousEndDate, selectedBranchId]);
  const analysisVisits = scopedCurrentVisits;
  const analysisBranches = useMemo(() => selectedBranchId === "all" ? branches : branches.filter((branch) => branch.id === selectedBranchId), [branches, selectedBranchId]);

  const branchStats = useMemo(() => analysisBranches.map((branch) => {
    const rows = analysisVisits.filter((visit) => visit.branch_id === branch.id);
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
  }), [analysisBranches, analysisVisits]);

  const comparisonBranchStats = useMemo(() => analysisBranches.map((branch) => {
    const rows = scopedComparisonVisits.filter((visit) => visit.branch_id === branch.id);
    const purchases = rows.filter((visit) => visit.outcome === "purchased").length;
    const noPurchase = rows.filter((visit) => visit.outcome === "not_purchased").length;
    const resolved = purchases + noPurchase;
    return { ...branch, total: rows.length, purchases, noPurchase, resolved, conversion: percent(purchases, resolved) };
  }), [analysisBranches, scopedComparisonVisits]);

  const previousBranchStats = useMemo(() => analysisBranches.map((branch) => {
    const rows = previousVisits.filter((visit) => visit.branch_id === branch.id);
    const purchases = rows.filter((visit) => visit.outcome === "purchased").length;
    const resolved = rows.filter((visit) => visit.outcome !== "undecided").length;
    return { id: branch.id, name: branch.name, total: rows.length, purchases, resolved, conversion: percent(purchases, resolved) };
  }), [analysisBranches, previousVisits]);

  const purchases = analysisVisits.filter((visit) => visit.outcome === "purchased").length;
  const noPurchase = analysisVisits.filter((visit) => visit.outcome === "not_purchased").length;
  const resolved = analysisVisits.filter((visit) => visit.outcome !== "undecided").length;
  const conversion = percent(purchases, resolved);
  const noPurchaseRate = percent(noPurchase, resolved);
  const noPurchaseShare = percent(noPurchase, analysisVisits.length);
  const undecided = analysisVisits.filter((visit) => visit.outcome === "undecided").length;
  const unavailableRequests = analysisVisits.filter((visit) => visit.unavailable_item_requested).length;
  const comparisonPurchases = scopedComparisonVisits.filter((visit) => visit.outcome === "purchased").length;
  const comparisonNoPurchase = scopedComparisonVisits.filter((visit) => visit.outcome === "not_purchased").length;
  const comparisonResolved = comparisonPurchases + comparisonNoPurchase;
  const comparisonConversion = percent(comparisonPurchases, comparisonResolved);
  const previousPurchases = previousVisits.filter((visit) => visit.outcome === "purchased").length;
  const previousNoPurchase = previousVisits.filter((visit) => visit.outcome === "not_purchased").length;
  const previousResolved = previousVisits.filter((visit) => visit.outcome !== "undecided").length;
  const previousConversion = percent(previousPurchases, previousResolved);
  const comparisonStats = [
    { label: "Total visits", current: scopedComparisonVisits.length, previous: previousVisits.length },
    { label: "Purchases", current: comparisonPurchases, previous: previousPurchases },
    { label: "No purchase", current: comparisonNoPurchase, previous: previousNoPurchase },
    { label: "Conversion", current: comparisonConversion, previous: previousConversion, percentagePoints: true },
  ].map((item) => {
    const baselineAvailable = previousPeriodComplete && (item.percentagePoints ? previousResolved > 0 && comparisonResolved > 0 : previousVisits.length > 0);
    const partialBaseline = !previousPeriodComplete && previousPeriodDays > 0;
    const delta = item.current - item.previous;
    const change = baselineAvailable && !item.percentagePoints && item.previous > 0
      ? Math.round((item.current - item.previous) / item.previous * 100)
      : null;
    return { ...item, delta, change, baselineAvailable, partialBaseline };
  });
  const hourlyAnalysis = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, label: new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "numeric", hour12: true }).format(new Date(Date.UTC(2026, 0, 1, hour - 1))), total: 0 }));
    let batchExcluded = 0;
    let beforeOpeningExcluded = 0;
    let invalidTimestampExcluded = 0;
    analysisVisits.forEach((visit) => {
      if (visit.batch_id) { batchExcluded += 1; return; }
      const date = new Date(visit.recorded_at);
      if (Number.isNaN(date.getTime())) { invalidTimestampExcluded += 1; return; }
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hourCycle: "h23" }).format(date));
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Lagos", weekday: "short" }).format(date);
      const openingHour = weekday === "Sun" ? 14 : 8;
      if (hour < openingHour) { beforeOpeningExcluded += 1; return; }
      hours[hour].total += 1;
    });
    return { hours, batchExcluded, beforeOpeningExcluded, invalidTimestampExcluded };
  }, [analysisVisits]);
  const busyHourStats = hourlyAnalysis.hours;
  const visibleBusyHourStats = busyHourStats.filter((hour) => hour.total >= minimumHourlyVisitThreshold);
  const peakHour = [...visibleBusyHourStats].filter((hour) => hour.total > 0).sort((a, b) => b.total - a.total)[0];
  const quietHour = [...visibleBusyHourStats].filter((hour) => hour.total > 0).sort((a, b) => a.total - b.total)[0];

  const dailyStats = useMemo(() => {
    const days: { date: string; total: number; purchases: number; noPurchase: number; undecided: number }[] = [];
    for (let cursor = startDate; cursor <= analysisEndDate; cursor = shiftDate(cursor, 1)) {
      const rows = analysisVisits.filter((visit) => visit.visit_date === cursor);
      days.push({
        date: cursor,
        total: rows.length,
        purchases: rows.filter((visit) => visit.outcome === "purchased").length,
        noPurchase: rows.filter((visit) => visit.outcome === "not_purchased").length,
        undecided: rows.filter((visit) => visit.outcome === "undecided").length,
      });
    }
    return days;
  }, [analysisVisits, startDate, analysisEndDate]);
  const completedDailyStats = dailyStats.filter((day) => day.date < today);
  const periodDailyComparison = useMemo(() => Array.from({ length: rangeDays }, (_, index) => {
    const currentDate = shiftDate(startDate, index);
    const previousDate = shiftDate(previousStartDate, index);
    return {
      index: index + 1,
      current: scopedComparisonVisits.filter((visit) => visit.visit_date === currentDate).length,
      previous: previousVisits.filter((visit) => visit.visit_date === previousDate).length,
    };
  }), [rangeDays, startDate, previousStartDate, scopedComparisonVisits, previousVisits]);
  const maxPeriodDaily = Math.max(1, ...periodDailyComparison.flatMap((day) => [day.current, day.previous]));
  const activeDays = completedDailyStats.filter((day) => day.total > 0);
  const averageDailyFootfall = activeDays.length ? activeDays.reduce((total, day) => total + day.total, 0) / activeDays.length : 0;
  const busiestDay = [...activeDays].sort((a, b) => b.total - a.total)[0];
  const quietestRecordedDay = [...activeDays].sort((a, b) => a.total - b.total)[0];

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
    const totals = labels.map((label, index) => ({ label, index, total: 0, purchases: 0, noPurchase: 0, undecided: 0, occurrences: 0 }));
    completedDailyStats.forEach((day) => {
      const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
      totals[weekday].total += day.total;
      totals[weekday].purchases += day.purchases;
      totals[weekday].noPurchase += day.noPurchase;
      totals[weekday].undecided += day.undecided;
      totals[weekday].occurrences += 1;
    });
    return totals.map((day) => ({ ...day, average: day.occurrences ? day.total / day.occurrences : 0 }));
  }, [completedDailyStats]);
  const outcomeStats = [
    { label: "Purchased", count: purchases, color: "#23875b" },
    { label: "No purchase", count: noPurchase, color: "#e27b48" },
    { label: "Undecided", count: undecided, color: "#9aa69e" },
  ];
  const peak = Math.max(1, ...dailyStats.map((day) => day.total));
  const maxHour = Math.max(1, ...visibleBusyHourStats.map((hour) => hour.total));
  const maxBranch = Math.max(1, ...branchStats.map((branch) => branch.total));
  const topBranch = [...branchStats].filter((item) => item.resolved >= MIN_BRANCH_SAMPLE).sort((a, b) => b.conversion - a.conversion)[0];
  const busiestBranch = [...branchStats].filter((item) => item.total > 0).sort((a, b) => b.total - a.total)[0];
  const lowestConversionBranch = [...branchStats].filter((item) => item.resolved >= MIN_BRANCH_SAMPLE).sort((a, b) => a.conversion - b.conversion)[0];
  const mostNoPurchaseBranch = [...branchStats].filter((item) => item.noPurchase > 0).sort((a, b) => b.noPurchase - a.noPurchase)[0];
  const mostUnavailableBranch = [...branchStats].filter((item) => item.unavailable > 0).sort((a, b) => b.unavailable - a.unavailable)[0];

  const downloadAnalysisPdf = async () => {
    const { jsPDF } = await import("jspdf");
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
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(startDate + " to " + analysisEndDate + " | " + (selectedBranchId === "all" ? "All branches combined" : (analysisBranches[0]?.name || "Selected branch")), margin, 36);
    doc.setFontSize(8); doc.setTextColor(muted[0], muted[1], muted[2]); doc.text("Prepared from saved records. Comparisons are descriptive, not causal.", margin, y); y += 10;
    line("Current day", includeToday && endDate === today ? "Included in current totals and daily trend; excluded from comparisons and daily averages" : "Excluded from current reporting period");
    line("Opening schedule", "Mon-Sat 8:00 AM · Sunday 2:00 PM");
    line("Hourly analysis", "Individual record-entry timestamps only. Batch entries are excluded. These are not confirmed customer arrival times.");
    line("Batch-entered records excluded", String(hourlyAnalysis.batchExcluded));
    line("Before-opening records excluded", String(hourlyAnalysis.beforeOpeningExcluded));
    line("Invalid timestamps excluded", String(hourlyAnalysis.invalidTimestampExcluded));
    if (activeTab === "overview" && ["kpi-visits","kpi-purchases","kpi-no-purchase","kpi-conversion","kpi-unavailable"].some(isVisible)) {
      section("Performance at a glance");
      if (isVisible("kpi-visits")) line("Total visits", analysisVisits.length.toLocaleString());
      if (isVisible("kpi-purchases")) line("Purchases", purchases.toLocaleString());
      if (isVisible("kpi-no-purchase")) line("No-purchase visits", noPurchase.toLocaleString());
      if (isVisible("kpi-conversion")) line("Purchase conversion", conversion + "%");
      if (isVisible("kpi-unavailable")) line("Unavailable-item requests", unavailableRequests.toLocaleString());
    }
    if (activeTab === "branches" && isVisible("branch-kpis")) {
      section("Branch summary metrics"); line("Branches included", String(branchStats.length));
      line("Branches with visits", String(branchStats.filter(item => item.total > 0).length));
      line("Highest footfall branch", busiestBranch ? busiestBranch.name + " · " + busiestBranch.total + " visits" : "No data");
      line("Highest branch conversion", topBranch ? topBranch.name + " · " + topBranch.conversion + "%" : "No data");
      line("Lowest active branch conversion", lowestConversionBranch ? lowestConversionBranch.name + " · " + lowestConversionBranch.conversion + "%" : "No data");
      line("Most no-purchase visits", mostNoPurchaseBranch ? mostNoPurchaseBranch.name + " · " + mostNoPurchaseBranch.noPurchase : "No data");
      line("Most unavailable-item requests", mostUnavailableBranch ? mostUnavailableBranch.name + " · " + mostUnavailableBranch.unavailable : "No data");
    }
    if (activeTab === "reasons" && isVisible("reason-kpis")) {
      section("Reason summary metrics"); line("No-purchase visits", noPurchase.toLocaleString());
      line("Reason categories", String(reasonStats.length)); line("Most frequent reason", String(reasonStats[0]?.count ?? 0));
    }
    if (isVisible(activeTab + "-comparison")) section("Previous-period comparison");
    if (isVisible(activeTab + "-comparison")) {
      line("Previous period", previousPeriodLabel + (previousPeriodComplete ? "" : previousPeriodDays > 0 ? " · partial operational period" : ""));
      comparisonStats.forEach(item => line(item.label, String(item.current) + (item.percentagePoints ? "%" : "") + " vs " + (item.baselineAvailable ? String(item.previous) + (item.percentagePoints ? "%" : "") + " previous" : item.partialBaseline ? String(item.previous) + (item.percentagePoints ? "%" : "") + " partial previous" : "no baseline") + (item.baselineAvailable ? item.percentagePoints ? " · " + (item.delta > 0 ? "+" : "") + item.delta + " pp" : " · " + (item.delta > 0 ? "+" : "") + item.delta + " change" + (item.change === null ? "" : " (" + (item.change > 0 ? "+" : "") + item.change + "%)") : item.partialBaseline ? " · no like-for-like change" : "")));
    }
    if (activeTab === "overview") {
      if (isVisible("outcomes")) { section("Outcome distribution"); bars([{label:"Purchased",value:purchases,color:[35,135,91]},{label:"No purchase",value:noPurchase,color:[226,123,72]},{label:"Undecided",value:undecided,color:[154,166,158]}]); }
      if (isVisible("weekday")) { section("Average visits by weekday"); bars(weekdayStats.map(day => ({label:day.label + " · " + day.occurrences + " days",value:Number(day.average.toFixed(1))}))); }
      if (isVisible("branch-snapshot")) { section("Branch snapshot"); bars(branchStats.map(item => ({label:item.name + " · " + item.conversion + "% conversion",value:item.total}))); }
      if (isVisible("insights")) { section("Quick insights"); line("Purchase conversion among resolved visits", conversion + "%"); line("No-purchase rate among resolved visits", noPurchaseRate + "%"); line("No-purchase share of all visits", noPurchaseShare + "%"); line("Undecided visits", String(undecided)); }
      if (topBranch) line("Highest branch conversion", topBranch.name + " · " + topBranch.conversion + "%");
    } else if (activeTab === "branches") {
      if (isVisible("branch-performance")) { section("Branch performance"); bars(branchStats.map(item => ({label:item.name + " · " + item.conversion + "% conversion",value:item.total}))); }
      if (isVisible("branch-performance")) branchStats.forEach(item => line(item.name + " · purchases / no purchase", item.purchases + " / " + item.noPurchase));
    } else if (activeTab === "trends") {
      if (isVisible("daily-trend")) { section("Daily visits"); bars(dailyStats.filter(day => day.total > 0).map(day => ({label:day.date,value:day.total}))); }
      if (isVisible("weekday-conversion")) { section("Purchase conversion by weekday"); bars(weekdayStats.map(day => ({label:day.label + " · " + day.occurrences + " days",value:percent(day.purchases,day.purchases+day.noPurchase)}))); }
      if (isVisible("outcome-totals")) { section("Outcome totals"); bars(outcomeStats.map(item => ({label:item.label,value:item.count,color:(item.label === "Purchased" ? [35,135,91] : item.label === "No purchase" ? [226,123,72] : [139,154,144]) as [number,number,number]}))); }
      if (isVisible("daily-averages")) { section("Daily averages and peak days"); line("Average on recorded days", averageDailyFootfall.toFixed(1) + " visits");
      line("Busiest recorded day", busiestDay ? busiestDay.date + " · " + busiestDay.total + " visits" : "No data");
      line("Quietest recorded day", quietestRecordedDay ? quietestRecordedDay.date + " · " + quietestRecordedDay.total + " visits" : "No data");
      line("Days with visits", String(activeDays.length)); } if (isVisible("hourly")) section("Busy hours · Lagos time");
      if (isVisible("hourly")) bars(busyHourStats.filter(hour => hour.total > 0).map(hour => ({label:hour.label,value:hour.total,color:[226,123,72]})));
      line("Peak hour", peakHour ? peakHour.label + " · " + peakHour.total + " visits" : "No timestamped visits");
    } else {
      if (isVisible("reason-breakdown")) section("No-purchase reasons");
      const colors: [number,number,number][] = [[226,123,72],[123,131,216],[35,149,168],[200,94,145],[123,155,69],[186,138,56]];
      if (isVisible("reason-breakdown")) bars(reasonStats.map((item,index) => ({label:item.reason + " · " + percent(item.count,noPurchase) + "%",value:item.count,color:colors[index % colors.length]})));
      if (isVisible("reason-branches")) section("Reasons by branch");
      if (isVisible("reason-branches")) reasonBranchStats.forEach(branch => { line(branch.name, branch.total + " no-purchase visits"); bars(branch.reasons.slice(0,5).map((item,index) => ({label:item.reason,value:item.count,color:colors[index % colors.length]}))); });
    }
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page); doc.setDrawColor(222, 232, 224); doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text("FOOTLYTICS · INTERNAL MANAGEMENT REPORT", margin, pageHeight - 6); doc.text("Page " + page + " of " + pages, pageWidth - margin, pageHeight - 6, { align: "right" });
    }
    doc.save("Footlytics-" + activeTab + "-" + startDate + "-to-" + analysisEndDate + ".pdf");
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
          <input id="analytics-start" type="date" min={earliest} max={analysisEndDate} value={startDate} onChange={(event) => setStartDate(event.target.value ? laterDate(GO_LIVE_DATE, event.target.value) : "")} />
        </label>
        <label className="history-date-field" htmlFor="analytics-end"><span><CalendarDays size={15} /> End date</span>
          <input id="analytics-end" type="date" min={startDate || earliest} max={today} value={endDate} onChange={(event) => { const nextEnd = event.target.value; setEndDate(nextEnd); if (nextEnd !== today) setIncludeToday(false); setStartDate((current) => current > (nextEnd === today && !includeToday ? shiftDate(today, -1) : nextEnd) ? (nextEnd === today && !includeToday ? shiftDate(today, -1) : nextEnd) : current); }} />
        </label>
        <button type="button" className="secondary-button analytics-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? "Refreshing…" : "Refresh analysis"}</button>
      </div>
      <label className="analytics-include-today"><input type="checkbox" checked={includeToday} disabled={endDate !== today} onChange={(event) => { setIncludeToday(event.target.checked); if (!event.target.checked && startDate === today) setStartDate(shiftDate(today, -1)); }} /><span>Include today (in progress)</span></label>
      <div className="analytics-date-presets" aria-label="Quick reporting periods">
        <span>Quick range</span>
        {[{ label: "7 days", days: 7 }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }].map((preset) => <button key={preset.days} type="button" className={startDate === laterDate(GO_LIVE_DATE, shiftDate(analysisEndDate, -(preset.days - 1))) ? "analytics-preset active" : "analytics-preset"} onClick={() => { setEndDate(today); setIncludeToday(false); setStartDate(laterDate(GO_LIVE_DATE, shiftDate(shiftDate(today, -1), -(preset.days - 1)))); }} disabled={loading}>{preset.label}</button>)}
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="analytics-range-row">
        <p className="analytics-range">{loadedRange ? `Reporting period: ${loadedRange}` : "Preparing reporting period…"} · Maximum window: 90 days</p>
        <span className="analytics-record-count">{loading ? "Updating records…" : `${analysisVisits.length.toLocaleString()} visits in view`}</span>
      </div>
      {endDate === today && (includeToday ? <p className="analytics-help analytics-comparison-empty">Current-day visits are included in current totals and daily trends. Period comparisons, weekday averages and daily averages use completed days only.</p> : <p className="analytics-help analytics-comparison-empty">Today is excluded by default because its figures may be incomplete. Turn on Include today to add it to current totals and the daily trend.</p>)}

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

      <div className="history-summary analytics-kpis analytics-shared-kpis" aria-label="Key performance metrics">
        {comparisonStats.map((item) => <article className="analytics-shared-kpi" key={item.label}>
          <span className="analytics-shared-kpi-label">{item.label === "Total visits" ? <><Users size={13} /> Total visits</> : item.label}</span>
          <strong>{item.current}{item.percentagePoints ? "%" : ""}</strong>
          <small>{item.baselineAvailable ? `Previous: ${item.previous}${item.percentagePoints ? "%" : ""}` : item.partialBaseline ? `Partial previous: ${item.previous}${item.percentagePoints ? "%" : ""}` : "No previous baseline"}</small>
          <small className={item.baselineAvailable && item.delta > 0 ? "comparison-up" : item.baselineAvailable && item.delta < 0 ? "comparison-down" : ""}>
            {item.baselineAvailable ? item.percentagePoints
              ? `${item.delta > 0 ? "+" : ""}${item.delta} pp change`
              : `${item.delta > 0 ? "+" : ""}${item.delta} change${item.change === null ? "" : ` (${item.change > 0 ? "+" : ""}${item.change}%)`}`
              : item.partialBaseline ? "Partial period, no like-for-like change" : "No previous baseline"}
          </small>
        </article>)}
      </div>

      <details className="analytics-customise-panel">
        <summary><span><strong>Customise view</strong><small>Choose exactly which data to display in this section</small></span><span className="analytics-customise-count">{sectionOptions[activeTab].filter((item) => isVisible(item.id)).length} of {sectionOptions[activeTab].length} selected</span></summary>
        <div className="analytics-customise-tools">
          <button type="button" onClick={() => setAllCurrent(true)}>Select all</button>
          <button type="button" onClick={() => setAllCurrent(false)}>Clear all</button>
        </div>
        <div className="analytics-customise-options">
          {sectionOptions[activeTab].map((item) => <label key={item.id} className="analytics-customise-option">
            <input type="checkbox" checked={isVisible(item.id)} onChange={(event) => toggleData(item.id, event.target.checked)} />
            <span>{item.label}</span>
          </label>)}
        </div>
      </details>
      <div className="analytics-action-row analytics-period-label">
        <span><strong>Period comparison · completed days</strong><small>{previousPeriodLabel}{previousPeriodComplete ? "" : previousPeriodDays > 0 ? " · partial" : ""} vs {startDate} to {comparisonEndDate}</small></span>
      </div>
      {isVisible(activeTab + "-comparison") && <section className="analytics-comparison-grid" aria-label="Previous-period comparison">
        <p className="analytics-comparison-period">Previous period: {previousPeriodLabel}{previousPeriodComplete ? "" : previousPeriodDays > 0 ? " (partial operational period)" : ""}. Completed current period: {startDate} to {comparisonEndDate}. Today is excluded from comparisons.</p>
        {!previousPeriodComplete && <p className="analytics-help analytics-comparison-empty">Only {previousPeriodDays} operational days are available in the previous window. Records before 14 October 2026 are excluded, so this partial period is shown for context and no like-for-like change is calculated.</p>}
        {previousPeriodComplete && previousVisits.length === 0 && <p className="analytics-help analytics-comparison-empty">No saved visits were found in the previous period for this branch scope. There is no previous-period baseline.</p>}
        {comparisonStats.map((item) => <article className="analytics-comparison-card" key={item.label}>
          <span>{item.label}</span><strong>{item.current}{item.percentagePoints ? "%" : ""}</strong>
          <small>{item.baselineAvailable ? `Previous: ${item.previous}${item.percentagePoints ? "%" : ""}` : item.partialBaseline ? `Partial previous: ${item.previous}${item.percentagePoints ? "%" : ""}` : "No previous baseline"}</small>
          <small className={item.baselineAvailable && item.delta > 0 ? "comparison-up" : item.baselineAvailable && item.delta < 0 ? "comparison-down" : ""}>{item.baselineAvailable ? item.percentagePoints ? `${item.delta > 0 ? "+" : ""}${item.delta} pp change` : `${item.delta > 0 ? "+" : ""}${item.delta} change${item.change === null ? "" : ` (${item.change > 0 ? "+" : ""}${item.change}%)`}` : item.partialBaseline ? "Partial period, no like-for-like change" : "No previous baseline"}</small>
        </article>)}
      </section>}

      {activeTab === "overview" && (
        <div className="analytics-tab-content">
          {isVisible("kpi-unavailable") && <div className="history-summary analytics-kpis analytics-optional-kpi">
            <div><strong>{unavailableRequests.toLocaleString()}</strong><span>Unavailable-item requests</span></div>
          </div>}
          <div className="analytics-grid">
            <section hidden={!isVisible("outcomes")} className="analytics-subpanel analytics-chart-card">
              <h3><BarChart3 size={16} /> Outcome distribution</h3>
              <p className="analytics-help">How recorded visits ended during this period.</p>
              <div className="analytics-outcome-total"><strong>{analysisVisits.length.toLocaleString()}</strong><span>total visits</span></div>
              <div className="analytics-outcome-bar" role="img" aria-label={outcomeStats.map((item) => `${item.label}: ${item.count}`).join(", ")}>
                {outcomeStats.filter((item) => item.count > 0).map((item) => <span key={item.label} style={{ width: `${item.count / Math.max(1, analysisVisits.length) * 100}%`, background: item.color }} />)}
              </div>
              <div className="analytics-legend">
                {outcomeStats.map((item) => <div key={item.label}><span className="analytics-legend-dot" style={{ background: item.color }} /><span>{item.label}</span><strong>{item.count.toLocaleString()}</strong><small>{percent(item.count, analysisVisits.length)}%</small></div>)}
              </div>
              <p className="analytics-help">Purchase conversion is purchases divided by resolved visits (purchased or no purchase); undecided visits are excluded.</p>
            </section>
            <section hidden={!isVisible("weekday")} className="analytics-subpanel analytics-chart-card">
              <h3><CalendarDays size={16} /> Visits by weekday</h3>
              <p className="analytics-help">Average visits per occurrence of each weekday. The count below each bar shows how many days contributed to the average.</p>
              <div className="analytics-weekday-chart">
                {weekdayStats.map((day) => <div className="analytics-weekday" key={day.label} title={`${day.label}: average ${day.average.toFixed(1)} visits across ${day.occurrences} days (${day.total} total)`}>
                  <strong>{day.average ? day.average.toFixed(1) : ""}</strong><span className="analytics-weekday-track"><i style={{ height: `${Math.max(day.average ? 5 : 2, day.average / Math.max(1, ...weekdayStats.map((item) => item.average)) * 100)}%` }} /></span><small>{day.label}<br />{day.occurrences}d</small>
                </div>)}
              </div>
              <p className="analytics-help">Patterns are descriptive. Different date coverage can affect comparisons.</p>
            </section>
            <section hidden={!isVisible("branch-snapshot")} className="analytics-subpanel">
              <h3><GitCompare size={16} /> Branch snapshot</h3>
              <p className="analytics-help">A quick view of recorded activity for the selected branch scope.</p>
              {branchStats.map((item) => (
                <div className="analytics-branch-row" key={item.id}>
                  <div className="analytics-row-label"><strong>{item.name}</strong><span>{item.total} visits</span></div>
                  <div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${item.total / maxBranch * 100}%` }} /></div>
                  <div className="analytics-stacked-bar" aria-label={`${item.name}: ${item.purchases} purchased, ${item.noPurchase} no purchase, ${item.undecided} undecided`}>
                    {[
                      { count: item.purchases, color: "#23875b" },
                      { count: item.noPurchase, color: "#e27b48" },
                      { count: item.undecided, color: "#9aa69e" },
                    ].filter((part) => part.count > 0).map((part, index) => <span key={index} style={{ width: `${part.count / Math.max(1, item.total) * 100}%`, background: part.color }} />)}
                  </div>
                  <div className="analytics-row-meta"><span>{item.purchases} purchases</span><span>{item.noPurchase} no purchase</span><span>{item.undecided} undecided</span></div>
                </div>
              ))}
              {branchStats.length === 0 && <p className="corrections-empty">No branches are available for analysis.</p>}
            </section>
            <section hidden={!isVisible("insights")} className="analytics-subpanel analytics-insight-panel">
              <h3><TrendingUp size={16} /> Quick insights</h3>
              {analysisVisits.length === 0 ? <p className="corrections-empty">No visits were recorded in this reporting period.</p> : (
                <ul className="analytics-insight-list">
                  <li><strong>{conversion}%</strong> purchase conversion among resolved visits (purchased or no purchase).</li>
                  <li><strong>{noPurchaseRate}%</strong> of resolved visits ended without a purchase.</li>
                  <li><strong>{noPurchaseShare}%</strong> of all recorded visits ended without a purchase.</li>
                  <li><strong>{undecided}</strong> visits have an undecided legacy outcome.</li>
                  <li>{topBranch ? selectedBranchId === "all" ? <><strong>{topBranch.name}</strong> has the highest conversion among branches with at least {MIN_BRANCH_SAMPLE} resolved visits.</> : <>The selected branch, <strong>{topBranch.name}</strong>, has a conversion rate of <strong>{topBranch.conversion}%</strong> from {topBranch.resolved} resolved visits.</> : `No branch has at least ${MIN_BRANCH_SAMPLE} resolved visits, so conversion rankings are withheld.`}</li>

                </ul>
              )}
              <p className="analytics-help">These are descriptive summaries, not proof of why performance changed.</p>
            </section>
          </div>
        </div>
      )}

      {activeTab === "branches" && (
        <div className="analytics-tab-content">
          <div hidden={!isVisible("branch-kpis")} className="history-summary analytics-kpis analytics-branch-summary">
            <div><strong>{branchStats.length}</strong><span>Branches included</span></div>
            <div><strong>{branchStats.filter((item) => item.total > 0).length}</strong><span>Branches with visits</span></div>
            <div><strong>{busiestBranch ? busiestBranch.name + " · " + busiestBranch.total : "No data"}</strong><span>Highest footfall branch (visits)</span></div>
            <div><strong>{topBranch ? topBranch.name + " · " + topBranch.conversion + "% (n=" + topBranch.resolved + ")" : "Insufficient sample"}</strong><span>Highest conversion ({MIN_BRANCH_SAMPLE}+ resolved visits)</span></div>
            <div><strong>{lowestConversionBranch ? lowestConversionBranch.name + " · " + lowestConversionBranch.conversion + "% (n=" + lowestConversionBranch.resolved + ")" : "Insufficient sample"}</strong><span>Lowest conversion ({MIN_BRANCH_SAMPLE}+ resolved visits)</span></div>
            <div><strong>{mostNoPurchaseBranch ? mostNoPurchaseBranch.name + " · " + mostNoPurchaseBranch.noPurchase : "No data"}</strong><span>Most no-purchase visits</span></div>
            <div><strong>{mostUnavailableBranch ? mostUnavailableBranch.name + " · " + mostUnavailableBranch.unavailable : "No data"}</strong><span>Most unavailable-item requests</span></div>
          </div>
          <div className="analytics-grid">
            <section hidden={!isVisible("branch-period-chart")} className="analytics-subpanel analytics-wide-subpanel">
              <h3><GitCompare size={16} /> Branch performance: current vs previous period</h3>
              <p className="analytics-help">{previousPeriodComplete ? "Compare each branch with the same-length period immediately before the selected dates. Visit bars use counts; conversion bars use percentages." : `Only ${previousPeriodDays} operational days are available in the previous window. Previous-period bars are shown for context only and should not be treated as a like-for-like comparison.`}</p>
              {comparisonBranchStats.map((item) => {
                const previous = previousBranchStats.find((row) => row.id === item.id);
                const maxVisits = Math.max(1, ...comparisonBranchStats.map((row) => row.total), ...previousBranchStats.map((row) => row.total));
                const conversionDelta = previousPeriodComplete && previous && previous.resolved > 0 && item.resolved > 0
                  ? item.conversion - previous.conversion
                  : null;
                return <article className="analytics-period-branch" key={item.id}>
                  <div className="analytics-row-label"><strong>{item.name}</strong><span>{item.total} visits now · {previous?.total ?? 0} previously</span></div>
                  <span className="analytics-period-metric-label">Visits</span>
                  <div className="analytics-paired-bars" aria-label={`${item.name} visits: current ${item.total}, previous ${previous?.total ?? 0}`}>
                    <span className="analytics-period-current" style={{ width: `${item.total / maxVisits * 100}%` }} />
                    <span className="analytics-period-previous" style={{ width: `${(previous?.total ?? 0) / maxVisits * 100}%` }} />
                  </div>
                  <span className="analytics-period-metric-label">Resolved visits: {item.resolved} now · {previous?.resolved ?? 0} previously</span>
                  <span className="analytics-period-metric-label">
                    Conversion: {item.resolved > 0 ? item.conversion + "% now (n=" + item.resolved + ")" : "No resolved visits now"} · {previous?.resolved ? previous.conversion + "% previously (n=" + previous.resolved + ")" : "No previous baseline"}{item.resolved > 0 && item.resolved < MIN_BRANCH_SAMPLE ? " · Low sample" : ""}
                    {conversionDelta !== null && <> · {conversionDelta > 0 ? "+" : ""}{conversionDelta} percentage points</>}
                  </span>
                  <div className="analytics-paired-bars" aria-label={item.name + " conversion: " + (item.resolved > 0 ? item.conversion + " percent current" : "no current baseline") + ", " + (previous?.resolved ? previous.conversion + " percent previous" : "no previous baseline")}>
                    {item.resolved > 0 && <span className="analytics-period-current" style={{ width: `${item.conversion}%` }} />}
                    {previous?.resolved ? <span className="analytics-period-previous" style={{ width: `${previous.conversion}%` }} /> : null}
                  </div>
                </article>;
              })}
              <div className="analytics-period-legend"><span><i className="analytics-period-current" /> Current period</span><span><i className="analytics-period-previous" /> Previous period</span></div>
            </section>
            <section hidden={!isVisible("branch-performance")} className="analytics-subpanel analytics-wide-subpanel">
              <h3><GitCompare size={16} /> {selectedBranchId === "all" ? "Branch performance comparison" : "Selected branch performance"}</h3>
              <p className="analytics-help">Review visit volume, outcomes and conversion for the selected branch scope. Each conversion rate shows its resolved-visit sample size. Rates below {MIN_BRANCH_SAMPLE} resolved visits are marked low sample.</p>
              {branchStats.map((item) => (
                <div className="analytics-branch-row" key={item.id}>
                  <div className="analytics-row-label"><strong>{item.name}</strong><span>{item.total.toLocaleString()} visits · {item.resolved} resolved · {item.resolved > 0 ? item.conversion + "% conversion" : "No resolved visits"}{item.resolved > 0 && item.resolved < MIN_BRANCH_SAMPLE ? " · Low sample" : ""}</span></div>
                  <div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${item.total / maxBranch * 100}%` }} /></div>
                  <div className="analytics-row-meta"><span>{item.purchases} purchases</span><span>{item.noPurchase} no purchase</span></div>
                  <div className="analytics-row-meta"><span>{item.unavailable} unavailable-item requests</span></div>
                  <button type="button" className="text-button analytics-expand-button" aria-expanded={Boolean(expandedBranchDetails[item.id])} onClick={() => setExpandedBranchDetails((current) => ({ ...current, [item.id]: !current[item.id] }))}>
                    {expandedBranchDetails[item.id] ? "Hide detailed breakdown" : "Show detailed breakdown"}
                  </button>
                  {expandedBranchDetails[item.id] && <div className="analytics-branch-detail">
                    <div className="analytics-row-meta"><span>Share of all visits</span><strong>{percent(item.total, analysisVisits.length)}%</strong><span>Share of all purchases</span><strong>{percent(item.purchases, purchases)}%</strong></div>
                    <div className="analytics-row-meta"><span>No-purchase rate</span><strong>{percent(item.noPurchase, item.resolved)}%</strong><span>Unavailable request rate</span><strong>{percent(item.unavailable, item.total)}%</strong></div>
                    <strong>Reasons for no purchase</strong>
                    {(reasonBranchStats.find((entry) => entry.id === item.id)?.reasons ?? []).length === 0
                      ? <p className="corrections-empty">No no-purchase reasons recorded for this branch in this period.</p>
                      : (reasonBranchStats.find((entry) => entry.id === item.id)?.reasons ?? []).map((reason) => <div className="analytics-reason-branch-row" key={reason.reason}>
                        <div className="analytics-row-label"><span>{reason.reason}</span><strong>{reason.count} · {percent(reason.count, item.noPurchase)}%</strong></div>
                        <div className="progress-track"><span style={{ width: percent(reason.count, item.noPurchase) + "%" }} /></div>
                      </div>)}
                  </div>}
                </div>
              ))}
              {branchStats.length === 0 && <p className="corrections-empty">No branches are available for analysis.</p>}
            </section>
          </div>
        </div>
      )}

      {activeTab === "trends" && (
        <div className="analytics-tab-content">
          <section hidden={!isVisible("period-daily-chart")} className="analytics-subpanel analytics-wide-subpanel">
            <h3><TrendingUp size={16} /> Daily visits: current vs previous period</h3>
            <p className="analytics-help">Each pair compares the same position in two equal-length periods. Scroll horizontally on mobile for longer ranges.</p>
            {!previousPeriodComplete
              ? <p className="analytics-help analytics-comparison-empty">A daily comparison is unavailable because the full previous period falls partly before the 14 October 2026 operational start date.</p>
              : <div className="analytics-period-daily-chart" role="img" aria-label="Daily visits comparison, current period versus previous period">
                {periodDailyComparison.map((day) => <div className="analytics-period-day" key={day.index} title={`Day ${day.index}: current ${day.current} visits; previous ${day.previous} visits`}>
                  <div className="analytics-period-day-bars"><span className="analytics-period-current" style={{ height: `${day.current / maxPeriodDaily * 100}%` }} /><span className="analytics-period-previous" style={{ height: `${day.previous / maxPeriodDaily * 100}%` }} /></div>
                  <small>{day.index % 5 === 1 || day.index === 1 || day.index === rangeDays ? day.index : ""}</small>
                </div>)}
              </div>}
            <div className="analytics-period-legend"><span><i className="analytics-period-current" /> Current period</span><span><i className="analytics-period-previous" /> Previous period</span></div>
          </section>
          <section hidden={!isVisible("weekday-outcomes")} className="analytics-subpanel analytics-wide-subpanel">
            <h3><BarChart3 size={16} /> Visit outcomes by weekday</h3>
            <p className="analytics-help">See the full outcome mix by weekday. Conversion uses resolved visits, while the stacked bars include undecided records.</p>
            <div className="analytics-weekday-outcomes">
              {weekdayStats.map((day) => { const resolvedWeekday = day.purchases + day.noPurchase; return <div className="analytics-weekday-outcome" key={day.label}>
                <div className="analytics-row-label"><strong>{day.label}</strong><span>{day.total} visits across {day.occurrences} days · {resolvedWeekday} resolved · {day.undecided} undecided · {percent(day.purchases, resolvedWeekday)}% conversion</span></div>
                <div className="analytics-stacked-bar" aria-label={`${day.label}: ${day.purchases} purchases, ${day.noPurchase} no purchase, ${day.undecided} undecided`}>
                  <span className="analytics-stack-purchased" style={{ width: `${day.purchases / Math.max(1, day.total) * 100}%` }} />
                  <span className="analytics-stack-no-purchase" style={{ width: `${day.noPurchase / Math.max(1, day.total) * 100}%` }} />
                  <span style={{ width: `${day.undecided / Math.max(1, day.total) * 100}%`, background: "#9aa69e" }} />
                </div>
              </div>; })}
            </div>
            <div className="analytics-period-legend"><span><i className="analytics-stack-purchased" /> Purchased</span><span><i className="analytics-stack-no-purchase" /> No purchase</span><span><i style={{ background: "#9aa69e" }} /> Undecided</span></div>
          </section>
          <div className="analytics-trends-stack">
          <section hidden={!isVisible("daily-trend")} className="analytics-subpanel analytics-trend">
            <h3><CalendarDays size={16} /> Daily visit trend</h3>
            <p className="analytics-help">Each bar shows all recorded visits for that Lagos calendar date. When Include today is on, the final bar is labelled Today* to show it is still in progress. Scroll horizontally on smaller screens to see the full period.</p>
            <div className="analytics-daily-chart analytics-daily-chart-stacked" role="img" aria-label="Daily visit counts by outcome for the selected reporting period">
              {dailyStats.map((day) => (
                <div className="analytics-day" key={day.date} title={`${day.date}: ${day.total} visits, ${day.purchases} purchases, ${day.noPurchase} no purchase, ${day.undecided} undecided${day.date === today ? " · in progress" : ""}`}>
                  <span className="analytics-day-count">{day.total || ""}</span>
                  <span className="analytics-day-stack" style={{ height: `${Math.max(day.total ? 8 : 2, day.total / peak * 100)}%` }}>
                    {day.purchases > 0 && <i className="analytics-stack-purchased" style={{ height: `${day.purchases / Math.max(1, day.total) * 100}%` }} />}
                    {day.noPurchase > 0 && <i className="analytics-stack-no-purchase" style={{ height: `${day.noPurchase / Math.max(1, day.total) * 100}%` }} />}
                    {day.undecided > 0 && <i style={{ height: `${day.undecided / Math.max(1, day.total) * 100}%`, background: "#9aa69e" }} />}
                  </span>
                  <span className="analytics-day-label">{day.date === today ? "Today*" : day.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="analytics-legend analytics-trend-legend">
              {outcomeStats.map((item) => <div key={item.label}><span className="analytics-legend-dot" style={{ background: item.color }} /><span>{item.label}</span></div>)}
            </div>
          </section>
            <div className="analytics-grid analytics-secondary-trends">
              <section hidden={!isVisible("weekday-conversion")} className="analytics-subpanel analytics-chart-card">
                <h3><TrendingUp size={16} /> Purchase conversion by weekday</h3>
                <p className="analytics-help">Purchases divided by resolved visits for each weekday. Weekday averages use completed days only, with undecided visits excluded from conversion.</p>
                <div className="analytics-weekday-chart">
                  {weekdayStats.map((day) => {
                    const resolvedWeekday = day.purchases + day.noPurchase;
                    const rate = percent(day.purchases, resolvedWeekday);
                    return <div className="analytics-weekday" key={day.label} title={`${day.label}: ${rate}% conversion from ${resolvedWeekday} resolved visits across ${day.occurrences} days`}>
                      <strong>{resolvedWeekday ? `${rate}%` : "—"}</strong><span className="analytics-weekday-track conversion-track"><i style={{ height: `${Math.max(rate ? 5 : 2, rate)}%` }} /></span><small>{day.label}<br />{day.occurrences}d</small>
                    </div>;
                  })}
                </div>
              </section>
              <section hidden={!isVisible("outcome-totals")} className="analytics-subpanel analytics-chart-card">
                <h3><Users size={16} /> Outcome totals</h3>
                <p className="analytics-help">Counts and share of all recorded visits across the three tracked outcomes.</p>
                <div className="analytics-legend">
                  {outcomeStats.map((item) => <div key={item.label}><span className="analytics-legend-dot" style={{ background: item.color }} /><span>{item.label}</span><strong>{item.count.toLocaleString()}</strong><small>{percent(item.count, analysisVisits.length)}%</small></div>)}
                </div>
              </section>
            </div>
            <div hidden={!isVisible("trend-summary")} className="analytics-trend-summary">
              <span>Visits <strong>{analysisVisits.length.toLocaleString()}</strong></span>
              <span>Purchases <strong>{purchases.toLocaleString()}</strong></span>
              <span>No purchase <strong>{noPurchase.toLocaleString()}</strong></span>
              <span>Undecided <strong>{undecided.toLocaleString()}</strong></span>
            </div>
            <section hidden={!isVisible("hourly")} className="analytics-subpanel analytics-pattern-panel">
              <h3><Clock3 size={16} /> Individual record-entry times</h3>
              <p className="analytics-help">This chart shows individual record-entry times in Lagos time, not confirmed customer arrival times. Batch-entered visits are excluded because they share an insert timestamp. Entries before opening are also excluded. Closing times are not configured yet, so delayed entries may still affect the pattern.</p>
              <p className="analytics-help">Excluded from this chart: {hourlyAnalysis.batchExcluded} batch-entered records, {hourlyAnalysis.beforeOpeningExcluded} records before opening and {hourlyAnalysis.invalidTimestampExcluded} records with invalid timestamps.</p>
              <label className="analytics-hour-threshold">Show hours with at least
                <input type="text" inputMode="numeric" pattern="[0-9]*" value={minimumHourlyVisits} onChange={(event) => setMinimumHourlyVisits(event.target.value.replace(/[^0-9]/g, ""))} aria-label="Minimum visits per hour" />
                visits
              </label>
              <div className="analytics-hour-chart-scroll"><div className="analytics-hour-chart" role="group" aria-label="Individual record-entry counts by hour in Lagos time" style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleBusyHourStats.length)}, minmax(36px, 1fr))`, minWidth: `${Math.max(1, visibleBusyHourStats.length) * 36}px` }}>
                {visibleBusyHourStats.map((hour) => <div className="analytics-hour" key={hour.hour} title={hour.label + ": " + hour.total + " visits"}>
                  <strong>{hour.total.toLocaleString()}</strong><span className="analytics-hour-track"><i style={{ height: (hour.total ? Math.max(5, hour.total / maxHour * 100) : 2) + "%" }} /></span><small>{hour.label.replace(" am","a").replace(" pm","p")}</small>
                </div>)}
                {visibleBusyHourStats.length === 0 && <p className="corrections-empty">No hours reached this minimum in the selected period.</p>}
              </div></div>
              <div className="analytics-pattern-highlights">
                <div><span>Peak recorded hour</span><strong>{peakHour?.label ?? "No data"}</strong><small>{peakHour ? peakHour.total + " visits" : "No timestamped visits"}</small></div>
                <div><span>Quietest active hour</span><strong>{quietHour?.label ?? "No data"}</strong><small>{quietHour ? quietHour.total + " visits" : "No timestamped visits"}</small></div>
              </div>
            </section>
            <section hidden={!isVisible("daily-averages")} className="analytics-subpanel analytics-daily-summary">
              <h3><TrendingUp size={16} /> Daily averages &amp; peak days</h3>
              <p className="analytics-help">The average and peak-day figures use completed days with at least one recorded visit. Today is excluded because its figures may still be incomplete.</p>
              <div className="analytics-pattern-highlights">
                <div><span>Average on recorded days</span><strong>{averageDailyFootfall.toFixed(1)}</strong><small>visits per active recorded day</small></div>
                <div><span>Busiest recorded day</span><strong>{busiestDay?.date ?? "No data"}</strong><small>{busiestDay ? busiestDay.total + " visits" : "No visits in range"}</small></div>
                <div><span>Quietest recorded day</span><strong>{quietestRecordedDay?.date ?? "No data"}</strong><small>{quietestRecordedDay ? quietestRecordedDay.total + " visits" : "No visits in range"}</small></div>
              </div>
              <div className="analytics-daily-average-chart">
                {completedDailyStats.map(day => <div key={day.date} title={day.date + ": " + day.total + " visits"}><span style={{height: Math.max(day.total ? 4 : 1, day.total / Math.max(1,...completedDailyStats.map(item=>item.total))*100) + "%" }} /><small>{day.date.slice(8)}</small></div>)}
              </div>
            </section>
          </div>
        </div>
      )}

      {activeTab === "reasons" && (
        <div className="analytics-tab-content">
          <div hidden={!isVisible("reason-kpis")} className="history-summary analytics-kpis">
            <div><strong>{noPurchase.toLocaleString()}</strong><span>No-purchase visits</span></div>
            <div><strong>{noPurchase > 0 ? reasonStats.length : "—"}</strong><span>Reason categories</span></div>
            <div><strong>{reasonStats[0]?.reason ?? (noPurchase > 0 ? "Not recorded" : "No data")}</strong><span>Most frequent reason</span><small>{reasonStats[0] ? reasonStats[0].count + " visits" : noPurchase > 0 ? "No reason values saved" : "No no-purchase visits"}</small></div>
          </div>
          <section hidden={!isVisible("reason-breakdown")} className="analytics-subpanel analytics-reasons-panel">
            <h3><Search size={16} /> No-purchase reasons</h3>
            <p className="analytics-help">Counts and percentages are based on no-purchase visits in the selected period. Blank reasons are grouped as Other / Unknown.</p>
            {noPurchase === 0 && <p className="corrections-empty">No no-purchase visits were recorded in this period, so there are no reason metrics to summarise.</p>}
            {reasonStats.length === 0 && noPurchase > 0 && <p className="corrections-empty">No reasons were saved for the no-purchase visits in this period.</p>}
            {reasonStats.length > 0 && reasonStats.map((item, index) => {
              const colors = ["#e27b48", "#7b83d8", "#2395a8", "#c85e91", "#7b9b45", "#ba8a38"];
              return <div className="analytics-reason-row" key={item.reason}>
                <div className="analytics-row-label"><strong>{item.reason}</strong><span>{item.count.toLocaleString()} · {percent(item.count, noPurchase)}%</span></div>
                <div className="progress-track"><span className="analytics-reason-fill" style={{ width: `${item.count / Math.max(1, noPurchase) * 100}%`, background: colors[index % colors.length] }} /></div>
              </div>;
            })}
          </section>
          <section hidden={!isVisible("reason-branches")} className="analytics-subpanel analytics-reason-branch-panel">
            <h3><GitCompare size={16} /> Reasons by branch</h3>
            <p className="analytics-help">See which reasons are being recorded at each branch. Counts reflect no-purchase visits within the selected date range.</p>
            <div className="analytics-reason-branch-grid">
              {reasonBranchStats.map((branch) => <article className="analytics-reason-branch-card" key={branch.id}>
                <div className="analytics-row-label"><strong>{branch.name}</strong><span>{branch.total} no-purchase visits · {percent(branch.total, noPurchase)}% of all no-purchase visits</span></div>
                <div className="analytics-row-meta"><span>{branch.reasons.length} reason categories</span><span>Top reason: {branch.reasons[0]?.reason ?? "None recorded"}</span></div>
                {branch.reasons.length === 0 ? <p className="corrections-empty">No reasons recorded.</p> : (expandedReasonBranches[branch.id] ? branch.reasons : branch.reasons.slice(0, 5)).map((item, index) => {
                  const colors = ["#e27b48", "#7b83d8", "#2395a8", "#c85e91", "#7b9b45", "#ba8a38"];
                  return <div className="analytics-reason-branch-row" key={item.reason}>
                    <div className="analytics-row-label"><span>{item.reason}</span><strong>{item.count} · {percent(item.count, branch.total)}%</strong></div>
                    <div className="progress-track"><span style={{ width: `${item.count / Math.max(1, branch.total) * 100}%`, background: colors[index % colors.length] }} /></div>
                  </div>;
                })}
                {branch.reasons.length > 5 && <button type="button" className="text-button analytics-expand-button" aria-expanded={Boolean(expandedReasonBranches[branch.id])} onClick={() => setExpandedReasonBranches((current) => ({ ...current, [branch.id]: !current[branch.id] }))}>{expandedReasonBranches[branch.id] ? "Show top 5 reasons" : `Show all ${branch.reasons.length} reasons`}</button>}
              </article>)}
            </div>
          </section>
        </div>
      )}
      <div className="analytics-export-bottom">
        <button type="button" className="analytics-export-button" onClick={downloadAnalysisPdf} disabled={loading || Boolean(error)}><Download size={15} /> Export current view to PDF</button>
      </div>
      <p className="history-footnote">Analytics use saved visit records only. This view does not edit, move, or delete data.</p>
      <p className="analytics-hours-note"><Clock3 size={12} /> Opening hours: Mon–Sat 8:00 AM · Sunday 2:00 PM. Hourly charts exclude pre-opening records; daily totals remain unchanged.</p>
    </section>
  );
}
