-- 009_deduplication.sql
-- Two-tier document deduplication: file hash (exact) + text fingerprint (content)

-- New columns on documents
ALTER TABLE documents ADD COLUMN file_hash text;
ALTER TABLE documents ADD COLUMN text_fingerprint text;
ALTER TABLE documents ADD COLUMN canonical_document_id uuid REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN dedup_status text
  CHECK (dedup_status IN ('unique', 'exact_file_match', 'text_match', 'manual_link'));
ALTER TABLE documents ADD COLUMN dedup_detected_at timestamptz;

-- Partial indexes for fast lookup (only hash non-null rows)
CREATE INDEX documents_file_hash_idx ON documents(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX documents_text_fingerprint_idx ON documents(text_fingerprint) WHERE text_fingerprint IS NOT NULL;
CREATE INDEX documents_canonical_id_idx ON documents(canonical_document_id) WHERE canonical_document_id IS NOT NULL;

-- Add 'dedup' as a valid processing_log stage
-- (processing_log.stage is text, no enum constraint — just documenting it)

-- Lookup function: find existing canonical document with matching file hash
CREATE OR REPLACE FUNCTION find_file_hash_match(p_hash text, p_exclude_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, title text, created_at timestamptz, privacy_level text)
LANGUAGE sql STABLE
AS $$
  SELECT d.id, d.title, d.created_at, d.privacy_level
  FROM documents d
  WHERE d.file_hash = p_hash
    AND d.processing_status IN ('completed', 'flagged_for_review')
    AND d.canonical_document_id IS NULL  -- only match canonical docs
    AND (p_exclude_id IS NULL OR d.id != p_exclude_id)
  ORDER BY d.created_at ASC
  LIMIT 1;
$$;

-- Lookup function: find existing canonical document with matching text fingerprint
CREATE OR REPLACE FUNCTION find_text_fingerprint_match(p_fingerprint text, p_exclude_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, title text, created_at timestamptz, privacy_level text)
LANGUAGE sql STABLE
AS $$
  SELECT d.id, d.title, d.created_at, d.privacy_level
  FROM documents d
  WHERE d.text_fingerprint = p_fingerprint
    AND d.processing_status IN ('completed', 'flagged_for_review')
    AND d.canonical_document_id IS NULL  -- only match canonical docs
    AND (p_exclude_id IS NULL OR d.id != p_exclude_id)
  ORDER BY d.created_at ASC
  LIMIT 1;
$$;
