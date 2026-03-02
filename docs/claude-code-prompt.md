# Implementation Task: Document Sensitivity Tiers & Download Controls

## Context

The Logbook is a Nuxt 3 + Supabase platform for a residential body corporate (180 units) in Cape Town. It stores documents uploaded by owners, trustees, and lawyers. Documents already have a `privacy_level` field (shared, private, privileged) and a PII scrubbing pipeline.

We need to add a **document sensitivity classification system** that controls:
1. What level of PII scrubbing is applied per document type
2. Who can download documents (vs view-only)
3. What each role sees (full, lightly scrubbed, heavily scrubbed, or no access)

This is driven by South African law — POPIA (Protection of Personal Information Act) requires minimisation of personal data, but the STSMA (Sectional Titles Schemes Management Act, PMR 26(2)) gives owners a statutory right to inspect financial records. The balance is: scheme-level financial documents can show owner names and levy amounts (needed to assess scheme finances), but personal financial documents like sale agreements must be heavily redacted.

## Sensitivity Tiers

### Tier 1 — Scheme Operations
**Examples:** Levy statements, levy rolls, AGM minutes, trustee meeting minutes, maintenance invoices, insurance certificates, annual financial statements, budget documents, contractor quotes, building rules, management agency agreements.

**Scrubbing rules (light):**
- Redact: Bank account numbers, ID/passport numbers, personal email addresses, personal phone numbers
- Keep visible: Owner names, unit numbers, levy amounts, voting records, attendance lists
- Rationale: Owners have statutory right to inspect these. Names and levy amounts are necessary to assess scheme financial position.

**Download policy:**
- Owners: ✅ Can download (scrubbed version)
- Trustees: ✅ Can download (full version)
- Lawyer: ✅ Can download (full version)
- Building Manager: ✅ Can download (scrubbed version)
- Tenants: ❌ No download

### Tier 2 — Personal Financial
**Examples:** Offers to purchase, sale agreements, bond/mortgage documents, individual payment arrangements, debt collection correspondence, individual levy arrears notices, personal financial declarations, transfer documents.

**Scrubbing rules (heavy):**
- Redact: Purchase prices, sale amounts, bond amounts, buyer/seller names, ID numbers, bank details, all financial figures, personal addresses (other than unit number within the scheme), attorney details from personal transactions
- Keep visible: Document type, date, general nature of the document, unit number ONLY if the viewing user is a trustee/lawyer
- Rationale: These are personal to individual owners. No statutory right for other owners to see the detail.

**Download policy:**
- Owners (not submitter): ❌ No download — view-only of heavily scrubbed version
- Submitting owner: ✅ Can download their own full version
- Trustees: ✅ Can download (full version)
- Lawyer: ✅ Can download (full version)
- Building Manager: ❌ No access at all
- Tenants: ❌ No access at all

### Tier 3 — Privileged / Legal
**Examples:** Legal opinions, attorney correspondence, litigation strategy, settlement discussions, compliance assessments, privilege-marked communications.

**Scrubbing rules:** None needed — access is restricted entirely by role.

**Download policy:**
- Owners: ❌ No access
- Trustees: ✅ Can download (full version)
- Lawyer: ✅ Can download (full version)
- Building Manager: ❌ No access
- Tenants: ❌ No access

## Access Matrix Summary

