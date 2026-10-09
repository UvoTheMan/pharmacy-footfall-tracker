import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity, ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronDown,
  CircleHelp, Clock3, KeyRound, LogOut, RotateCcw, ShoppingBag, Users, X,
} from "lucide-react";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

type Branch = { id: string; slug: string; name: string };
type Outcome = "purchased" | "not_purchased" | "undecided";
type Reason =
  | "Item unavailable" | "Price too high" | "Only enquiring"
  | "Preferred brand unavailable" | "Customer changed mind"
  | "Will buy later" | "Other / Unknown";
type Visit = {
  id: string;
  branch_id: string;
  visit_date: string;
  recorded_at: string;
  outcome: Outcome;
  reason: Reason | null;
  batch_id: string | null;
  created_by: string;
};
type Profile = { user_id: string; display_name: string; role: "staff" | "admin"; active: boolean };

const REASONS: Reason[] = [
  "Item unavailable", "Price too high", "Only enquiring",
  "Preferred brand unavailable", "Customer changed mind",
  "Will buy later", "Other / Unknown",
];

function lagosDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function lagosDisplayDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(date);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchChoice, setBranchChoice] = useState("");
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [showNoPurchaseReason, setShowNoPurchaseReason] = useState(false);
  const [batchCount, setBatchCount] = useState("5");
  const [batchOutcome, setBatchOutcome] = useState<Outcome>("purchased");
  const [reason, setReason] = useState<Reason | "">("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [showPasswordSettings, setShowPasswordSettings] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const today = lagosDateKey();

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  };

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setSession(nextSession);
      setProfile(null);
      setBranches([]);
      setVisits([]);
      setBranch(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!supabase || !session?.user) return;
    setBusy(true);
    setError("");
    try {
      const [profileResult, branchResult] = await Promise.all([
        supabase.from("profiles").select("user_id,display_name,role,active").eq("user_id", session.user.id).single(),
        supabase.from("branches").select("id,slug,name").order("name"),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (branchResult.error) throw branchResult.error;
      const currentProfile = profileResult.data as Profile;
      if (!currentProfile.active) {
        await supabase.auth.signOut();
        throw new Error("This account is inactive. Please contact the administrator.");
      }
      setProfile(currentProfile);
      const availableBranches = (branchResult.data ?? []) as Branch[];
      setBranches(availableBranches);
      const savedDate = localStorage.getItem("pft.selected-day");
      const savedBranchId = localStorage.getItem("pft.selected-branch-id");
      const savedBranch = savedDate === today
        ? availableBranches.find((item) => item.id === savedBranchId)
        : undefined;
      if (savedBranch) {
        setBranch(savedBranch);
        setBranchChoice(savedBranch.id);
        setShowBranchPicker(false);
      } else {
        setBranch(null);
        setBranchChoice("");
        setShowBranchPicker(true);
      }
      if (!availableBranches.length) {
        setError("No branch access is assigned to this account. Ask an administrator to assign your branch.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load your account.");
    } finally {
      setBusy(false);
    }
  }, [session, today]);

  useEffect(() => {
    if (session) void loadWorkspace();
  }, [session, loadWorkspace]);

  const loadVisits = useCallback(async () => {
    if (!supabase || !branch || !session) return;
    setLoadingVisits(true);
    setError("");
    const result = await supabase
      .from("visits")
      .select("id,branch_id,visit_date,recorded_at,outcome,reason,batch_id,created_by")
      .eq("branch_id", branch.id)
      .eq("visit_date", today)
      .order("recorded_at", { ascending: false });
    if (result.error) setError(`Could not load visits: ${result.error.message}`);
    else setVisits((result.data ?? []) as Visit[]);
    setLoadingVisits(false);
  }, [branch, session, today]);

  useEffect(() => { void loadVisits(); }, [loadVisits]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    if (username.trim().toLowerCase() !== "springcare") {
      setError("Incorrect username or password.");
      setBusy(false);
      return;
    }
    const result = await supabase.auth.signInWithPassword({ email: "victorokolieau@gmail.com", password });
    if (result.error) setError("Incorrect username or password.");
    setBusy(false);
  }

  async function requestPasswordReset() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");
    const result = await supabase.auth.resetPasswordForEmail("victorokolieau@gmail.com", {
      redirectTo: "https://springfootfall.vercel.app/",
    });
    if (result.error) {
      setError(`Could not request password reset: ${result.error.message}`);
    } else {
      setNotice("Password reset email requested. Check the inbox and spam folder for victorokolieau@gmail.com.");
    }
    setBusy(false);
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword.length < 10) {
      setError("Choose a password with at least 10 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await supabase.auth.updateUser({ password: newPassword });
    if (result.error) {
      setError(`Could not update password: ${result.error.message}`);
      setBusy(false);
      return;
    }
    setPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setRecoveryMode(false);
    setShowPasswordSettings(false);
    setBusy(false);
    flash("Password updated successfully. You are signed in.");
  }

  async function signOut() {
    if (!supabase) return;
    const result = await supabase.auth.signOut();
    if (result.error) setError(result.error.message);
    setBranch(null);
    setProfile(null);
  }

  function chooseBranch() {
    const chosen = branches.find((item) => item.id === branchChoice);
    if (!chosen) return;
    setBranch(chosen);
    localStorage.setItem("pft.selected-branch-id", chosen.id);
    localStorage.setItem("pft.selected-day", today);
    setShowBranchPicker(false);
    flash(`Today's branch is set to ${chosen.name}.`);
  }

  async function addVisits(outcome: Outcome, count = 1, visitReason?: Reason) {
    if (!supabase || !branch || !session) {
      setError("Sign in and select an assigned branch before recording visits.");
      return;
    }
    setBusy(true);
    setError("");
    const now = new Date();
    const batchId = count > 1 ? crypto.randomUUID() : null;
    const records = Array.from({ length: count }, () => ({
      branch_id: branch.id,
      visit_date: lagosDateKey(now),
      recorded_at: now.toISOString(),
      outcome,
      reason: outcome === "not_purchased" ? visitReason ?? null : null,
      batch_id: batchId,
      created_by: session.user.id,
    }));
    const result = await supabase.from("visits").insert(records).select("id");
    if (result.error) {
      setError(`Visit not saved: ${result.error.message}`);
      setBusy(false);
      return;
    }
    setReason("");
    setShowBatch(false);
    await loadVisits();
    flash(count === 1 ? "Visit saved to the shared database." : `${count} visits saved to the shared database.`);
    setBusy(false);
  }

  const todaysVisits = useMemo(() => visits.filter((visit) => visit.branch_id === branch?.id && visit.visit_date === today), [visits, branch, today]);
  const purchasers = todaysVisits.filter((visit) => visit.outcome === "purchased").length;
  const nonPurchasers = todaysVisits.filter((visit) => visit.outcome === "not_purchased").length;
  const undecided = todaysVisits.filter((visit) => visit.outcome === "undecided").length;
  const total = todaysVisits.length;
  const conversion = total - undecided > 0 ? Math.round((purchasers / (total - undecided)) * 100) : null;

  if (!hasSupabaseConfig) return (
    <main className="setup-screen">
      <section className="setup-card">
        <span className="brand-mark"><Activity size={22} /></span>
        <p className="eyebrow">STAGE 2 SETUP</p>
        <h1>Connect your Supabase project</h1>
        <p>The app code is ready for the shared database, but it needs your project's URL and publishable key before anyone can sign in or save visits online.</p>
        <ol>
          <li>Create a Supabase project.</li>
          <li>Run the SQL migration in <code>supabase/migrations/202610090001_initial_schema.sql</code>.</li>
          <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in both values.</li>
          <li>Restart the development server or add the values to your hosting provider's environment settings.</li>
        </ol>
        <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase dashboard ↗</a>
        <p className="setup-footnote">Never add a Supabase service-role key to frontend environment variables.</p>
      </section>
    </main>
  );

  if (!authReady) return <main className="setup-screen"><section className="setup-card"><p>Checking your sign-in session…</p></section></main>;

  if (recoveryMode && session) return (
    <main className="setup-screen">
      <form className="setup-card login-card" onSubmit={updatePassword}>
        <span className="brand-mark"><Activity size={22} /></span>
        <p className="eyebrow">PHARMACY FOOTFALL TRACKER</p>
        <h1>Set a new password</h1>
        <p>Choose a new password for the Springcare account.</p>
        <label className="field-label" htmlFor="new-password">New password</label>
        <input className="number-input" id="new-password" type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <label className="field-label" htmlFor="confirm-new-password">Confirm new password</label>
        <input className="number-input" id="confirm-new-password" type="password" autoComplete="new-password" minLength={10} required value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} />
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Updating password…" : "Update password"} <span>→</span></button>
        <p className="setup-footnote">Use at least 10 characters. Keep your new password private.</p>
      </form>
    </main>
  );

  if (!session) return (
    <main className="setup-screen">
      <form className="setup-card login-card" onSubmit={signIn}>
        <span className="brand-mark"><Activity size={22} /></span>
        <p className="eyebrow">PHARMACY FOOTFALL TRACKER</p>
        <h1>Welcome back.</h1>
        <p>Sign in with the account provided by your administrator.</p>
        <label className="field-label" htmlFor="username">Username</label>
        <input className="number-input" id="username" type="text" autoComplete="username" autoCapitalize="none" required value={username} onChange={(event) => setUsername(event.target.value)} />
        <label className="field-label" htmlFor="password">Password</label>
        <input className="number-input" id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <span>→</span></button>
        {notice && <p className="notice" role="status">{notice}</p>}
        <button className="text-button" type="button" disabled={busy} onClick={() => void requestPasswordReset()}>Forgot password? Send recovery email</button>
        <p className="setup-footnote">Staff accounts must be created by the administrator.</p>
      </form>
    </main>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Pharmacy Footfall Tracker home">
          <span className="brand-mark"><Activity size={21} strokeWidth={2.4} /></span>
          <span className="brand-copy"><strong>Footfall</strong><small>PHARMACY TRACKER</small></span>
        </a>
        <div className="user-actions">
          <div className="local-time"><span className="live-dot" /> Lagos time <Clock3 size={14} /></div>
          <button className="signout-button" onClick={() => { setNewPassword(""); setConfirmNewPassword(""); setError(""); setShowPasswordSettings(true); }} disabled={busy}><KeyRound size={15} /> Change password</button>
          <button className="signout-button" onClick={() => void signOut()} aria-label="Sign out"><LogOut size={15} /> Sign out</button>
        </div>
      </header>

      <section className="welcome">
        <div>
          <p className="eyebrow">DAILY OPERATIONS</p>
          <h1>{profile?.display_name ? `Welcome, ${profile.display_name}.` : "Welcome back, team."}</h1>
          <p className="date-line"><CalendarDays size={16} /> {lagosDisplayDate()}</p>
        </div>
        <button className="branch-switch" onClick={() => { setBranchChoice(branch?.id ?? ""); setShowBranchPicker(true); }}>
          <span className="branch-icon"><Users size={17} /></span>
          <span><small>ACTIVE BRANCH</small><strong>{branch?.name ?? "Choose branch"}</strong></span>
          <ChevronDown size={16} />
        </button>
      </section>

      {notice && <div className="notice" role="status"><Check size={16} />{notice}</div>}
      {error && <div className="error-message banner-error" role="alert"><CircleHelp size={16} />{error}</div>}

      <section className="stats-grid" aria-label="Today's totals">
        <article className="stat-card stat-primary"><div className="stat-top"><span>Total visits</span><span className="stat-icon"><Users size={18} /></span></div><strong className="stat-number">{total}</strong><span className="stat-foot">{loadingVisits ? "Refreshing…" : "Shared records for today"}</span></article>
        <article className="stat-card"><div className="stat-top"><span>Purchases</span><span className="stat-icon green"><ShoppingBag size={18} /></span></div><strong className="stat-number">{purchasers}</strong><span className="stat-foot positive"><ArrowUpRight size={14} /> Completed sales</span></article>
        <article className="stat-card"><div className="stat-top"><span>No purchase</span><span className="stat-icon amber"><ArrowDownRight size={18} /></span></div><strong className="stat-number">{nonPurchasers}</strong><span className="stat-foot">Visit without a sale</span></article>
        <article className="stat-card"><div className="stat-top"><span>Conversion</span><span className="stat-icon blue"><Activity size={18} /></span></div><strong className="stat-number">{conversion === null ? "—" : `${conversion}%`}</strong><span className="stat-foot">{undecided} undecided {undecided === 1 ? "visit" : "visits"}</span></article>
      </section>

      <div className="content-grid">
        <section className="panel counter-panel">
          <div className="panel-heading"><div><p className="eyebrow">QUICK ENTRY</p><h2>Record a visit</h2></div><span className="heading-chip"><span className="live-dot" /> {busy ? "Saving…" : "Online"}</span></div>
          <p className="panel-description">Choose the outcome for the person who just visited the pharmacy.</p>
          <div className="outcome-list">
            <button className="outcome-button purchased" onClick={() => void addVisits("purchased")} disabled={!branch || busy}><span className="outcome-symbol"><Check size={21} /></span><span className="outcome-text"><strong>Made a purchase</strong><small>Customer bought an item</small></span><span className="outcome-plus">+</span></button>
            <button className="outcome-button not-purchased" onClick={() => { setReason(""); setError(""); setShowNoPurchaseReason(true); }} disabled={!branch || busy}><span className="outcome-symbol"><X size={21} /></span><span className="outcome-text"><strong>No purchase</strong><small>Customer left without buying</small></span><span className="outcome-plus">+</span></button>
          </div>
          <div className="counter-footer"><span className="text-button muted-button"><RotateCcw size={15} /> Corrections coming in Stage 3</span><button className="secondary-button" onClick={() => setShowBatch(true)} disabled={!branch || busy}>Batch entry <span>+</span></button></div>
        </section>

        <section className="panel summary-panel">
          <div className="panel-heading"><div><p className="eyebrow">LIVE SNAPSHOT</p><h2>Today's activity</h2></div><span className="date-pill">Today</span></div>
          <div className="activity-total"><span className="activity-total-icon"><Users size={20} /></span><div><strong>{total}</strong><small>Total recorded visits</small></div></div>
          <div className="progress-group"><div className="progress-label"><span><i className="legend-dot purchase-dot" /> Purchases</span><strong>{purchasers} <small>{total ? Math.round(purchasers / total * 100) : 0}%</small></strong></div><div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${total ? purchasers / total * 100 : 0}%` }} /></div></div>
          <div className="progress-group"><div className="progress-label"><span><i className="legend-dot no-purchase-dot" /> No purchase</span><strong>{nonPurchasers} <small>{total ? Math.round(nonPurchasers / total * 100) : 0}%</small></strong></div><div className="progress-track"><span className="progress-fill no-purchase-fill" style={{ width: `${total ? nonPurchasers / total * 100 : 0}%` }} /></div></div>
          <div className="snapshot-note"><CircleHelp size={16} /><span>Data shown is loaded from the shared database.</span></div>
        </section>
      </div>

      <footer className="footer"><span>Pharmacy Footfall Tracker <span className="footer-dot">·</span> Stage 2 database integration</span><span className="local-only"><span className="live-dot" /> Signed in as {profile?.role ?? "staff"}</span></footer>

      {showPasswordSettings && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="password-settings-title" onSubmit={updatePassword}>
            <button className="modal-close" type="button" aria-label="Close change password" onClick={() => setShowPasswordSettings(false)}><X size={19} /></button>
            <p className="eyebrow">ACCOUNT SECURITY</p>
            <h2 id="password-settings-title">Change password</h2>
            <p className="modal-description">Choose a new password for the Springcare account. No recovery email is needed while you are signed in.</p>
            <label className="field-label" htmlFor="dashboard-new-password">New password</label>
            <input className="number-input" id="dashboard-new-password" type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <label className="field-label" htmlFor="dashboard-confirm-password">Confirm new password</label>
            <input className="number-input" id="dashboard-confirm-password" type="password" autoComplete="new-password" minLength={10} required value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} />
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Updating password…" : "Save new password"} <span>→</span></button>
            <p className="modal-footnote">Use at least 10 characters. Keep your new password private.</p>
          </form>
        </div>
      )}

      {showNoPurchaseReason && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="no-purchase-title" onSubmit={(event) => { event.preventDefault(); if (!reason) return; setShowNoPurchaseReason(false); void addVisits("not_purchased", 1, reason); }}>
            <button className="modal-close" type="button" aria-label="Cancel no-purchase entry" onClick={() => setShowNoPurchaseReason(false)}><X size={19} /></button>
            <p className="eyebrow">VISIT DETAILS</p>
            <h2 id="no-purchase-title">Why was there no purchase?</h2>
            <p className="modal-description">Select the main reason before recording this visit.</p>
            <label className="field-label" htmlFor="no-purchase-reason">Reason <span>Required</span></label>
            <div className="select-wrap"><select id="no-purchase-reason" required autoFocus value={reason} onChange={(event) => setReason(event.target.value as Reason | "")}><option value="">Select a reason</option>{REASONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={16} /></div>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy || !reason}>{busy ? "Saving visit…" : "Save no-purchase visit"} <span>→</span></button>
            <button className="text-button" type="button" onClick={() => setShowNoPurchaseReason(false)} disabled={busy}>Cancel</button>
          </form>
        </div>
      )}

      {showBranchPicker && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="branch-title">
            <div className="modal-brand"><span className="brand-mark"><Activity size={21} /></span><span className="eyebrow">DAILY BRANCH SETUP</span></div>
            <h2 id="branch-title">Which branch are you recording for?</h2>
            <p className="modal-description">Only branches assigned to your account are listed. Choose today's branch; it remains selected through browser closure until the next Lagos calendar day.</p>
            <div className="branch-options">{branches.map((item) => <button key={item.id} className={branchChoice === item.id ? "branch-option selected" : "branch-option"} onClick={() => setBranchChoice(item.id)}><span className="branch-option-icon"><Users size={18} /></span><span><strong>{item.name}</strong><small>Assigned pharmacy branch</small></span><span className="radio-mark">{branchChoice === item.id && <span />}</span></button>)}</div>
            <button className="primary-button" disabled={!branchChoice || busy} onClick={chooseBranch}>Confirm branch <span>→</span></button>
            <p className="modal-footnote"><Clock3 size={13} /> Branch access is controlled by the database.</p>
          </section>
        </div>
      )}

      {showBatch && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="batch-title">
            <button className="modal-close" aria-label="Close batch entry" onClick={() => setShowBatch(false)}><X size={19} /></button>
            <p className="eyebrow">MULTIPLE VISITS</p><h2 id="batch-title">Batch entry</h2>
            <p className="modal-description">Each visit is saved as its own database record and linked to this batch.</p>
            <label className="field-label" htmlFor="batch-count">Number of visits</label>
            <input id="batch-count" className="number-input" type="number" min="1" max="100" value={batchCount} onChange={(event) => setBatchCount(event.target.value)} />
            <label className="field-label" htmlFor="batch-outcome">Visit outcome</label>
            <div className="select-wrap"><select id="batch-outcome" value={batchOutcome} onChange={(event) => setBatchOutcome(event.target.value as Outcome)}><option value="purchased">Made a purchase</option><option value="not_purchased">No purchase</option></select><ChevronDown size={16} /></div>
            {batchOutcome === "not_purchased" && <><label className="field-label" htmlFor="batch-reason">Reason <span>Required</span></label><div className="select-wrap"><select id="batch-reason" required value={reason} onChange={(event) => setReason(event.target.value as Reason | "")}><option value="">Select a reason</option>{REASONS.map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={16} /></div></>}
            <button className="primary-button" disabled={busy || !Number.isInteger(Number(batchCount)) || Number(batchCount) < 1 || Number(batchCount) > 100 || (batchOutcome === "not_purchased" && !reason)} onClick={() => void addVisits(batchOutcome, Number(batchCount), batchOutcome === "not_purchased" ? reason || undefined : undefined)}>Add {batchCount || "0"} visits <span>→</span></button>
            <p className="modal-footnote">The app confirms the save only after the database accepts the records.</p>
          </section>
        </div>
      )}
    </main>
  );
}
