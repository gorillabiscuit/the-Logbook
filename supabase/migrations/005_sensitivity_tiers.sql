-- ============================================================
-- SENSITIVITY TIERS: Tiered PII scrubbing & download controls
-- ============================================================

-- Add sensitivity_tier column to documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS sensitivity_tier text
  NOT NULL DEFAULT 'scheme_ops'
  CHECK (sensitivity_tier IN ('scheme_ops', 'personal_financial', 'privileged_legal'));

-- Light scrub text (keeps names, levy amounts — redacts bank/ID numbers)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS scrubbed_text_light text;

-- Heavy scrub text (redacts all personal information)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS scrubbed_text_heavy text;

-- Index for filtering by tier
CREATE INDEX IF NOT EXISTS documents_sensitivity_tier_idx ON documents(sensitivity_tier);

-- ============================================================
-- SENSITIVITY RULES: Maps categories to sensitivity tiers
-- ============================================================
CREATE TABLE IF NOT EXISTS sensitivity_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  sensitivity_tier text NOT NULL CHECK (sensitivity_tier IN ('scheme_ops', 'personal_financial', 'privileged_legal')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(category_id)
);

ALTER TABLE sensitivity_rules ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read rules (needed for frontend display)
CREATE POLICY "sensitivity_rules_select" ON sensitivity_rules FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only admins can modify rules
CREATE POLICY "sensitivity_rules_insert_admin" ON sensitivity_rules FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'trustee')));

CREATE POLICY "sensitivity_rules_update_admin" ON sensitivity_rules FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'trustee')));

CREATE POLICY "sensitivity_rules_delete_admin" ON sensitivity_rules FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'trustee')));

