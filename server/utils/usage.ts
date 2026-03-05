/**
 * API usage tracking — fire-and-forget logging of token consumption
 * and estimated costs for all AI API calls (Claude + Voyage AI).
 */

type Operation = 'categorization' | 'pii_scrub' | 'entity_extraction' | 'chat' | 'email_triage' | 'embedding' | 'query_embedding'

interface UsageRecord {
  service: 'anthropic' | 'voyage'
  model: string
  operation: Operation
  input_tokens: number
  output_tokens: number
  user_id?: string
  document_id?: string
}

/** Cost per 1M tokens (USD). */
const COST_RATES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
  'voyage-3.5':                { input: 0.06,  output: 0     },
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_RATES[model]
  if (!rates) return 0
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000
}

/**
 * Logs an API usage record. Fire-and-forget — errors are logged
 * to console but never thrown, so callers are never affected.
 */
export function logUsage(record: UsageRecord): void {
  const cost = estimateCost(record.model, record.input_tokens, record.output_tokens)

  // Fire and forget — don't await
  const supabase = useSupabaseAdmin()
  supabase
    .from('api_usage')
    .insert({
      service: record.service,
      model: record.model,
      operation: record.operation,
      input_tokens: record.input_tokens,
      output_tokens: record.output_tokens,
      estimated_cost_usd: cost,
      user_id: record.user_id ?? null,
      document_id: record.document_id ?? null,
    })
    .then(({ error: insertError }: { error: any }) => {
      if (insertError) console.error('[usage] Failed to log API usage:', insertError.message)
    })
}
