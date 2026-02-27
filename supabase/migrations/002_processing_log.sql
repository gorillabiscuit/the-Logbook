-- ============================================================
-- PROCESSING LOG (tracks pipeline stages per document)
-- ============================================================
create table processing_log (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  stage text not null, -- 'extraction', 'pii_scrub', 'categorization', 'embedding', 'indexing'
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table processing_log enable row level security;

create policy "processing_log_select_admin" on processing_log for select
  using (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
  ));

create policy "processing_log_insert_service" on processing_log for insert
  with check (true);

create policy "processing_log_update_service" on processing_log for update
  using (true);

create index processing_log_document_id_idx on processing_log(document_id);

-- ============================================================
-- Add processing_error column to documents
-- ============================================================
alter table documents add column if not exists processing_error text;

-- ============================================================
-- match_chunks: vector similarity search function
-- ============================================================
create or replace function match_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_privacy text[] default array['shared']
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  chunk_index integer,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.document_id,
    c.content,
    c.chunk_index,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where d.privacy_level = any(filter_privacy)
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;
