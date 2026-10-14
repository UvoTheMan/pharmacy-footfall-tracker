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

type Props = { branches: Branch[]; profile: Profile; userId: string };

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

export default function UnavailableItems({ branches, profile, userId }: Props) {
  const [items, setItems] = useState<UnavailableItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [fromDate, setFromDate] = useState(dateMinusDays(89));
  const [toDate, setToDate] = useState(todayKey());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<UnavailableItem | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const loadItems = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    const earliest = dateMinusDays(89);
    const latest = todayKey();
    const safeFrom = fromDate < earliest ? earliest : fromDate;
    const safeTo = toDate > latest ? latest : toDate;
    if (safeFrom > safeTo) {
      setItems([]);
      setError("Choose a valid date range within the last 90 days.");
      setLoading(false);
      return;
    }
    const result = await supabase
      .from("unavailable_items")
      .select("id,visit_id,branch_id,item_name,reported_on,recorded_at,created_by,status,image_path,branches(name)")
      .gte("reported_on", safeFrom)
      .lte("reported_on", safeTo)
      .order("reported_on", { ascending: false })
      .order("recorded_at", { ascending: false });
    if (result.error) {
      setError("Could not load unavailable items: " + result.error.message);
    } else {
      const records = (result.data ?? []) as unknown as UnavailableItem[];
      const paths = records.flatMap((item) => item.image_path ? [item.image_path] : []);
      let photoUrls = new Map<string, string>();
      if (paths.length) {
        const signed = await supabase.storage.from("unavailable-item-photos").createSignedUrls(paths, 3600);
        if (signed.error) setError("Reports loaded, but some photos could not be opened: " + signed.error.message);
        else photoUrls = new Map((signed.data ?? []).flatMap((entry) => entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as [string, string]] : []));
      }
      setItems(records.map((item) => ({ ...item, photo_url: item.image_path ? photoUrls.get(item.image_path) : undefined })));
    }
    setLoading(false);
  }, [fromDate, toDate]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  const filteredItems = useMemo(() => items.filter((item) => {
    const matchesName = !appliedSearch || item.item_name.toLowerCase().includes(appliedSearch.toLowerCase());
    const matchesBranch = branchFilter === "all" || item.branch_id === branchFilter;
    return matchesName && matchesBranch;
  }), [items, appliedSearch, branchFilter]);

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editing) return;
    const cleanName = editName.trim();
    if (!cleanName || cleanName.length > 180) {
      setError("Enter an item name between 1 and 180 characters.");
      return;
    }
    setSaving(true);
    setError("");
    const result = await supabase.from("unavailable_items")
      .update({ item_name: cleanName })
      .eq("id", editing.id);
    if (result.error) {
      setError("Could not correct this report: " + result.error.message);
      setSaving(false);
      return;
    }
    setEditing(null);
    setSaving(false);
    setNotice("Unavailable-item report corrected.");
    await loadItems();
  }

  async function updateStatus(item: UnavailableItem, status: UnavailableItem["status"]) {
    if (!supabase || profile.role !== "admin") return;
    setError("");
    const result = await supabase.from("unavailable_items").update({ status }).eq("id", item.id);
    if (result.error) setError("Could not update assessment status: " + result.error.message);
    else {
      setNotice("Assessment status updated.");
      await loadItems();
    }
  }

  function exportCsv() {
    const columns = ["Product name", "Branch", "Unavailable date", "Reported time", "Assessment status", "Photo attached"];
    const escapeCell = (value: string) => {
      // Prevent spreadsheet formulas from running when the CSV is opened.
      const safe = /^[=+@\\-\\t\\r]/.test(value) ? "'" + value : value;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const rows = filteredItems.map((item) => [
      item.item_name,
      item.branches?.name ?? branches.find((branch) => branch.id === item.branch_id)?.name ?? "Branch unavailable",
      item.reported_on,
      new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(item.recorded_at)),
      item.status === "pending" ? "Pending assessment" : item.status === "reviewed" ? "Reviewed" : "Resolved",
      item.image_path ? "Yes" : "No",
    ]);
    const csv = "\\uFEFF" + [columns, ...rows].map((row) => row.map((cell) => escapeCell(String(cell ?? ""))).join(",")).join("\\r\\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `footlytics-unavailable-items-${todayKey()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${filteredItems.length} unavailable-item report${filteredItems.length === 1 ? "" : "s"} as CSV.`);
  }

  const ownReport = (item: UnavailableItem) => item.created_by === userId;

  return (
    <section className="panel unavailable-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">STOCK GAP MONITORING</p><h2>Unavailable items</h2></div>
        <span className="date-pill">Last 90 days</span>
      </div>
      <p className="panel-description">Search shared reports from every branch. Each row represents one customer visit, so repeat requests remain visible as separate records.</p>
      {notice && <div className="notice" role="status"><Check size={15} />{notice}</div>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <form className="unavailable-search" onSubmit={(event) => { event.preventDefault(); setAppliedSearch(searchInput.trim()); }}>
        <label className="history-date-field unavailable-search-name"><span><Search size={14} /> Search item name</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="e.g. Amoxicillin 500 mg" /></label>
        <label className="history-date-field"><span>Branch</span><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="history-date-field"><span><CalendarDays size={14} /> From date</span><input type="date" min={dateMinusDays(89)} max={todayKey()} value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label className="history-date-field"><span>To date</span><input type="date" min={dateMinusDays(89)} max={todayKey()} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <button className="primary-button unavailable-search-button" type="submit"><Search size={15} /> Search records</button>
      </form>
      <div className="history-toolbar"><span>{loading ? "Loading records…" : `${filteredItems.length} report${filteredItems.length === 1 ? "" : "s"} found`}</span><div><button className="secondary-button" type="button" onClick={exportCsv} disabled={loading || filteredItems.length === 0}><Download size={14} /> Export CSV</button><button className="secondary-button" type="button" onClick={() => { setSearchInput(""); setAppliedSearch(""); setBranchFilter("all"); setFromDate(dateMinusDays(89)); setToDate(todayKey()); }}>Reset filters</button></div></div>
      {filteredItems.length === 0 && !loading ? <div className="corrections-empty">No unavailable-item reports match these filters.</div> : (
        <div className="unavailable-record-list">
          {filteredItems.map((item) => (
            <article className="unavailable-record" key={item.id}>
              {item.photo_url && <a className="unavailable-record-photo" href={item.photo_url} target="_blank" rel="noreferrer"><img src={item.photo_url} alt={`Photo of ${item.item_name}`} loading="lazy" /></a>}
              <div className="unavailable-record-main">
                <div className="unavailable-record-title"><strong>{item.item_name}</strong><span className={`unavailable-status ${item.status}`}>{item.status === "pending" ? "Pending assessment" : item.status === "reviewed" ? "Reviewed" : "Resolved"}</span></div>
                <div className="unavailable-record-meta"><span>{item.branches?.name ?? branches.find((branch) => branch.id === item.branch_id)?.name ?? "Branch unavailable"}</span><span>Unavailable on {displayDate(item.reported_on)}</span><span>Reported {new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(new Date(item.recorded_at))}</span></div>
              </div>
              <div className="unavailable-record-actions">
                {(ownReport(item) || profile.role === "admin") && <button className="correction-edit" type="button" onClick={() => { setEditing(item); setEditName(item.item_name); setError(""); }}><Edit3 size={13} /> Correct</button>}
                {profile.role === "admin" && <label className="unavailable-status-control"><span className="sr-only">Assessment status</span><select value={item.status} onChange={(event) => void updateStatus(item, event.target.value as UnavailableItem["status"])}><option value="pending">Pending assessment</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option></select></label>}
              </div>
            </article>
          ))}
        </div>
      )}
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
