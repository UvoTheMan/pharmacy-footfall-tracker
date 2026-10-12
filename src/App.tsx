import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity, ArrowDownRight, ArrowUpRight, CalendarDays, Check, ChevronDown,
  CircleHelp, Clock3, KeyRound, LogOut, ShoppingBag, Users, X,
} from "lucide-react";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import VisitCorrections from "./components/VisitCorrections";
import HistoricalVisits from "./components/HistoricalVisits";
import BranchCorrectionRequests from "./components/BranchCorrectionRequests";

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
  unavailable_item_requested: boolean;
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

function FootlyticsMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 5.5H24.5M7 5.5V26.5M7 13H18" stroke="#FFFFFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 25.5V21M19 25.5V17M24.5 25.5V12.5" stroke="#9EE6C0" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [correctionTargets, setCorrectionTargets] = useState<Branch[]>([]);
  const [pendingCorrection, setPendingCorrection] = useState(false);
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
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [showPasswordSettings, setShowPasswordSettings] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [adminToken, setAdminToken] = useState("");
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
      const correctionTargetsResult = await supabase.rpc("get_active_correction_branches");
      setCorrectionTargets(correctionTargetsResult.error ? availableBranches : ((correctionTargetsResult.data ?? []) as Branch[]));
      const savedDate = localStorage.getItem("pft.selected-day");
      const savedBranchId = localStorage.getItem("pft.selected-branch-id");
      const savedBranch = savedDate === today
        ? availableBranches.find((item) => item.id === savedBranchId)
        : undefined;
      if (currentProfile.role === "admin") {
        const initialBranch = savedBranch ?? availableBranches[0] ?? null;
        setBranch(initialBranch);
        setBranchChoice(initialBranch?.id ?? "");
        setShowBranchPicker(false);
      } else if (savedBranch) {
        setBranch(savedBranch);
        setBranchChoice(savedBranch.id);
        setShowBranchPicker(false);
      } else {
        setBranch(null);
        setBranchChoice("");
        setShowBranchPicker(true);
      }
      if (!availableBranches.length && currentProfile.role !== "admin") {
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
      .select("id,branch_id,visit_date,recorded_at,outcome,reason,unavailable_item_requested,batch_id,created_by")
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
    const normalizedUsername = username.trim().toLowerCase();
    const accountEmails: Record<string, string> = {
      springcare: "victorokolieau@gmail.com",
      "victorokolieau@gmail.com": "victorokolieau@gmail.com",
      springcarestaff: "victorokolie911@gmail.com",
      sprincarestaff: "victorokolie911@gmail.com",
      "victorokolie911@gmail.com": "victorokolie911@gmail.com",
    };
    const email = accountEmails[normalizedUsername];
    if (!email) {
      setError("Incorrect username or password.");
      setBusy(false);
      return;
    }
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setError("Incorrect username or password.");
    setBusy(false);
  }

  async function requestPasswordReset() {
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");
    const result = await supabase.functions.invoke("authorize-password-change", {
      body: { action: "request-recovery", adminToken, username: username.trim() },
    });
    if (result.error || result.data?.success !== true) {
      setError(result.data?.error ?? "Password recovery was rejected. Make sure you are using the exact current Production Supabase ADMIN_PASSWORD_CHANGE_TOKEN secret, then try again.");
    } else {
      setAdminToken("");
      setForgotPasswordMode(false);
      setNotice(`Password reset email requested for ${username.trim()}. Check that account’s inbox and spam folder.`);
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
    const result = await supabase.functions.invoke("authorize-password-change", {
      body: { action: "update-password", password: newPassword, adminToken },
    });
    if (result.error) {
      setError(result.data?.error ?? "Password change could not be completed. Confirm the admin token and reopen the latest recovery email if your session expired.");
      setBusy(false);
      return;
    }
    setPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setAdminToken("");
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

  async function chooseBranch() {
    if (profile?.role === "admin") return;
    const selectableBranches = todaysVisits.length > 0 ? correctionTargets : branches;
    const chosen = selectableBranches.find((item) => item.id === branchChoice);
    if (!chosen) return;
    if (pendingCorrection) {
      setError("A branch correction is already awaiting administrator review. Visit entry is paused until it is resolved.");
      return;
    }

    if (branch && chosen.id !== branch.id && todaysVisits.length > 0) {
      if (!supabase) return;
      setBusy(true);
      setError("");
      const request = await supabase.rpc("request_branch_correction", {
        p_source_branch_id: branch.id,
        p_target_branch_id: chosen.id,
        p_visit_date: today,
      });
      if (request.error) {
        setError("Could not request branch correction: " + request.error.message);
        setBusy(false);
        return;
      }
      setBranchChoice(branch.id);
      setPendingCorrection(true);
      setShowBranchPicker(false);
      setBusy(false);
      flash("Correction request submitted. Visit entry is paused until an administrator reviews the request.");
      return;
    }

    setBranch(chosen);
    localStorage.setItem("pft.selected-branch-id", chosen.id);
    localStorage.setItem("pft.selected-day", today);
    setShowBranchPicker(false);
    flash("Today's branch is set to " + chosen.name + ".");
  }

  async function addVisits(outcome: Outcome, count = 1, visitReason?: Reason, unavailableItemRequested = false) {
    if (profile?.role === "admin") {
      setError("Admin accounts can review branch performance and correct existing records, but cannot add new visits.");
      return;
    }
    if (pendingCorrection) {
      setError("Visit entry is paused while a branch correction is awaiting administrator review.");
      return;
    }
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
      unavailable_item_requested: outcome === "purchased" && unavailableItemRequested,
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
  const unavailableDespitePurchase = todaysVisits.filter((visit) => visit.outcome === "purchased" && visit.unavailable_item_requested).length;
  const total = todaysVisits.length;
  const conversion = total - undecided > 0 ? Math.round((purchasers / (total - undecided)) * 100) : null;

  if (!hasSupabaseConfig) return (
    <main className="setup-screen">
      <section className="setup-card">
        <span className="brand-mark"><FootlyticsMark /></span>
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
        <span className="brand-mark"><FootlyticsMark /></span>
        <p className="eyebrow">PHARMACY FOOTFALL TRACKER</p>
        <h1>Set a new password</h1>
        <p>Choose a new password for the account associated with this recovery link.</p>
        <label className="field-label" htmlFor="new-password">New password</label>
        <input className="number-input" id="new-password" type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <label className="field-label" htmlFor="confirm-new-password">Confirm new password</label>
        <input className="number-input" id="confirm-new-password" type="password" autoComplete="new-password" minLength={10} required value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} />
        <label className="field-label" htmlFor="recovery-admin-token">Admin authorization token</label>
        <input className="number-input" id="recovery-admin-token" type="password" autoComplete="off" required value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
        <p className="setup-footnote">Enter the authorization token provided by your administrator to finish password recovery.</p>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Updating password…" : "Update password"} <span>→</span></button>
        <p className="setup-footnote">Use at least 10 characters. Keep your new password private.</p>
      </form>
    </main>
  );

  if (!session) return (
    <main className="setup-screen">
      <form className="setup-card login-card" onSubmit={signIn}>
        <span className="brand-mark"><FootlyticsMark /></span>
        <p className="eyebrow">PHARMACY FOOTFALL TRACKER</p>
        <h1>Welcome back.</h1>
        <p>Sign in with the account provided by your administrator.</p>
        <label className="field-label" htmlFor="username">Username or email</label>
        <input className="number-input" id="username" type="text" autoComplete="username" autoCapitalize="none" required value={username} onChange={(event) => setUsername(event.target.value)} />
        <label className="field-label" htmlFor="password">Password</label>
        <input className="number-input" id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <span>→</span></button>
        {notice && <p className="notice" role="status">{notice}</p>}
        {forgotPasswordMode ? (
          <>
            <p className="setup-footnote">Enter the account username in the Username field above (Springcare or Sprincarestaff), then authorize the recovery email.</p>
            <label className="field-label" htmlFor="forgot-admin-token">Admin authorization token</label>
            <input className="number-input" id="forgot-admin-token" type="password" autoComplete="off" required value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
            <button className="primary-button" type="button" disabled={busy || !adminToken.trim() || !username.trim()} onClick={() => void requestPasswordReset()}>{busy ? "Requesting recovery…" : "Authorize recovery email"} <span>→</span></button>
            <button className="text-button" type="button" disabled={busy} onClick={() => { setForgotPasswordMode(false); setAdminToken(""); setError(""); }}>Cancel</button>
          </>
        ) : (
          <button className="text-button" type="button" disabled={busy} onClick={() => { setForgotPasswordMode(true); setAdminToken(""); setError(""); setNotice(""); }}>Forgot password? Request recovery email</button>
        )}
        <p className="setup-footnote">Staff accounts must be created by the administrator.</p>
      </form>
    </main>
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Pharmacy Footfall Tracker home">
          <span className="brand-mark"><FootlyticsMark /></span>
          <span className="brand-copy"><strong>Footlytics</strong><small>FOOTFALL INTELLIGENCE</small></span>
        </a>
        <div className="user-actions">
          <div className="local-time"><span className="live-dot" /> Lagos time <Clock3 size={14} /></div>
          <button className="signout-button" onClick={() => { setNewPassword(""); setConfirmNewPassword(""); setAdminToken(""); setError(""); setShowPasswordSettings(true); }} disabled={busy}><KeyRound size={15} /> Change password</button>
          <button className="signout-button" onClick={() => void signOut()} aria-label="Sign out"><LogOut size={15} /> Sign out</button>
        </div>
      </header>

      <section className="welcome">
        <div>
          <p className="eyebrow">DAILY OPERATIONS</p>
          <h1>Welcome</h1>
          <p className="welcome-tagline">VISITS. INSIGHTS. GROWTH.</p>
          <p className="date-line"><CalendarDays size={16} /> {lagosDisplayDate()}</p>
        </div>
        {profile?.role === "admin" ? (
          <nav className="admin-branch-nav" aria-label="Switch branch">
            <span className="admin-branch-nav-label">VIEW BRANCH</span>
            <div className="admin-branch-tabs">
              {branches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={branch?.id === item.id ? "admin-branch-tab active" : "admin-branch-tab"}
                  aria-pressed={branch?.id === item.id}
                  onClick={() => { setBranch(item); setBranchChoice(item.id); setVisits([]); setError(""); }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </nav>
        ) : (
          <button className="branch-switch" onClick={() => { setBranchChoice(branch?.id ?? ""); setShowBranchPicker(true); }}>
            <span className="branch-icon"><Users size={17} /></span>
            <span><small>ACTIVE BRANCH</small><strong>{branch?.name ?? "Choose branch"}</strong></span>
            <ChevronDown size={16} />
          </button>
        )}
      </section>

      {notice && <div className="notice" role="status"><Check size={16} />{notice}</div>}
      {error && <div className="error-message banner-error" role="alert"><CircleHelp size={16} />{error}</div>}

      {pendingCorrection && <div className="notice" role="status">A branch correction is pending. Visit entry is paused until an administrator approves or rejects the request.</div>}
      {profile?.role === "admin" && <BranchCorrectionRequests branches={branches} onUpdated={loadVisits} />}

      <section className="stats-grid" aria-label="Today's totals">
        <article className="stat-card stat-primary"><div className="stat-top"><span>Total visits</span><span className="stat-icon"><Users size={18} /></span></div><strong className="stat-number">{total}</strong><span className="stat-foot">{loadingVisits ? "Refreshing…" : "Shared records for today"}</span></article>
        <article className="stat-card"><div className="stat-top"><span>Purchases</span><span className="stat-icon green"><ShoppingBag size={18} /></span></div><strong className="stat-number">{purchasers}</strong><span className="stat-foot positive"><ArrowUpRight size={14} /> Completed sales</span></article>
        <article className="stat-card"><div className="stat-top"><span>No purchase</span><span className="stat-icon amber"><ArrowDownRight size={18} /></span></div><strong className="stat-number">{nonPurchasers}</strong><span className="stat-foot">Visit without a sale</span></article>
        <article className="stat-card"><div className="stat-top"><span>Conversion</span><span className="stat-icon blue"><Activity size={18} /></span></div><strong className="stat-number">{conversion === null ? "—" : `${conversion}%`}</strong><span className="stat-foot">Purchase rate</span></article>
      </section>

      <div className={profile?.role === "admin" ? "content-grid admin-content-grid" : "content-grid"}>
        {profile?.role !== "admin" && <section className="panel counter-panel">
          <div className="panel-heading"><div><p className="eyebrow">QUICK ENTRY</p><h2>Record a visit</h2></div><span className="heading-chip"><span className="live-dot" /> {busy ? "Saving…" : "Online"}</span></div>
          <p className="panel-description">Choose the outcome for the person who just visited the pharmacy.</p>
          <div className="outcome-list">
            <button className="outcome-button purchased" onClick={() => void addVisits("purchased")} disabled={!branch || busy || pendingCorrection}><span className="outcome-symbol"><Check size={21} /></span><span className="outcome-text"><strong>Made a purchase</strong><small>Customer bought an item</small></span><span className="outcome-plus">+</span></button>
            <button className="outcome-button not-purchased" onClick={() => { setReason(""); setError(""); setShowNoPurchaseReason(true); }} disabled={!branch || busy || pendingCorrection}><span className="outcome-symbol"><X size={21} /></span><span className="outcome-text"><strong>No purchase</strong><small>Customer left without buying</small></span><span className="outcome-plus">+</span></button>
          </div>
          <button className="secondary-button" style={{ width: "100%", marginTop: 10 }} onClick={() => void addVisits("purchased", 1, undefined, true)} disabled={!branch || busy || pendingCorrection}>Purchased, but requested item unavailable <span>↗</span></button>
          <div className="counter-footer"><span /><button className="secondary-button" onClick={() => setShowBatch(true)} disabled={!branch || busy || pendingCorrection}>Batch entry <span>+</span></button></div>
        </section>}

        <section className="panel summary-panel">
          <div className="panel-heading"><div><p className="eyebrow">LIVE SNAPSHOT</p><h2>Today's activity</h2></div><span className="date-pill">Today</span></div>
          <div className="activity-total"><span className="activity-total-icon"><Users size={20} /></span><div><strong>{total}</strong><small>Total recorded visits</small></div></div>
          <div className="progress-group"><div className="progress-label"><span><i className="legend-dot purchase-dot" /> Purchases</span><strong>{purchasers} <small>{total ? Math.round(purchasers / total * 100) : 0}%</small></strong></div><div className="progress-track"><span className="progress-fill purchase-fill" style={{ width: `${total ? purchasers / total * 100 : 0}%` }} /></div></div>
          <div className="progress-group"><div className="progress-label"><span><i className="legend-dot no-purchase-dot" /> No purchase</span><strong>{nonPurchasers} <small>{total ? Math.round(nonPurchasers / total * 100) : 0}%</small></strong></div><div className="progress-track"><span className="progress-fill no-purchase-fill" style={{ width: `${total ? nonPurchasers / total * 100 : 0}%` }} /></div></div>
          <div className="snapshot-note"><CircleHelp size={16} /><span>Unavailable request despite purchase: <strong>{unavailableDespitePurchase}</strong></span></div>
          <div className="snapshot-note"><CircleHelp size={16} /><span>Data shown is loaded from the shared database.</span></div>
        </section>
      </div>

      {profile?.role === "admin" && <BranchCorrectionRequests branches={branches} onUpdated={loadVisits} mode="history" />}

      <VisitCorrections visits={todaysVisits} onUpdated={loadVisits} canEdit={profile?.role !== "admin"} />
      <HistoricalVisits branch={branch} branches={branches} profile={profile} />

      <details className="testing-cutoff">
        <summary><CalendarDays size={16} /> Testing cutoff and historical records</summary>
        <div className="testing-cutoff-content"><strong>Testing ended: Sunday, 11 October 2026</strong><p>From Monday, 12 October 2026, visits are intended to be live operational records. Historical records have not been changed.</p></div>
      </details>

      <footer className="footer"><span>Pharmacy Footfall Tracker <span className="footer-dot">·</span> Stage 3 visit corrections</span><span>Built by UVO <span className="footer-dot">·</span> <a href="mailto:victorokolieau@gmail.com">Contact</a></span><span className="local-only"><span className="live-dot" /> Signed in as {profile?.role ?? "staff"}</span></footer>

      {showPasswordSettings && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="password-settings-title" onSubmit={updatePassword}>
            <button className="modal-close" type="button" aria-label="Close change password" onClick={() => { setShowPasswordSettings(false); setAdminToken(""); }}><X size={19} /></button>
            <p className="eyebrow">ACCOUNT SECURITY</p>
            <h2 id="password-settings-title">Change password</h2>
            <p className="modal-description">Choose a new password for the Springcare account. No recovery email is needed while you are signed in.</p>
            <label className="field-label" htmlFor="dashboard-new-password">New password</label>
            <input className="number-input" id="dashboard-new-password" type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <label className="field-label" htmlFor="dashboard-confirm-password">Confirm new password</label>
            <input className="number-input" id="dashboard-confirm-password" type="password" autoComplete="new-password" minLength={10} required value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} />
            <label className="field-label" htmlFor="dashboard-admin-token">Admin authorization token</label>
            <input className="number-input" id="dashboard-admin-token" type="password" autoComplete="off" required value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
            <p className="modal-footnote">Ask the administrator for the current authorization token. The token is checked by Supabase, not by the browser.</p>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Updating password…" : "Save new password"} <span>→</span></button>
            <p className="modal-footnote">Use at least 10 characters. Keep your new password private.</p>
          </form>
        </div>
      )}

      {showNoPurchaseReason && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="no-purchase-title">
            <button className="modal-close" type="button" aria-label="Cancel no-purchase entry" onClick={() => setShowNoPurchaseReason(false)} disabled={busy}><X size={19} /></button>
            <p className="eyebrow">VISIT DETAILS</p>
            <h2 id="no-purchase-title">Why was there no purchase?</h2>
            <p className="modal-description">Tap a reason to record the visit immediately.</p>
            <div className="branch-options">{REASONS.map((item) => <button key={item} type="button" className="branch-option" disabled={busy} onClick={() => { setReason(item); setShowNoPurchaseReason(false); void addVisits("not_purchased", 1, item); }}><span className="branch-option-icon"><X size={18} /></span><span><strong>{item}</strong></span><span className="outcome-plus">→</span></button>)}</div>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="text-button" type="button" onClick={() => setShowNoPurchaseReason(false)} disabled={busy}>Cancel</button>
          </section>
        </div>
      )}

      {showBranchPicker && profile?.role !== "admin" && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="branch-title">
            <div className="modal-brand"><span className="brand-mark"><FootlyticsMark /></span><span className="eyebrow">DAILY BRANCH SETUP</span></div>
            <h2 id="branch-title">Which branch are you recording for?</h2>
            <p className="modal-description">{todaysVisits.length > 0 ? "Choose the branch where today's visits should have been recorded. This submits a correction request and pauses new visit entry until an administrator resolves it." : "Only branches assigned to your account are available for recording. Choose today's branch; it remains selected through browser closure until the next Lagos calendar day."}</p>
            {pendingCorrection && <p className="modal-footnote">A correction is already pending. Close this window and wait for administrator review.</p>}
            <div className="branch-options">{(todaysVisits.length > 0 ? correctionTargets : branches).map((item) => <button key={item.id} disabled={pendingCorrection || busy} className={branchChoice === item.id ? "branch-option selected" : "branch-option"} onClick={() => setBranchChoice(item.id)}><span className="branch-option-icon"><Users size={18} /></span><span><strong>{item.name}</strong><small>{branches.some((branchItem) => branchItem.id === item.id) ? "Assigned pharmacy branch" : "Correction destination only"}</small></span><span className="radio-mark">{branchChoice === item.id && <span />}</span></button>)}</div>
            <button className="primary-button" disabled={!branchChoice || busy || loadingVisits || pendingCorrection} onClick={() => void chooseBranch()}>{busy ? "Submitting…" : "Confirm branch"} <span>→</span></button>
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
