import { useCallback, useEffect, useState } from "react";
import { Check, Clock3, X } from "lucide-react";
import { supabase } from "../lib/supabase";

type Branch = { id: string; name: string; slug: string };
type Request = {
  id: string;
  source_branch_id: string;
  target_branch_id: string;
  visit_date: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  resolved_at: string | null;
};
type Visit = {
  id: string;
  recorded_at: string;
  outcome: "purchased" | "not_purchased" | "undecided";
  reason: string | null;
};
type Verification = {
  requestDate: string;
  sourceBranchId: string;
  targetBranchId: string;
  selectedCount: number;
  confirmedMovedCount: number | null;
  sourceRemainingCount: number | null;
  destinationTotalCount: number | null;
  error?: string;
};

export default function BranchCorrectionRequests({ branches, onUpdated }: { branches: Branch[]; onUpdated: () => Promise<void> }) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [resolvedRequests, setResolvedRequests] = useState<Request[]>([]);
  const [activeRequest, setActiveRequest] = useState<Request | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);

  const loadRequests = useCallback(async () => {
    if (!supabase) return;
    const allRequests: Request[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("branch_correction_requests")
        .select("id,source_branch_id,target_branch_id,visit_date,status,created_at,resolved_at")
        .order("created_at", { ascending: false })
        .range(offset, offset + 999);
      if (result.error) {
        setError(`Could not load branch correction requests: ${result.error.message}`);
        return;
      }
      const page = (result.data ?? []) as Request[];
      allRequests.push(...page);
      if (page.length < 1000) break;
    }
    setRequests(allRequests.filter((request) => request.status === "pending").sort((left, right) => left.created_at.localeCompare(right.created_at)));
    setResolvedRequests(allRequests.filter((request) => request.status !== "pending").sort((left, right) => (right.resolved_at ?? "").localeCompare(left.resolved_at ?? "")));
  }, []);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function reviewRequest(request: Request) {
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");
    setVerification(null);
    setActiveRequest(request);
    setSelected([]);
    const result = await supabase
      .from("visits")
      .select("id,recorded_at,outcome,reason")
      .eq("branch_id", request.source_branch_id)
      .eq("visit_date", request.visit_date)
      .order("recorded_at", { ascending: true });
    if (result.error) setError(`Could not load visits for review: ${result.error.message}`);
    else setVisits((result.data ?? []) as Visit[]);
    setBusy(false);
  }

  async function resolveRequest(approve: boolean) {
    if (!supabase || !activeRequest) return;
    if (approve && selected.length === 0) {
      setError("Select the visits that were recorded under the wrong branch.");
      return;
    }
    const destination = branches.find((item) => item.id === activeRequest.target_branch_id)?.name ?? "the destination branch";
    const source = branches.find((item) => item.id === activeRequest.source_branch_id)?.name ?? "the source branch";
    const message = approve
      ? `Move ${selected.length} selected visit(s) from ${source} to ${destination}?`
      : "Reject this branch correction request?";
    if (!window.confirm(message)) return;

    setBusy(true);
    setError("");
    const result = approve
      ? await supabase.rpc("approve_branch_correction", {
          p_request_id: activeRequest.id,
          p_visit_ids: selected,
        })
      : await supabase.rpc("reject_branch_correction", {
          p_request_id: activeRequest.id,
        });
    if (result.error) {
      setError(`Could not ${approve ? "approve" : "reject"} request: ${result.error.message}`);
      setBusy(false);
      return;
    }
    if (approve) {
      const requestDate = activeRequest.visit_date;
      const movedIds = [...selected];
      const [movedResult, sourceCountResult, destinationCountResult] = await Promise.all([
        supabase
          .from("visits")
          .select("id,branch_id,visit_date")
          .in("id", movedIds),
        supabase
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("branch_id", activeRequest.source_branch_id)
          .eq("visit_date", requestDate),
        supabase
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("branch_id", activeRequest.target_branch_id)
          .eq("visit_date", requestDate),
      ]);

      const verificationError = movedResult.error ?? sourceCountResult.error ?? destinationCountResult.error;
      const confirmedMovedCount = verificationError
        ? null
        : (movedResult.data ?? []).filter(
            (visit) => visit.branch_id === activeRequest.target_branch_id && visit.visit_date === requestDate,
          ).length;

      setVerification({
        requestDate,
        sourceBranchId: activeRequest.source_branch_id,
        targetBranchId: activeRequest.target_branch_id,
        selectedCount: movedIds.length,
        confirmedMovedCount,
        sourceRemainingCount: verificationError ? null : sourceCountResult.count ?? 0,
        destinationTotalCount: verificationError ? null : destinationCountResult.count ?? 0,
        error: verificationError?.message,
      });
      setNotice(verificationError
        ? "Correction was approved, but automatic verification could not complete. Refresh Past Records and check both branches."
        : confirmedMovedCount === movedIds.length
          ? "Correction approved and verified against the saved database records."
          : "Correction was approved, but the saved records did not all match the expected destination. Please inspect both branches.");
      await onUpdated();
    } else {
      setNotice("Branch correction request rejected.");
    }
    setActiveRequest(null);
    setVisits([]);
    setSelected([]);
    await loadRequests();
    setBusy(false);
  }

  const branchName = (id: string) => branches.find((item) => item.id === id)?.name ?? "Unknown branch";
  const timeLabel = (value: string) => new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date(value));

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">ADMIN REVIEW</p><h2>Branch correction requests</h2></div>
        <span className="date-pill">{requests.length} pending</span>
      </div>
      <p className="panel-description">Review the visits selected for reassignment. No requester or approver identity is recorded.</p>
      {notice && <div className="notice" role="status"><Check size={15} />{notice}</div>}
      {error && <p className="error-message" role="alert">{error}</p>}
      {verification && (
        <div className="correction-row" role="status">
          <div className="correction-details">
            <strong>Post-approval verification · {verification.requestDate}</strong>
            <span>{branchName(verification.sourceBranchId)} → {branchName(verification.targetBranchId)}</span>
            {verification.error ? (
              <span>Could not verify saved records: {verification.error}</span>
            ) : (
              <>
                <span>{verification.confirmedMovedCount} of {verification.selectedCount} selected visits confirmed in the destination branch for this date.</span>
                <span>Source branch records remaining on that date: {verification.sourceRemainingCount}</span>
                <span>Destination branch total records on that date: {verification.destinationTotalCount}</span>
              </>
            )}
          </div>
          <button className="correction-edit" type="button" disabled={busy} onClick={() => {
            setVerification(null);
            setNotice("");
          }}>Dismiss</button>
        </div>
      )}
      {requests.length === 0 ? (
        <p className="modal-footnote">No pending branch correction requests.</p>
      ) : requests.map((request) => (
        <article className="correction-row" key={request.id}>
          <div className="correction-details">
            <strong>{branchName(request.source_branch_id)} → {branchName(request.target_branch_id)}</strong>
            <span>{request.visit_date}</span>
          </div>
          <button className="correction-edit" type="button" disabled={busy} onClick={() => void reviewRequest(request)}>Review visits</button>
        </article>
      ))}
      <div className="approval-history">
        <div className="panel-heading">
          <div><p className="eyebrow">RESOLVED REQUESTS</p><h3>Approval history</h3></div>
          <span className="date-pill">{resolvedRequests.length} reviewed</span>
        </div>
        <p className="panel-description">Previously approved and rejected branch-correction requests, with the decision date. Approver identity is not stored.</p>
        {resolvedRequests.length === 0 ? (
          <p className="modal-footnote">No completed branch correction decisions yet.</p>
        ) : resolvedRequests.map((request) => (
          <article className="correction-row" key={request.id}>
            <div className="correction-details">
              <strong>{branchName(request.source_branch_id)} → {branchName(request.target_branch_id)}</strong>
              <span>{request.visit_date}</span>
              <span>{request.status === "approved" ? "Approved" : "Rejected"}{request.resolved_at ? ` · ${new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(request.resolved_at))}` : ""}</span>
            </div>
            <span className={request.status === "approved" ? "correction-badge purchased" : "correction-badge not-purchased"}>{request.status === "approved" ? "Approved" : "Rejected"}</span>
          </article>
        ))}
      </div>
      {activeRequest && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="branch-correction-review-title">
            <button className="modal-close" type="button" aria-label="Close review" disabled={busy} onClick={() => setActiveRequest(null)}><X size={19} /></button>
            <p className="eyebrow">CONFIRM CORRECTION</p>
            <h2 id="branch-correction-review-title">{branchName(activeRequest.source_branch_id)} → {branchName(activeRequest.target_branch_id)}</h2>
            <p className="modal-description">Select only the visits that were recorded under the wrong branch. Unselected visits will stay where they are.</p>
            {visits.length === 0 ? <p className="modal-footnote">No visits are available for this request.</p> : (
              <div className="corrections-list">
                {visits.map((visit) => (
                  <label className="correction-row" key={visit.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(visit.id)}
                      disabled={busy}
                      onChange={(event) => setSelected((current) => event.target.checked
                        ? [...current, visit.id]
                        : current.filter((id) => id !== visit.id))}
                    />
                    <span className="correction-time"><Clock3 size={12} />{timeLabel(visit.recorded_at)}</span>
                    <span className="correction-details">
                      <strong>{visit.outcome === "purchased" ? "Purchase" : visit.outcome === "not_purchased" ? "No purchase" : "Undecided"}</strong>
                      <span>{visit.reason ?? ""}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-button" type="button" disabled={busy || selected.length === 0} onClick={() => void resolveRequest(true)}>{busy ? "Saving…" : `Move ${selected.length} selected visit(s)`} <span>→</span></button>
            <button className="text-button" type="button" disabled={busy} onClick={() => void resolveRequest(false)}>Reject request</button>
          </section>
        </div>
      )}
    </section>
  );
}
