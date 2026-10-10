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
};
type Visit = {
  id: string;
  recorded_at: string;
  outcome: "purchased" | "not_purchased" | "undecided";
  reason: string | null;
};

export default function BranchCorrectionRequests({ branches, onUpdated }: { branches: Branch[]; onUpdated: () => Promise<void> }) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [activeRequest, setActiveRequest] = useState<Request | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadRequests = useCallback(async () => {
    if (!supabase) return;
    const result = await supabase
      .from("branch_correction_requests")
      .select("id,source_branch_id,target_branch_id,visit_date,status,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (result.error) setError(`Could not load branch correction requests: ${result.error.message}`);
    else setRequests((result.data ?? []) as Request[]);
  }, []);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function reviewRequest(request: Request) {
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");
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
    setActiveRequest(null);
    setVisits([]);
    setSelected([]);
    setNotice(approve ? "Selected visits moved to the corrected branch." : "Branch correction request rejected.");
    if (approve) await onUpdated();
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
