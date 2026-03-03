# The Logbook — Project Status & Roadmap

Last updated: 3 March 2026

## What This Platform Is

A POPIA-compliant, AI-powered collective knowledge platform for the residential owners of The Yacht Club Sectional Title Scheme. It serves as institutional memory, legal resource, and building management tool.

---

## Current State: ~85% Feature Complete

The platform is **functional and deployed** at https://the-logbook-orpin.vercel.app. Core document management, AI querying, and building management features are working.

---

## Phase 1: Foundation — COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Supabase project (DB, auth, storage, RLS) | Done | 11 migrations, full RLS policies |
| Nuxt project scaffold with Nuxt UI | Done | Nuxt 4.3.1, Nuxt UI v4, TypeScript |
| Auth flow (magic link → consent → account) | Done | Open signup, POPIA consent gate v1.0 |
| User profiles with roles | Done | 7 roles, profile auto-created on signup |
| Document upload (web) with privacy selection | Done | Single + bulk upload, drag-and-drop, dedup |
| Document storage in Supabase Storage | Done | Private bucket, RLS enforced |
| Document browser with filtering | Done | Privacy, type, status, category, source channel filters |
| Admin: manage users | Done | Role assignment, activate/deactivate |

## Phase 2: Document Intelligence — COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Text extraction (PDF, DOCX, images) | Done | Unstructured.io API, split-PDF for large docs |
| PII detection + scrubbed versions | Done | Claude-based, light/heavy levels, sensitivity-tier-aware |
| AI auto-categorization with confidence | Done | Claude against category tree, confidence scoring |
| Flagging for low-confidence docs | Done | < 60% confidence → flagged_for_review, admin review UI with approve/discard |
| Chunking + embedding pipeline | Done | 1000-char chunks, 200 overlap, Voyage AI 1024-dim embeddings |
| Meilisearch full-text search | Done | Indexes scrubbed_text_heavy, search proxy API |
| Auto-analyse on upload | Done | AI generates title, doc_type, categories when enabled |
| Sensitivity tiers | Done | scheme_ops / personal_financial / privileged_legal, category-based rules |

## Phase 3: AI Query Layer — COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| RAG query endpoint | Done | Vector search (match_chunks) → Claude synthesis |
| Chat interface with conversation history | Done | Multi-turn, persistent conversations in DB |
| Source attribution | Done | Clickable source badges linking to documents |
| Scoped queries (privacy-tier-aware) | Done | RLS + role-based privacy filter on chunk retrieval |
| Entity extraction (knowledge graph) | Done | Claude auto-discovers people, contractors, assets, contracts, rules, promises |

## Phase 4: Building Management — MOSTLY COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Notice board | Done | Create, pin, expire, type badges. Admin-only publishing |
| Contractors directory with ratings | Done | Add contractors, 1-5 star ratings, filter by speciality |
| Issue reporting | Done | Create issues with severity, category, privacy |
| Issue detail/edit page | Done | View, status updates (admin), linked documents display |
| Issue-document linking | **Not built** | Junction table exists, no API or UI to create links |
| Issue comments/activity log | **Not built** | No comment system on issues |
| Timeline view | Done | Manual event creation, type filtering, document linking |
| Auto-generated timeline events | **Not built** | Schema supports it, no code generates events from documents |
| Dashboard | Done | Stats, recent activity, pattern alerts (admin) |

## Phase 5: Advanced Intelligence — PARTIAL

| Feature | Status | Notes |
|---------|--------|-------|
| Pattern detection | Done | "N owners reported issues in category X" on admin dashboard |
| Case builder | **Not built** | No ability to group documents + issues into legal cases |
| Export / report generation | **Partial** | JSON export API exists (admin/lawyer), no frontend UI, no PDF generation |
| Knowledge graph browser | Done | Admin entity browser with relationship management |
| Dashboard stats | Done | Document counts, issue counts, processing status |

## Phase 6: Extended Ingestion — MOSTLY COMPLETE

| Feature | Status | Notes |
|---------|--------|-------|
| Email ingestion | Done | Postmark webhook, smart attachment filtering, email context metadata, auto-analyse |
| Google Drive sync | Done | OAuth2, folder browse, batch sync, dedup-aware |
| WhatsApp export parsing | Done | Multi-format parser, message extraction, participant tracking |
| Bulk import tool | Done | Multi-file upload with per-file dedup checks |

---

## What's NOT Built Yet

### High Priority (Core Functionality Gaps)

1. **Notifications system**
   - No email notifications for anything (new notices, issue status changes, flagged docs)
   - No in-app notification centre
   - Novu was planned but never integrated
   - Impact: Users have to manually check for updates

2. **Issue-document linking UI**
   - The `issue_documents` junction table exists in the database
   - No API endpoint to create/remove links
   - No UI on issue detail page to attach documents
   - Impact: Can't associate evidence with issues

3. **Issue comments / activity log**
   - No way for trustees to add notes or comments to an issue
   - No status change history
   - Impact: Issues are static after creation, no collaboration

4. **Case builder for legal proceedings**
   - No feature to group documents + issues + timeline events into a "case"
   - No export of a case bundle for the lawyer
   - Impact: Judith has to manually collect relevant documents

5. **PDF report export**
   - Export API returns JSON only
   - No frontend trigger for exports
   - No PDF generation (jsPDF, Puppeteer, or similar)
   - Impact: Lawyer can't get a formatted document pack

