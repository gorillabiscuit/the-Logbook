-- ============================================================
-- STUCK DOCUMENT DETECTION & AUTO-RECOVERY
-- ============================================================

-- Add retry_count column to documents
alter table documents add column if not exists retry_count integer not null default 0;

-- ============================================================
-- find_stuck_documents: returns documents stuck in processing/pending
-- ============================================================
create or replace function find_stuck_documents(
  max_retries integer default 3,
  processing_threshold interval default interval '10 minutes',
  pending_threshold interval default interval '5 minutes'
)
returns table (
  document_id uuid,
  current_status text,
  retry_count integer,
  stuck_since timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    d.id as document_id,
    d.processing_status as current_status,
    d.retry_count,
    coalesce(
      -- For "processing" docs, use the most recent processing_log started_at
      (
        select max(pl.started_at)
        from processing_log pl
        where pl.document_id = d.id and pl.status = 'running'
      ),
      d.created_at
    ) as stuck_since
  from documents d
  where
    (
      -- "processing" for longer than threshold
      d.processing_status = 'processing'
      and coalesce(
        (
          select max(pl.started_at)
          from processing_log pl
          where pl.document_id = d.id and pl.status = 'running'
        ),
        d.created_at
      ) < now() - processing_threshold
    )
    or
    (
      -- "pending" for longer than threshold
      d.processing_status = 'pending'
      and d.created_at < now() - pending_threshold
    )
  order by d.created_at asc;
end;
$$;
