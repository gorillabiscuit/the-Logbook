-- API usage tracking table
-- Stores token counts and estimated costs for all AI API calls (Claude + Voyage AI)

CREATE TABLE api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL CHECK (service IN ('anthropic', 'voyage')),
  model text NOT NULL,
  operation text NOT NULL CHECK (operation IN (
    'categorization', 'pii_scrub', 'entity_extraction',
    'chat', 'email_triage', 'embedding', 'query_embedding'
  )),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_api_usage_created_at ON api_usage (created_at);
CREATE INDEX idx_api_usage_user_id ON api_usage (user_id);
CREATE INDEX idx_api_usage_operation ON api_usage (operation);

-- RLS
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

-- Users see their own rows
CREATE POLICY "api_usage_select_own" ON api_usage FOR SELECT USING (
  user_id = auth.uid()
);

-- Admins see all rows
CREATE POLICY "api_usage_select_admin" ON api_usage FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('super_admin', 'trustee')
  )
);

-- Insert only via service role (no user-facing insert policy)
-- The service role client bypasses RLS, so no INSERT policy is needed.

-- Summary function: all usage grouped by operation + service
CREATE OR REPLACE FUNCTION usage_summary()
RETURNS TABLE (
  operation text,
  service text,
  total_input_tokens bigint,
  total_output_tokens bigint,
  total_cost_usd numeric,
  call_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    operation,
    service,
    SUM(input_tokens)::bigint AS total_input_tokens,
    SUM(output_tokens)::bigint AS total_output_tokens,
    SUM(estimated_cost_usd) AS total_cost_usd,
    COUNT(*)::bigint AS call_count
  FROM api_usage
  GROUP BY operation, service
  ORDER BY total_cost_usd DESC;
$$;

-- Summary since a given date
CREATE OR REPLACE FUNCTION usage_summary_since(since_date timestamptz)
RETURNS TABLE (
  operation text,
  service text,
  total_input_tokens bigint,
  total_output_tokens bigint,
  total_cost_usd numeric,
  call_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    operation,
    service,
    SUM(input_tokens)::bigint AS total_input_tokens,
    SUM(output_tokens)::bigint AS total_output_tokens,
    SUM(estimated_cost_usd) AS total_cost_usd,
    COUNT(*)::bigint AS call_count
  FROM api_usage
  WHERE created_at >= since_date
  GROUP BY operation, service
  ORDER BY total_cost_usd DESC;
$$;

-- Summary for a specific user
CREATE OR REPLACE FUNCTION usage_summary_for_user(target_user_id uuid)
RETURNS TABLE (
  operation text,
  service text,
  total_input_tokens bigint,
  total_output_tokens bigint,
  total_cost_usd numeric,
  call_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    operation,
    service,
    SUM(input_tokens)::bigint AS total_input_tokens,
    SUM(output_tokens)::bigint AS total_output_tokens,
    SUM(estimated_cost_usd) AS total_cost_usd,
    COUNT(*)::bigint AS call_count
  FROM api_usage
  WHERE user_id = target_user_id
  GROUP BY operation, service
  ORDER BY total_cost_usd DESC;
$$;

-- Summary for a specific user since a given date
CREATE OR REPLACE FUNCTION usage_summary_for_user_since(target_user_id uuid, since_date timestamptz)
RETURNS TABLE (
  operation text,
  service text,
  total_input_tokens bigint,
  total_output_tokens bigint,
  total_cost_usd numeric,
  call_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    operation,
    service,
    SUM(input_tokens)::bigint AS total_input_tokens,
    SUM(output_tokens)::bigint AS total_output_tokens,
    SUM(estimated_cost_usd) AS total_cost_usd,
    COUNT(*)::bigint AS call_count
  FROM api_usage
  WHERE user_id = target_user_id
    AND created_at >= since_date
  GROUP BY operation, service
  ORDER BY total_cost_usd DESC;
$$;