6. **Auto-generated timeline events**
   - Schema has `is_auto_generated` flag but no code creates events
   - When a document is processed, it should auto-create a timeline entry if it contains a date
   - Impact: Timeline requires manual maintenance

### Medium Priority (UX & Polish)

7. **Scoped AI queries**
   - Currently RAG searches the entire corpus
   - Should allow "search only within this issue" or "search only legal documents"
   - Would improve accuracy and reduce noise as corpus grows

8. **Correspondence threading**
   - Email chains arrive as individual documents
   - No concept of threading or grouping related emails
   - Could use email subjects, sender chains, or entity mentions to auto-group

9. **Invite system / access control**
   - Currently open signup — anyone with an email can create an account
   - No trustee approval step for new users
   - AMDEC or anyone else could sign up
   - Should have: invite links, email domain whitelist, or admin approval queue

10. **Admin role succession**
    - No mechanism to transfer super_admin if chairman steps down
    - Should have: ability for super_admin to designate successor, or multi-admin support

11. **Rate limiting**
    - No rate limiting on API routes
    - AI endpoints (chat, processing) could be abused

12. **Streaming chat responses**
    - Currently waits for full Claude response before displaying
    - Streaming would improve perceived performance for long answers

### Lower Priority (Nice to Have)

13. **Rich text in notices** — Currently plain text only
14. **Contractor detail pages** — Just cards in the directory
15. **Contractor deactivation UI** — Only possible directly in database
16. **Read/unread tracking** on notices
17. **Bulk document delete** from the documents table
18. **Audit log UI** — consent_log table exists but no viewer
19. **Year filtering on timeline** — API supports it, frontend doesn't expose it
20. **Custom components** — Everything uses Nuxt UI directly; shared components would reduce duplication
21. **E2E test suite** — No automated tests
22. **API documentation** — No OpenAPI spec

---

## Architecture Notes for Future Development

### How Token Costs Are Managed
- Documents are processed **once** at upload (extraction + categorization + PII scrub + embedding)
- Queries use **RAG** (retrieve top-8 chunks via vector similarity, ~2-4K tokens → Claude synthesis)
- The full corpus never enters a context window — only relevant chunks do
- Meilisearch handles keyword search with zero AI cost
- PII scrubbing happens once, not per-query

### How Privacy/Security Works
- **Row Level Security** at the Postgres level — users can only query data their role permits
- RAG chunk retrieval is privacy-filtered before reaching Claude
- Prompt injection cannot escalate database permissions
- PII-scrubbed text is what gets indexed in Meilisearch
- Three distinct agent personas (resident vs trustee vs legal) would be a UX improvement but aren't a security boundary — RLS already enforces access

### Scaling Considerations
- As corpus grows, retrieval quality matters more
- Current: top-8 chunks with 0.3 cosine similarity threshold
- Future: add metadata filtering (category, date range, entity), re-ranking, hybrid search (keyword + semantic)
- Chunking strategy (1000 chars / 200 overlap) may need tuning for specific document types

### What's NOT Needed
- **OCR on every query** — text is extracted once and stored (trustee concern already handled)
- **1M token context windows** — RAG retrieves small relevant chunks, not entire documents
- **Multiple separate databases/instances** — RLS handles data isolation within one database
- **LangChain** — listed in original spec but not used; direct Anthropic SDK is simpler

---

## User Perspective: What Would Make This More Useful

### For Owners (residents)
- **Mobile-friendly experience** — the site works on mobile but isn't optimised for it
- **Push notifications** when a notice is published or their issue is updated
- **Simple issue reporting** — "report a problem" flow that's 3 clicks: category → description → done
- **Building info hub** — emergency contacts, building rules summary, utility schedules
- **"Ask about my unit"** — scoped AI queries about documents related to their specific unit
- **WhatsApp bot** — query the system from WhatsApp without opening the website

### For Trustees
- **Issue dashboard** — overview of all open issues by category/severity, trends over time
- **Case builder** — group related documents, issues, and timeline events into a litigation bundle
- **Meeting prep mode** — "summarise everything since last AGM" or "what are the outstanding promises"
- **Automated timeline** — key dates auto-extracted from documents appear on the timeline
- **Owner engagement metrics** — who's contributing, who's been invited but hasn't joined
- **Bulk operations** — approve multiple flagged docs, update multiple issue statuses
- **Email digest** — weekly summary of new documents, issues, and unresolved items

### For the Lawyer (Judith)
- **Case export to PDF** — formatted bundle with table of contents, document summaries, timeline
- **Contradiction detection** — AI flags when documents contradict each other (e.g., developer promises vs. actual)
- **Chain of custody view** — for any document, show who uploaded it, when, from what source, all processing steps
- **Privilege tagging workflow** — bulk-tag documents as privileged, with audit trail
- **Search with date ranges** — "find all correspondence between Jan 2023 and March 2024 about levies"
- **Entity relationship browser** — visual graph of connections between people, companies, contracts, promises

---

## Immediate Next Steps (Suggested Priority)

1. **Run migration 010** — `auto_analyze` column (needed for latest deploy)
2. **Invite system or admin approval** — before sharing more broadly, prevent unauthorized signups
3. **Notifications** — even basic email via Supabase edge functions would be valuable
4. **Issue-document linking** — enable associating evidence with issues
5. **Issue comments** — allow trustees to discuss issues within the platform
6. **PDF export** — critical for legal utility
7. **Scoped AI queries** — filter by category/date for better accuracy
8. **Case builder** — the killer feature for legal proceedings
