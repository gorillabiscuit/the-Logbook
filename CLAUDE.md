# The Logbook

## Project Overview

The Logbook is a POPIA-compliant, AI-powered collective knowledge platform for the residential owners of The Yacht Club Sectional Title Scheme in Cape Town, South Africa. It serves as institutional memory, legal resource, and practical building management tool.

The scheme is a mixed-use development (residential/hotel/commercial/parking) managed by developer AMDEC Group. The residential body corporate has limited voting power (1 of 6 votes despite 40.5% PQ) and the developer has substituted prescribed management rules with a constitution that may be legally invalid. The platform exists to consolidate evidence, empower owners, and support potential legal action.

There are approximately 180 residential units.

## Tech Stack

- **Frontend:** Nuxt 3 with Nuxt UI component library
- **Backend/Database:** Supabase (Postgres + pgvector + Auth + Storage + Row Level Security + Edge Functions)
- **AI/RAG:** LangChain + Claude API (Anthropic) for querying; Voyage AI or OpenAI for embeddings
- **Document Processing:** Unstructured.io for PDF/DOCX/image text extraction
- **Search:** Meilisearch for browsable full-text search; pgvector for semantic/AI retrieval
- **Email Ingestion:** Cloudflare Email Workers or Postmark Inbound (webhook-based)
- **Notifications:** Novu (open source)
- **Rich Text Editing:** Tiptap
- **Hosting:** Vercel (frontend) + Supabase (backend) + Railway (if needed for Python processing workers)

## Design Principles

1. **Library-first:** Never build from scratch what a mature open-source library handles. Auth, search, notifications, UI components — use established solutions.
2. **Self-extending ontology:** The system's understanding of the building grows organically. When new entities (assets, contractors, issues) appear in documents, the AI proposes new entries in the knowledge graph. Trustees approve or adjust.
3. **Lowest friction ingestion:** The easiest way to contribute is forwarding an email. The web upload exists for people who want more control. Never require metadata — AI fills gaps.
4. **Privacy by design:** Every document gets a privacy tier. PII is auto-scrubbed before shared display. Row Level Security enforces access tiers at the database level.
5. **Legal utility:** Everything is built with the awareness that this data may be used in legal proceedings. Source attribution, timestamps, chain of custody, original document preservation.

## User Roles & Access Tiers

| Role | Code | Can Upload | Can See | AI Scope | Admin |
|------|------|-----------|---------|----------|-------|
| Super Admin | `super_admin` | Everything | Everything incl. privileged | Full | Full |
| Trustee | `trustee` | Everything | Everything incl. privileged | Full | Approve users, review flags |
| Lawyer | `lawyer` | Legal docs | Everything incl. privileged + raw downloads | Full | None |
| Building Manager | `building_manager` | Operational docs | Shared + operational (not privileged) | Operational scope | None |
| Management Company | `management_co` | Operational docs | Shared + operational (not privileged) | Operational scope | None |
| Owner | `owner` | Own documents | Shared + own private | Non-privileged | None |
| Tenant | `tenant` | Issue reports | Building info, notices, contractors | Building info only | None |

## Document Privacy Levels

Every document gets one of three levels:

- **`shared`** — Visible to all authenticated users. Default for general complaints, photos, AGM minutes, financial statements, maintenance records.
- **`private`** — Visible only to Trustees + Lawyer + the submitter. For sensitive personal documents, financial details, personal correspondence.
- **`privileged`** — Visible only to Trustees + Lawyer. Auto-applied to legal opinions/strategy. Can only be uploaded via web interface by authorized users, never via email.

## Email Ingestion

Two dedicated email addresses:
- `share@logbook.yachtclub.co.za` → classified as `shared`
- `private@logbook.yachtclub.co.za` → classified as `private`

Privileged documents can ONLY be uploaded through the web interface.

Processing pipeline: email arrives → webhook fires → extract sender (match to user) → extract attachments → extract body text as context → run through document processing pipeline.

## Database Schema

### Core Tables

