-- ============================================================
-- GOOGLE DRIVE SYNC: tracks imported Drive files (deduplication)
-- ============================================================
create table drive_sync_files (
  id uuid primary key default gen_random_uuid(),
  google_file_id text not null unique,
  document_id uuid references documents(id) on delete set null,
  google_folder_id text not null,
  synced_by uuid references profiles(id),
  synced_at timestamptz default now()
);

alter table drive_sync_files enable row level security;

create policy "drive_sync_files_select_admin" on drive_sync_files for select
  using (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
  ));

create policy "drive_sync_files_insert_service" on drive_sync_files for insert
  with check (true);

create index drive_sync_files_google_file_id_idx on drive_sync_files(google_file_id);
create index drive_sync_files_google_folder_id_idx on drive_sync_files(google_folder_id);
create index drive_sync_files_synced_by_idx on drive_sync_files(synced_by);

-- ============================================================
-- Add 'google_drive' to documents.source_channel check constraint
-- ============================================================
alter table documents drop constraint if exists documents_source_channel_check;
alter table documents add constraint documents_source_channel_check
  check (source_channel in ('web_upload', 'email_shared', 'email_private', 'google_drive'));
