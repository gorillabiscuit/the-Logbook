-- Add progress tracking columns to processing_log
ALTER TABLE processing_log ADD COLUMN IF NOT EXISTS progress integer DEFAULT 0;
ALTER TABLE processing_log ADD COLUMN IF NOT EXISTS detail text;