```sql
-- User profiles (extends Supabase Auth)
create table profiles (
  id uuid primary key references auth.users(id),
  full_name text not null,
  email text not null,
  phone text,
  unit_number text,
  role text not null check (role in ('super_admin', 'trustee', 'lawyer', 'building_manager', 'management_co', 'owner', 'tenant')),
  is_active boolean default true,
  consent_accepted_at timestamptz,
  consent_ip_address text,
  consent_version text,
  created_at timestamptz default now(),
  deactivated_at timestamptz
);

-- Documents
create table documents (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references profiles(id),
  title text,
  original_filename text,
  file_url text not null, -- Supabase Storage path
  file_size_bytes bigint,
  mime_type text,
  privacy_level text not null default 'shared' check (privacy_level in ('shared', 'private', 'privileged')),
  doc_type text, -- letter, contract, minutes, invoice, photo, legal_opinion, etc.
  doc_date date, -- date of the document itself (not upload date)
  source_channel text check (source_channel in ('web_upload', 'email_shared', 'email_private')),
  processing_status text default 'pending' check (processing_status in ('pending', 'processing', 'completed', 'failed', 'flagged_for_review')),
  extracted_text text,
  ai_summary text,
  ai_confidence float,
  scrubbed_text text, -- PII-redacted version
  created_at timestamptz default now(),
  processed_at timestamptz
);

-- Document chunks for RAG
create table chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  chunk_index integer not null,
  embedding vector(1536), -- dimension depends on embedding model
  metadata jsonb default '{}', -- extra context for retrieval
  created_at timestamptz default now()
);

-- Categories (hierarchical)
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references categories(id),
  description text,
  is_auto_created boolean default false,
  created_at timestamptz default now()
);

-- Document-category junction
create table document_categories (
  document_id uuid references documents(id) on delete cascade,
  category_id uuid references categories(id) on delete cascade,
  confidence float, -- AI confidence in this categorization
  primary key (document_id, category_id)
);

-- Issues
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

-- Issue-document junction
create table issue_documents (
  issue_id uuid references issues(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  primary key (issue_id, document_id)
);

-- Knowledge graph entities (self-extending)
create table entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null, -- asset, contractor, person, contract, rule, decision, promise, event
  name text not null,
  properties jsonb default '{}',
  discovered_from_document_id uuid references documents(id),
  is_confirmed boolean default false, -- false = auto-discovered, true = trustee-approved
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Entity relationships
create table entity_relations (
  id uuid primary key default gen_random_uuid(),
  entity_a_id uuid references entities(id) on delete cascade,
  entity_b_id uuid references entities(id) on delete cascade,
  relation_type text not null, -- maintained_by, located_in, governed_by, promised_in, contradicted_by, etc.
  properties jsonb default '{}',
  created_at timestamptz default now()
);

-- Entity mentions in documents
create table entity_mentions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  chunk_id uuid references chunks(id) on delete set null,
  context_snippet text, -- surrounding text for quick reference
  created_at timestamptz default now()
);

-- Timeline events
create table timeline_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  title text not null,
  description text,
  event_type text, -- agm, rule_change, maintenance, legal, financial, promise, incident
  source_document_id uuid references documents(id),
  issue_id uuid references issues(id),
  privacy_level text default 'shared' check (privacy_level in ('shared', 'private', 'privileged')),
  is_auto_generated boolean default false,
  created_at timestamptz default now()
);

-- AI chat conversations
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  source_chunks jsonb default '[]', -- references to chunks used in response
  created_at timestamptz default now()
);

-- Trusted contractors directory
create table contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  speciality text not null, -- plumbing, electrical, painting, glazing, locksmith, appliance, etc.
  phone text,
  email text,
  notes text,
  is_active boolean default true,
  added_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- Contractor ratings
create table contractor_ratings (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid references contractors(id) on delete cascade,
  rated_by uuid references profiles(id),
  rating integer check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now(),
  unique(contractor_id, rated_by)
);

-- Building notices
create table notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  notice_type text default 'general', -- general, maintenance, agm, urgent, event
  published_by uuid references profiles(id),
  is_pinned boolean default false,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- Consent log (POPIA compliance)
create table consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  consent_version text not null,
  accepted boolean not null,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);
```

### Row Level Security Policies

RLS is critical — it enforces the privacy tiers at the database level:

```sql
-- Documents: users can see shared docs, their own private docs, 
-- and trustees/lawyers can see everything
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

-- Similar policies needed for: chunks, issues, timeline_events, messages
-- Building manager/management_co: shared + operational categories only
-- Tenants: notices + contractors + building info only
```

## Default Categories (Seed Data)

