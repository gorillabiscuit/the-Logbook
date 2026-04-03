-- Safe default for share@ email: ingest as private, then AI may auto-promote to shared
-- or await sender confirmation. Trustees only for rare privilege cases.

alter table documents
  add column if not exists email_public_share_requested boolean not null default false;

alter table documents
  add column if not exists share_publication_status text
  check (
    share_publication_status is null
    or share_publication_status in (
      'auto_promoted_shared',
      'pending_sender_confirm',
      'sender_confirmed_shared',
      'sender_kept_private',
      'trustee_review_privilege',
      'unmatched_sender'
    )
  );

comment on column documents.email_public_share_requested is 'True if sent to share@ — publication to all members is reviewed (AI + optional sender).';
comment on column documents.share_publication_status is 'Outcome of share@ safety review; null for web/private@ uploads.';
