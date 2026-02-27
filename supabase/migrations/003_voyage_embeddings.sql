-- Switch embedding dimensions from 1536 (OpenAI) to 1024 (Voyage AI voyage-3.5)

-- Drop existing chunks data (no production embeddings exist yet)
truncate table chunks cascade;

-- Change the embedding column dimension
alter table chunks
  alter column embedding type vector(1024);

-- Update match_chunks function to use 1024 dimensions
create or replace function match_chunks(
  query_embedding vector(1024),
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