Hierarchical categories to start with (the system will propose additions over time):

```
Governance
├── AGM / SGM
├── Voting & Resolutions
├── Constitution & Rules
├── Trustee Decisions
└── Developer Relations

Legal
├── Legal Opinions
├── Correspondence
├── CSOS / Ombud
├── Contracts & Agreements
└── Deed of Sale / Title

Financial
├── Levies & Special Levies
├── Budgets
├── Financial Statements
├── Reserve Fund
└── Insurance

Maintenance
├── Common Property
├── Plumbing
├── Electrical
├── Lifts
├── HVAC / Heat Pumps
├── Security Systems
├── Fire Equipment
├── Painting & Exterior
└── Landscaping

Building Operations
├── Cleaning
├── Security
├── Parking
├── Access Control
├── Waste Management
└── Water & Utilities

Amenities
├── Swimming Pool
├── Gym
├── Common Areas
└── Other Facilities

Complaints
├── Noise
├── Conduct
├── Maintenance Delays
├── Communication Issues
└── Developer Conduct

Historical
├── Original Promises
├── Marketing Material
├── Sales Documentation
└── Scheme Registration
```

## Key Features by Build Phase

### Phase 1: Foundation
- [ ] Supabase project setup (database, auth, storage, RLS)
- [ ] Nuxt 3 project scaffold with Nuxt UI
- [ ] Auth flow: invite link → consent agreement → account creation
- [ ] User profile management with roles
- [ ] Document upload (web) with privacy level selection
- [ ] Document storage in Supabase Storage
- [ ] Basic document browser with filtering by category and date
- [ ] Admin panel: manage users, approve/deactivate accounts

### Phase 2: Document Intelligence
- [ ] Text extraction pipeline (PDF, DOCX, images via Unstructured.io)
- [ ] PII detection and scrubbed version generation
- [ ] AI auto-categorization with confidence scoring
- [ ] Flagging system for low-confidence categorizations
- [ ] Chunking + embedding pipeline (documents → pgvector)
- [ ] Meilisearch integration for full-text browsable search

### Phase 3: AI Query Layer
- [ ] RAG query endpoint (retrieve relevant chunks → Claude synthesis)
- [ ] Chat interface with conversation history
- [ ] Source attribution (responses cite specific documents)
- [ ] Scoped queries (respects user role / privacy tiers)
- [ ] Auto-entity extraction (knowledge graph population)

### Phase 4: Building Management
- [ ] Notice board (with push notifications via Novu)
- [ ] Trusted contractors directory with ratings
- [ ] Issue reporting and tracking
- [ ] Timeline view (chronological scheme history)
- [ ] Maintenance log

### Phase 5: Advanced Intelligence
- [ ] Pattern detection across owners ("5 owners reported same issue")
- [ ] Case builder (group documents + issues into legal cases)
- [ ] Export / report generation (PDF summaries for lawyer)
- [ ] Knowledge graph browser (visual entity relationships)
- [ ] Dashboard: issue counts, document stats, unresolved items

### Phase 6: Extended Ingestion
- [ ] Email ingestion (Cloudflare Workers / Postmark)
- [ ] Google Drive folder sync
- [ ] WhatsApp export parsing
- [ ] Bulk import tool for historical documents

## File Structure

