-- ============================================================
-- GOOGLE DRIVE OAUTH: per-user Google Drive token storage
-- ============================================================
create table google_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  token_expiry timestamptz,
  scope text,
  google_email text,
  connected_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table google_tokens enable row level security;

-- Users can read/delete their own tokens
create policy "google_tokens_select_own" on google_tokens for select
  using (user_id = auth.uid());

create policy "google_tokens_delete_own" on google_tokens for delete
  using (user_id = auth.uid());

-- Admins can see all tokens (for oversight)
create policy "google_tokens_select_admin" on google_tokens for select
  using (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
  ));

-- Service role inserts/updates (via server endpoints)
create policy "google_tokens_insert_service" on google_tokens for insert
  with check (true);

create policy "google_tokens_update_service" on google_tokens for update
  using (true);

create index google_tokens_user_id_idx on google_tokens(user_id);

-- Grant table-level permissions
grant all on google_tokens to authenticated;
grant all on google_tokens to service_role;

-- ============================================================
-- Update drive_sync_files RLS: users can see their own syncs
-- ============================================================
drop policy if exists "drive_sync_files_select_admin" on drive_sync_files;

-- Admins see all, users see their own
create policy "drive_sync_files_select" on drive_sync_files for select
  using (
    synced_by = auth.uid()
    or exists (
      select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
    )
  );
