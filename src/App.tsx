import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, Check, ChevronDown, Footprints, Search,
  CircleHelp, Clock3, KeyRound, LogOut, ShoppingBag, Users, X,
} from "lucide-react";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import VisitCorrections from "./components/VisitCorrections";
import HistoricalVisits from "./components/HistoricalVisits";
import BranchCorrectionRequests from "./components/BranchCorrectionRequests";
import ManualBackup from "./components/ManualBackup";
import AdminAnalytics from "./components/AdminAnalytics";
import UnavailableItems from "./components/UnavailableItems";

type Branch = { id: string; slug: string; name: string };
type Outcome = "purchased" | "not_purchased";
type Reason =
  | "Item unavailable" | "Price too high" | "Only enquiring"
  | "Preferred brand unavailable" | "Customer changed mind"
  | "Will buy later" | "Other / Unknown";
type Visit = {
  id: string;
  branch_id: string;
  visit_date: string;
  recorded_at: string;
  outcome: Outcome | "undecided";
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
  const currentUserIdRef = useRef<string | null>(null);
  const authEventReceivedRef = useRef(false);
  const sessionUserId = session?.user.id ?? null;
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [correctionTargets, setCorrectionTargets] = useState<Branch[]>([]);
  const [pendingCorrection, setPendingCorrection] = useState(false);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchChoice, setBranchChoice] = useState("");
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branchPickerIsChange, setBranchPickerIsChange] = useState(false);
  const [showBranchChangeConfirm, setShowBranchChangeConfirm] = useState(false);
  const [adminPage, setAdminPage] = useState<"dashboard" | "analytics">("dashboard");
  const [showUnavailablePage, setShowUnavailablePage] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showUnavailablePrompt, setShowUnavailablePrompt] = useState(false);
  const [unavailableOutcome, setUnavailableOutcome] = useState<"purchased" | "not_purchased">("purchased");
  const [unavailableItemName, setUnavailableItemName] = useState("");
  const [unavailableItemPhoto, setUnavailableItemPhoto] = useState<File | null>(null);
  const [unavailableItemPhotoPreview, setUnavailableItemPhotoPreview] = useState("");
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
      // An auth event can arrive before getSession() resolves. Do not let the
      // slower initial lookup overwrite the newer session from that event.
      if (!authEventReceivedRef.current) {
        currentUserIdRef.current = data.session?.user.id ?? null;
        setSession(data.session);
      }
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEventReceivedRef.current = true;
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);

      const nextUserId = nextSession?.user.id ?? null;
      const previousUserId = currentUserIdRef.current;
      const userChanged = previousUserId !== nextUserId;
      currentUserIdRef.current = nextUserId;
      setSession(nextSession);

      // A same-user SIGNED_IN can occur when a backgrounded tab becomes
      // visible. Preserve workspace state for that event and token refreshes.
      // Clear it only on sign-out or when a different account signs in.
      if (
        event === "SIGNED_OUT" ||
        (userChanged && previousUserId !== null) ||
        (event === "SIGNED_IN" && previousUserId === null && nextUserId !== null)
      ) {
        setProfile(null);
        setBranches([]);
        setVisits([]);
        setBranch(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!supabase || !sessionUserId) return;
    setBusy(true);
    setError("");
    try {
      const [profileResult, branchResult] = await Promise.all([
        supabase.from("profiles").select("user_id,display_name,role,active").eq("user_id", sessionUserId).single(),
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
      setBranchPickerIsChange(false);
      setShowBranchChangeConfirm(false);
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
  }, [sessionUserId, today]);

  useEffect(() => {
    if (sessionUserId) void loadWorkspace();
  }, [sessionUserId, loadWorkspace]);

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

  async function addVisits(outcome: Outcome, count = 1, visitReason?: Reason, unavailableItemRequested = false, waitForRefresh = true) {
    if (profile?.role === "admin") {
      setError("Admin accounts can review branch performance and correct existing records, but cannot add new visits.");
      return null;
    }
    if (pendingCorrection) {
      setError("Visit entry is paused while a branch correction is awaiting administrator review.");
      return null;
    }
    if (!supabase || !branch || !session) {
      setError("Sign in and select an assigned branch before recording visits.");
      return null;
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
      unavailable_item_requested: unavailableItemRequested,
      batch_id: batchId,
      created_by: session.user.id,
    }));
    const result = await supabase.from("visits").insert(records).select("id");
    if (result.error) {
      setError(`Visit not saved: ${result.error.message}`);
      setBusy(false);
      return null;
    }
    setReason("");
    setShowBatch(false);
    if (waitForRefresh) await loadVisits();
    else void loadVisits();
    flash(count === 1 ? "Visit saved to the shared database." : `${count} visits saved to the shared database.`);
    setBusy(false);
    return result.data?.[0]?.id ?? null;
  }

  async function startUnavailablePrompt(outcome: "purchased" | "not_purchased", reason?: Reason) {
    if (!supabase || !branch || !session || profile?.role === "admin" || pendingCorrection) {
      setError(profile?.role === "admin"
        ? "Admin accounts cannot record new visits."
        : pendingCorrection
          ? "Visit entry is paused while a branch correction is awaiting administrator review."
          : "Sign in and select an assigned branch before recording visits.");
      return;
    }
    setUnavailableOutcome(outcome);
    setReason(reason ?? "");
    setUnavailableItemName("");
    clearUnavailablePhoto();
    setError("");
    setShowUnavailablePrompt(true);
  }

  function clearUnavailablePhoto() {
    if (unavailableItemPhotoPreview) URL.revokeObjectURL(unavailableItemPhotoPreview);
    setUnavailableItemPhoto(null);
    setUnavailableItemPhotoPreview("");
  }

  async function deferUnavailablePrompt() {
    const savedVisitId = await addVisits(
      unavailableOutcome,
      1,
      unavailableOutcome === "not_purchased" ? "Item unavailable" : undefined,
      true,
    );
    if (!savedVisitId) return;
    setShowUnavailablePrompt(false);
    setUnavailableItemName("");
    clearUnavailablePhoto();
    setError("");
  }

  function selectUnavailablePhoto(file: File | null) {
    setError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The picture must be 5 MB or smaller.");
      return;
    }
    if (unavailableItemPhotoPreview) URL.revokeObjectURL(unavailableItemPhotoPreview);
    setUnavailableItemPhoto(file);
    setUnavailableItemPhotoPreview(URL.createObjectURL(file));
  }

  async function saveUnavailableItem() {
    const itemName = unavailableItemName.trim();
    if (!supabase || !branch || !session || !itemName) {
      setError("Enter the unavailable item name before saving.");
      return;
    }
    setBusy(true);
    setError("");
    let imagePath: string | null = null;
    if (unavailableItemPhoto) {
      const extension = unavailableItemPhoto.type === "image/png" ? "png" : unavailableItemPhoto.type === "image/webp" ? "webp" : "jpg";
      imagePath = `${session.user.id}/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from("unavailable-item-photos").upload(imagePath, unavailableItemPhoto, {
        contentType: unavailableItemPhoto.type,
        upsert: false,
      });
      if (upload.error) {
        setError("The report was not saved because the photo upload failed: " + upload.error.message);
        setBusy(false);
        return;
      }
    }
    const result = await supabase.rpc("record_unavailable_item", {
      p_branch_id: branch.id,
      p_outcome: unavailableOutcome,
      p_reason: unavailableOutcome === "not_purchased" ? "Item unavailable" : null,
      p_item_name: itemName,
      p_image_path: imagePath,
    });
    if (result.error) {
      if (imagePath) {
        const cleanup = await supabase.storage.from("unavailable-item-photos").remove([imagePath]);
        if (cleanup.error) {
          setError("Visit and unavailable item were not saved: " + result.error.message + ". The uploaded photo could not be cleaned up; please notify the administrator.");
          setBusy(false);
          return;
        }
      }
      setError("Visit and unavailable item were not saved: " + result.error.message);
      setBusy(false);
      return;
    }
    setShowUnavailablePrompt(false);
    setUnavailableItemName("");
    clearUnavailablePhoto();
    await loadVisits();
    flash("Visit and unavailable item saved together to the shared register.");
    setBusy(false);
  }

  const todaysVisits = useMemo(() => visits.filter((visit) => visit.branch_id === branch?.id && visit.visit_date === today), [visits, branch, today]);
  const purchasers = todaysVisits.filter((visit) => visit.outcome === "purchased").length;
  const nonPurchasers = todaysVisits.filter((visit) => visit.outcome === "not_purchased").length;
  const unavailableDespitePurchase = todaysVisits.filter((visit) => visit.outcome === "purchased" && visit.unavailable_item_requested).length;
  const undecided = todaysVisits.filter((visit) => visit.outcome === "undecided").length;
  const total = todaysVisits.length;
  const resolvedVisits = total - undecided;
  const conversion = resolvedVisits > 0 ? Math.round((purchasers / resolvedVisits) * 100) : null;

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
          {profile?.role === "admin" && <button className="signout-button admin-page-switch" type="button" onClick={() => { setShowUnavailablePage(false); setAdminPage((page) => page === "dashboard" ? "analytics" : "dashboard"); }} aria-label={adminPage === "analytics" ? "Return to daily dashboard" : "Open analysis and analytics"}>{adminPage === "analytics" ? <><Footprints size={15} /><span className="admin-page-switch-label">Daily dashboard</span></> : <><BarChart3 size={15} /><span className="admin-page-switch-label">Analysis &amp; analytics</span></>}</button>}
          <button className={`signout-button admin-page-switch unavailable-page-switch${showUnavailablePage ? " active" : ""}`} type="button" onClick={() => { setShowUnavailablePage((shown) => !shown); setAdminPage("dashboard"); setError(""); }} aria-label={showUnavailablePage ? "Return to daily dashboard" : "Open unavailable items register"}>{showUnavailablePage ? <><Footprints size={16} /><span className="admin-page-switch-label">Daily dashboard</span></> : <><Search size={15} /><span className="admin-page-switch-label">Unavailable items</span></>}</button>
          <div className="account-menu-wrap">
            <button className="signout-button account-menu-toggle" type="button" aria-haspopup="menu" aria-expanded={showAccountMenu} onClick={() => setShowAccountMenu((open) => !open)}><span className="account-menu-label">Account</span><ChevronDown size={15} /></button>
            {showAccountMenu && <div className="account-menu" role="menu">
              <button className="account-menu-item" role="menuitem" type="button" onClick={() => { setShowAccountMenu(false); setNewPassword(""); setConfirmNewPassword(""); setAdminToken(""); setError(""); setShowPasswordSettings(true); }} disabled={busy}><KeyRound size={15} /> Change password</button>
              <button className="account-menu-item" role="menuitem" type="button" onClick={() => { setShowAccountMenu(false); void signOut(); }}><LogOut size={15} /> Sign out</button>
            </div>}
          </div>
        </div>
      </header>

      <section className="welcome">
        <div>
          <p className="eyebrow">{showUnavailablePage ? "SHARED STOCK GAP REGISTER" : profile?.role === "admin" && adminPage === "analytics" ? "ADMIN WORKSPACE" : "DAILY OPERATIONS"}</p>
          <h1>{showUnavailablePage ? "Unavailable items" : profile?.role === "admin" && adminPage === "analytics" ? "Analysis & analytics" : "Welcome"}</h1>
          <p className="welcome-tagline">{showUnavailablePage ? "PRODUCT DEMAND. STOCK GAPS. FOLLOW-UP." : profile?.role === "admin" && adminPage === "analytics" ? "BRANCH PERFORMANCE. TRENDS. OPPORTUNITIES." : "VISITS. INSIGHTS. GROWTH."}</p>
          <p className="date-line"><CalendarDays size={16} /> {lagosDisplayDate()}</p>
        </div>
        {profile?.role === "admin" && adminPage === "dashboard" ? (
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
        ) : profile?.role !== "admin" ? (
          <button className="branch-switch" onClick={() => { setBranchChoice(branch?.id ?? ""); setBranchPickerIsChange(Boolean(branch)); setShowBranchPicker(true); }}>
            <span className="branch-icon"><Users size={17} /></span>
            <span><small>ACTIVE BRANCH</small><strong>{branch?.name ?? "Choose branch"}</strong></span>
            <ChevronDown size={16} />
          </button>
        ) : null}
      </section>

      {notice && <div className="notice" role="status"><Check size={16} />{notice}</div>}
      {error && <div className="error-message banner-error" role="alert"><CircleHelp size={16} />{error}</div>}

      {pendingCorrection && <div className="notice" role="status">A branch correction is pending. Visit entry is paused until an administrator approves or rejects the request.</div>}

      {showUnavailablePage ? (
        profile ? (
          <UnavailableItems branches={branches} profile={profile} userId={session.user.id} />
        ) : (
          <section className="panel" role="status">
            <p className="panel-description">Loading your workspace. The unavailable-items register will open when your account details are ready.</p>
          </section>
        )
      ) : profile?.role === "admin" && adminPage === "analytics" ? (
        <section className="admin-analytics-page" aria-label="Admin analysis and analytics">
          <p className="panel-description">A dedicated workspace for reviewing performance across Gbagada, Akoka, and Sangotedo. More analysis tools can be added here without crowding daily operations.</p>
          <AdminAnalytics branches={branches} />
        </section>
      ) : (
      <>
      {profile?.role === "admin" && <BranchCorrectionRequests branches={branches} onUpdated={loadVisits} />}

      <section className="stats-grid" aria-label="Today's totals">
        <article className="stat-card stat-primary"><div className="stat-top"><span>Total visits</span><span className="stat-icon"><Users size={18} /></span></div><strong className="stat-number">{total}</strong><span className="stat-foot">{loadingVisits ? "Refreshing…" : "Shared records for today"}</span></article>
        <article className="stat-card"><div className="stat-top"><span>Purchases</span><span className="stat-icon green"><ShoppingBag size={18} /></span></div><strong className="stat-number">{purchasers}</strong><span className="stat-foot positive"><ArrowUpRight size={14} /> Completed sales</span></article>
        <article className="stat-card"><div className="stat-top"><span>No purchase</span><span className="stat-icon amber"><ArrowDownRight size={18} /></span></div><strong className="stat-number">{nonPurchasers}</strong><span className="stat-foot">Visit without a sale</span></article>
        <article className="stat-card"><div className="stat-top"><span>Conversion</span><span className="stat-icon blue"><Activity size={18} /></span></div><strong className="stat-number">{conversion === null ? "—" : `${conversion}%`}</strong><span className="stat-foot">Purchase rate</span></article>
      </section>

      {profile?.role === "admin" && <BranchCorrectionRequests branches={branches} onUpdated={loadVisits} mode="history" />}

      <div className={profile?.role === "admin" ? "content-grid admin-content-grid" : "content-grid"}>
        {profile?.role !== "admin" && <section className="panel counter-panel">
          <div className="panel-heading"><div><p className="eyebrow">QUICK ENTRY</p><h2>Record a visit</h2></div><span className="heading-chip"><span className="live-dot" /> {busy ? "Saving…" : "Online"}</span></div>
          <p className="panel-description">Choose the outcome for the person who just visited the pharmacy.</p>
          <div className="outcome-list">
            <button className="outcome-button purchased" onClick={() => void addVisits("purchased")} disabled={!branch || busy || pendingCorrection}><span className="outcome-symbol"><Check size={21} /></span><span className="outcome-text"><strong>Made a purchase</strong><small>Customer bought an item</small></span><span className="outcome-plus">+</span></button>
            <button className="outcome-button not-purchased" onClick={() => { setReason(""); setError(""); setShowNoPurchaseReason(true); }} disabled={!branch || busy || pendingCorrection}><span className="outcome-symbol"><X size={21} /></span><span className="outcome-text"><strong>No purchase</strong><small>Customer left without buying</small></span><span className="outcome-plus">+</span></button>
          </div>
          <button className="secondary-button" style={{ width: "100%", marginTop: 10 }} onClick={() => void startUnavailablePrompt("purchased")} disabled={!branch || busy || pendingCorrection}>Purchased, but requested item unavailable <span>↗</span></button>
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


      {profile?.role === "admin" ? (
        <details className="admin-record-rollup">
          <summary><span className="admin-record-rollup-title"><span className="eyebrow">TODAY'S RECORDS</span><strong>Today's records</strong><small>Expand to review today's visits and read-only outcomes.</small></span><span className="admin-record-rollup-meta">{todaysVisits.length} visits <ChevronDown size={17} /></span></summary>
          <div className="admin-record-rollup-content"><VisitCorrections visits={todaysVisits} onUpdated={loadVisits} canEdit={false} /></div>
        </details>
      ) : <VisitCorrections visits={todaysVisits} onUpdated={loadVisits} canEdit={true} />}
      {profile?.role === "admin" ? (
        <details className="admin-record-rollup">
          <summary><span className="admin-record-rollup-title"><span className="eyebrow">HISTORICAL RECORDS</span><strong>Historical records</strong><small>Search previous dates, filter by branch, and export CSVs.</small></span><span className="admin-record-rollup-meta">Last 90 days <ChevronDown size={17} /></span></summary>
          <div className="admin-record-rollup-content"><HistoricalVisits branch={branch} branches={branches} profile={profile} /></div>
        </details>
      ) : (
        <details className="admin-record-rollup staff-history-rollup">
          <summary><span className="admin-record-rollup-title"><span className="eyebrow">HISTORY &amp; EXPORT</span><strong>Historical records &amp; CSV export</strong><small>Review past visits or download a CSV for a date range.</small></span><span className="admin-record-rollup-meta">Last 90 days <ChevronDown size={17} /></span></summary>
          <div className="admin-record-rollup-content"><HistoricalVisits branch={branch} branches={branches} profile={profile} /></div>
        </details>
      )}

      {/* Manual backup stays collapsed and directly above the testing warning. */}
      {profile && <ManualBackup role={profile.role} branchSlug={branch?.slug} />}

      <details className="testing-cutoff">
        <summary><CalendarDays size={16} /> Testing cutoff and historical records</summary>
        <div className="testing-cutoff-content"><strong>Testing ended: Tuesday, 13 October 2026</strong><p>From Wednesday, 14 October 2026, visits are intended to be live operational records. Historical records have not been changed.</p></div>
      </details>
      </>
      )}

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
            <div className="branch-options">{REASONS.map((item) => <button key={item} type="button" className="branch-option" disabled={busy} onClick={() => { setReason(item); setShowNoPurchaseReason(false); if (item === "Item unavailable") { void startUnavailablePrompt("not_purchased", item); } else { void addVisits("not_purchased", 1, item); } }}><span className="branch-option-icon"><X size={18} /></span><span><strong>{item}</strong></span><span className="outcome-plus">→</span></button>)}</div>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="text-button" type="button" onClick={() => setShowNoPurchaseReason(false)} disabled={busy}>Cancel</button>
          </section>
        </div>
      )}

      {showUnavailablePrompt && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="unavailable-prompt-title" onSubmit={(event) => { event.preventDefault(); void saveUnavailableItem(); }}>
            <button className="modal-close" type="button" aria-label="Close product details prompt" disabled={busy} onClick={deferUnavailablePrompt}><X size={19} /></button>
            <p className="eyebrow">UNAVAILABLE ITEM REPORT</p>
            <h2 id="unavailable-prompt-title">Which item was unavailable?</h2>
            <p className="modal-description">{unavailableOutcome === "purchased" ? "Record the item the customer couldn't obtain, even though they purchased something else." : "Record the item that led to the customer leaving without a purchase."} This report will be shared with staff and admins.</p>
            <label className="field-label" htmlFor="unavailable-item-name">Product name, strength and form <span>Required</span></label>
            <textarea className="unavailable-item-input" id="unavailable-item-name" maxLength={180} autoFocus required value={unavailableItemName} onChange={(event) => setUnavailableItemName(event.target.value)} placeholder="e.g. Amoxicillin 500 mg capsules" />
            <label className="field-label" htmlFor="unavailable-item-photo">Add a picture <span>Optional</span></label>
            <input className="unavailable-photo-input" id="unavailable-item-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={(event) => selectUnavailablePhoto(event.target.files?.[0] ?? null)} />
            {unavailableItemPhotoPreview && <div className="unavailable-photo-preview"><img src={unavailableItemPhotoPreview} alt="Selected unavailable item preview" /><div><strong>{unavailableItemPhoto?.name}</strong><small>Photo ready to attach</small><button className="text-button" type="button" disabled={busy} onClick={clearUnavailablePhoto}>Remove picture</button></div></div>}
            <p className="modal-footnote">JPG, PNG or WebP, up to 5 MB. Please do not photograph prescriptions or documents showing patient-identifying details.</p>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy || !unavailableItemName.trim()}>{busy ? "Saving report…" : "Save unavailable item"} <span>→</span></button>
            <button className="text-button" type="button" disabled={busy} onClick={deferUnavailablePrompt}>Close for now</button>
            <p className="modal-footnote">Saving the product name records the visit and unavailable item together. If you close for now, the visit will still be recorded without product details, which can be added later from Recent visits.</p>
          </form>
        </div>
      )}

      {showBranchPicker && profile?.role !== "admin" && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="branch-title">
            <div className="modal-brand"><span className="brand-mark"><FootlyticsMark /></span><span className="eyebrow">DAILY BRANCH SETUP</span></div>
            <h2 id="branch-title">{branchPickerIsChange ? "Change your active branch?" : "Select the branch where you're working"}</h2>
            <p className="modal-description">{branchPickerIsChange ? (todaysVisits.length > 0 ? "Select the branch that today's visits should have been recorded under. Continuing will submit a correction request and pause new visit entry until an administrator reviews it." : "Select the branch you need to work in. You will be asked to confirm before the active branch changes.") : "Choose the branch where you're working today. Only branches assigned to your account are available. Your selection remains active until the next Lagos calendar day, including after closing your browser."}</p>
            {branchPickerIsChange && <p className="branch-switch-warning" role="alert"><strong>IMPORTANT: Changing branches may briefly interrupt data entry while branch information reloads. Finish any entry in progress first, then confirm the active branch before recording more visits.</strong></p>}
            {pendingCorrection && <p className="modal-footnote">A correction is already pending. Close this window and wait for administrator review.</p>}
            <div className="branch-options">{(todaysVisits.length > 0 ? correctionTargets : branches).map((item) => <button key={item.id} disabled={pendingCorrection || busy} className={branchChoice === item.id ? "branch-option selected" : "branch-option"} onClick={() => setBranchChoice(item.id)}><span className="branch-option-icon"><Users size={18} /></span><span><strong>{item.name}</strong><small>{branches.some((branchItem) => branchItem.id === item.id) ? "Assigned pharmacy branch" : "Correction destination only"}</small></span><span className="radio-mark">{branchChoice === item.id && <span />}</span></button>)}</div>
            <button className="primary-button" disabled={!branchChoice || busy || loadingVisits || pendingCorrection} onClick={() => { if (branchPickerIsChange && branch && branchChoice !== branch.id) setShowBranchChangeConfirm(true); else void chooseBranch(); }}>{busy ? "Submitting…" : branchPickerIsChange ? "Continue" : "Select branch"} <span>→</span></button>
            <p className="modal-footnote"><Clock3 size={13} /> Branch access is controlled by the database.</p>
          </section>
        </div>
      )}

      {showBranchChangeConfirm && branchPickerIsChange && branch && (
        <div className="modal-backdrop branch-confirm-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="branch-change-confirm-title">
            <p className="eyebrow">CONFIRM BRANCH CHANGE</p>
            <h2 id="branch-change-confirm-title">Are you sure you want to change branches?</h2>
            <p className="modal-description">You're changing your active branch from <strong>{branch.name}</strong> to <strong>{branches.find((item) => item.id === branchChoice)?.name ?? "the selected branch"}</strong>.</p>
            <p className="branch-switch-warning" role="alert"><strong>Before continuing, make sure you've finished any visit entry in progress. Check the active branch again after switching.</strong></p>
            {todaysVisits.length > 0 && <p className="modal-description">Visits have already been recorded for today. Continuing will send a correction request to an administrator and pause new visit entry until it is reviewed.</p>}
            <button className="primary-button" disabled={busy || loadingVisits || pendingCorrection} onClick={() => { setShowBranchChangeConfirm(false); void chooseBranch(); }}>Yes, change branch <span>→</span></button>
            <button className="secondary-button branch-confirm-cancel" disabled={busy} onClick={() => setShowBranchChangeConfirm(false)}>Cancel, keep current branch</button>
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