```
logbook/
├── CLAUDE.md                  # This file
├── nuxt.config.ts
├── package.json
├── app/
│   ├── app.vue
│   ├── pages/
│   │   ├── index.vue          # Dashboard / home
│   │   ├── login.vue
│   │   ├── consent.vue        # POPIA consent flow
│   │   ├── documents/
│   │   │   ├── index.vue      # Document browser
│   │   │   ├── upload.vue     # Upload interface
│   │   │   └── [id].vue       # Single document view
│   │   ├── chat/
│   │   │   └── index.vue      # AI query interface
│   │   ├── issues/
│   │   │   ├── index.vue      # Issue tracker
│   │   │   ├── new.vue        # Report issue
│   │   │   └── [id].vue       # Single issue
│   │   ├── notices/
│   │   │   └── index.vue      # Notice board
│   │   ├── contractors/
│   │   │   └── index.vue      # Trusted contractors
│   │   ├── timeline/
│   │   │   └── index.vue      # Scheme history timeline
│   │   └── admin/
│   │       ├── users.vue      # User management
│   │       ├── categories.vue # Category management
│   │       ├── flagged.vue    # Review flagged documents
│   │       └── entities.vue   # Knowledge graph management
│   ├── components/
│   │   ├── DocumentCard.vue
│   │   ├── ChatMessage.vue
│   │   ├── PrivacyBadge.vue
│   │   ├── EntityTag.vue
│   │   ├── TimelineEntry.vue
│   │   └── ContractorCard.vue
│   ├── composables/
│   │   ├── useAuth.ts
│   │   ├── useDocuments.ts
│   │   ├── useChat.ts
│   │   ├── useEntities.ts
│   │   └── useNotices.ts
│   ├── layouts/
│   │   ├── default.vue        # Main app layout with sidebar
│   │   └── auth.vue           # Login/consent layout
│   └── middleware/
│       ├── auth.ts
│       └── role.ts            # Role-based route protection
├── server/
│   ├── api/
│   │   ├── documents/
│   │   ├── chat/
│   │   ├── issues/
│   │   ├── entities/
│   │   ├── notices/
│   │   ├── contractors/
│   │   ├── admin/
│   │   └── webhooks/
│   │       └── email.ts       # Email ingestion webhook
│   ├── utils/
│   │   ├── supabase.ts
│   │   ├── ai.ts              # Claude API + LangChain
│   │   ├── embeddings.ts
│   │   ├── extraction.ts      # Document text extraction
│   │   ├── pii.ts             # PII detection and scrubbing
│   │   └── categorization.ts  # AI categorization
│   └── middleware/
├── supabase/
│   ├── migrations/            # SQL migrations
│   └── seed.sql               # Default categories, etc.
└── workers/                   # Background processing (if needed)
    └── document-processor/    # Async document processing worker
```

## Environment Variables

```env
NUXT_PUBLIC_SUPABASE_URL=
NUXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NUXT_PUBLIC_APP_URL=         # Production site origin (no trailing slash); used for OAuth and invite redirects
ANTHROPIC_API_KEY=
EMBEDDING_API_KEY=           # Voyage AI or OpenAI
MEILISEARCH_HOST=
MEILISEARCH_API_KEY=
NOVU_API_KEY=
EMAIL_WEBHOOK_SECRET=        # For verifying email ingestion webhooks
```

### Supabase Auth URL configuration (dashboard)

Magic links and `inviteUserByEmail` redirect to `{origin}/confirm` (see [`nuxt.config.ts`](nuxt.config.ts) `redirectOptions.callback` and [`server/api/admin/invite.post.ts`](server/api/admin/invite.post.ts)). In the Supabase project under **Authentication → URL configuration**:

- Set **Site URL** to the primary production origin (e.g. `https://the-logbook-orpin.vercel.app`).
- Add **Redirect URLs** for every environment that must accept the callback, for example:
  - `https://the-logbook-orpin.vercel.app/confirm`
  - `http://localhost:3000/confirm` (local dev)
  - If you use Vercel preview deployments, add a pattern such as `https://*.vercel.app/confirm` (or each preview host explicitly).

CLI invites from a machine whose `NUXT_PUBLIC_APP_URL` is localhost should override redirect for production recipients:

`INVITE_APP_URL=https://<your-prod-host> pnpm invite:user <email> <role> [full_name]`

## Important Context

- This platform exists partly to support potential legal proceedings against the developer (AMDEC). Data integrity, timestamps, and source attribution are critical.
- The owner (Wouter) is the current chairman of the residential body corporate and will be the initial super_admin.
- The lawyer (Judith) needs raw document access and the ability to query the AI across all documents.
- POPIA compliance is mandatory. A participation agreement / consent document has been drafted and needs to be presented to users before they can access the platform.
- The developer (AMDEC) must be explicitly excluded from accessing the platform.
- The system should be designed so that if Wouter steps down as chairman, admin control transfers to the new chairman or another trustee. The platform belongs to the residential body corporate, not any individual.

## Coding Conventions

- Use TypeScript throughout
- Use Nuxt 3 auto-imports (no manual importing of Vue composables)
- Use Nuxt UI components — don't build custom UI where Nuxt UI has a component
- Use Supabase client libraries — don't write raw SQL in the frontend
- Server API routes handle business logic; frontend is thin
- All dates stored as UTC, displayed in SAST (Africa/Johannesburg)
- Use Zod for validation on both client and server