| Document Type | Owner View | Owner Download | Trustee View | Trustee Download | Lawyer View | Lawyer Download | Bldg Mgr View | Bldg Mgr Download | Tenant View | Tenant Download |
|---|---|---|---|---|---|---|---|---|---|---|
| Levy statement | Light scrub | ✅ scrubbed | Full | ✅ full | Full | ✅ full | Light scrub | ✅ scrubbed | ❌ | ❌ |
| AGM minutes | Full | ✅ | Full | ✅ | Full | ✅ | Full | ✅ | ❌ | ❌ |
| Maintenance invoice | Light scrub | ✅ scrubbed | Full | ✅ | Full | ✅ | Full | ✅ | ❌ | ❌ |
| Offer to purchase | Heavy scrub | ❌ | Full | ✅ | Full | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sale agreement | Heavy scrub | ❌ | Full | ✅ | Full | ✅ | ❌ | ❌ | ❌ | ❌ |
| Legal opinion | ❌ | ❌ | Full | ✅ | Full | ✅ | ❌ | ❌ | ❌ | ❌ |
| Building rules | Full | ✅ | Full | ✅ | Full | ✅ | Full | ✅ | Full | ✅ |
| Notices | Full | ✅ | Full | ✅ | Full | ✅ | Full | ✅ | Full | ✅ |

**Special case — Submitting owner:** Always has full view + download of their own documents regardless of tier.

## Implementation Steps

### 1. Database Schema Changes

Add to the `documents` table:
- `sensitivity_tier` — enum: `scheme_ops`, `personal_financial`, `privileged_legal` (default: `scheme_ops`)
- `download_policy` — jsonb field or derived from sensitivity_tier + role at query time
- `scrubbing_tier` — enum: `none`, `light`, `heavy` (can be derived from sensitivity_tier, but storing explicitly allows trustee override)

Create a new table `sensitivity_rules`:
```sql
CREATE TABLE sensitivity_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_category text NOT NULL, -- references categories.name or a document_type enum
  sensitivity_tier text NOT NULL CHECK (sensitivity_tier IN ('scheme_ops', 'personal_financial', 'privileged_legal')),
  scrub_fields_light jsonb DEFAULT '["bank_account", "id_number", "personal_email", "personal_phone"]',
  scrub_fields_heavy jsonb DEFAULT '["bank_account", "id_number", "personal_email", "personal_phone", "purchase_price", "sale_amount", "bond_amount", "buyer_name", "seller_name", "financial_figures", "personal_address", "attorney_details"]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

Create a `download_permissions` table or function:
```sql
-- Could be a function instead of a table
CREATE OR REPLACE FUNCTION can_download(
  p_user_role text,
  p_sensitivity_tier text,
  p_is_submitter boolean
) RETURNS boolean AS $$
BEGIN
  -- Submitter can always download their own
  IF p_is_submitter THEN RETURN true; END IF;
  
  CASE p_sensitivity_tier
    WHEN 'scheme_ops' THEN
      RETURN p_user_role IN ('super_admin', 'trustee', 'lawyer', 'building_manager', 'owner');
    WHEN 'personal_financial' THEN
      RETURN p_user_role IN ('super_admin', 'trustee', 'lawyer');
    WHEN 'privileged_legal' THEN
      RETURN p_user_role IN ('super_admin', 'trustee', 'lawyer');
    ELSE
      RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Similarly create a `get_scrub_level` function:
```sql
CREATE OR REPLACE FUNCTION get_scrub_level(
  p_user_role text,
  p_sensitivity_tier text,
  p_is_submitter boolean
) RETURNS text AS $$
BEGIN
  -- Submitter always sees full
  IF p_is_submitter THEN RETURN 'none'; END IF;
  -- Trustees, lawyer, super_admin always see full
  IF p_user_role IN ('super_admin', 'trustee', 'lawyer') THEN RETURN 'none'; END IF;
  
  CASE p_sensitivity_tier
    WHEN 'scheme_ops' THEN RETURN 'light';
    WHEN 'personal_financial' THEN RETURN 'heavy';
    WHEN 'privileged_legal' THEN RETURN 'no_access';
    ELSE RETURN 'heavy'; -- safe default
  END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 2. Update RLS Policies

Update the existing document RLS policies to factor in sensitivity_tier for visibility:
- `privileged_legal` documents: Only visible to super_admin, trustee, lawyer roles
- `personal_financial` documents: Visible to all owners (heavily scrubbed), but building_manager and tenant have no access
- `scheme_ops` documents: Visible to owners and building_manager (lightly scrubbed), tenants only see building rules and notices

### 3. API Changes

**Document view endpoint** (`/api/documents/[id]`):
- Determine user role and whether they are the submitter
- Call `get_scrub_level()` to determine which version to serve
- If `light`: return `scrubbed_text` with only bank/ID numbers redacted
- If `heavy`: return `scrubbed_text` with all PII redacted
- If `none`: return full `extracted_text`
- If `no_access`: return 403

**Document download endpoint** (`/api/documents/[id]/download`):
- Call `can_download()` — if false, return 403 with message explaining why
- If user is owner viewing scheme_ops doc: serve the lightly-scrubbed file
- If user is trustee/lawyer: serve original file
- If user is submitter: serve original file

**Scrubbing pipeline update:**
- Currently produces one scrubbed version. Now needs to produce TWO scrubbed versions per document:
  - `scrubbed_text_light`: Only bank accounts, ID numbers, personal contact details removed
  - `scrubbed_text_heavy`: All PII including names, financial figures, addresses removed
- Store both in the documents table (or chunks table if scrubbing happens at chunk level)
- The AI scrubbing prompt needs to be updated to output both tiers in a single pass

### 4. Auto-Classification

When a document is uploaded and processed by AI:
1. AI categorises the document (already planned)
2. Based on category, auto-assign `sensitivity_tier` using the `sensitivity_rules` lookup
3. Trustee/super_admin can override the auto-assigned tier via the UI

Default mappings:
- Governance → scheme_ops
- Legal → privileged_legal (unless it's a general legal notice → scheme_ops)
- Financial/Levies → scheme_ops
- Financial/Sale Agreements → personal_financial
- Financial/Individual Arrears → personal_financial
- Maintenance → scheme_ops
- Building Operations → scheme_ops
- Complaints → scheme_ops (but individual complaints about specific owners → personal_financial)
- Historical → scheme_ops

### 5. UI Changes

**Document card/list view:**
- Show a sensitivity badge: 🟢 Scheme Ops | 🟡 Personal Financial | 🔴 Privileged
- Download button: Show only if `can_download()` returns true for current user
- If download not allowed, show a tooltip: "This document contains personal financial information and cannot be downloaded per POPIA requirements"

**Document detail view:**
- Display the appropriate scrubbed version based on user role
- If heavily scrubbed, show a notice: "Some personal information has been redacted in accordance with POPIA. Trustees and the scheme's legal representative can view the full document."
- Submitter sees their own document in full with a note: "You are viewing your own submission — full content shown"

**Upload flow:**
- After AI categorisation, show the auto-assigned sensitivity tier
- Allow uploader to suggest a tier change (trustees can confirm or override)
- For Tier 2 (personal financial), warn: "This document will be heavily redacted for other owners. Only trustees and the lawyer will see the full version."

**Admin panel:**
- Add sensitivity tier management: view/edit the category → tier mappings
- Audit log: track when sensitivity tiers are overridden and by whom

### 6. Update CLAUDE.md

Add the sensitivity tier system to the project specification so future Claude Code sessions understand the model.

## Important Notes

- This system works alongside the existing `privacy_level` (shared/private/privileged). Think of `privacy_level` as "who can see this document exists" and `sensitivity_tier` as "how much PII scrubbing is applied and who can download".
- A document can be `privacy_level: shared` + `sensitivity_tier: personal_financial` — meaning all owners know it exists and can see a heavily scrubbed version, but can't download it.
- A document that is `privacy_level: private` is only visible to trustees/lawyer/submitter regardless of sensitivity tier.
- A document that is `privacy_level: privileged` maps directly to `sensitivity_tier: privileged_legal`.
- The scrubbing pipeline should be idempotent — re-running it produces the same output.
- All scrubbing decisions should be logged for POPIA compliance auditing.