-- ============================================================
-- FUNCTION: can_download(role, tier, is_submitter) → boolean
-- ============================================================
CREATE OR REPLACE FUNCTION can_download(
  user_role text,
  doc_sensitivity_tier text,
  is_submitter boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Submitter can always download their own document
  IF is_submitter THEN RETURN true; END IF;

  -- Privileged roles can always download
  IF user_role IN ('super_admin', 'trustee', 'lawyer') THEN RETURN true; END IF;

  -- Tier-specific rules for non-privileged roles
  CASE doc_sensitivity_tier
    WHEN 'scheme_ops' THEN
      -- Owners and building managers can download scheme operational docs
      RETURN user_role IN ('owner', 'building_manager');
    WHEN 'personal_financial' THEN
      -- Only privileged roles (handled above) can download
      RETURN false;
    WHEN 'privileged_legal' THEN
      -- Only privileged roles (handled above) can download
      RETURN false;
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- ============================================================
-- FUNCTION: get_scrub_level(role, tier, is_submitter) → text
-- Returns which scrub level to show: 'none', 'light', 'heavy'
-- ============================================================
CREATE OR REPLACE FUNCTION get_scrub_level(
  user_role text,
  doc_sensitivity_tier text,
  is_submitter boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Submitter sees full original text
  IF is_submitter THEN RETURN 'none'; END IF;

  -- Privileged roles see original text
  IF user_role IN ('super_admin', 'trustee', 'lawyer') THEN RETURN 'none'; END IF;

  -- Tier-specific scrub levels
  CASE doc_sensitivity_tier
    WHEN 'scheme_ops' THEN
      -- Owners/building_manager see light scrub (names kept, bank/ID redacted)
      RETURN 'light';
    WHEN 'personal_financial' THEN
      -- Non-privileged see heavy scrub
      RETURN 'heavy';
    WHEN 'privileged_legal' THEN
      -- Should not reach here (RLS blocks access), but heavy as safety net
      RETURN 'heavy';
    ELSE
      RETURN 'heavy';
  END CASE;
END;
$$;

-- ============================================================
-- SEED: Default sensitivity rules for existing categories
-- ============================================================

-- Governance → scheme_ops (AGM minutes, voting records are scheme-level)
INSERT INTO sensitivity_rules (category_id, sensitivity_tier) VALUES
  ('00000000-0000-0000-0001-000000000001', 'scheme_ops'),
  ('00000000-0000-0000-0001-000000000002', 'scheme_ops'),
  ('00000000-0000-0000-0001-000000000003', 'scheme_ops'),
  ('00000000-0000-0000-0001-000000000004', 'scheme_ops'),
  ('00000000-0000-0000-0001-000000000005', 'scheme_ops'),
  ('00000000-0000-0000-0001-000000000006', 'scheme_ops')
ON CONFLICT (category_id) DO NOTHING;

-- Legal → privileged_legal for opinions, scheme_ops for general correspondence
INSERT INTO sensitivity_rules (category_id, sensitivity_tier) VALUES
  ('00000000-0000-0000-0002-000000000001', 'scheme_ops'),
  ('00000000-0000-0000-0002-000000000002', 'privileged_legal'),
  ('00000000-0000-0000-0002-000000000003', 'scheme_ops'),
  ('00000000-0000-0000-0002-000000000004', 'scheme_ops'),
  ('00000000-0000-0000-0002-000000000005', 'scheme_ops'),
  ('00000000-0000-0000-0002-000000000006', 'personal_financial')
ON CONFLICT (category_id) DO NOTHING;

-- Financial → scheme_ops for scheme finances, personal_financial for individual
INSERT INTO sensitivity_rules (category_id, sensitivity_tier) VALUES
  ('00000000-0000-0000-0003-000000000001', 'scheme_ops'),
  ('00000000-0000-0000-0003-000000000002', 'scheme_ops'),
  ('00000000-0000-0000-0003-000000000003', 'scheme_ops'),
  ('00000000-0000-0000-0003-000000000004', 'scheme_ops'),
  ('00000000-0000-0000-0003-000000000005', 'scheme_ops'),
  ('00000000-0000-0000-0003-000000000006', 'scheme_ops')
ON CONFLICT (category_id) DO NOTHING;

-- Maintenance → scheme_ops
INSERT INTO sensitivity_rules (category_id, sensitivity_tier) VALUES
  ('00000000-0000-0000-0004-000000000001', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000002', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000003', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000004', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000005', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000006', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000007', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000008', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000009', 'scheme_ops'),
  ('00000000-0000-0000-0004-000000000010', 'scheme_ops')
ON CONFLICT (category_id) DO NOTHING;

-- Building Operations → scheme_ops
INSERT INTO sensitivity_rules (category_id, sensitivity_tier) VALUES
  ('00000000-0000-0000-0005-000000000001', 'scheme_ops'),
  ('00000000-0000-0000-0005-000000000002', 'scheme_ops'),
  ('00000000-0000-0000-0005-000000000003', 'scheme_ops'),
  ('00000000-0000-0000-0005-000000000004', 'scheme_ops'),
  ('00000000-0000-0000-0005-000000000005', 'scheme_ops'),
  ('00000000-0000-0000-0005-000000000006', 'scheme_ops'),
  ('00000000-0000-0000-0005-000000000007', 'scheme_ops')
ON CONFLICT (category_id) DO NOTHING;

-- Amenities → scheme_ops
INSERT INTO sensitivity_rules (category_id, sensitivity_tier) VALUES
  ('00000000-0000-0000-0006-000000000001', 'scheme_ops'),
  ('00000000-0000-0000-0006-000000000002', 'scheme_ops'),
  ('00000000-0000-0000-0006-000000000003', 'scheme_ops'),
  ('00000000-0000-0000-0006-000000000004', 'scheme_ops'),
  ('00000000-0000-0000-0006-000000000005', 'scheme_ops')
ON CONFLICT (category_id) DO NOTHING;

-- Complaints → scheme_ops (general complaints are scheme-level)
INSERT INTO sensitivity_rules (category_id, sensitivity_tier) VALUES
  ('00000000-0000-0000-0007-000000000001', 'scheme_ops'),
  ('00000000-0000-0000-0007-000000000002', 'scheme_ops'),
  ('00000000-0000-0000-0007-000000000003', 'scheme_ops'),
  ('00000000-0000-0000-0007-000000000004', 'scheme_ops'),
  ('00000000-0000-0000-0007-000000000005', 'scheme_ops'),
  ('00000000-0000-0000-0007-000000000006', 'scheme_ops')
ON CONFLICT (category_id) DO NOTHING;

-- Historical → scheme_ops (marketing, promises, scheme registration)
INSERT INTO sensitivity_rules (category_id, sensitivity_tier) VALUES
  ('00000000-0000-0000-0008-000000000001', 'scheme_ops'),
  ('00000000-0000-0000-0008-000000000002', 'scheme_ops'),
  ('00000000-0000-0000-0008-000000000003', 'scheme_ops'),
  ('00000000-0000-0000-0008-000000000004', 'personal_financial'),
  ('00000000-0000-0000-0008-000000000005', 'scheme_ops')
ON CONFLICT (category_id) DO NOTHING;
