-- RAG: allow owners (and tenants) to retrieve vector chunks from their *own* private
-- uploads, without widening access to other users' private documents.
-- Trustees/lawyers/super_admin already pass filter_privacy including 'private'.

create or replace function match_chunks(
  query_embedding vector(1024),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_privacy text[] default array['shared'],
  include_private_for_user uuid default null
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
stable
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
  where (
    d.privacy_level = any(filter_privacy)
    or (
      include_private_for_user is not null
      and d.privacy_level = 'private'
      and d.uploaded_by is not distinct from include_private_for_user
    )
  )
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$$;
