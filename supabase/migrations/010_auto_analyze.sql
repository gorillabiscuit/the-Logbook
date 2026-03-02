-- Add auto_analyze flag to documents
-- When true, the pipeline will use AI-generated title and doc_type
alter table documents add column if not exists auto_analyze boolean default false;
