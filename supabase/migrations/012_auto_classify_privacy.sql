-- Add columns for AI-driven privacy classification
alter table documents
  add column if not exists auto_classify_privacy boolean default false;

alter table documents
  add column if not exists ai_privacy_reason text;
