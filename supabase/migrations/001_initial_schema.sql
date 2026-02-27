-- Enable required extensions
create extension if not exists vector;

-- ============================================================
-- PROFILES (extends Supabase Auth)
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  unit_number text,
  role text not null default 'owner' check (role in ('super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner', 'tenant')),
  is_active boolean default true,
  consent_accepted_at timestamptz,
  consent_ip_address text,
  consent_version text,
  created_at timestamptz default now(),
  deactivated_at timestamptz
);

alter table profiles enable row level security;

-- All authenticated users can read profiles (avoids infinite recursion
-- since many other RLS policies reference profiles for role checks)
create policy "profiles_select" on profiles for select
  using (auth.uid() is not null);

create policy "profiles_update_own" on profiles for update
  using (id = auth.uid());

-- Auto-create profile on user sign-up (handled via trigger)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- CATEGORIES (hierarchical)
-- ============================================================
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references categories(id),
  description text,
  is_auto_created boolean default false,
  created_at timestamptz default now()
);

alter table categories enable row level security;

create policy "categories_select_all" on categories for select
  using (auth.uid() is not null);

create policy "categories_insert_admin" on categories for insert
  with check (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
  ));

create policy "categories_update_admin" on categories for update
  using (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
  ));

-- ============================================================
-- DOCUMENTS
-- ============================================================
create table documents (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references profiles(id),
  title text,
  original_filename text,
  file_url text not null,
  file_size_bytes bigint,
  mime_type text,
  privacy_level text not null default 'shared' check (privacy_level in ('shared', 'private', 'privileged')),
  doc_type text, -- letter, contract, minutes, invoice, photo, legal_opinion, etc.
  doc_date date,
  source_channel text check (source_channel in ('web_upload', 'email_shared', 'email_private')),
  processing_status text default 'pending' check (processing_status in ('pending', 'processing', 'completed', 'failed', 'flagged_for_review')),
  extracted_text text,
  ai_summary text,
  ai_confidence float,
  scrubbed_text text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

alter table documents enable row level security;

create policy "documents_select" on documents for select using (
  privacy_level = 'shared'
  or uploaded_by = auth.uid()
  or (
    privacy_level in ('private', 'privileged')
    and exists (
      select 1 from profiles
      where id = auth.uid()
      and role in ('super_admin', 'trustee', 'lawyer')
    )
  )
);

create policy "documents_insert" on documents for insert
  with check (auth.uid() is not null);

create policy "documents_update_own" on documents for update
  using (
    uploaded_by = auth.uid()
    or exists (
      select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
    )
  );

create index documents_uploaded_by_idx on documents(uploaded_by);
create index documents_privacy_level_idx on documents(privacy_level);
create index documents_doc_type_idx on documents(doc_type);
create index documents_doc_date_idx on documents(doc_date);
create index documents_processing_status_idx on documents(processing_status);
create index documents_created_at_idx on documents(created_at desc);

-- ============================================================
-- DOCUMENT-CATEGORY JUNCTION
-- ============================================================
create table document_categories (
  document_id uuid references documents(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  confidence float,
  primary key (document_id, category_id)
);

alter table document_categories enable row level security;

create policy "document_categories_select" on document_categories for select
  using (
    exists (
      select 1 from documents d
      where d.id = document_id
      and (
        d.privacy_level = 'shared'
        or d.uploaded_by = auth.uid()
        or exists (
          select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee', 'lawyer')
        )
      )
    )
  );

create policy "document_categories_insert" on document_categories for insert
  with check (auth.uid() is not null);

-- ============================================================
-- CHUNKS (for RAG)
-- ============================================================
create table chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  chunk_index integer not null,
  embedding vector(1536),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

alter table chunks enable row level security;

create policy "chunks_select" on chunks for select
  using (
    exists (
      select 1 from documents d
      where d.id = document_id
      and (
        d.privacy_level = 'shared'
        or d.uploaded_by = auth.uid()
        or exists (
          select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee', 'lawyer')
        )
      )
    )
  );

create policy "chunks_insert_service" on chunks for insert
  with check (auth.uid() is not null);

-- Vector similarity search index (build after bulk load)
create index chunks_document_id_idx on chunks(document_id);
-- Note: create the ivfflat index after loading sufficient data:
-- create index chunks_embedding_idx on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ============================================================
-- ISSUES
-- ============================================================
create table issues (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references profiles(id),
  title text not null,
  description text,
  category_id uuid references categories(id),
  status text default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed', 'escalated')),
  severity text default 'normal' check (severity in ('low', 'normal', 'high', 'critical')),
  privacy_level text default 'shared' check (privacy_level in ('shared', 'private', 'privileged')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

alter table issues enable row level security;

create policy "issues_select" on issues for select using (
  privacy_level = 'shared'
  or created_by = auth.uid()
  or (
    privacy_level in ('private', 'privileged')
    and exists (
      select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee', 'lawyer')
    )
  )
);

create policy "issues_insert" on issues for insert
  with check (auth.uid() is not null);

create policy "issues_update" on issues for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
    )
  );

create index issues_created_by_idx on issues(created_by);
create index issues_status_idx on issues(status);
create index issues_created_at_idx on issues(created_at desc);

-- ============================================================
-- ISSUE-DOCUMENT JUNCTION
-- ============================================================
create table issue_documents (
  issue_id uuid references issues(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  primary key (issue_id, document_id)
);

alter table issue_documents enable row level security;

create policy "issue_documents_select" on issue_documents for select
  using (auth.uid() is not null);

create policy "issue_documents_insert" on issue_documents for insert
  with check (auth.uid() is not null);

-- ============================================================
-- ENTITIES (knowledge graph)
-- ============================================================
create table entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('asset', 'contractor', 'person', 'contract', 'rule', 'decision', 'promise', 'event')),
  name text not null,
  properties jsonb default '{}',
  discovered_from_document_id uuid references documents(id),
  is_confirmed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table entities enable row level security;

create policy "entities_select_all" on entities for select
  using (auth.uid() is not null);

create policy "entities_insert" on entities for insert
  with check (auth.uid() is not null);

create policy "entities_update_admin" on entities for update
  using (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
  ));

create index entities_type_idx on entities(entity_type);
create index entities_name_idx on entities(name);

-- ============================================================
-- ENTITY RELATIONS
-- ============================================================
create table entity_relations (
  id uuid primary key default gen_random_uuid(),
  entity_a_id uuid references entities(id) on delete cascade,
  entity_b_id uuid references entities(id) on delete cascade,
  relation_type text not null,
  properties jsonb default '{}',
  created_at timestamptz default now()
);

alter table entity_relations enable row level security;

create policy "entity_relations_select_all" on entity_relations for select
  using (auth.uid() is not null);

create policy "entity_relations_insert" on entity_relations for insert
  with check (auth.uid() is not null);

-- ============================================================
-- ENTITY MENTIONS
-- ============================================================
create table entity_mentions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  chunk_id uuid references chunks(id) on delete set null,
  context_snippet text,
  created_at timestamptz default now()
);

