import { FormEvent, useEffect, useState } from "react";
import { Check, Clock3, Edit3, ImagePlus, X } from "lucide-react";
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
  unavailable_item_requested: boolean;
};

const REASONS: Reason[] = [
  "Item unavailable", "Price too high", "Only enquiring",
  "Preferred brand unavailable", "Customer changed mind",
  "Will buy later", "Other / Unknown",
];

type Props = { visits: Visit[]; onUpdated: () => Promise<void>; canEdit?: boolean };

export default function VisitCorrections({ visits, onUpdated, canEdit = true }: Props) {
  const [editing, setEditing] = useState<Visit | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("purchased");
  const [reason, setReason] = useState<Reason | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reportedVisitIds, setReportedVisitIds] = useState<Set<string>>(new Set());
  const [pendingVisit, setPendingVisit] = useState<Visit | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemPhoto, setItemPhoto] = useState<File | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadReportedVisits() {
      const pending = visits.filter((visit) => visit.unavailable_item_requested).map((visit) => visit.id);
      if (!supabase || pending.length === 0) {
        if (active) setReportedVisitIds(new Set());
        return;
      }
      const result = await supabase.from("unavailable_items").select("visit_id").in("visit_id", pending);
      if (active && !result.error) setReportedVisitIds(new Set((result.data ?? []).map((row) => row.visit_id as string)));
    }
    void loadReportedVisits();
    return () => { active = false; };
  }, [visits]);

  function beginEdit(visit: Visit) {
    if (!canEdit) return;
    setEditing(visit);
    setOutcome(visit.outcome === "not_purchased" ? "not_purchased" : "purchased");
    setReason(visit.outcome === "not_purchased" ? visit.reason ?? "" : "");
    setItemName("");
    setItemPhoto(null);
    setError("");
    setNotice("");
  }

  async function saveCorrection() {
    if (!canEdit || !supabase || !editing) return;
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
    const correctedVisit: Visit = {
      ...editing,
      outcome,
      reason: outcome === "not_purchased" ? reason as Reason : null,
      unavailable_item_requested: outcome === "not_purchased" && reason === "Item unavailable"
        ? true
        : outcome === "purchased" ? editing.unavailable_item_requested : false,
    };
    setEditing(null);
    setSaving(false);
    if (outcome === "not_purchased" && reason === "Item unavailable" && !reportedVisitIds.has(editing.id)) {
      setPendingVisit(correctedVisit);
      setItemPhoto(null);
      setNotice("");
    } else {
      setNotice("Visit correction saved.");
    }
    await onUpdated();
  }

  async function savePendingItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !pendingVisit || !itemName.trim()) return;
    setSavingItem(true);
    setError("");
    const auth = await supabase.auth.getUser();
    const userId = auth.data.user?.id;
    if (auth.error || !userId) {
      setError("Your session could not be verified. Close this prompt and sign in again.");
      setSavingItem(false);
      return;
    }
    let imagePath: string | null = null;
    if (itemPhoto) {
      const extension = itemPhoto.type === "image/png" ? "png" : itemPhoto.type === "image/webp" ? "webp" : "jpg";
      imagePath = `${userId}/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from("unavailable-item-photos").upload(imagePath, itemPhoto, { contentType: itemPhoto.type, upsert: false });
      if (upload.error) {
        setError("The product details were not saved because the photo upload failed: " + upload.error.message);
        setSavingItem(false);
        return;
      }
    }
    const result = await supabase.rpc("add_unavailable_item_details", {
      p_visit_id: pendingVisit.id,
      p_item_name: itemName.trim(),
      p_image_path: imagePath,
    });
    if (result.error) {
      if (imagePath) {
        const cleanup = await supabase.storage.from("unavailable-item-photos").remove([imagePath]);
        if (cleanup.error) {
          setError("Product details were not saved: " + result.error.message + ". The uploaded photo could not be cleaned up; please notify the administrator.");
          setSavingItem(false);
          return;
        }
      }
      setError(result.error.code === "23505" ? "Product details have already been added for this visit. The uploaded photo was cleaned up if one was selected. Refresh the list." : "Could not save product details: " + result.error.message);
      setSavingItem(false);
      return;
    }
    setReportedVisitIds((current) => new Set([...current, pendingVisit.id]));
    setPendingVisit(null);
    setItemName("");
    setItemPhoto(null);
    setSavingItem(false);
    setNotice("Product details added to the shared unavailable-items register.");
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
        <p className="panel-description">{canEdit ? "Correct an outcome or no-purchase reason if a visit was recorded incorrectly. Corrections are logged." : "Review today’s visit records for the selected branch. Admin accounts have read-only access to visit outcomes."}</p>
        {notice && <div className="notice" role="status"><Check size={15} />{notice}</div>}
        {visits.length === 0 ? (
          <div className="corrections-empty">No visits recorded for this branch today.</div>
        ) : (
          <div className="corrections-list">
            {visits.map((visit) => (
              <article className={`correction-row${visit.unavailable_item_requested && !reportedVisitIds.has(visit.id) ? " pending-product-details" : ""}`} key={visit.id}>
                <span className="correction-time"><Clock3 size={12} />{timeLabel(visit.recorded_at)}</span>
                <div className="correction-details">
                  <span className={`correction-badge ${visit.outcome === "not_purchased" ? "not-purchased" : "purchased"}`}>
                    {visit.outcome === "not_purchased" ? "No purchase" : visit.outcome === "undecided" ? "Legacy record" : "Purchased"}
                  </span>
                  <strong>{visit.outcome === "not_purchased" ? visit.reason ?? "Reason not recorded" : "Purchase recorded"}</strong>
                  {visit.unavailable_item_requested && !reportedVisitIds.has(visit.id) && <span className="pending-product-label">Product details needed</span>}
                </div>
                {visit.unavailable_item_requested && !reportedVisitIds.has(visit.id) && canEdit && <button type="button" className="correction-edit pending-product-action" onClick={() => { setPendingVisit(visit); setItemPhoto(null); setError(""); }}><ImagePlus size={13} /> Add details</button>}
                {canEdit && <button type="button" className="correction-edit" onClick={() => beginEdit(visit)}><Edit3 size={13} /> Edit</button>}
              </article>
            ))}
          </div>
        )}
      </section>
      {canEdit && pendingVisit && (
        <div className="modal-backdrop" role="presentation">
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="pending-item-title" onSubmit={savePendingItem}>
            <button className="modal-close" type="button" aria-label="Close product details" disabled={savingItem} onClick={() => setPendingVisit(null)}><X size={19} /></button>
            <p className="eyebrow">COMPLETE VISIT DETAILS</p>
            <h2 id="pending-item-title">Which item was unavailable?</h2>
            <p className="modal-description">The visit is already saved. Add the product details now, or close this prompt and return later.</p>
            <label className="field-label" htmlFor="pending-unavailable-name">Product name, strength and form <span>Required</span></label>
            <input className="number-input" id="pending-unavailable-name" maxLength={180} required autoFocus value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="e.g. Amoxicillin 500 mg capsules" />
            <label className="field-label" htmlFor="pending-unavailable-photo">Add a picture <span>Optional</span></label>
            <input className="unavailable-photo-input" id="pending-unavailable-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={savingItem} onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (!file) return;
              if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Choose a JPG, PNG or WebP image."); return; }
              if (file.size > 5 * 1024 * 1024) { setError("The picture must be 5 MB or smaller."); return; }
              setItemPhoto(file);
              setError("");
            }} />
            {itemPhoto && <p className="modal-footnote">Photo selected: {itemPhoto.name}</p>}
            <p className="modal-footnote">JPG, PNG or WebP, up to 5 MB. Do not photograph prescriptions or documents showing patient-identifying details.</p>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={savingItem || !itemName.trim()}>{savingItem ? "Saving details…" : "Save product details"} <span>→</span></button>
            <button className="text-button" type="button" disabled={savingItem} onClick={() => setPendingVisit(null)}>Close for now and fill in later</button>
          </form>
        </div>
      )}
      {canEdit && editing && (
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
                <select id="edit-visit-reason" value={reason} disabled={saving} required onChange={(event) => {
                  const nextReason = event.target.value as Reason | "";
                  setReason(nextReason);
                  if (nextReason !== "Item unavailable") setItemName("");
                }}>
                  <option value="">Select a reason</option>
                  {REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              {reason === "Item unavailable" && !reportedVisitIds.has(editing.id) && <>
                <label className="field-label" htmlFor="edit-unavailable-item-name">Which item was unavailable? <span>Required for register entry</span></label>
                <input className="number-input" id="edit-unavailable-item-name" maxLength={180} value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="e.g. Amoxicillin 500 mg capsules" />
                <p className="modal-footnote">After saving the correction, you can confirm these details in the shared unavailable-items register prompt.</p>
              </>}
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
