-- Add email_context column to documents for storing email provenance metadata
-- Stores sender, subject, body snippet, and cross-references when email body
-- is also stored as a separate document.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_context jsonb;
