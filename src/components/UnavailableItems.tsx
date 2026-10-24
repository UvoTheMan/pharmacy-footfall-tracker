import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Download, Edit3, Search, X } from "lucide-react";
import { supabase } from "../lib/supabase";

type Branch = { id: string; name: string };
type Profile = { user_id: string; role: "staff" | "admin"; active: boolean };
type UnavailableItem = {
  id: string;
  visit_id: string;
  branch_id: string;
  item_name: string;
  reported_on: string;
  recorded_at: string;
  created_by: string;
  status: "pending" | "reviewed" | "resolved";
  image_path: string | null;
  photo_url?: string;
  branches?: { name: string } | null;
};

type Props = { branches: Branch[]; profile: Profile; userId: string; activeBranchId: string | null };

const dateKey = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const todayKey = () => dateKey(new Date());

function dateMinusDays(days: number) {
  const today = todayKey().split("-").map(Number);
  const date = new Date(Date.UTC(today[0], today[1] - 1, today[2] - days, 12));
  return dateKey(date);
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(value + "T12:00:00"));
}

export default function UnavailableItems({ branches, profile, userId, activeBranchId }: Props) {
  const [items, setItems] = useState<UnavailableItem[]>([]);
  const [registerBranches, setRegisterBranches] = useState<Branch[]>(branches);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState(profile.role === "admin" ? "all" : activeBranchId ?? "");
  const [statusFilter, setStatusFilter] = useState<"all" | UnavailableItem["status"]>("all");
  const [visibleItemCount, setVisibleItemCount] = useState(10);
  const [fromDate, setFromDate] = useState(dateMinusDays(89));
  const [toDate, setToDate] = useState(todayKey());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<UnavailableItem | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [exportFromDate, setExportFromDate] = useState(dateMinusDays(29));
  const [exportToDate, setExportToDate] = useState(todayKey());

  useEffect(() => {
    let cancelled = false;
    async function loadBranchLabels() {
      if (!supabase) {
        setRegisterBranches(branches);
        return;
      }
      const result = await supabase.rpc("list_active_branch_labels");
      if (cancelled) return;
      setRegisterBranches(!result.error && result.data?.length
        ? result.data as Branch[]
        : branches);
    }
    void loadBranchLabels();
    return () => { cancelled = true; };
  }, [branches]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setBranchFilter(profile.role === "admin" ? "all" : activeBranchId ?? "");
    setSelectedIds(new Set());
  }, [profile.role, activeBranchId]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!supabase) {
      setError("The database connection is unavailable. Please try opening the register again.");
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const earliest = dateMinusDays(89);
      const latest = todayKey();
      const safeFrom = fromDate < earliest ? earliest : fromDate;
      const safeTo = toDate > latest ? latest : toDate;
      if (safeFrom > safeTo) {
        setItems([]);
        setError("Choose a valid date range within the last 90 days.");
        return;
      }
      const records: UnavailableItem[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        let query = supabase
          .from("unavailable_items")
          .select("id,visit_id,branch_id,item_name,reported_on,recorded_at,created_by,status,image_path,branches(name)")
          .gte("reported_on", safeFrom)
          .lte("reported_on", safeTo);
        if (profile.role !== "admin") query = query.eq("branch_id", activeBranchId!);
        const result = await query
          .order("reported_on", { ascending: false })
          .order("recorded_at", { ascending: false })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (result.error) {
          setItems([]);
          setError("Could not load unavailable items: " + result.error.message);
          return;
        }
        const page = (result.data ?? []) as unknown as UnavailableItem[];
        records.push(...page);
        if (page.length < pageSize) break;
      }
      const paths = records.flatMap((item) => item.image_path ? [item.image_path] : []);
      const photoUrls = new Map<string, string>();
      for (let index = 0; index < paths.length; index += 100) {
        const signed = await supabase.storage.from("unavailable-item-photos").createSignedUrls(paths.slice(index, index + 100), 3600);
        if (signed.error) {
          setError("Reports loaded, but some photos could not be opened: " + signed.error.message);
          continue;
        }
        for (const entry of signed.data ?? []) {
          if (entry.path && entry.signedUrl) photoUrls.set(entry.path, entry.signedUrl);
        }
      }
      setItems(records.map((item) => ({ ...item, photo_url: item.image_path ? photoUrls.get(item.image_path) : undefined })));
    } catch {
      setItems([]);
      setError("The unavailable-items register could not be restored. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, profile.role, activeBranchId]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      // Mobile Chrome can emit both visibilitychange and focus when returning
      // to a suspended tab. Coalesce them into one data refresh.
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void loadItems();
      }, 200);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    const recoverFromBrowserRestore = (event: PageTransitionEvent) => {
      // Refresh the register after a back-forward-cache restore without
      // reloading the entire app and forcing authentication/workspace startup.
      if (event.persisted) scheduleRefresh();
    };
    void loadItems();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", recoverFromBrowserRestore);
    return () => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("pageshow", recoverFromBrowserRestore);
    };
  }, [loadItems]);

  const filteredItems = useMemo(() => items.filter((item) => {
    const matchesName = !appliedSearch || item.item_name.toLowerCase().includes(appliedSearch.toLowerCase());
    const matchesBranch = profile.role === "admin" ? branchFilter === "all" || item.branch_id === branchFilter : item.branch_id === activeBranchId;
    const matchesStatus = profile.role !== "admin" || statusFilter === "all" || item.status === statusFilter;
    return matchesName && matchesBranch && matchesStatus;
  }), [items, appliedSearch, branchFilter, profile.role, statusFilter, activeBranchId]);

  useEffect(() => {
    setVisibleItemCount(10);
  }, [filteredItems]);

  const visibleItems = filteredItems.slice(0, visibleItemCount);

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editing) return;
    const cleanName = editName.trim();
    if (!cleanName || cleanName.length > 180) {
      setError("Enter an item name between 1 and 180 characters.");
      return;
    }
    const statusWillReset = profile.role !== "admin" && editing.status !== "pending" && cleanName !== editing.item_name;
    setSaving(true);
    setError("");
    const result = await supabase.from("unavailable_items")
      .update({ item_name: cleanName })
      .eq("id", editing.id)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      setError("Could not correct this report: " + (result.error?.message ?? "The report was not updated. Check your access and refresh the register."));
      setSaving(false);
      return;
    }
    setEditing(null);
    setSaving(false);
    setNotice(statusWillReset
      ? "Report corrected and returned to Pending assessment for admin review."
      : "Unavailable-item report corrected.");
    await loadItems();
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function toggleAllFiltered(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      filteredItems.forEach((item) => checked ? next.add(item.id) : next.delete(item.id));
      return next;
    });
  }

  async function bulkUpdateStatus(status: "reviewed" | "resolved") {
    if (!supabase || profile.role !== "admin" || selectedIds.size === 0) return;
    const visibleSelected = filteredItems.filter((item) => selectedIds.has(item.id));
    if (!visibleSelected.length) {
      setSelectedIds(new Set());
      return;
    }
    setBulkSaving(true);
    setError("");
    setNotice("");
    const result = await supabase.from("unavailable_items")
      .update({ status })
      .in("id", visibleSelected.map((item) => item.id))
      .select("id");
    if (result.error) {
      setError("Could not update selected reports: " + result.error.message);
    } else if ((result.data ?? []).length !== visibleSelected.length) {
      setError("Not all selected reports were updated. Refresh the register and check your permissions.");
      await loadItems();
    } else {
      setNotice(`${visibleSelected.length} report${visibleSelected.length === 1 ? "" : "s"} marked ${status}.`);
      setSelectedIds((current) => {
        const next = new Set(current);
        visibleSelected.forEach((item) => next.delete(item.id));
        return next;
      });
      await loadItems();
    }
    setBulkSaving(false);
  }

  async function updateStatus(item: UnavailableItem, status: UnavailableItem["status"]) {
    if (!supabase || profile.role !== "admin") return;
    setError("");
    const result = await supabase.from("unavailable_items")
      .update({ status })
      .eq("id", item.id)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      setError("Could not update assessment status: " + (result.error?.message ?? "The report was not updated. Refresh the register and check your permissions."));
    } else {
      setNotice("Assessment status updated.");
      await loadItems();
    }
  }

  async function exportCsv() {
    if (!supabase || exporting) return;
    if (!exportFromDate || !exportToDate || exportFromDate > exportToDate) {
      setError("Choose a valid export date range. The From date must be on or before the To date.");
      return;
    }
    if (exportToDate > todayKey()) {
      setError("The export To date cannot be in the future.");
      return;
    }

    setExporting(true);
    setError("");
    setNotice("");
    try {
      const exportRows: UnavailableItem[] = [];
      const pageSize = 1000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from("unavailable_items")
          .select("id,visit_id,branch_id,item_name,reported_on,recorded_at,created_by,status,image_path,branches(name)")
          .gte("reported_on", exportFromDate)
          .lte("reported_on", exportToDate)
          .order("reported_on", { ascending: false })
          .order("recorded_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (profile.role !== "admin") query = query.eq("branch_id", activeBranchId!);
        else if (branchFilter !== "all") query = query.eq("branch_id", branchFilter);
        if (appliedSearch) query = query.ilike("item_name", `%${appliedSearch.replace(/[\\%_]/g, "\\$&")}%`);
        const result = await query;
        if (result.error) throw result.error;
        const page = (result.data ?? []) as unknown as UnavailableItem[];
        exportRows.push(...page);
        hasMore = page.length === pageSize;
        offset += page.length;
      }

      if (exportRows.length === 0) {
        setNotice("No unavailable-item reports were found for that export date range and the selected filters.");
        return;
      }

      const columns = ["Product name", "Branch", "Unavailable date", "Reported time", "Assessment status", "Photo attached"];
      const escapeCell = (value: string) => {
        // Prevent spreadsheet formulas from running when the CSV is opened.
        const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
        return '"' + safe.replace(/"/g, '""') + '"';
      };
      const rows = exportRows.map((item) => [
        item.item_name,
        item.branches?.name ?? registerBranches.find((branch) => branch.id === item.branch_id)?.name ?? "Branch unavailable",
        item.reported_on,
        new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(item.recorded_at)),
        item.status === "pending" ? "Pending assessment" : item.status === "reviewed" ? "Reviewed" : "Resolved",
        item.image_path ? "Yes" : "No",
      ]);
      const csv = "\uFEFF" + [columns, ...rows].map((row) => row.map((cell) => escapeCell(String(cell ?? ""))).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `footlytics-unavailable-items-${exportFromDate}-to-${exportToDate}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Exported ${exportRows.length} unavailable-item report${exportRows.length === 1 ? "" : "s"} for ${exportFromDate} to ${exportToDate} as CSV.`);
    } catch (exportError) {
      setError("Could not export unavailable-item reports: " + (exportError instanceof Error ? exportError.message : "Please try again."));
    } finally {
      setExporting(false);
    }
  }

  const ownReport = (item: UnavailableItem) => item.created_by === userId;

  return (
    <section className="panel unavailable-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">STOCK GAP MONITORING</p><h2>Unavailable items</h2></div>
        <span className="date-pill">Last 90 days</span>
      </div>
      <p className="panel-description">{profile.role === "admin" ? "Review unavailable-item reports across all branches or narrow the register to one branch. Each row represents one customer visit." : "Showing unavailable-item reports for your active branch only. Each row represents one customer visit."}</p>
      {notice && <div className="notice" role="status"><Check size={15} />{notice}</div>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <form className="unavailable-search" onSubmit={(event) => { event.preventDefault(); setAppliedSearch(searchInput.trim()); }}>
        <label className="history-date-field unavailable-search-name"><span><Search size={14} /> Search item name</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="e.g. Amoxicillin 500 mg" /></label>
        {profile.role === "admin" ? <label className="history-date-field"><span>Branch</span><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">All branches</option>{registerBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : <div className="history-date-field"><span>Active branch</span><strong>{branches.find((item) => item.id === activeBranchId)?.name ?? "No branch selected"}</strong></div>}
        <label className="history-date-field"><span><CalendarDays size={14} /> From date</span><input type="date" min={dateMinusDays(89)} max={todayKey()} value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label className="history-date-field"><span>To date</span><input type="date" min={dateMinusDays(89)} max={todayKey()} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button className="primary-button unavailable-search-button" type="submit"><Search size={15} /> Search records</button>
      </form>
      <div className="history-toolbar"><span>Quick date range</span><div>
        <button className="secondary-button" type="button" onClick={() => { setFromDate(dateMinusDays(6)); setToDate(todayKey()); }}>Last 7 days</button>
        <button className="secondary-button" type="button" onClick={() => { setFromDate(dateMinusDays(29)); setToDate(todayKey()); }}>Last 30 days</button>
      </div></div>
      <div className="history-toolbar"><span>{loading ? "Loading records…" : `${filteredItems.length} report${filteredItems.length === 1 ? "" : "s"} found`}</span><div><button className="secondary-button" type="button" onClick={() => { setSearchInput(""); setAppliedSearch(""); setBranchFilter(profile.role === "admin" ? "all" : activeBranchId ?? ""); setStatusFilter("all"); setFromDate(dateMinusDays(89)); setToDate(todayKey()); setSelectedIds(new Set()); }}>Reset filters</button></div></div>
      {profile.role === "admin" && <div className="unavailable-status-filter-row"><label className="history-date-field"><span>Assessment status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">All statuses</option><option value="pending">Pending assessment</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option></select></label><span className="unavailable-filter-note">Applies to the selected date range and branch/item filters.</span></div>}
      {profile.role === "admin" && filteredItems.length > 0 && <div className="unavailable-bulk-toolbar">
        <label className="unavailable-select-all"><input type="checkbox" checked={filteredItems.every((item) => selectedIds.has(item.id))} onChange={(event) => toggleAllFiltered(event.target.checked)} aria-label="Select all filtered unavailable-item reports" /> <span>Select all shown</span></label>
        <span className="unavailable-selected-count">{filteredItems.filter((item) => selectedIds.has(item.id)).length} selected</span>
        <div className="unavailable-bulk-actions"><button className="secondary-button" type="button" disabled={bulkSaving || !filteredItems.some((item) => selectedIds.has(item.id))} onClick={() => void bulkUpdateStatus("reviewed")}>{bulkSaving ? "Updating…" : "Mark reviewed"}</button><button className="secondary-button" type="button" disabled={bulkSaving || !filteredItems.some((item) => selectedIds.has(item.id))} onClick={() => void bulkUpdateStatus("resolved")}>{bulkSaving ? "Updating…" : "Mark resolved"}</button><button className="unavailable-clear-selection" type="button" disabled={bulkSaving || selectedIds.size === 0} onClick={() => setSelectedIds(new Set())}>Clear</button></div>
      </div>}
      {filteredItems.length === 0 && !loading ? <div className="corrections-empty">No unavailable-item reports match these filters.</div> : (
        <div className="unavailable-record-list">
          {visibleItems.map((item) => (
            <article className={`unavailable-record${profile.role === "admin" && selectedIds.has(item.id) ? " selected" : ""}`} key={item.id}>
              {profile.role === "admin" && <label className="unavailable-record-select"><input type="checkbox" checked={selectedIds.has(item.id)} onChange={(event) => toggleSelected(item.id, event.target.checked)} aria-label={`Select ${item.item_name}`} /></label>}
              {item.photo_url && <a className="unavailable-record-photo" href={item.photo_url} target="_blank" rel="noreferrer"><img src={item.photo_url} alt={`Photo of ${item.item_name}`} loading="lazy" /></a>}
              <div className="unavailable-record-main">
                <div className="unavailable-record-title"><strong>{item.item_name}</strong><span className={`unavailable-status ${item.status}`}>{item.status === "pending" ? "Pending assessment" : item.status === "reviewed" ? "Reviewed" : "Resolved"}</span></div>
                <div className="unavailable-record-meta"><span>{item.branches?.name ?? registerBranches.find((branch) => branch.id === item.branch_id)?.name ?? "Branch unavailable"}</span><span>Unavailable on {displayDate(item.reported_on)}</span><span>Reported {new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(new Date(item.recorded_at))}</span></div>
              </div>
              <div className="unavailable-record-actions">
                {(ownReport(item) || profile.role === "admin") && <button className="correction-edit" type="button" onClick={() => { setEditing(item); setEditName(item.item_name); setError(""); }}><Edit3 size={13} /> Correct</button>}
                {profile.role === "admin" && <label className="unavailable-status-control"><span className="sr-only">Assessment status</span><select value={item.status} onChange={(event) => void updateStatus(item, event.target.value as UnavailableItem["status"])}><option value="pending">Pending assessment</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option></select></label>}
              </div>
            </article>
          ))}
        </div>
      )}
      {filteredItems.length > 10 && (
        <div className="history-toolbar unavailable-pagination">
          <span>Showing {Math.min(visibleItems.length, filteredItems.length)} of {filteredItems.length} reports</span>
          <div>
            {visibleItemCount < filteredItems.length && <button className="secondary-button" type="button" onClick={() => setVisibleItemCount((count) => Math.min(count + 10, filteredItems.length))}>Show more</button>}
            {visibleItemCount > 10 && <button className="secondary-button" type="button" onClick={() => setVisibleItemCount(10)}>Show less</button>}
          </div>
        </div>
      )}
      <details className="admin-record-rollup unavailable-export-rollup">
        <summary><span className="admin-record-rollup-title"><span className="eyebrow">CSV EXPORT</span><strong>Export unavailable-item reports</strong><small>Choose a separate date range for the CSV export.</small></span><span className="admin-record-rollup-meta">{exportFromDate && exportToDate ? `${exportFromDate} → ${exportToDate}` : "Choose dates"} <Download size={15} /></span></summary>
        <div className="admin-record-rollup-content">
          <p className="panel-description">Choose the reporting period for this export. The date range is independent of the records currently shown above, and can include older reports. Branch and item-name filters still apply.</p>
          <div className="unavailable-search">
            <label className="history-date-field"><span><CalendarDays size={14} /> Export from</span><input type="date" max={todayKey()} value={exportFromDate} onChange={(event) => setExportFromDate(event.target.value)} /></label>
            <label className="history-date-field"><span>Export to</span><input type="date" max={todayKey()} value={exportToDate} onChange={(event) => setExportToDate(event.target.value)} /></label>
          </div>
          <div className="history-toolbar">
            <span>{exportFromDate && exportToDate && exportFromDate <= exportToDate ? `Export period: ${exportFromDate} to ${exportToDate}` : "Choose a valid date range"}</span>
            <button className="secondary-button" type="button" onClick={() => { setExportFromDate(dateMinusDays(29)); setExportToDate(todayKey()); }} disabled={exporting}>Last 30 days</button>
          </div>
          <button className="secondary-button" type="button" onClick={() => void exportCsv()} disabled={exporting || !exportFromDate || !exportToDate || exportFromDate > exportToDate || exportToDate > todayKey()}><Download size={14} /> {exporting ? "Preparing CSV…" : "Export CSV"}</button>
        </div>
      </details>
      <p className="history-footnote">The list shows up to 90 days of records, including today. Older reports remain stored for future analysis and aren't deleted by this filter.</p>
      {editing && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-unavailable-title" onSubmit={saveEdit}>
            <button className="modal-close" type="button" disabled={saving} aria-label="Close correction" onClick={() => setEditing(null)}><X size={19} /></button>
            <p className="eyebrow">CORRECT REPORT</p><h2 id="edit-unavailable-title">Correct unavailable item</h2>
            <p className="modal-description">Only the product name can be changed by staff. Reports cannot be deleted.</p>
            <label className="field-label" htmlFor="edit-unavailable-name">Product name <span>Required</span></label>
            <input className="number-input" id="edit-unavailable-name" maxLength={180} required value={editName} onChange={(event) => setEditName(event.target.value)} />
            <button className="primary-button" type="submit" disabled={saving || !editName.trim()}>{saving ? "Saving…" : "Save correction"} <span>→</span></button>
          </form>
        </div>
      )}
    </section>
  );
}
