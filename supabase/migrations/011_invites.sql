-- ============================================================
-- INVITE SYSTEM + AUDIT LOG
-- ============================================================

-- Invite codes (shareable links)
create table invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  role text not null default 'owner' check (role in ('super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner', 'tenant')),
  max_uses integer, -- null = unlimited
  uses_count integer not null default 0,
  expires_at timestamptz,
  created_by uuid references profiles(id),
  is_active boolean not null default true,
  created_at timestamptz default now()
);

alter table invites enable row level security;

-- Admin-only read/write
create policy "invites_admin_select" on invites for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee'))
);
create policy "invites_admin_insert" on invites for insert with check (
  exists (select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee'))
);
create policy "invites_admin_update" on invites for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee'))
);

-- Invite claims (tracks who used each code)
create table invite_claims (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references invites(id) on delete cascade,
  email text not null,
  user_id uuid references profiles(id),
  claimed_at timestamptz default now()
);

alter table invite_claims enable row level security;

create policy "invite_claims_admin_select" on invite_claims for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee'))
);

-- Audit log for all access-related events
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null, -- invite_sent, invite_bulk, invite_code_created, invite_code_claimed, invite_code_deactivated, user_pre_approved
  target_email text,
  metadata jsonb default '{}',
  ip_address text,
  created_at timestamptz default now()
);

alter table audit_log enable row level security;

create policy "audit_log_admin_select" on audit_log for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee'))
);
-- Insert via service role only (no user-facing insert policy)

-- ============================================================
-- UPDATE handle_new_user() to read role + unit_number from metadata
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role, unit_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'owner'),
    new.raw_user_meta_data->>'unit_number'
  );
  return new;
end;
$$;

-- Explicit grants for service_role and authenticated
grant all on invites to service_role, authenticated;
grant all on invite_claims to service_role, authenticated;
grant all on audit_log to service_role, authenticated;

-- Index for fast code lookups
create index idx_invites_code on invites (code);
create index idx_audit_log_created_at on audit_log (created_at desc);
create index idx_invite_claims_invite_id on invite_claims (invite_id);