alter table entity_mentions enable row level security;

create policy "entity_mentions_select_all" on entity_mentions for select
  using (auth.uid() is not null);

create policy "entity_mentions_insert" on entity_mentions for insert
  with check (auth.uid() is not null);

-- ============================================================
-- TIMELINE EVENTS
-- ============================================================
create table timeline_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  title text not null,
  description text,
  event_type text check (event_type in ('agm', 'rule_change', 'maintenance', 'legal', 'financial', 'promise', 'incident')),
  source_document_id uuid references documents(id),
  issue_id uuid references issues(id),
  privacy_level text default 'shared' check (privacy_level in ('shared', 'private', 'privileged')),
  is_auto_generated boolean default false,
  created_at timestamptz default now()
);

alter table timeline_events enable row level security;

create policy "timeline_events_select" on timeline_events for select using (
  privacy_level = 'shared'
  or (
    privacy_level in ('private', 'privileged')
    and exists (
      select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee', 'lawyer')
    )
  )
);

create policy "timeline_events_insert_admin" on timeline_events for insert
  with check (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
  ));

create index timeline_events_date_idx on timeline_events(event_date desc);

-- ============================================================
-- CONVERSATIONS & MESSAGES (AI chat)
-- ============================================================
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table conversations enable row level security;

create policy "conversations_select_own" on conversations for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
    )
  );

create policy "conversations_insert_own" on conversations for insert
  with check (user_id = auth.uid());

create policy "conversations_update_own" on conversations for update
  using (user_id = auth.uid());

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  source_chunks jsonb default '[]',
  created_at timestamptz default now()
);

alter table messages enable row level security;

create policy "messages_select" on messages for select
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
      and (
        c.user_id = auth.uid()
        or exists (
          select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
        )
      )
    )
  );

create policy "messages_insert" on messages for insert
  with check (
    exists (
      select 1 from conversations c
      where c.id = conversation_id
      and c.user_id = auth.uid()
    )
  );

create index messages_conversation_id_idx on messages(conversation_id);
create index messages_created_at_idx on messages(created_at);

-- ============================================================
-- CONTRACTORS
-- ============================================================
create table contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  speciality text not null,
  phone text,
  email text,
  notes text,
  is_active boolean default true,
  added_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table contractors enable row level security;

create policy "contractors_select_all" on contractors for select
  using (auth.uid() is not null);

create policy "contractors_insert_admin" on contractors for insert
  with check (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee', 'building_manager', 'management_co')
  ));

create policy "contractors_update_admin" on contractors for update
  using (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee', 'building_manager', 'management_co')
  ));

-- ============================================================
-- CONTRACTOR RATINGS
-- ============================================================
create table contractor_ratings (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid references contractors(id) on delete cascade,
  rated_by uuid references profiles(id),
  rating integer check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now(),
  unique(contractor_id, rated_by)
);

alter table contractor_ratings enable row level security;

create policy "contractor_ratings_select_all" on contractor_ratings for select
  using (auth.uid() is not null);

create policy "contractor_ratings_insert_own" on contractor_ratings for insert
  with check (rated_by = auth.uid());

create policy "contractor_ratings_update_own" on contractor_ratings for update
  using (rated_by = auth.uid());

-- ============================================================
-- NOTICES
-- ============================================================
create table notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  notice_type text default 'general' check (notice_type in ('general', 'maintenance', 'agm', 'urgent', 'event')),
  published_by uuid references profiles(id),
  is_pinned boolean default false,
  expires_at timestamptz,
  created_at timestamptz default now()
);

alter table notices enable row level security;

create policy "notices_select_all" on notices for select
  using (auth.uid() is not null);

create policy "notices_insert_admin" on notices for insert
  with check (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee', 'building_manager', 'management_co')
  ));

create policy "notices_update_admin" on notices for update
  using (exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee', 'building_manager', 'management_co')
  ));

-- ============================================================
-- CONSENT LOG (POPIA compliance)
-- ============================================================
create table consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  consent_version text not null,
  accepted boolean not null,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);

alter table consent_log enable row level security;

create policy "consent_log_insert_own" on consent_log for insert
  with check (user_id = auth.uid());

create policy "consent_log_select_own_or_admin" on consent_log for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from profiles where id = auth.uid() and role in ('super_admin', 'trustee')
    )
  );
