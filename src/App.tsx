import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronDown,
  CircleHelp, Clock3, RotateCcw, ShoppingBag, Users, X,
} from "lucide-react";

const BRANCHES = ["Gbagada", "Akoka", "Sangotedo"] as const;
type Branch = (typeof BRANCHES)[number];
type Outcome = "purchased" | "not_purchased" | "undecided";
type Reason =
  | "Item unavailable"
  | "Price too high"
  | "Only enquiring"
  | "Preferred brand unavailable"
  | "Customer changed mind"
  | "Will buy later"
  | "Other / Unknown";

type Visit = {
  id: string;
  branch: Branch;
  date: string;
  recordedAt: string;
  outcome: Outcome;
  reason?: Reason;
};

const REASONS: Reason[] = [
  "Item unavailable",
  "Price too high",
  "Only enquiring",
  "Preferred brand unavailable",
  "Customer changed mind",
  "Will buy later",
  "Other / Unknown",
];

function lagosDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function lagosDisplayDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function loadVisits(): Visit[] {
  try {
    const raw = localStorage.getItem("pft.visits.v1");
    return raw ? (JSON.parse(raw) as Visit[]) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const today = lagosDateKey();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [visits, setVisits] = useState<Visit[]>(loadVisits);
  const [branchChoice, setBranchChoice] = useState<Branch | "">("");
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [batchCount, setBatchCount] = useState("5");
  const [batchOutcome, setBatchOutcome] = useState<Outcome>("purchased");
  const [reason, setReason] = useState<Reason | "">("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const savedDay = localStorage.getItem("pft.selected-day");
    const savedBranch = localStorage.getItem("pft.selected-branch") as Branch | null;
    if (savedDay === today && savedBranch && BRANCHES.includes(savedBranch)) {
      setBranch(savedBranch);
      setBranchChoice(savedBranch);
    } else {
      setShowBranchPicker(true);
      setBranchChoice("");
    }
  }, [today]);

  useEffect(() => {
    localStorage.setItem("pft.visits.v1", JSON.stringify(visits));
  }, [visits]);

  const todaysVisits = useMemo(
    () => visits.filter((visit) => visit.branch === branch && visit.date === today),
    [visits, branch, today],
  );
  const purchasers = todaysVisits.filter((visit) => visit.outcome === "purchased").length;
  const nonPurchasers = todaysVisits.filter((visit) => visit.outcome === "not_purchased").length;
  const undecided = todaysVisits.filter((visit) => visit.outcome === "undecided").length;
  const total = todaysVisits.length;
  const conversion = total - undecided > 0
    ? Math.round((purchasers / (total - undecided)) * 100)
    : null;

  function chooseBranch() {
    if (!branchChoice) return;
    setBranch(branchChoice);
    localStorage.setItem("pft.selected-branch", branchChoice);
    localStorage.setItem("pft.selected-day", today);
    setShowBranchPicker(false);
    setNotice(`Today's branch is set to ${branchChoice}.`);
    window.setTimeout(() => setNotice(""), 2800);
  }

  function addVisits(outcome: Outcome, count = 1, visitReason?: Reason) {
    if (!branch) {
      setShowBranchPicker(true);
      return;
    }
    const now = new Date();
    const newVisits = Array.from({ length: count }, () => ({
      id: crypto.randomUUID(),
      branch,
      date: lagosDateKey(now),
      recordedAt: now.toISOString(),
      outcome,
      ...(visitReason ? { reason: visitReason } : {}),
    } satisfies Visit));
    setVisits((current) => [...current, ...newVisits]);
    setReason("");
    setShowBatch(false);
    setNotice(count === 1 ? "Visit added on this device." : `${count} visits added on this device.`);
    window.setTimeout(() => setNotice(""), 2800);
  }

  function undoLastVisit() {
    const last = [...todaysVisits].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    if (!last) return;
    setVisits((current) => current.filter((visit) => visit.id !== last.id));
    setNotice("Last visit removed from this device.");
    window.setTimeout(() => setNotice(""), 2800);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Pharmacy Footfall Tracker home">
          <span className="brand-mark"><Activity size={21} strokeWidth={2.4} /></span>
          <span className="brand-copy"><strong>Footfall</strong><small>PHARMACY TRACKER</small></span>
        </a>
        <div className="local-time"><span className="live-dot" /> Lagos time <Clock3 size={14} /></div>
      </header>

      <section className="welcome">
        <div>
          <p className="eyebrow">DAILY OPERATIONS</p>
          <h1>Good morning, team.</h1>
          <p className="date-line"><CalendarDays size={16} /> {lagosDisplayDate()}</p>
        </div>
        <button className="branch-switch" onClick={() => { setBranchChoice(branch ?? ""); setShowBranchPicker(true); }}>
          <span className="branch-icon"><Users size={17} /></span>
          <span><small>ACTIVE BRANCH</small><strong>{branch ?? "Choose branch"}</strong></span>
          <ChevronDown size={16} />
        </button>
      </section>

      {notice && <div className="notice" role="status"><Check size={16} />{notice}</div>}

      <section className="stats-grid" aria-label="Today's totals">
        <article className="stat-card stat-primary">
          <div className="stat-top"><span>Total visits</span><span className="stat-icon"><Users size={18} /></span></div>
          <strong className="stat-number">{total}</strong>
          <span className="stat-foot">Recorded today</span>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>Purchases</span><span className="stat-icon green"><ShoppingBag size={18} /></span></div>
          <strong className="stat-number">{purchasers}</strong>
          <span className="stat-foot positive"><ArrowUpRight size={14} /> Completed sales</span>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>No purchase</span><span className="stat-icon amber"><ArrowDownRight size={18} /></span></div>
          <strong className="stat-number">{nonPurchasers}</strong>
          <span className="stat-foot">Visit without a sale</span>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>Conversion</span><span className="stat-icon blue"><Activity size={18} /></span></div>
          <strong className="stat-number">{conversion === null ? "—" : `${conversion}%`}</strong>
          <span className="stat-foot">{undecided} undecided {undecided === 1 ? "visit" : "visits"}</span>
        </article>
      </section>

      <div className="content-grid">
        <section className="panel counter-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">QUICK ENTRY</p><h2>Record a visit</h2></div>
            <span className="heading-chip"><span className="live-dot" /> Ready</span>
          </div>
          <p className="panel-description">Choose the outcome for the person who just visited the pharmacy.</p>

          <div className="outcome-list">
            <button className="outcome-button purchased" onClick={() => addVisits("purchased")} disabled={!branch}>
              <span className="outcome-symbol"><Check size={21} /></span>
              <span className="outcome-text"><strong>Made a purchase</strong><small>Customer bought an item</small></span>
              <span className="outcome-plus">+</span>
            </button>
            <button className="outcome-button not-purchased" onClick={() => addVisits("not_purchased", 1, reason || undefined)} disabled={!branch}>
              <span className="outcome-symbol"><X size={21} /></span>
              <span className="outcome-text"><strong>No purchase</strong><small>Customer left without buying</small></span>
              <span className="outcome-plus">+</span>
            </button>
            <button className="outcome-button undecided" onClick={() => addVisits("undecided")} disabled={!branch}>
              <span className="outcome-symbol"><CircleHelp size={21} /></span>
              <span className="outcome-text"><strong>Still enquiring</strong><small>Outcome not confirmed</small></span>
              <span className="outcome-plus">+</span>
            </button>
          </div>

          <label className="field-label" htmlFor="reason">Reason for no purchase <span>Optional</span></label>
          <div className="select-wrap">
            <select id="reason" value={reason} onChange={(event) => setReason(event.target.value as Reason | "")}>
              <option value="">Select a reason (optional)</option>
              {REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <ChevronDown size={16} />
          </div>
          <div className="counter-footer">
            <button className="text-button" onClick={undoLastVisit} disabled={total === 0}><RotateCcw size={15} /> Undo last visit</button>
            <button className="secondary-button" onClick={() => setShowBatch(true)} disabled={!branch}>Batch entry <span>+</span></button>
          </div>
        </section>

        <section className="panel summary-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">LIVE SNAPSHOT</p><h2>Today's activity</h2></div>
            <span className="date-pill">Today</span>
          </div>
          <div className="activity-total"><span className="activity-total-icon"><Users size={20} /></span><div><strong>{total}</strong><small>Total recorded visits</small></div></div>
          <div className="progress-group">
            <div className="progress-label"><span><i className="legend-dot purchase-dot" /> Purchases</span><strong>{purchasers} <small>{total ? Math.round(purchasers / total * 100) : 0}%</small></strong></div>
            <div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${total ? purchasers / total * 100 : 0}%` }} /></div>
          </div>
          <div className="progress-group">
            <div className="progress-label"><span><i className="legend-dot no-purchase-dot" /> No purchase</span><strong>{nonPurchasers} <small>{total ? Math.round(nonPurchasers / total * 100) : 0}%</small></strong></div>
            <div className="progress-track"><span className="progress-fill no-purchase-fill" style={{ width: `${total ? nonPurchasers / total * 100 : 0}%` }} /></div>
          </div>
          <div className="progress-group">
            <div className="progress-label"><span><i className="legend-dot undecided-dot" /> Still enquiring</span><strong>{undecided} <small>{total ? Math.round(undecided / total * 100) : 0}%</small></strong></div>
            <div className="progress-track"><span className="progress-fill undecided-fill" style={{ width: `${total ? undecided / total * 100 : 0}%` }} /></div>
          </div>
          <div className="snapshot-note"><CircleHelp size={16} /><span>Conversion excludes visits marked as still enquiring.</span></div>
        </section>
      </div>

      <footer className="footer"><span>Pharmacy Footfall Tracker <span className="footer-dot">·</span> Stage 1 preview</span><span className="local-only"><span className="device-dot" /> Saved on this device only</span></footer>

      {showBranchPicker && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="branch-title">
            <div className="modal-brand"><span className="brand-mark"><Activity size={21} /></span><span className="eyebrow">DAILY BRANCH SETUP</span></div>
            <h2 id="branch-title">Which branch are you recording for?</h2>
            <p className="modal-description">Choose the branch you're working at today. Your selection stays active for this Lagos calendar day, even if you close the app.</p>
            <div className="branch-options">
              {BRANCHES.map((item) => (
                <button key={item} className={branchChoice === item ? "branch-option selected" : "branch-option"} onClick={() => setBranchChoice(item)}>
                  <span className="branch-option-icon"><Users size={18} /></span><span><strong>{item}</strong><small>Pharmacy branch</small></span>
                  <span className="radio-mark">{branchChoice === item && <span />}</span>
                </button>
              ))}
            </div>
            <button className="primary-button" disabled={!branchChoice} onClick={chooseBranch}>Confirm branch <span>→</span></button>
            <p className="modal-footnote"><Clock3 size={13} /> Resets for branch selection at the start of each new day in Lagos.</p>
          </section>
        </div>
      )}

      {showBatch && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="batch-title">
            <button className="modal-close" aria-label="Close batch entry" onClick={() => setShowBatch(false)}><X size={19} /></button>
            <p className="eyebrow">MULTIPLE VISITS</p><h2 id="batch-title">Batch entry</h2>
            <p className="modal-description">Add several visits with the same outcome. Use this when recording a group after a busy period.</p>
            <label className="field-label" htmlFor="batch-count">Number of visits</label>
            <input id="batch-count" className="number-input" type="number" min="1" max="100" value={batchCount} onChange={(event) => setBatchCount(event.target.value)} />
            <label className="field-label" htmlFor="batch-outcome">Visit outcome</label>
            <div className="select-wrap"><select id="batch-outcome" value={batchOutcome} onChange={(event) => setBatchOutcome(event.target.value as Outcome)}><option value="purchased">Made a purchase</option><option value="not_purchased">No purchase</option><option value="undecided">Still enquiring</option></select><ChevronDown size={16} /></div>
            <button className="primary-button" disabled={!Number.isInteger(Number(batchCount)) || Number(batchCount) < 1 || Number(batchCount) > 100} onClick={() => addVisits(batchOutcome, Number(batchCount), batchOutcome === "not_purchased" ? reason || undefined : undefined)}>Add {batchCount || "0"} visits <span>→</span></button>
            <p className="modal-footnote">Batch entries create a separate record for each visit.</p>
          </section>
        </div>
      )}
    </main>
  );
}