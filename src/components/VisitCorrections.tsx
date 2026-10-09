import { useState } from "react";
import { Check, Clock3, Edit3, X } from "lucide-react";
import { supabase } from "../lib/supabase";

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
  outcome: "purchased" | "not_purchased" | "undecided";
  reason: Reason | null;
  batch_id: string | null;
  created_by: string;
};

const REASONS: Reason[] = [
  "Item unavailable", "Price too high", "Only enquiring",
  "Preferred brand unavailable", "Customer changed mind",
  "Will buy later", "Other / Unknown",
];

type Props = { visits: Visit[]; onUpdated: () => Promise<void> };

export default function VisitCorrections({ visits, onUpdated }: Props) {
  const [editing, setEditing] = useState<Visit | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("purchased");
  const [reason, setReason] = useState<Reason | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function beginEdit(visit: Visit) {
    setEditing(visit);
    setOutcome(visit.outcome === "not_purchased" ? "not_purchased" : "purchased");
    setReason(visit.outcome === "not_purchased" ? visit.reason ?? "" : "");
    setError("");
    setNotice("");
  }

  async function saveCorrection() {
    if (!supabase || !editing) return;
    if (outcome === "not_purchased" && !reason) {
      setError("Choose a reason before saving a no-purchase correction.");
      return;
    }
    setSaving(true);
    setError("");
    const result = await supabase.rpc("correct_visit", {
      p_visit_id: editing.id,
      p_outcome: outcome,
      p_reason: outcome === "not_purchased" ? reason : null,
    });
    if (result.error) {
      setError(`Could not save correction: ${result.error.message}`);
      setSaving(false);
      return;
    }
    setEditing(null);
    setSaving(false);
    setNotice("Visit correction saved.");
    await onUpdated();
  }

  const timeLabel = (value: string) => new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date(value));

  return (
    <>
      <section className="panel corrections-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">TODAY'S RECORDS</p><h2>Recent visits</h2></div>
          <span className="date-pill">{visits.length} {visits.length === 1 ? "visit" : "visits"}</span>
        </div>
        <p className="panel-description">Correct an outcome or no-purchase reason if a visit was recorded incorrectly. Corrections are logged.</p>
        {notice && <div className="notice" role="status"><Check size={15} />{notice}</div>}
        {visits.length === 0 ? (
          <div className="corrections-empty">No visits recorded for this branch today.</div>
        ) : (
          <div className="corrections-list">
            {visits.map((visit) => (
              <article className="correction-row" key={visit.id}>
                <span className="correction-time"><Clock3 size={12} />{timeLabel(visit.recorded_at)}</span>
                <div className="correction-details">
                  <span className={`correction-badge ${visit.outcome === "not_purchased" ? "not-purchased" : "purchased"}`}>
                    {visit.outcome === "not_purchased" ? "No purchase" : visit.outcome === "undecided" ? "Legacy record" : "Purchased"}
                  </span>
                  <strong>{visit.outcome === "not_purchased" ? visit.reason ?? "Reason not recorded" : "Purchase recorded"}</strong>
                </div>
                <button type="button" className="correction-edit" onClick={() => beginEdit(visit)}><Edit3 size={13} /> Edit</button>
              </article>
            ))}
          </div>
        )}
      </section>
      {editing && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-visit-title">
            <button className="modal-close" type="button" aria-label="Cancel visit correction" disabled={saving} onClick={() => setEditing(null)}><X size={19} /></button>
            <p className="eyebrow">AUDITED CORRECTION</p>
            <h2 id="edit-visit-title">Edit recorded visit</h2>
            <p className="modal-description">Recorded at {timeLabel(editing.recorded_at)}. The original and corrected values are retained in the audit log.</p>
            <label className="field-label" htmlFor="edit-visit-outcome">Correct outcome</label>
            <div className="select-wrap">
              <select id="edit-visit-outcome" value={outcome} disabled={saving} onChange={(event) => { setOutcome(event.target.value as Outcome); if (event.target.value === "purchased") setReason(""); }}>
                <option value="purchased">Made a purchase</option>
                <option value="not_purchased">No purchase</option>
              </select>
            </div>
            {outcome === "not_purchased" && <>
              <label className="field-label" htmlFor="edit-visit-reason">Reason <span>Required</span></label>
              <div className="select-wrap">
                <select id="edit-visit-reason" value={reason} disabled={saving} required onChange={(event) => setReason(event.target.value as Reason | "")}>
                  <option value="">Select a reason</option>
                  {REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </>}
            {error && <p className="error-message" role="alert">{error}</p>}
            <button type="button" className="primary-button" disabled={saving || (outcome === "not_purchased" && !reason)} onClick={() => void saveCorrection()}>{saving ? "Saving correction…" : "Save correction"} <span>→</span></button>
            <p className="modal-footnote">Changes apply to today's totals after the database confirms the save.</p>
          </section>
        </div>
      )}
    </>
  );
}
