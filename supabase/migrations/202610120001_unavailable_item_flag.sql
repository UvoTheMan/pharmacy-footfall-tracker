-- Phase 1: record when a customer buys something despite an unavailable request.
-- No item names are stored in this phase; the visit remains a single visit.
alter table public.visits
  add column if not exists unavailable_item_requested boolean not null default false;

comment on column public.visits.unavailable_item_requested is
  'True when a customer purchased something but at least one requested item was unavailable. Exact item capture is deferred to a later phase.';
